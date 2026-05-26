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

---

*Made with love by Antigravity.*
