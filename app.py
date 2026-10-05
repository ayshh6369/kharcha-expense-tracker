"""
Kharcha - expense tracker backend (Flask + SQLite).
Serves the REST API under /api and the frontend (PWA) from ../frontend.

Run:  python app.py
"""
import csv
import io
import os
import re
import secrets
import socket
import sqlite3
from datetime import date, datetime, timedelta
from functools import wraps

from flask import Flask, Response, g, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
FRONTEND = os.path.abspath(os.path.join(BASE, "..", "frontend"))
DB_PATH = os.environ.get("KHARCHA_DB", os.path.join(BASE, "expenses.db"))

app = Flask(__name__, static_folder=None)

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    budget        REAL NOT NULL DEFAULT 0,
    currency      TEXT NOT NULL DEFAULT '₹',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS tokens (
    token      TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS transactions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount     REAL NOT NULL CHECK (amount > 0),
    category   TEXT NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    date       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, date);
"""


# ---------- database helpers ----------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


# ---------- auth ----------
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def error(message, status=400):
    return jsonify({"error": message}), status


def user_json(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "budget": row["budget"],
        "currency": row["currency"],
    }


def new_token(user_id):
    token = secrets.token_urlsafe(32)
    get_db().execute("INSERT INTO tokens (token, user_id) VALUES (?, ?)", (token, user_id))
    get_db().commit()
    return token


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else ""
        row = get_db().execute(
            "SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ?",
            (token,),
        ).fetchone()
        if row is None:
            return error("Please log in again.", 401)
        g.user = row
        g.token = token
        return fn(*args, **kwargs)

    return wrapper


@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()[:60]
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if not name:
        return error("Enter your name.")
    if not EMAIL_RE.match(email):
        return error("Enter a valid email address.")
    if len(password) < 6:
        return error("Password must be at least 6 characters.")
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
        return error("An account with this email already exists.", 409)
    cur = db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        (name, email, generate_password_hash(password)),
    )
    db.commit()
    user = db.execute("SELECT * FROM users WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"token": new_token(user["id"]), "user": user_json(user)}), 201


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if user is None or not check_password_hash(user["password_hash"], password):
        return error("Wrong email or password.", 401)
    return jsonify({"token": new_token(user["id"]), "user": user_json(user)})


@app.post("/api/logout")
@login_required
def logout():
    get_db().execute("DELETE FROM tokens WHERE token = ?", (g.token,))
    get_db().commit()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def me():
    return jsonify({"user": user_json(g.user)})


@app.put("/api/me")
@login_required
def update_me():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", g.user["name"])).strip()[:60] or g.user["name"]
    currency = str(data.get("currency", g.user["currency"])).strip()[:4] or g.user["currency"]
    try:
        budget = float(data.get("budget", g.user["budget"]))
    except (TypeError, ValueError):
        return error("Budget must be a number.")
    if budget < 0:
        return error("Budget cannot be negative.")
    db = get_db()
    db.execute(
        "UPDATE users SET name = ?, currency = ?, budget = ? WHERE id = ?",
        (name, currency, budget, g.user["id"]),
    )
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id = ?", (g.user["id"],)).fetchone()
    return jsonify({"user": user_json(row)})


@app.delete("/api/me")
@login_required
def delete_me():
    db = get_db()
    db.execute("DELETE FROM users WHERE id = ?", (g.user["id"],))
    db.commit()
    return jsonify({"ok": True})


# ---------- transactions ----------
def tx_json(row):
    return {k: row[k] for k in ("id", "type", "amount", "category", "note", "date")}


def parse_tx(data):
    """Validate a transaction payload. Returns (clean_dict, error_message)."""
    tx_type = data.get("type")
    if tx_type not in ("expense", "income"):
        return None, "Choose expense or income."
    try:
        amount = round(float(data.get("amount")), 2)
    except (TypeError, ValueError):
        return None, "Enter a valid amount."
    if amount <= 0 or amount > 1e9:
        return None, "Amount must be greater than zero."
    category = str(data.get("category", "")).strip()[:40]
    if not category:
        return None, "Choose a category."
    note = str(data.get("note", "")).strip()[:200]
    try:
        day = datetime.strptime(str(data.get("date", "")), "%Y-%m-%d").date().isoformat()
    except ValueError:
        return None, "Enter a valid date."
    return {"type": tx_type, "amount": amount, "category": category, "note": note, "date": day}, None


def month_bounds(month):
    """'2026-10' -> ('2026-10-01', '2026-11-01') or None if invalid."""
    try:
        start = datetime.strptime(month, "%Y-%m").date()
    except (TypeError, ValueError):
        return None
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1)
    return start.isoformat(), end.isoformat()


@app.get("/api/transactions")
@login_required
def list_transactions():
    sql = "SELECT * FROM transactions WHERE user_id = ?"
    args = [g.user["id"]]
    month = request.args.get("month")
    if month:
        bounds = month_bounds(month)
        if not bounds:
            return error("Invalid month.")
        sql += " AND date >= ? AND date < ?"
        args += list(bounds)
    if request.args.get("category"):
        sql += " AND category = ?"
        args.append(request.args["category"])
    if request.args.get("type") in ("expense", "income"):
        sql += " AND type = ?"
        args.append(request.args["type"])
    q = request.args.get("q", "").strip()
    if q:
        sql += " AND (note LIKE ? OR category LIKE ?)"
        args += [f"%{q}%", f"%{q}%"]
    sql += " ORDER BY date DESC, id DESC LIMIT 1000"
    rows = get_db().execute(sql, args).fetchall()
    return jsonify({"transactions": [tx_json(r) for r in rows]})


@app.post("/api/transactions")
@login_required
def create_transaction():
    clean, problem = parse_tx(request.get_json(silent=True) or {})
    if problem:
        return error(problem)
    db = get_db()
    cur = db.execute(
        "INSERT INTO transactions (user_id, type, amount, category, note, date) VALUES (?, ?, ?, ?, ?, ?)",
        (g.user["id"], clean["type"], clean["amount"], clean["category"], clean["note"], clean["date"]),
    )
    db.commit()
    row = db.execute("SELECT * FROM transactions WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify({"transaction": tx_json(row)}), 201


@app.put("/api/transactions/<int:tx_id>")
@login_required
def update_transaction(tx_id):
    clean, problem = parse_tx(request.get_json(silent=True) or {})
    if problem:
        return error(problem)
    db = get_db()
    cur = db.execute(
        "UPDATE transactions SET type = ?, amount = ?, category = ?, note = ?, date = ? "
        "WHERE id = ? AND user_id = ?",
        (clean["type"], clean["amount"], clean["category"], clean["note"], clean["date"], tx_id, g.user["id"]),
    )
    db.commit()
    if cur.rowcount == 0:
        return error("Transaction not found.", 404)
    row = db.execute("SELECT * FROM transactions WHERE id = ?", (tx_id,)).fetchone()
    return jsonify({"transaction": tx_json(row)})


@app.delete("/api/transactions/<int:tx_id>")
@login_required
def delete_transaction(tx_id):
    db = get_db()
    cur = db.execute("DELETE FROM transactions WHERE id = ? AND user_id = ?", (tx_id, g.user["id"]))
    db.commit()
    if cur.rowcount == 0:
        return error("Transaction not found.", 404)
    return jsonify({"ok": True})


# ---------- summary & export ----------
@app.get("/api/summary")
@login_required
def summary():
    month = request.args.get("month") or date.today().strftime("%Y-%m")
    bounds = month_bounds(month)
    if not bounds:
        return error("Invalid month.")
    db = get_db()
    uid = g.user["id"]

    totals = {"expense": 0.0, "income": 0.0}
    for r in db.execute(
        "SELECT type, SUM(amount) AS total FROM transactions "
        "WHERE user_id = ? AND date >= ? AND date < ? GROUP BY type",
        (uid, *bounds),
    ):
        totals[r["type"]] = r["total"] or 0.0

    by_category = [
        {"category": r["category"], "total": r["total"]}
        for r in db.execute(
            "SELECT category, SUM(amount) AS total FROM transactions "
            "WHERE user_id = ? AND type = 'expense' AND date >= ? AND date < ? "
            "GROUP BY category ORDER BY total DESC",
            (uid, *bounds),
        )
    ]

    # last 6 months of expense totals, oldest first
    first = datetime.strptime(month, "%Y-%m").date()
    months = []
    y, m = first.year, first.month
    for _ in range(6):
        months.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    months.reverse()
    spent = {
        r["ym"]: r["total"]
        for r in db.execute(
            "SELECT substr(date, 1, 7) AS ym, SUM(amount) AS total FROM transactions "
            "WHERE user_id = ? AND type = 'expense' AND substr(date, 1, 7) BETWEEN ? AND ? GROUP BY ym",
            (uid, months[0], months[-1]),
        )
    }
    trend = [{"month": mm, "total": spent.get(mm, 0.0)} for mm in months]

    return jsonify(
        {
            "month": month,
            "income": totals["income"],
            "expense": totals["expense"],
            "balance": totals["income"] - totals["expense"],
            "budget": g.user["budget"],
            "by_category": by_category,
            "trend": trend,
        }
    )


@app.get("/api/export.csv")
@login_required
def export_csv():
    rows = get_db().execute(
        "SELECT date, type, category, amount, note FROM transactions WHERE user_id = ? ORDER BY date, id",
        (g.user["id"],),
    ).fetchall()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Date", "Type", "Category", "Amount", "Note"])
    for r in rows:
        writer.writerow([r["date"], r["type"], r["category"], r["amount"], r["note"]])
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=kharcha-export.csv"},
    )


# ---------- frontend ----------
@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")


@app.get("/sw.js")
def service_worker():
    resp = send_from_directory(FRONTEND, "sw.js")
    resp.headers["Cache-Control"] = "no-cache"
    resp.headers["Service-Worker-Allowed"] = "/"
    return resp


@app.get("/<path:filename>")
def static_files(filename):
    if filename.startswith("api/"):
        return error("Not found.", 404)
    return send_from_directory(FRONTEND, filename)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print("\n  Kharcha is running")
    print(f"  On this laptop:      http://localhost:{port}")
    print(f"  On your phone (same Wi-Fi): http://{lan_ip()}:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=False)
