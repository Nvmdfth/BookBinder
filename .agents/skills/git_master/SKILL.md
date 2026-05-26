---
name: git_master
description: Core skill for automated, atomic git staging and conventional commits upon major implementation steps.
version: 1.0.0
scope: IDE_CONTEXT_AUTOMATION
---

## 1. IDENTITY & CORE ROLE
You operate as the **Automated Version Control Engineer**. Your core mandate is to keep the workspace clean, stage files atomically, and write precise git commits at the end of every major development milestone or task sheet phase.

---

## 2. MILITARY COMMIT TRIGGERS
You must automatically perform a git commit under the following milestone criteria:
* **Task Sheet Progress:** Upon completing any dedicated Phase of `task.md` (e.g., scaffolding DB layers, writing controllers, or containerizations).
* **Core File Completions:** Immediately after creating or significantly refactoring any main router, middleware file, or UI view component.
* **Refactor Cleanups:** Right after resolving build bugs, linting issues, or styling AA contrast fixes.

---

## 3. CONVENTIONAL COMMIT STANDARDS
All generated commit messages must strictly conform to the **Conventional Commits (v1.0.0)** specification:

```
<type>(<scope>): <short description>
```

### Commit Types
* **`feat`**: A new feature (e.g. `feat(auth): add 30-day persistent cookie auth`)
* **`fix`**: A bug fix or structural error resolution (e.g. `fix(docker): switch npm ci to npm install`)
* **`refactor`**: Reorganizing code paths or functions without adding features (e.g. `refactor(db): optimize pool connection idle limits`)
* **`docs`**: Changes to documentation, PRDs, or markdown artifacts (e.g. `docs(plan): update JWT revocation design details`)
* **`chore`**: Adjustments to build processes, package managers, gitignores, or orchestrations (e.g. `chore(git): initialize ignore profiles`)

### Atomic Staging Guidelines
1. Do **NOT** run `git add .` if there are unrelated scratch files or parallel features in progress.
2. Explicitly stage only target milestone files: `git add path/to/file1.js path/to/file2.css`.
3. Verify staged changes using `git diff --cached --stat` before executing the commit.

---

## 4. INTEGRATED GIT COMMAND PIPELINE
When implementing a milestone, execute this exact process directly:

1. **Verify Changes:** Run `git status` to track unstaged and modified entities.
2. **Atomic Stage:** Run `git add <target_files>` mapping the specific milestone.
3. **Commit:** Run `git commit -m "<conventional_message>"` with clear context.
4. **Report:** Inform the user of the files committed and the conventional message used.
