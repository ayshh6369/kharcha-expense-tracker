(() => {
  "use strict";

  const CATS = {
    expense: ["Food", "Transport", "Shopping", "Bills", "Rent", "Health", "Education", "Entertainment", "Travel", "Other"],
    income: ["Salary", "Business", "Gift", "Other income"],
  };
  const COLORS = {
    Food: "#d9480f", Transport: "#1971c2", Shopping: "#a61e9a", Bills: "#6741d9", Rent: "#0b7285",
    Health: "#c92a2a", Education: "#2b8a3e", Entertainment: "#e8590c", Travel: "#1098ad", Other: "#6b6b80",
    Salary: "#2e7d5b", Business: "#087f5b", Gift: "#c2255c", "Other income": "#5c7cfa",
  };
  document.getElementById("app").innerHTML = `
   ...
    `;
  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20V10M12 20V4M19 20v-7"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  };
  const TABS = [["home", "Home"], ["history", "History"], ["stats", "Stats"], ["settings", "Settings"]];

  const state = {
    token: localStorage.getItem("kharcha_token"),
    user: null,
    tab: "home",
    month: monthKey(new Date()),
    summary: null,
    txs: [],
    filter: { q: "", category: "", type: "" },
    sheet: null,        // null | { tx: object|null, type: 'expense'|'income' }
    authMode: "login",
    authError: "",
    installPrompt: null,
  };

  const app = document.getElementById("app");

  /* ---------- helpers ---------- */
  function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
  function today() { return new Date().toLocaleDateString("en-CA"); }
  function shiftMonth(key, delta) {
    const [y, m] = key.split("-").map(Number);
    return monthKey(new Date(y, m - 1 + delta, 1));
  }
  function monthLabel(key, long) {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: long ? "long" : "short", year: "numeric" });
  }
  function dayLabel(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function money(n) {
    const cur = state.user ? state.user.currency : "₹";
    return cur + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n || 0);
  }
  function colorOf(cat) { return COLORS[cat] || "#6b6b80"; }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  function setSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem("kharcha_token", token);
  }
  function clearSession() {
    state.token = null;
    state.user = null;
    state.summary = null;
    state.txs = [];
    localStorage.removeItem("kharcha_token");
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (state.token) headers.Authorization = "Bearer " + state.token;
    let res;
    try {
      res = await fetch("/api" + path, {
        method: opts.method || "GET",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new Error("Can't reach the server. Check that it is running and you are online.");
    }
    if (res.status === 401 && state.token) {
      clearSession();
      state.authError = "Please log in again.";
      render();
      throw new Error("Please log in again.");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  /* ---------- data loading ---------- */
  async function loadMonth() {
    const [s, t] = await Promise.all([
      api("/summary?month=" + state.month),
      api("/transactions?month=" + state.month),
    ]);
    state.summary = s;
    state.txs = t.transactions;
  }

  async function boot() {
    if (state.token) {
      try {
        state.user = (await api("/me")).user;
        await loadMonth();
      } catch (e) {
        if (state.token) toast(e.message);
      }
    }
    render();
  }

  async function refresh() {
    try { await loadMonth(); } catch (e) { toast(e.message); }
    render();
  }

  /* ---------- rendering ---------- */
  function render() {
    if (!state.token || !state.user) { app.innerHTML = authView(); return; }
    const views = { home: homeView, history: historyView, stats: statsView, settings: settingsView };
    app.innerHTML = `
      <div class="shell">
        <div class="topbar">
          <div class="brand">Kharcha</div>
          ${state.tab !== "settings" ? `
          <div class="month-nav">
            <button class="icon-btn" data-action="month-prev" aria-label="Previous month">‹</button>
            <span>${esc(monthLabel(state.month))}</span>
            <button class="icon-btn" data-action="month-next" aria-label="Next month">›</button>
          </div>` : ""}
        </div>
        ${state.summary ? views[state.tab]() : '<div class="empty">Loading…</div>'}
      </div>
      <button class="fab" data-action="add" aria-label="Add transaction">+</button>
      <nav class="nav" aria-label="Main">
        ${TABS.map(([id, label]) => `
          <button data-action="tab" data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${ICONS[id]}${label}</button>`).join("")}
      </nav>
      ${state.sheet ? sheetView() : ""}`;
    if (state.tab === "history") fillHistoryList();
  }

  function authView() {
    const reg = state.authMode === "register";
    return `
      <div class="auth">
        <h1>Kharcha</h1>
        <p>${reg ? "Create an account to start tracking your spending." : "Log in to see your spending."}</p>
        <form data-form="auth" novalidate>
          ${reg ? '<label for="a-name">Name</label><input id="a-name" name="name" autocomplete="name" required>' : ""}
          <label for="a-email">Email</label>
          <input id="a-email" name="email" type="email" inputmode="email" autocomplete="email" required>
          <label for="a-pass">Password</label>
          <input id="a-pass" name="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}" required>
          <p class="form-error" role="alert">${esc(state.authError)}</p>
          <button class="btn" type="submit">${reg ? "Create account" : "Log in"}</button>
        </form>
        <p style="text-align:center;margin-top:14px">
          <button class="link" data-action="auth-switch">${reg ? "I already have an account" : "Create a new account"}</button>
        </p>
      </div>`;
  }

  function txItem(t) {
    return `
      <button class="item" data-action="edit" data-id="${t.id}">
        <span class="dot" style="background:${colorOf(t.category)}" aria-hidden="true">${esc(t.category.charAt(0))}</span>
        <span class="meta"><b>${esc(t.category)}</b><span>${esc(t.note || dayLabel(t.date))}</span></span>
        <span class="amt ${t.type}">${t.type === "expense" ? "−" : "+"}${money(t.amount)}</span>
      </button>`;
  }

  function homeView() {
    const s = state.summary;
    const hasBudget = s.budget > 0;
    const left = s.budget - s.expense;
    const pct = hasBudget ? Math.min(100, (s.expense / s.budget) * 100) : 0;
    const over = hasBudget && left < 0;
    const recent = state.txs.slice(0, 6);
    return `
      <section class="hero">
        <small>${hasBudget ? (over ? "Over budget in " : "Left to spend in ") : "Spent in "}${esc(monthLabel(state.month, true))}</small>
        <div class="big ${over ? "over" : ""}">${money(hasBudget ? Math.abs(left) : s.expense)}</div>
        ${hasBudget ? `
          <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
            <i class="${over ? "over" : ""}" style="width:${pct}%"></i>
          </div>
          <div class="meter-note"><span>Spent ${money(s.expense)}</span><span>Budget ${money(s.budget)}</span></div>`
        : `<div class="meter-note"><span>Set a monthly budget in Settings to see what is left.</span></div>`}
      </section>
      <div class="row2">
        <div class="stat in"><small>Income</small><b>${money(s.income)}</b></div>
        <div class="stat"><small>Balance</small><b>${s.balance < 0 ? "−" : ""}${money(Math.abs(s.balance))}</b></div>
      </div>
      <h2>Recent</h2>
      ${recent.length ? `<div class="list">${recent.map(txItem).join("")}</div>`
        : '<div class="empty">Nothing recorded this month. Tap + to add your first expense.</div>'}`;
  }

  function historyView() {
    const f = state.filter;
    const allCats = [...new Set([...CATS.expense, ...CATS.income])];
    return `
      <div class="filters">
        <input type="search" id="f-q" placeholder="Search notes or categories" value="${esc(f.q)}" aria-label="Search">
        <select id="f-cat" aria-label="Category">
          <option value="">All categories</option>
          ${allCats.map((c) => `<option ${f.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
        <select id="f-type" aria-label="Type">
          <option value="">Expenses and income</option>
          <option value="expense" ${f.type === "expense" ? "selected" : ""}>Expenses only</option>
          <option value="income" ${f.type === "income" ? "selected" : ""}>Income only</option>
        </select>
      </div>
      <div id="hist-list"></div>`;
  }

  async function fillHistoryList() {
    const box = document.getElementById("hist-list");
    if (!box) return;
    const f = state.filter;
    const qs = new URLSearchParams({ month: state.month });
    if (f.q) qs.set("q", f.q);
    if (f.category) qs.set("category", f.category);
    if (f.type) qs.set("type", f.type);
    try {
      const { transactions } = await api("/transactions?" + qs);
      state.histTxs = transactions;
      if (!document.getElementById("hist-list")) return;
      if (!transactions.length) {
        box.innerHTML = '<div class="empty" style="margin-top:14px">No transactions match.</div>';
        return;
      }
      let html = "", cur = "", open = false;
      for (const t of transactions) {
        if (t.date !== cur) {
          if (open) html += "</div>";
          cur = t.date;
          html += `<div class="day-label">${esc(dayLabel(cur))}</div><div class="list">`;
          open = true;
        }
        html += txItem(t);
      }
      box.innerHTML = html + (open ? "</div>" : "");
    } catch (e) { toast(e.message); }
  }

  function statsView() {
    const s = state.summary;
    const max = Math.max(...s.trend.map((t) => t.total), 1);
    return `
      <h2>Where the money went</h2>
      ${s.by_category.length ? s.by_category.map((c) => {
        const pct = s.expense ? (c.total / s.expense) * 100 : 0;
        return `
          <div class="bar-row">
            <div class="head"><span>${esc(c.category)}</span><b>${money(c.total)} · ${pct.toFixed(0)}%</b></div>
            <div class="meter"><i style="width:${pct}%;--c:${colorOf(c.category)}"></i></div>
          </div>`;
      }).join("") : '<div class="empty">No expenses this month.</div>'}
      <h2>Last 6 months</h2>
      <div class="trend">
        ${s.trend.map((t) => `
          <div class="col ${t.month === state.month ? "now" : ""}" title="${money(t.total)}">
            <i style="height:${(t.total / max) * 100}%"></i>
            <span>${esc(monthLabel(t.month).split(" ")[0])}</span>
          </div>`).join("")}
      </div>`;
  }

  function settingsView() {
    const u = state.user;
    return `
      <h2>Profile and budget</h2>
      <form data-form="settings" novalidate>
        <label for="s-name">Name</label>
        <input id="s-name" name="name" value="${esc(u.name)}">
        <label for="s-cur">Currency symbol</label>
        <input id="s-cur" name="currency" maxlength="4" value="${esc(u.currency)}">
        <label for="s-budget">Monthly budget (0 for none)</label>
        <input id="s-budget" name="budget" inputmode="decimal" value="${u.budget || ""}" placeholder="e.g. 20000">
        <p class="form-error" role="alert" id="s-error"></p>
        <button class="btn" type="submit">Save changes</button>
      </form>
      <h2>Your data</h2>
      <button class="btn ghost" data-action="export">Download all as CSV</button>
      ${state.installPrompt ? '<button class="btn ghost" data-action="install">Install app on this phone</button>' : ""}
      <h2>Account</h2>
      <p style="color:var(--ink-soft);margin:0 0 10px">Signed in as ${esc(u.email)}</p>
      <button class="btn ghost" data-action="logout">Log out</button>
      <button class="btn danger" data-action="delete-account">Delete account and data</button>`;
  }

  function sheetView() {
    const { tx, type } = state.sheet;
    const t = tx || { amount: "", category: "", note: "", date: today() };
    return `
      <div class="scrim" data-action="close-sheet-bg">
        <form class="sheet" data-form="tx" role="dialog" aria-modal="true" aria-label="${tx ? "Edit transaction" : "Add transaction"}" novalidate>
          <h3>${tx ? "Edit transaction" : "Add transaction"}</h3>
          <div class="seg" role="group" aria-label="Type">
            <button type="button" data-action="set-type" data-type="expense" aria-pressed="${type === "expense"}">Expense</button>
            <button type="button" data-action="set-type" data-type="income" aria-pressed="${type === "income"}">Income</button>
          </div>
          <label for="t-amount">Amount</label>
          <input id="t-amount" name="amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(t.amount)}" required>
          <label for="t-cat">Category</label>
          <select id="t-cat" name="category">${catOptions(type, t.category)}</select>
          <label for="t-date">Date</label>
          <input id="t-date" name="date" type="date" value="${esc(t.date)}" required>
          <label for="t-note">Note (optional)</label>
          <input id="t-note" name="note" maxlength="200" value="${esc(t.note)}" placeholder="e.g. Lunch with Riya">
          <p class="form-error" role="alert" id="t-error"></p>
          <button class="btn" type="submit">Save</button>
          ${tx ? '<button class="btn danger" type="button" data-action="delete-tx">Delete</button>' : ""}
          <button class="btn ghost" type="button" data-action="close-sheet">Cancel</button>
        </form>
      </div>`;
  }

  function catOptions(type, selected) {
    return CATS[type].map((c) => `<option ${c === selected ? "selected" : ""}>${esc(c)}</option>`).join("");
  }

  /* ---------- events ---------- */
  app.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "close-sheet-bg") {
      if (e.target === el) { state.sheet = null; render(); }
      return;
    }
    switch (action) {
      case "auth-switch":
        state.authMode = state.authMode === "login" ? "register" : "login";
        state.authError = "";
        render();
        break;
      case "tab":
        state.tab = el.dataset.tab;
        render();
        break;
      case "month-prev":
      case "month-next":
        state.month = shiftMonth(state.month, action === "month-next" ? 1 : -1);
        await refresh();
        break;
      case "add":
        state.sheet = { tx: null, type: "expense" };
        render();
        break;
      case "edit": {
        const id = Number(el.dataset.id);
        const tx = [...(state.histTxs || []), ...state.txs].find((t) => t.id === id);
        if (tx) { state.sheet = { tx, type: tx.type }; render(); }
        break;
      }
      case "close-sheet":
        state.sheet = null;
        render();
        break;
      case "set-type": {
        const form = el.closest("form");
        const type = el.dataset.type;
        state.sheet.type = type;
        form.querySelectorAll("[data-action=set-type]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === type)));
        form.querySelector("#t-cat").innerHTML = catOptions(type, "");
        break;
      }
      case "delete-tx":
        if (confirm("Delete this transaction?")) {
          try {
            await api("/transactions/" + state.sheet.tx.id, { method: "DELETE" });
            state.sheet = null;
            toast("Deleted");
            await refresh();
          } catch (err) { toast(err.message); }
        }
        break;
      case "export":
        try {
          const res = await fetch("/api/export.csv", { headers: { Authorization: "Bearer " + state.token } });
          if (!res.ok) throw new Error("Could not export your data.");
          const url = URL.createObjectURL(await res.blob());
          const a = document.createElement("a");
          a.href = url; a.download = "kharcha-export.csv";
          document.body.appendChild(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        } catch (err) { toast(err.message); }
        break;
      case "install":
        if (state.installPrompt) {
          state.installPrompt.prompt();
          await state.installPrompt.userChoice;
          state.installPrompt = null;
          render();
        }
        break;
      case "logout":
        try { await api("/logout", { method: "POST" }); } catch { /* ignore */ }
        clearSession();
        state.authError = "";
        render();
        break;
      case "delete-account":
        if (confirm("Delete your account and all your transactions? This cannot be undone.")) {
          try {
            await api("/me", { method: "DELETE" });
            clearSession();
            state.authMode = "register";
            render();
            toast("Account deleted");
          } catch (err) { toast(err.message); }
        }
        break;
    }
  });

  app.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const kind = form.dataset.form;
    const data = Object.fromEntries(new FormData(form));
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;
    try {
      if (kind === "auth") {
        const path = state.authMode === "register" ? "/register" : "/login";
        const res = await api(path, { method: "POST", body: data });
        setSession(res.token, res.user);
        state.authError = "";
        await loadMonth();
        render();
      } else if (kind === "tx") {
        const body = { ...data, type: state.sheet.type };
        const editing = state.sheet.tx;
        await api(editing ? "/transactions/" + editing.id : "/transactions", {
          method: editing ? "PUT" : "POST",
          body,
        });
        state.sheet = null;
        toast(editing ? "Changes saved" : "Added");
        await refresh();
      } else if (kind === "settings") {
        const res = await api("/me", { method: "PUT", body: data });
        state.user = res.user;
        toast("Saved");
        await refresh();
      }
    } catch (err) {
      const target = kind === "auth" ? form.querySelector(".form-error") : form.querySelector(".form-error");
      if (state.token || kind === "auth") target.textContent = err.message;
      btn.disabled = false;
    }
  });

  // History filters (update list only so the search box keeps focus)
  let filterTimer;
  app.addEventListener("input", (e) => {
    if (e.target.id === "f-q") {
      state.filter.q = e.target.value.trim();
      clearTimeout(filterTimer);
      filterTimer = setTimeout(fillHistoryList, 250);
    }
  });
  app.addEventListener("change", (e) => {
    if (e.target.id === "f-cat") { state.filter.category = e.target.value; fillHistoryList(); }
    if (e.target.id === "f-type") { state.filter.type = e.target.value; fillHistoryList(); }
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.installPrompt = e;
    if (state.token && state.tab === "settings") render();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  boot();
})();
