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

*Made with love by Antigravity.*
