# Kharcha - Expense Tracker (free, self-hosted)

Python (Flask) + SQLite backend, HTML/CSS/JS frontend, installable on Android as an app (PWA).
Everything runs on your laptop. No paid services.

## Features
- Accounts (register / log in), each person sees only their own data
- Add, edit, delete expenses and income with category, date, note
- Monthly view: budget meter, income, balance, recent items
- History with search and filters, grouped by day
- Stats: spending by category and the last 6 months
- Monthly budget, currency symbol, CSV export, delete account
- Works as an installed app, light and dark theme

## 1. Run the server on your laptop
1. Install Python 3.9+ from python.org (tick "Add Python to PATH" on Windows).
2. Double-click `start.bat` (Windows) or run `./start.sh` (Mac/Linux).
   Or manually:
   ```
   cd backend
   pip install -r requirements.txt
   python app.py
   ```
3. The terminal prints two addresses. Keep it open while people use the app.
   Data is stored in `backend/expenses.db` (back this file up).

## 2. Use it on your phone (same Wi-Fi)
1. Allow Python through the firewall when Windows asks (Private networks).
2. On the phone open the "On your phone" address, e.g. `http://192.168.1.5:5000`, in Chrome.
3. Chrome menu -> "Add to Home screen". It opens like an app.
Note: over plain http Chrome adds a shortcut; the full "Install app" needs https (step 3).

## 3. Let anyone install it from anywhere (free, https)
Use a free Cloudflare quick tunnel; no account or router settings needed:
1. Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. With the server running, in a second terminal: `cloudflared tunnel --url http://localhost:5000`
3. It prints an `https://something.trycloudflare.com` link. Share it. People open it in Chrome and tap
   "Install app" (or Settings -> "Install app on this phone" inside Kharcha).
The link changes each time you restart the tunnel, and the app only works while your laptop and the
server are on. For a permanent address use a free Cloudflare account with a named tunnel, or deploy
the `backend` + `frontend` folders to any free Python host (e.g. PythonAnywhere).

## 4. Optional: a real APK
With a public https link, paste it into https://www.pwabuilder.com and choose Android to get an APK/AAB.

## Security notes
- Passwords are hashed; sessions use random tokens.
- If you expose it to the internet, you are holding other people's financial notes. Keep the laptop updated
  and back up `expenses.db`. For wide public use, move to a hosted server with a production WSGI server.
