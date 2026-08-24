# 📚 BookBinder

BookBinder is an open-source, self-hosted, web-based home library management system designed to catalog, track, and organize physical book collections. It serves as a personal inventory engine, bridging the gap between digital indexing and the physical layout of your household or storage spaces.

---

## ✨ What it does

* **Catalog by barcode.** Scan an ISBN with your phone's camera and the book is looked up automatically via Google Books and OpenLibrary. Older paperbacks carrying a UPC rather than a Bookland EAN are learned on first scan: enter the book once, and every later scan of that barcode resolves locally.
* **Scan without picking a shelf first.** The scan button lives in the app chrome. Each capture answers *do I already own this?* before asking where to file it, so you can stand in a bookshop and check.
* **Shelves that map to real places.** Every copy records a physical location — which shelf, which box, which room — because the point is finding the book again.
* **Wishlists**, marked per shelf, so wanted books live alongside owned ones without polluting the count.
* **Sharing.** Shelves can be shared read-only or as a collaborator who can add and edit.
* **Read tracking**, per copy rather than per title.
* **Admin console** — account management, open-registration toggle, external lookup switches, catalog cache pruning, and database backup/restore.
* **Themes** — light and dark, with selectable accent palettes, remembered per user.

---

## 🛠️ Technology Stack

* **Frontend:** React 18 SPA (Vite, React Router, mobile-first layouts, `html5-qrcode` camera scanning, lucide icons, per-user theme manager)
* **Backend:** Express 4 REST API (JWT in HttpOnly cookies, role-based access control, bearer API tokens for automation)
* **Database:** PostgreSQL 16 (relational schema, catalog-level deduplication, shared-shelf junctions; schema self-applies on boot)
* **Deployment:** Docker Compose — one app container serving the API and the built SPA, one Postgres container, two named volumes
* **Testing:** Jest + supertest (backend), Vitest + Testing Library (frontend), Playwright (end-to-end, real browser against the full stack), ESLint at zero warnings

---

## 🚀 Getting Started

You need Docker and Docker Compose. Nothing else — Node is only required if you want to run the app outside containers.

```bash
git clone https://git.wanmedia.net/Optx/BookBinder.git
cd BookBinder
cp .env.example .env
```

Edit `.env` before the first boot. Three values matter:

| Variable | Why it matters |
|---|---|
| `JWT_SECRET` | Signs session cookies. Change it from the example value, and don't change it afterwards — every existing session dies when you do. |
| `BOOKBINDER_ADMIN_EMAIL` / `_PASS` | Seeds the first administrator, and **only** on a genuinely empty database. See [Administrator Access](#-administrator-access). |
| `GOOGLE_BOOKS_API_KEY` | Optional but recommended. Without it, wildcard searches hit Google's unauthenticated rate limit and start returning `429`. |
| `TRUST_PROXY_HOPS` | How many reverse proxies sit in front of the app. `1` (the default) suits a Cloudflare Tunnel or a single nginx; use `0` when the port is reachable directly. Getting this wrong matters — see below. |
| `RATE_LIMIT_AUTH_MAX` / `_ADMIN_MAX` | Requests allowed per client IP per 15 minutes before a `429`. Defaults: 10 for `/api/auth/*`, 60 for `/api/admin/*`. |

Then:

```bash
docker compose up -d --build
```

The app is at **http://localhost:5000** (change with `PORT`). Sign in with the admin credentials you just set. Open registration is **off** by default — turn it on in the admin console if you want others to sign themselves up.

### A note on `TRUST_PROXY_HOPS`

The rate limiters identify a client by `req.ip`, and Express derives that from `X-Forwarded-For` — a header the client writes. This setting is what tells Express how much of it to believe.

Set it to the number of proxies actually in front of the container. Too high and a client can forge the header to mint a fresh rate-limit budget on every request, defeating the throttle entirely; too low and every request appears to come from your proxy, so one attacker locks out everybody.

Note that `docker-compose.yml` publishes port 5000 on the host. If that port is reachable from anywhere other than your tunnel, either set `TRUST_PROXY_HOPS=0` or bind the mapping to `127.0.0.1:${PORT}:5000` so only the local tunnel can reach it.

---

## 💻 Development

Running outside Docker needs a Postgres reachable on `localhost:5432` — the compose file's `db` service is fine on its own:

```bash
docker compose up -d db

cd backend && npm install && npm run dev     # API on :5000, nodemon
cd frontend && npm install && npm run dev    # Vite on :5173, proxies /api to :5000
```

### Tests

```bash
cd backend  && npx jest         # unit + route tests, db and child_process mocked
cd frontend && npx vitest run   # component tests, jsdom
cd frontend && npm run lint     # eslint, --max-warnings 0
cd e2e      && npm test         # Playwright against a real stack it builds itself
```

The e2e suite boots and tears down its own containers; see [e2e/README.md](e2e/README.md). `npm run tour` there screenshots every screen and audits contrast.

---

## 📂 Project Structure

```
BookBinder/
├── backend/
│   ├── src/
│   │   ├── db/            init.sql — schema, replayed idempotently on every boot
│   │   ├── middleware/    cookie auth, bearer API tokens, share access
│   │   ├── routes/        auth, users, bookshelves, books, shares, settings, admin backup
│   │   ├── services/      pg_dump / pg_restore wrapper
│   │   └── utils/         ISBN normalisation, session cookie, token minting
│   ├── scripts/           reset-admin.js
│   └── tests/             Jest + supertest
├── frontend/
│   └── src/
│       ├── components/    Modal, BarcodeScanner, ScanModal, BookVolume, BackupCard, Layout
│       ├── context/       AuthProvider, ThemeProvider
│       ├── pages/         Dashboard, BookshelfDetails, AdminConsole, ProfileSettings, auth
│       └── tests/         Vitest + Testing Library
├── e2e/                   Playwright suite and design tour
├── docs/                  design specs and implementation plans
├── scripts/watchdog.sh    optional auto-deploy poller (see Deployment)
├── docker-compose.yml     app + db, two named volumes
├── Dockerfile             two stages: build the SPA, then serve it from Express
└── BookBinder_PRD.md      product requirements
```

---

## 🚢 Deployment

The published container serves both the API and the built SPA on a single port, so it sits behind a reverse proxy or tunnel without extra routing. Behind TLS termination, `trust proxy` honours `X-Forwarded-Proto` — the session cookie's `Secure` flag follows the browser's connection rather than the app's, which is what lets it work over both a LAN address and a public HTTPS host.

`scripts/watchdog.sh` is an optional auto-updater for a self-hosted box: it polls the remote branch every 60s and rebuilds the stack only when a new commit lands. Set `PROJECT_DIR` and `BRANCH` inside it before use.

---

## 🔑 Administrator Access

`BOOKBINDER_ADMIN_EMAIL` and `BOOKBINDER_ADMIN_PASS` seed the first administrator, and only ever on a **genuinely empty** database — the seeding step is skipped as soon as any user exists. Changing the password in the app is therefore permanent: restarting the stack will not revert it, and editing `.env` afterwards has no effect on an existing install.

**To change your own password**, sign in and use Profile → Update Password.

**If nobody can sign in** — a forgotten password, or an administrator who disabled their own account — recover from the host:

```bash
docker compose exec app npm run reset-admin
```

It prompts for the new password (twice, without echoing, so it stays out of your shell history) and resets the account named by `BOOKBINDER_ADMIN_EMAIL`. To target a different account:

```bash
docker compose exec app npm run reset-admin -- --email someone@example.com
```

The tool never creates an account: an address it does not recognise is an error, so a typo cannot quietly mint a second administrator. It re-enables the account if it was disabled, and signs out every existing session for it.

---

## 💾 Backups

Your data lives in two named Docker volumes:

* **`bookbinder-pg-data`** — the Postgres cluster (books, shelves, users, everything relational).
* **`bookbinder-uploads-data`** — avatar images.

On a Linux host you'll find them under `/var/lib/docker/volumes/<name>/_data`. Both volumes survive `docker compose down`, container restarts, and image rebuilds — the only thing that destroys them is `docker compose down -v`.

**From the admin console**, open Admin Console → Database Backup & Restore. There you can:

* **Download a backup** — a `pg_dump` archive of the database, sent as an attachment. The
  export is buffered on the server and only sent once `pg_dump` has exited successfully —
  it does not stream — so a dump that fails midway never arrives as a truncated file
  carrying a `200`.
* **Restore a backup** — upload an archive to replace the database. You must type `REPLACE_ALL_DATA` to confirm; this is a guard against automation firing by accident, not a security control, so treat it as seriously as you'd treat dropping the database yourself.
* **Mint and revoke API tokens** — for scripting backups without a browser session (see below).

**Avatars are not included in a database backup.** Back up the uploads volume separately:

```bash
docker run --rm -v bookbinder-uploads-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/bookbinder-uploads-$(date +%F).tar.gz -C /data .
```

### Automating backups

Mint a token from the admin console, then point anything that can send a header and save a response body at the endpoint. The whole contract is four lines:

| | |
|---|---|
| **Request** | `GET /api/admin/backup` |
| **Auth** | `Authorization: Bearer bb_...` |
| **Success** | `200`, and the body *is* the `.dump` archive |
| **Failure** | `500` with a JSON error body — never a truncated file |

Branch on the status code; there's no need to inspect the downloaded bytes to know whether the backup succeeded. The examples below are three ways to do that, none of them privileged over the others.

**cron + curl**

```bash
0 3 * * * curl -fsS -H "Authorization: Bearer bb_..." \
  -o "/backups/bookbinder-$(date +\%F).dump" \
  https://<host>/api/admin/backup
```

`-f` makes curl exit non-zero on that `500`, so a failed backup is a failed cron job rather than a silent one. Note the escaped `\%` — crontab treats a bare `%` as a newline and the command will fail in a way that is genuinely annoying to diagnose.

**n8n**

```
Schedule Trigger (nightly)
  → HTTP Request
      GET https://<host>/api/admin/backup
      Header: Authorization: Bearer bb_...
      Response format: File
  → Write Binary File (or an S3 / Dropbox / Nextcloud node)
```

Set the HTTP Request node to **continue on fail** if you want the workflow to handle the `500` itself rather than halting — otherwise a failed dump stops the run, which is also a perfectly reasonable way to find out.

**Postman, Insomnia, or any REST client**

Set the `Authorization` header, send, then *Save response → Save to a file*. Worth doing once before you automate anything: it confirms the token works and that what comes back is a real archive. These clients won't run your nightly backup, though — for that, use a scheduler like the two above.

### Restoring is destructive

Restoring replaces every row in the database. Alongside the file, the restore endpoint requires a `confirm=REPLACE_ALL_DATA` field — without it, nothing happens. And because restoring rewrites the `users` table too, restoring an archive whose users differ from your current ones will sign you out; signing in again afterward is expected, not a bug.

**Restoring also rewrites `api_tokens`,** since that table is part of the dump like any other. Any token minted after the archive was taken — including, potentially, the very credential the automation used to call the restore endpoint — reverts to whatever tokens existed at backup time and stops working. If a scheduled backup job starts failing with `401` right after a restore, mint a fresh token from the console; this is expected, not a sign the restore went wrong.

**A caveat on older backups:** restoring an archive taken before a schema change can fail. The restore drops the tables present in the archive before reloading them, and if a newer table (added since that backup) holds a foreign key into one of those tables, the drop is blocked and the restore aborts. This fails safe — the whole restore runs as one transaction, so a blocked drop rolls everything back and your current data is left untouched — but it does mean an old backup won't restore in place. The fix is to restore it into a fresh database instead.

### API tokens are admin-equivalent secrets

A token can download a backup containing every user's row, password hashes included, and can trigger a full restore. Treat it like an admin password: it's shown once at creation and never again, so store it somewhere durable immediately, and revoke it from the console the moment it's no longer needed.

---

*Made with love by Antigravity.*
