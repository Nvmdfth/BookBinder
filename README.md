# 📚 BookBinder

BookBinder is an open-source, self-hosted, web-based home library management system designed to catalog, track, and organize physical book collections. It serves as a personal inventory engine, bridging the gap between digital indexing and the physical layout of your household or storage spaces.

---

## 🛠️ Technology Stack
* **Frontend:** React (Single Page Application, Mobile-First responsive layouts, custom dual-tone Theme Manager, and HTML5-qrcode scanning stream)
* **Backend:** Express.js (REST API, Role-Based Access Control, JWT authentication with HttpOnly cookies)
* **Database:** PostgreSQL (Relational schema, database-level deduplication, shared-shelf junctions)
* **Deployment:** Docker & Docker Compose (Multi-container production configuration with data volume persistence)

---

## 📂 Project Structure & Agent Orchestration
This workspace has been pre-configured with active scaffolding to support clean developer workflows, both manual and automated through **Antigravity AI agent orchestration**:

```
BookBinder/
├── .agents/
│   └── skills/
│       └── bookbinder_developer/
│           └── SKILL.md          <-- Developer skill & constraints for the AI agent
├── skills/
│   └── bookbinder_developer/
│       └── SKILL.md              <-- Duplicate root skill mirror
├── .gitignore                    <-- Standard git exclusions for Node, React, Docker, and DBs
├── .antigravityignore             <-- High-speed ignore indexes to optimize AI context window
├── BookBinder_PRD.md             <-- Core Product Requirements Document (PRD)
└── README.md                     <-- General developer information
```

### Active Configuration Files
* **`.gitignore`**: Excludes `node_modules/`, environments, logs, and internal database stores (`pg_data/`) from version control.
* **`.antigravityignore`**: Ensures the **Antigravity** AI assistant ignores large binaries, locks, and logs to maximize context performance, token economy, and response speed.
* **`.agents/skills/bookbinder_developer/SKILL.md`**: Outlines database schemas, interface parameters, and constraints to align AI contributions with BookBinder PRD specifications.

---

## 🚀 Getting Started

To initialize the development environment:
1. **Frontend Setup**:
   Create a standard React project in the `frontend` folder using `npx create-vite-app` or standard template wrappers.
2. **Backend Setup**:
   Build an Express.js backend wrapper in `backend/` with dependency mappings for `pg` (PostgreSQL driver), `jsonwebtoken`, `cookie-parser`, and standard middleware blocks.
3. **Containerization Setup**:
   Prepare a unified `docker-compose.yml` to stitch the React host engine, the Express backend API, and the PostgreSQL instance into an isolated internal Docker bridge network.

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

### Automating nightly backups with n8n

Mint a token from the admin console, then wire up a simple workflow:

```
Schedule (nightly)
  → HTTP Request
      GET https://<host>/api/admin/backup
      Header: Authorization: Bearer bb_...
      Response format: File
  → write to storage
```

A failed dump returns `500` with a JSON error body rather than a truncated file, so branch the workflow on the HTTP status code — there's no need to inspect the downloaded bytes to know whether the backup succeeded.

### Restoring is destructive

Restoring replaces every row in the database. Alongside the file, the restore endpoint requires a `confirm=REPLACE_ALL_DATA` field — without it, nothing happens. And because restoring rewrites the `users` table too, restoring an archive whose users differ from your current ones will sign you out; signing in again afterward is expected, not a bug.

**Restoring also rewrites `api_tokens`,** since that table is part of the dump like any other. Any token minted after the archive was taken — including, potentially, the very credential the automation used to call the restore endpoint — reverts to whatever tokens existed at backup time and stops working. If a scheduled n8n job starts failing with `401` right after a restore, mint a fresh token from the console; this is expected, not a sign the restore went wrong.

**A caveat on older backups:** restoring an archive taken before a schema change can fail. The restore drops the tables present in the archive before reloading them, and if a newer table (added since that backup) holds a foreign key into one of those tables, the drop is blocked and the restore aborts. This fails safe — the whole restore runs as one transaction, so a blocked drop rolls everything back and your current data is left untouched — but it does mean an old backup won't restore in place. The fix is to restore it into a fresh database instead.

### API tokens are admin-equivalent secrets

A token can download a backup containing every user's row, password hashes included, and can trigger a full restore. Treat it like an admin password: it's shown once at creation and never again, so store it somewhere durable immediately, and revoke it from the console the moment it's no longer needed.

---

*Made with love by Antigravity.*
