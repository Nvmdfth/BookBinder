# Database Backup & Restore — Design

**Date:** 2026-08-20
**Branch:** `feat/database-backup-restore`

## Problem

BookBinder's data lives in the `bookbinder-pg-data` Docker volume. It is genuinely
persistent — named volumes survive `docker compose down`, restarts and image rebuilds
— but there is no way to get a copy *out*. Backing up today means shelling into the
host and running `pg_dump` by hand, which nobody does on a schedule, and moving to a
new server means a manual `pg_restore` against a half-booted stack.

Two gaps follow from that:

- **No automation.** n8n runs the household's scheduled jobs and has no endpoint to
  call. Every backup is a remembered chore.
- **No recovery path inside the app.** The admin console can prune orphaned catalog
  rows but cannot export or reinstate the database it manages.

## What we're building

An admin-only backup subsystem with two surfaces: a card in the admin console for a
human, and HTTP endpoints for n8n. Export produces a real `pg_dump` archive. Import
accepts one back and replaces the database with it, behind a confirmation the caller
must supply deliberately.

A third piece falls out of the second surface: n8n cannot use the cookie session the
browser gets, so this introduces **API tokens** as the app's first machine credential.

## Scope

**In:** `pg_dump` export, `pg_restore` import, API tokens (mint/list/revoke), admin UI
for all three, Dockerfile change to ship the Postgres client binaries.

**Out:** avatar image files (see [Avatars are not included](#avatars-are-not-included)),
scheduling inside BookBinder (n8n owns that), backup retention or rotation, partial or
per-user exports, and API tokens as a general-purpose key for the rest of the API.

## Backup format

`pg_dump --format=custom` — the same artifact the manual shell path already produces,
restorable with `pg_restore`. It carries schema, sequences, constraints and indexes,
so a restore reproduces the database rather than merely its rows.

The alternative considered was an application-level JSON export built from `SELECT`s.
Rejected: the table list becomes hand-maintained, so a table added later silently
stops being backed up — and a backup that quietly omits data is worse than none.

### Avatars are not included

`users.avatar_url` points at files in the `bookbinder-uploads-data` volume
(`userRouter.js`), which no database dump can reach. Restoring onto a fresh server
therefore yields intact accounts with broken avatar images.

This is a deliberate trade. Avatars are cosmetic and re-uploadable; the library data
is not. Bundling them would mean assembling a tarball in the app container, which
costs temp files or streaming-tar assembly and grows the archive with every upload.

The admin UI states the omission plainly and shows the one-line remedy:

```bash
docker run --rm -v bookbinder-uploads-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/bookbinder-uploads-$(date +%F).tar.gz -C /data .
```

## Container changes

The final Dockerfile stage adds the Postgres 16 client binaries (`pg_dump`,
`pg_restore`) via `apk add --no-cache`. The exact package name is verified at build
time; the major version must match the `postgres:16-alpine` server.

`node_modules` for `pg` is a wire protocol client only — it cannot produce a dump
format archive, so the binaries are required, not a convenience.

## Backend

### `services/pgBackup.js`

A thin wrapper around `child_process.spawn` holding all process-level concerns, kept
out of the routers so it can be tested directly.

- **`spawn` with an argument array, never a shell string.** Database name, user and
  host come from environment variables and are never interpolated into a command line.
- **`PGPASSWORD` is passed through the child's `env`**, so the credential never
  appears in an argument list or in `ps` output.
- Both functions reject with the child's stderr text on a non-zero exit, so callers
  can return a real error rather than a generic failure.

### Export buffers, it does not stream

`dumpDatabase()` collects stdout into a buffer and resolves only after the process
exits `0`.

Streaming `pg_dump` straight into `res` would be the more idiomatic Express shape, and
it is wrong here. Response headers are committed as soon as the first chunk flushes,
so a dump that fails midway arrives as a **truncated file carrying a `200`** — an
invalid backup that every automated check reports as a success. Buffering keeps the
exit code and the response status on the same side of the decision.

A personal library dumps to tens of kilobytes, so the memory cost is immaterial. A
hard cap of **256 MB** guards the pathological case: exceeding it kills the child and
returns an error rather than exhausting the container's memory. The same cap applies
to an uploaded restore archive, enforced by multer's `limits.fileSize`.

### Restore pipes to stdin

`restoreDatabase()` writes the uploaded buffer to `pg_restore` stdin — no temp file is
written to disk, so nothing is left behind on a crash and there is no path traversal
surface.

Flags: `--clean --if-exists --single-transaction`.

`--single-transaction` is the important one. Without it a malformed archive leaves the
database half-dropped, with no route forward except restoring another backup. With it,
any failure rolls back and leaves the existing data exactly as it was.

### Endpoints

Two new routers, both mounted under `/api/admin` in `app.js`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/backup` | Download a dump |
| `POST` | `/api/admin/restore` | Replace the database from an uploaded dump |
| `GET` | `/api/admin/tokens` | List tokens (values never returned) |
| `POST` | `/api/admin/tokens` | Mint a token; plaintext returned once |
| `DELETE` | `/api/admin/tokens/:id` | Revoke a token |

`backupRouter.js` owns the first two, `apiTokenRouter.js` the rest. Both apply the
existing `requireAdmin` guard.

**`GET /api/admin/backup`** responds `200 application/octet-stream` with
`Content-Disposition: attachment; filename="bookbinder-<YYYY-MM-DD>.dump"`, or
`500 { error }` carrying the `pg_dump` stderr.

**`POST /api/admin/restore`** takes `multipart/form-data` with two fields:

- `file` — the dump, read through multer memory storage
- `confirm` — must equal exactly `REPLACE_ALL_DATA`

A request missing the confirmation, or carrying any other value, is rejected `400`
before `pg_restore` is invoked. The check exists so that no accidental or malformed
POST — a misconfigured n8n node, a retried request — can destroy the database. It is
not a security control; the token is. It is a control against automation firing the
wrong way.

## API tokens

### Table

Appended to `init.sql` following the file's existing `CREATE TABLE IF NOT EXISTS`
convention, so it self-applies on the next boot with no manual migration:

```sql
CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);
```

Tokens are `bb_` followed by 32 random bytes, base64url encoded. The server stores
**only the SHA-256 hash**; the plaintext is returned once at creation and is
unrecoverable afterwards. Revocation sets `revoked_at` rather than deleting the row,
so a revoked token's `last_used_at` survives for inspection.

SHA-256 rather than bcrypt is correct here and deliberate: the input is 256 bits of
server-generated entropy, not a human-chosen password, so it is not brute-forceable
and a per-request bcrypt cost would only slow legitimate calls.

### Middleware

`middleware/apiTokenAuth.js` runs ahead of `authenticateToken` on the backup routes
(`backupRouter.js` only — see [Bearer auth is admin-scoped only](#bearer-auth-is-admin-scoped-only)):

1. No `Authorization: Bearer bb_...` header → fall through untouched to the existing
   cookie path.
2. Header present → hash it, look up a matching row that is not revoked, load the
   owning user, and populate `req.user` in **the same shape** `authenticateToken`
   produces, so `requireAdmin` and every downstream handler work unchanged.
3. No match, revoked, or the owning user is disabled → `401`.

`last_used_at` is updated on each successful authentication.

The disabled-account check from `authenticateToken` is mirrored here. The
password-change revocation check is **not**: tokens are independent credentials and
must survive a password change, which is the entire reason they exist.

### Bearer auth is admin-scoped only

The middleware is mounted on `backupRouter.js` only — `GET /api/admin/backup` and
`POST /api/admin/restore` — and nowhere else. A token cannot read a bookshelf, add a
book, or touch any other route.

That containment matters because **a token is an admin-equivalent secret**: it can
download every user's row, bcrypt password hashes included, and it can trigger a
restore. The UI says so at the point of creation. Narrowing further — a read-only
scope that cannot restore — was considered and deferred as YAGNI; it can be added as
a `scope` column without disturbing this design.

**Token management is deliberately cookie-only.** `apiTokenRouter.js` (mint, list,
revoke) does *not* mount `authenticateApiToken` — only the browser session cookie
authenticates there, even though the same Bearer token would otherwise pass
`requireAdmin` just as well. Without this restriction a leaked token could mint its
own successor via `POST /api/admin/tokens`; revoking the leaked token would then
leave the attacker holding a fresh credential the admin never issued, which defeats
revocation as an incident-response control. Requiring a human in the browser to
manage tokens closes that loop: revoking a token is final, because nothing minted
after the leak was discovered can outlive the leaked one revoking it.

## Admin UI

A new `components/BackupCard.jsx`, rendered by `AdminConsole.jsx`.

The card is a new component rather than more lines in `AdminConsole.jsx` because that
file is already 1186 lines. Its existing orphan-prune card supplies the pattern to
follow for a destructive action, and its `styles` object supplies the visual
vocabulary; the new component matches both.

Three blocks:

**Download.** A button that fetches the dump and saves it. Below it, the standing note
that avatars are excluded, with the `docker run` command above.

**Restore.** File picker, plus a text input that must contain `REPLACE_ALL_DATA`
before the button enables — the same string the API demands, so the two surfaces teach
the same contract. Copy states what restore does: replaces all data, cannot be undone,
and may end the current session.

**Tokens.** Mint (with a name), list (name, created, last used), revoke. A newly
minted token is displayed once in a copyable block, with an explicit warning that it
grants full data access and will not be shown again.

## Failure modes

**A backup older than a schema change may refuse to restore.** `--clean` emits
`DROP TABLE` for the tables in the archive, but a table added since — `book_barcodes`
holds a foreign key to `books` — blocks the drop. `--single-transaction` turns this
into a clean abort with the data intact. The endpoint surfaces the Postgres error
verbatim; the remedy is to restore into a fresh database. This is a fail-safe outcome,
documented so it is not mistaken for corruption.

**A restore can log the admin out.** The session cookie embeds a signature derived
from the user's password hash (`authMiddleware.js`). If the restored `users` row
carries a different hash, every session issued against the old one is invalidated —
correct behaviour, surfaced in the UI as an expectation rather than a surprise.

**Requests in flight during a restore will fail** while tables are dropped and
recreated. For a single-admin household app the window is seconds and the trade is
acceptable; it is stated here so it is a known property rather than a discovery.

**A dump exceeding the size cap is refused** rather than silently truncated or allowed
to exhaust container memory.

## Testing

The existing suite mocks the database layer wholesale (`tests/helpers/testApp.js`) and
runs no Postgres. These tests follow that convention rather than introducing a
containerized database: `child_process.spawn` is mocked the same way `db` is, so the
assertions are about **which command is constructed and how its exit code is handled**
— which is where this subsystem's bugs live.

**Backend** (jest + supertest, `db` and `child_process` both mocked):

- Unauthenticated request → `401`; token owned by a non-admin → `403`; revoked token →
  `401`; disabled owner → `401`.
- Cookie-authenticated admin still reaches the endpoints — the Bearer branch must not
  regress the browser path.
- `POST /restore` without `confirm`, and with a wrong `confirm` value → `400`, and
  `spawn` is never called.
- `pg_dump` is spawned with an argument array and no shell, and `PGPASSWORD` is present
  in the child env but absent from the argument list.
- A non-zero exit → `500` carrying stderr, and **no** `Content-Disposition` header —
  the regression guard for the truncated-backup failure this design exists to prevent.
- `pg_restore` receives `--clean --if-exists --single-transaction` and the uploaded
  bytes on stdin.
- Minting returns plaintext once; listing never includes a token value or hash.

**Frontend** (vitest + testing-library):

- Restore button stays disabled until the confirmation input matches exactly.
- A freshly minted token renders once and is absent from a subsequent list render.

**Manual verification** (documented in the plan, run once against real containers):
export from a live stack, confirm `pg_restore --list` reads the archive, restore it
back, and confirm the data survives. Automated round-trip coverage would require
standing up Postgres in CI, which this repo does not do for any other subsystem.

## n8n usage

```
Schedule (nightly)
  → HTTP Request
      GET https://<host>/api/admin/backup
      Header: Authorization: Bearer bb_...
      Response format: File
  → write to storage
```

A failed dump returns `500` with a JSON body, so the workflow can branch on status
rather than inspecting the downloaded bytes. That is the property the buffering
decision above was made to guarantee.
