# Database Backup & Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give BookBinder admins a `pg_dump` export and `pg_restore` import, reachable both from the admin console and from HTTP endpoints n8n can call on a schedule.

**Architecture:** A `pgBackup` service wraps `child_process.spawn` around the Postgres client binaries, which are added to the app image. Two routers under `/api/admin` expose export, restore and API token management. A new Bearer-token middleware sits in front of the existing cookie auth on those routes only, so automation gets a credential that survives password changes.

**Tech Stack:** Node 18, Express 4, `pg` 8, multer 1.4 (already a dependency), jest 30 + supertest 7, React 18 + vite, vitest 4 + testing-library, Docker Compose with `postgres:16-alpine`.

**Spec:** `docs/superpowers/specs/2026-08-20-database-backup-restore-design.md`

## Global Constraints

- **Postgres client major version must match the server: 16.** The compose file pins `postgres:16-alpine`.
- **Never build a shell command string.** Every `spawn` call passes an argument array with no `shell: true`. Database identifiers come from env vars and are never interpolated into a command line.
- **`PGPASSWORD` travels in the child process `env`,** never in an argument.
- **Size cap: 256 MB,** applied to both the buffered dump and multer's `limits.fileSize`.
- **Confirmation string is exactly `REPLACE_ALL_DATA`,** identical on the API and in the UI.
- **Bearer auth is mounted on `/api/admin/*` only.** It must never become general API auth.
- **Restore flags are exactly `--clean --if-exists --single-transaction`.**
- **`init.sql` re-runs on every boot** — every statement added to it must be idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- **Tests mock the database.** Follow `backend/tests/helpers/testApp.js`; do not introduce a real Postgres into the suite.
- Backend tests: `cd backend && npx jest <path>`. Frontend tests: `cd frontend && npx vitest run <path>`.
- Lint must pass: `cd frontend && npm run lint`.

---

### Task 1: Postgres client binaries in the app image

**Files:**
- Modify: `Dockerfile:20-25` (Stage 2, after `WORKDIR /app/backend`)

**Interfaces:**
- Consumes: nothing.
- Produces: `pg_dump` and `pg_restore` on `PATH` inside the `app` container.

The `pg` npm package speaks the wire protocol only — it cannot produce or read a `--format=custom` archive. The binaries are required.

- [ ] **Step 1: Add the client package to the final stage**

In `Dockerfile`, immediately after the `ENV NODE_ENV=production` line in Stage 2:

```dockerfile
# Postgres client binaries for the admin backup/restore endpoints.
#
# The pg npm driver speaks the wire protocol only; producing and reading a
# --format=custom archive needs pg_dump/pg_restore themselves. The major
# version must match the postgres:16-alpine server in docker-compose.yml —
# pg_restore refuses an archive from a newer major.
RUN apk add --no-cache postgresql16-client
```

- [ ] **Step 2: Verify the package name resolves**

Run: `docker build --target final-runner -t bookbinder-buildcheck .`

Expected: build succeeds. If apk reports `unable to select packages`, the base image's Alpine release does not carry that exact name — run `docker run --rm node:18-alpine apk search -x 'postgresql*-client'` and use the version-16 name it prints. Do not fall back to the unversioned `postgresql-client`; it floats to whatever major Alpine currently ships and will silently break restores.

- [ ] **Step 3: Confirm the binaries are present and version-matched**

Run: `docker run --rm bookbinder-buildcheck pg_dump --version`

Expected: output begins `pg_dump (PostgreSQL) 16.`

- [ ] **Step 4: Commit**

```bash
git add Dockerfile
git commit -m "build: ship postgres 16 client binaries in the app image"
```

---

### Task 2: `api_tokens` table

**Files:**
- Modify: `backend/src/db/init.sql` (append a numbered section at the end)
- Test: `backend/tests/schema.test.js:14-25`

**Interfaces:**
- Consumes: the `users` table.
- Produces: table `api_tokens (id, user_id, name, token_hash, last_used_at, created_at, revoked_at)`.

- [ ] **Step 1: Write the failing test**

In `backend/tests/schema.test.js`, add `'api_tokens'` to the existing `it.each` list of tables (it currently ends with `'book_barcodes'`), then append this block at the end of the file:

```javascript
describe('API tokens (backup automation credentials)', () => {
  it('stores only a hash, never the token itself', () => {
    const block = normalized.match(/CREATE TABLE IF NOT EXISTS api_tokens[\s\S]*?\);/)[0];
    expect(block).toMatch(/token_hash VARCHAR\(64\) UNIQUE NOT NULL/i);
    expect(block).not.toMatch(/token VARCHAR/i);
  });

  it('cascades tokens away with their owning user', () => {
    const block = normalized.match(/CREATE TABLE IF NOT EXISTS api_tokens[\s\S]*?\);/)[0];
    expect(block).toMatch(/user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/i);
  });

  it('revokes by timestamp rather than deletion, so last_used_at survives audit', () => {
    const block = normalized.match(/CREATE TABLE IF NOT EXISTS api_tokens[\s\S]*?\);/)[0];
    expect(block).toMatch(/revoked_at TIMESTAMP WITH TIME ZONE/i);
    expect(block).toMatch(/last_used_at TIMESTAMP WITH TIME ZONE/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/schema.test.js`

Expected: FAIL — `Cannot read properties of null (reading '0')`, because the `match()` finds no `api_tokens` block.

- [ ] **Step 3: Add the table to init.sql**

Append to `backend/src/db/init.sql`:

```sql
-- 12. API Tokens: machine credentials for automated backups.
--
-- The browser session is a cookie carrying a signature derived from the user's
-- password hash, so it dies on every password change — correct for a browser,
-- useless for a scheduled n8n job. These are independent credentials: revoked
-- explicitly, never implicitly.
--
-- Only the SHA-256 hash is stored. The plaintext is shown once at creation and
-- is unrecoverable afterwards. SHA-256 rather than bcrypt is deliberate: the
-- input is 32 bytes of server-generated entropy, not a human-chosen password,
-- so there is nothing to brute-force and a per-request KDF cost would tax only
-- legitimate callers.
CREATE TABLE IF NOT EXISTS api_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_hash ON api_tokens(token_hash);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/schema.test.js`

Expected: PASS, all four new assertions green.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/init.sql backend/tests/schema.test.js
git commit -m "feat(db): add api_tokens table for backup automation credentials"
```

---

### Task 3: Token minting and hashing utility

**Files:**
- Create: `backend/src/utils/apiToken.js`
- Test: `backend/tests/apiToken.test.js`

**Interfaces:**
- Consumes: node `crypto` only. No database access — this module is pure.
- Produces:
  - `generateToken(): string` — returns `bb_` + 43-char base64url (32 random bytes)
  - `hashToken(plaintext: string): string` — returns 64-char lowercase hex SHA-256
  - `TOKEN_PREFIX: 'bb_'`

Keeping this pure and separate from the router is what lets Task 6 assert that a listed token never carries its plaintext.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/apiToken.test.js`:

```javascript
/**
 * Token minting is the one place a credential exists in plaintext. These
 * assertions pin the two properties the rest of the system assumes: enough
 * entropy that the hash need not be a KDF, and a stable hash so lookup by
 * hash is a single indexed equality.
 */
const { generateToken, hashToken, TOKEN_PREFIX } = require('../src/utils/apiToken');

describe('generateToken', () => {
  it('prefixes tokens so they are recognisable in a config file', () => {
    expect(generateToken().startsWith(TOKEN_PREFIX)).toBe(true);
  });

  it('carries 32 bytes of entropy as base64url', () => {
    const body = generateToken().slice(TOKEN_PREFIX.length);
    expect(body).toHaveLength(43);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never repeats', () => {
    const many = new Set(Array.from({ length: 500 }, generateToken));
    expect(many.size).toBe(500);
  });
});

describe('hashToken', () => {
  it('produces a 64-char hex digest that fits the token_hash column', () => {
    const hash = hashToken('bb_example');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic, so lookup by hash is a single indexed equality', () => {
    expect(hashToken('bb_example')).toBe(hashToken('bb_example'));
  });

  it('separates distinct tokens', () => {
    expect(hashToken('bb_one')).not.toBe(hashToken('bb_two'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/apiToken.test.js`

Expected: FAIL — `Cannot find module '../src/utils/apiToken'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/utils/apiToken.js`:

```javascript
const crypto = require('crypto');

/** Marks a BookBinder credential on sight in an n8n config or a log line. */
const TOKEN_PREFIX = 'bb_';

/**
 * Mint a token. 32 bytes from the CSPRNG, base64url so it survives being pasted
 * into a header, a query string or a YAML file without escaping.
 */
function generateToken() {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

/**
 * Hash for storage and lookup.
 *
 * SHA-256, not bcrypt: the input is 256 bits of server-generated entropy, so
 * there is no dictionary to run and no work factor worth paying on every
 * request. A KDF here would slow only the legitimate caller.
 */
function hashToken(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest('hex');
}

module.exports = { generateToken, hashToken, TOKEN_PREFIX };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/apiToken.test.js`

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/apiToken.js backend/tests/apiToken.test.js
git commit -m "feat(auth): add API token minting and hashing"
```

---

### Task 4: `pgBackup` service

**Files:**
- Create: `backend/src/services/pgBackup.js`
- Test: `backend/tests/pgBackup.test.js`

**Interfaces:**
- Consumes: `child_process.spawn`, `process.env` (`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`).
- Produces:
  - `dumpDatabase(): Promise<Buffer>` — resolves the archive bytes, rejects `Error` with stderr text
  - `restoreDatabase(archive: Buffer): Promise<void>` — resolves on success, rejects `Error` with stderr text
  - `MAX_ARCHIVE_BYTES: 268435456`

This is the only module that touches the process boundary. Everything security-relevant about the subsystem — no shell, no password in argv, exit code checked before success is claimed — is enforced here and asserted in this task's tests.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/pgBackup.test.js`:

```javascript
/**
 * The process boundary.
 *
 * These tests mock child_process the way testApp.js mocks the db layer: the
 * bugs that matter here are in how the command is built and how its exit code
 * is read, not in Postgres. The exit-code assertions are the regression guard
 * for the failure this design exists to prevent — a dump that fails midway and
 * is reported as a success.
 */
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');

const { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES } = require('../src/services/pgBackup');

/**
 * A fake child process. Tests drive it: push stdout bytes, push stderr text,
 * then close with an exit code.
 */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = jest.fn();
  return child;
}

beforeEach(() => {
  process.env.DB_HOST = 'db';
  process.env.DB_USER = 'postgres';
  process.env.DB_PASSWORD = 'secret-pw';
  process.env.DB_NAME = 'bookbinder';
  process.env.DB_PORT = '5432';
});

describe('dumpDatabase', () => {
  it('resolves the archive bytes when pg_dump exits 0', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('PGDMP-archive-bytes'));
    child.emit('close', 0);

    await expect(promise).resolves.toEqual(Buffer.from('PGDMP-archive-bytes'));
  });

  it('spawns pg_dump with an argument array and no shell', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end();
    child.emit('close', 0);
    await promise;

    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('pg_dump');
    expect(Array.isArray(args)).toBe(true);
    expect(options.shell).toBeFalsy();
    expect(args).toEqual(expect.arrayContaining(['--format=custom', '-d', 'bookbinder']));
  });

  it('passes the password through the child env, never through argv', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end();
    child.emit('close', 0);
    await promise;

    const [, args, options] = spawn.mock.calls[0];
    expect(options.env.PGPASSWORD).toBe('secret-pw');
    expect(args.join(' ')).not.toContain('secret-pw');
  });

  it('rejects with stderr when pg_dump exits non-zero', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('half-an-archive'));
    child.stderr.end('pg_dump: error: connection failed');
    child.emit('close', 1);

    await expect(promise).rejects.toThrow('connection failed');
  });

  it('rejects rather than resolving a partial archive on a mid-dump failure', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.end(Buffer.from('truncated'));
    child.emit('close', 2);

    // The whole point: bytes arrived, but the exit code says they are not a backup.
    await expect(promise).rejects.toThrow();
  });

  it('kills the child and rejects when the archive exceeds the cap', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.stdout.write(Buffer.alloc(MAX_ARCHIVE_BYTES + 1));

    await expect(promise).rejects.toThrow(/exceeds/i);
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects when the binary is missing', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = dumpDatabase();
    child.emit('error', Object.assign(new Error('spawn pg_dump ENOENT'), { code: 'ENOENT' }));

    await expect(promise).rejects.toThrow(/ENOENT|not available/i);
  });
});

describe('restoreDatabase', () => {
  it('restores under a single transaction so a bad archive rolls back', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive'));
    child.emit('close', 0);
    await promise;

    const [command, args] = spawn.mock.calls[0];
    expect(command).toBe('pg_restore');
    expect(args).toEqual(expect.arrayContaining(['--clean', '--if-exists', '--single-transaction']));
  });

  it('writes the archive to stdin rather than a temp file', async () => {
    const child = fakeChild();
    const written = [];
    child.stdin.on('data', (chunk) => written.push(chunk));
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('archive-bytes'));
    child.emit('close', 0);
    await promise;

    expect(Buffer.concat(written)).toEqual(Buffer.from('archive-bytes'));
  });

  it('rejects with stderr when pg_restore exits non-zero', async () => {
    const child = fakeChild();
    spawn.mockReturnValue(child);

    const promise = restoreDatabase(Buffer.from('corrupt'));
    child.stderr.end('pg_restore: error: did not find magic string in file header');
    child.emit('close', 1);

    await expect(promise).rejects.toThrow(/magic string/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/pgBackup.test.js`

Expected: FAIL — `Cannot find module '../src/services/pgBackup'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/services/pgBackup.js`:

```javascript
const { spawn } = require('child_process');

/**
 * 256 MB. A personal library dumps to tens of kilobytes; this exists so a
 * pathological archive fails loudly instead of exhausting the container.
 */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

/**
 * Connection arguments, read from the same env vars db.js uses.
 *
 * Passed as an array to spawn with no shell, so a database name containing a
 * quote or a semicolon is an argument and never a second command.
 */
function connectionArgs() {
  return [
    '-h', process.env.DB_HOST || 'localhost',
    '-p', String(process.env.DB_PORT || 5432),
    '-U', process.env.DB_USER || 'postgres',
    '-d', process.env.DB_NAME || 'bookbinder',
  ];
}

/** The password never appears in argv, where any process listing would show it. */
function childEnv() {
  return { ...process.env, PGPASSWORD: process.env.DB_PASSWORD || 'postgres' };
}

function describeSpawnError(binary, error) {
  if (error.code === 'ENOENT') {
    return new Error(
      `${binary} is not available in this container. The image must install the ` +
      'postgresql16-client package.'
    );
  }
  return error;
}

/**
 * Produce a --format=custom archive.
 *
 * Buffers rather than streams to the response on purpose. Streaming commits the
 * HTTP headers on the first chunk, so a dump that dies halfway is delivered as a
 * truncated file carrying a 200 — an unusable backup that every automated check
 * records as a success. Holding the bytes until the exit code is known keeps the
 * process result and the HTTP status on the same side of the decision.
 */
function dumpDatabase() {
  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', [...connectionArgs(), '--format=custom', '--no-owner'], {
      env: childEnv(),
    });

    const chunks = [];
    let size = 0;
    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) {
        child.kill();
        fail(new Error(`Backup exceeds the ${MAX_ARCHIVE_BYTES} byte limit.`));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => fail(describeSpawnError('pg_dump', error)));

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(stderr.trim() || `pg_dump exited with code ${code}.`));
    });
  });
}

/**
 * Replace the database from an archive.
 *
 * --single-transaction is the load-bearing flag: without it a malformed archive
 * leaves the database half-dropped, recoverable only from another backup. With
 * it, any failure rolls back and the existing data is untouched.
 */
function restoreDatabase(archive) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pg_restore',
      [...connectionArgs(), '--clean', '--if-exists', '--single-transaction', '--no-owner'],
      { env: childEnv() }
    );

    let stderr = '';
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => fail(describeSpawnError('pg_restore', error)));

    // EPIPE is expected if the child rejects the archive and exits early; the
    // close handler already owns that failure and reports the real stderr.
    child.stdin.on('error', () => {});
    child.stdin.end(archive);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) return resolve();
      reject(new Error(stderr.trim() || `pg_restore exited with code ${code}.`));
    });
  });
}

module.exports = { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/pgBackup.test.js`

Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/pgBackup.js backend/tests/pgBackup.test.js
git commit -m "feat(backup): add pg_dump/pg_restore service wrapper"
```

---

### Task 5: Bearer token middleware

**Files:**
- Create: `backend/src/middleware/apiTokenAuth.js`
- Test: `backend/tests/apiTokenAuth.test.js`

**Interfaces:**
- Consumes: `hashToken` from `src/utils/apiToken.js` (Task 3), `query` from `src/db/db.js`.
- Produces: `authenticateApiToken(req, res, next)` — an Express middleware that populates `req.user = { id, email, role }`, the same shape `authenticateToken` produces, so `requireAdmin` works unchanged downstream.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/apiTokenAuth.test.js`:

```javascript
/**
 * Bearer credentials for automation.
 *
 * The cookie path carries a signature derived from the password hash, so it
 * dies on every password change. These tokens must not — that independence is
 * the reason they exist — but every other guard the cookie path applies still
 * has to hold.
 */
jest.mock('../src/db/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn(), on: jest.fn() },
  initDb: jest.fn(),
}));

const { query } = require('../src/db/db');
const { authenticateApiToken } = require('../src/middleware/apiTokenAuth');
const { hashToken } = require('../src/utils/apiToken');

function mockReqRes(authorization) {
  const req = { headers: authorization ? { authorization } : {}, cookies: {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res, next: jest.fn() };
}

const ADMIN_ROW = {
  id: 9, email: 'admin@library.com', role: 'admin', is_disabled: false, token_id: 3,
};

beforeEach(() => query.mockReset());

it('falls through untouched when no Bearer header is present', async () => {
  const { req, res, next } = mockReqRes(undefined);

  await authenticateApiToken(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(req.user).toBeUndefined();
  expect(query).not.toHaveBeenCalled();
});

it('ignores a non-BookBinder Bearer value so the cookie path still runs', async () => {
  const { req, res, next } = mockReqRes('Bearer eyJhbGciOi.some.jwt');

  await authenticateApiToken(req, res, next);

  expect(next).toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

it('authenticates a valid token and populates req.user', async () => {
  query.mockResolvedValueOnce({ rows: [ADMIN_ROW], rowCount: 1 }).mockResolvedValueOnce({ rows: [] });
  const { req, res, next } = mockReqRes('Bearer bb_validtoken');

  await authenticateApiToken(req, res, next);

  expect(req.user).toEqual({ id: 9, email: 'admin@library.com', role: 'admin' });
  expect(next).toHaveBeenCalled();
});

it('looks the token up by hash, never by its plaintext', async () => {
  query.mockResolvedValueOnce({ rows: [ADMIN_ROW], rowCount: 1 }).mockResolvedValueOnce({ rows: [] });
  const { req, res, next } = mockReqRes('Bearer bb_validtoken');

  await authenticateApiToken(req, res, next);

  const [, params] = query.mock.calls[0];
  expect(params).toContain(hashToken('bb_validtoken'));
  expect(params).not.toContain('bb_validtoken');
});

it('records last_used_at on a successful call', async () => {
  query.mockResolvedValueOnce({ rows: [ADMIN_ROW], rowCount: 1 }).mockResolvedValueOnce({ rows: [] });
  const { req, res, next } = mockReqRes('Bearer bb_validtoken');

  await authenticateApiToken(req, res, next);

  expect(query.mock.calls[1][0]).toMatch(/UPDATE api_tokens SET last_used_at/i);
});

it('rejects an unknown token with 401', async () => {
  query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const { req, res, next } = mockReqRes('Bearer bb_unknown');

  await authenticateApiToken(req, res, next);

  expect(res.statusCode).toBe(401);
  expect(next).not.toHaveBeenCalled();
});

it('rejects a token whose owner has been disabled', async () => {
  query.mockResolvedValueOnce({ rows: [{ ...ADMIN_ROW, is_disabled: true }], rowCount: 1 });
  const { req, res, next } = mockReqRes('Bearer bb_validtoken');

  await authenticateApiToken(req, res, next);

  expect(res.statusCode).toBe(401);
  expect(next).not.toHaveBeenCalled();
});

it('excludes revoked tokens in the lookup itself', async () => {
  query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
  const { req, res, next } = mockReqRes('Bearer bb_revoked');

  await authenticateApiToken(req, res, next);

  expect(query.mock.calls[0][0]).toMatch(/revoked_at IS NULL/i);
  expect(res.statusCode).toBe(401);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/apiTokenAuth.test.js`

Expected: FAIL — `Cannot find module '../src/middleware/apiTokenAuth'`.

- [ ] **Step 3: Write the implementation**

Create `backend/src/middleware/apiTokenAuth.js`:

```javascript
const { query } = require('../db/db');
const { hashToken, TOKEN_PREFIX } = require('../utils/apiToken');

/**
 * Bearer authentication for automated clients, mounted on /api/admin only.
 *
 * Runs ahead of authenticateToken and falls through when there is no BookBinder
 * Bearer header, so the browser's cookie session is untouched. On success it
 * populates req.user in exactly the shape authenticateToken produces, so
 * requireAdmin and every downstream handler work without knowing which
 * credential got the caller in.
 *
 * The password-change revocation check from the cookie path is deliberately
 * absent: a scheduled job must survive an admin changing their password.
 * Revocation here is explicit, via revoked_at.
 */
async function authenticateApiToken(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) return next();

  const presented = header.slice('Bearer '.length).trim();

  // A JWT in a Bearer header is not ours; leave it for the cookie path to ignore.
  if (!presented.startsWith(TOKEN_PREFIX)) return next();

  try {
    const tokenRes = await query(
      `SELECT t.id AS token_id, u.id, u.email, u.role, u.is_disabled
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [hashToken(presented)]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or revoked API token.' });
    }

    const row = tokenRes.rows[0];

    if (row.is_disabled) {
      return res.status(401).json({ error: 'The account owning this token is disabled.' });
    }

    await query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [row.token_id]);

    req.user = { id: row.id, email: row.email, role: row.role };
    return next();
  } catch (error) {
    console.error('API Token Authentication Error:', error.message);
    return res.status(500).json({ error: 'Internal server error validating API token.' });
  }
}

module.exports = { authenticateApiToken };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx jest tests/apiTokenAuth.test.js`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/apiTokenAuth.js backend/tests/apiTokenAuth.test.js
git commit -m "feat(auth): accept Bearer API tokens alongside cookie sessions"
```

---

### Task 6: Token management endpoints

**Files:**
- Create: `backend/src/routes/apiTokenRouter.js`
- Modify: `backend/src/app.js:11` (import) and `backend/src/app.js:52` (mount)
- Test: `backend/tests/apiTokens.test.js`

**Interfaces:**
- Consumes: `generateToken`, `hashToken` (Task 3); `authenticateApiToken` (Task 5); `authenticateToken`, `requireAdmin` from `src/middleware/authMiddleware.js`.
- Produces: routes `GET /api/admin/tokens`, `POST /api/admin/tokens`, `DELETE /api/admin/tokens/:id`. `POST` responds `201 { id, name, token, created_at }` where `token` is the only plaintext the system will ever emit.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/apiTokens.test.js`:

```javascript
/**
 * Token lifecycle.
 *
 * A token is an admin-equivalent secret: it can download every user row and it
 * can trigger a restore. So the guard tests here are not ceremony — they are
 * the whole boundary.
 */
const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');

const LIST_TOKENS = /SELECT id, name, last_used_at, created_at FROM api_tokens/;
const INSERT_TOKEN = /INSERT INTO api_tokens/;
const REVOKE_TOKEN = /UPDATE api_tokens SET revoked_at/;

describe('Admin guard on /api/admin/tokens', () => {
  const cases = [
    ['get', '/api/admin/tokens'],
    ['post', '/api/admin/tokens'],
    ['delete', '/api/admin/tokens/1'],
  ];

  it.each(cases)('rejects %s %s from a standard user with 403', async (method, path) => {
    mockSql([], { authenticatedAs: 'stranger' });

    const res = await request(app)[method](path).set('Cookie', authCookie('stranger')).send({ name: 'x' });

    expect(res.status).toBe(403);
  });

  it.each(cases)('rejects %s %s from an anonymous caller with 401', async (method, path) => {
    mockSql([]);

    const res = await request(app)[method](path).send({ name: 'x' });

    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/tokens', () => {
  it('returns the plaintext token exactly once, at creation', async () => {
    mockSql([[INSERT_TOKEN, [{ id: 4, name: 'n8n nightly', created_at: '2026-08-20T00:00:00Z' }]]], {
      authenticatedAs: 'admin',
    });

    const res = await request(app)
      .post('/api/admin/tokens')
      .set('Cookie', authCookie('admin'))
      .send({ name: 'n8n nightly' });

    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^bb_[A-Za-z0-9_-]{43}$/);
  });

  it('stores the hash, not the token', async () => {
    mockSql([[INSERT_TOKEN, [{ id: 4, name: 'n8n nightly', created_at: '2026-08-20T00:00:00Z' }]]], {
      authenticatedAs: 'admin',
    });

    const res = await request(app)
      .post('/api/admin/tokens')
      .set('Cookie', authCookie('admin'))
      .send({ name: 'n8n nightly' });

    const insert = sqlCalls().find((c) => INSERT_TOKEN.test(c.sql));
    expect(insert.params).not.toContain(res.body.token);
    expect(insert.params.some((p) => /^[0-9a-f]{64}$/.test(String(p)))).toBe(true);
  });

  it('requires a name so the token list stays auditable', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/tokens')
      .set('Cookie', authCookie('admin'))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/tokens', () => {
  it('never returns token values or hashes', async () => {
    mockSql(
      [[LIST_TOKENS, [{ id: 4, name: 'n8n nightly', last_used_at: null, created_at: '2026-08-20T00:00:00Z' }]]],
      { authenticatedAs: 'admin' }
    );

    const res = await request(app).get('/api/admin/tokens').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/token_hash|bb_/);
  });
});

describe('DELETE /api/admin/tokens/:id', () => {
  it('revokes by timestamp rather than deleting the row', async () => {
    mockSql([[REVOKE_TOKEN, { rows: [{ id: 4 }], rowCount: 1 }]], { authenticatedAs: 'admin' });

    const res = await request(app).delete('/api/admin/tokens/4').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(sqlCalls().some((c) => /DELETE FROM api_tokens/i.test(c.sql))).toBe(false);
  });

  it('404s an unknown token', async () => {
    mockSql([[REVOKE_TOKEN, { rows: [], rowCount: 0 }]], { authenticatedAs: 'admin' });

    const res = await request(app).delete('/api/admin/tokens/999').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/apiTokens.test.js`

Expected: FAIL — every request 404s, because `/api/admin` is not mounted.

- [ ] **Step 3: Write the router**

Create `backend/src/routes/apiTokenRouter.js`:

```javascript
const express = require('express');
const { query } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { authenticateApiToken } = require('../middleware/apiTokenAuth');
const { generateToken, hashToken } = require('../utils/apiToken');

const router = express.Router();

// Bearer first, cookie second: authenticateApiToken falls through when the
// request carries no BookBinder token, leaving the browser path untouched.
router.use(authenticateApiToken);
router.use((req, res, next) => (req.user ? next() : authenticateToken(req, res, next)));
router.use(requireAdmin);

/**
 * GET /api/admin/tokens - List tokens. Values are unrecoverable by design, so
 * this returns metadata only.
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, last_used_at, created_at FROM api_tokens
        WHERE revoked_at IS NULL ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List API Tokens Error:', error);
    return res.status(500).json({ error: 'Internal server error listing API tokens.' });
  }
});

/**
 * POST /api/admin/tokens - Mint a token.
 *
 * The only response in the system that contains a plaintext credential. The
 * caller stores it now or mints a new one later.
 */
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'A descriptive token name is required.' });
  }

  try {
    const token = generateToken();
    const result = await query(
      `INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
      [req.user.id, name, hashToken(token)]
    );

    return res.status(201).json({ ...result.rows[0], token });
  } catch (error) {
    console.error('Create API Token Error:', error);
    return res.status(500).json({ error: 'Internal server error creating the API token.' });
  }
});

/**
 * DELETE /api/admin/tokens/:id - Revoke. The row stays so last_used_at remains
 * available to answer "was this leaked credential ever used?"
 */
router.delete('/:id', async (req, res) => {
  try {
    const result = await query(
      'UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'API token not found.' });
    }

    return res.json({ message: 'API token revoked.' });
  } catch (error) {
    console.error('Revoke API Token Error:', error);
    return res.status(500).json({ error: 'Internal server error revoking the API token.' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount it**

In `backend/src/app.js`, add the import beside the other routers:

```javascript
const apiTokenRouter = require('./routes/apiTokenRouter');
```

and the mount beside the other mounts:

```javascript
app.use('/api/admin/tokens', apiTokenRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/apiTokens.test.js`

Expected: PASS, 11 tests.

- [ ] **Step 6: Run the whole backend suite for regressions**

Run: `cd backend && npx jest`

Expected: PASS. The cookie-auth tests in `adminSettings.test.js` and `auth.test.js` must be unaffected — if any now fail, the Bearer middleware is not falling through correctly.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/apiTokenRouter.js backend/src/app.js backend/tests/apiTokens.test.js
git commit -m "feat(api): add admin endpoints to mint, list and revoke API tokens"
```

---

### Task 7: Backup and restore endpoints

**Files:**
- Create: `backend/src/routes/backupRouter.js`
- Modify: `backend/src/app.js` (import + mount, beside Task 6's)
- Test: `backend/tests/backup.test.js`

**Interfaces:**
- Consumes: `dumpDatabase`, `restoreDatabase`, `MAX_ARCHIVE_BYTES` (Task 4); the same auth chain as Task 6.
- Produces: `GET /api/admin/backup`, `POST /api/admin/restore`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/backup.test.js`:

```javascript
/**
 * The backup endpoints.
 *
 * Two behaviours here are load-bearing and easy to regress:
 *   1. A failed dump must not arrive as a 200 with a Content-Disposition
 *      header, or n8n will file a truncated file as a good backup.
 *   2. Restore must not reach pg_restore without the exact confirmation
 *      string, or a misfiring automation destroys the database.
 */
const request = require('supertest');

jest.mock('../src/services/pgBackup', () => ({
  dumpDatabase: jest.fn(),
  restoreDatabase: jest.fn(),
  MAX_ARCHIVE_BYTES: 256 * 1024 * 1024,
}));

const { dumpDatabase, restoreDatabase } = require('../src/services/pgBackup');
const { app, mockSql, authCookie } = require('./helpers/testApp');

beforeEach(() => {
  dumpDatabase.mockReset();
  restoreDatabase.mockReset();
});

describe('Admin guard on the backup endpoints', () => {
  it('rejects GET /api/admin/backup from a standard user with 403', async () => {
    mockSql([], { authenticatedAs: 'stranger' });

    const res = await request(app).get('/api/admin/backup').set('Cookie', authCookie('stranger'));

    expect(res.status).toBe(403);
    expect(dumpDatabase).not.toHaveBeenCalled();
  });

  it('rejects an anonymous GET /api/admin/backup with 401', async () => {
    mockSql([]);

    const res = await request(app).get('/api/admin/backup');

    expect(res.status).toBe(401);
    expect(dumpDatabase).not.toHaveBeenCalled();
  });

  it('rejects an anonymous POST /api/admin/restore with 401', async () => {
    mockSql([]);

    const res = await request(app)
      .post('/api/admin/restore')
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('archive'), 'backup.dump');

    expect(res.status).toBe(401);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/backup', () => {
  it('returns the archive as a dated attachment', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    dumpDatabase.mockResolvedValue(Buffer.from('PGDMP-archive'));

    const res = await request(app).get('/api/admin/backup').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/octet-stream/);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="bookbinder-\d{4}-\d{2}-\d{2}\.dump"/
    );
    expect(Buffer.from(res.body)).toEqual(Buffer.from('PGDMP-archive'));
  });

  it('reports a failed dump as a 500 with no attachment header', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    dumpDatabase.mockRejectedValue(new Error('pg_dump: error: connection refused'));

    const res = await request(app).get('/api/admin/backup').set('Cookie', authCookie('admin'));

    // The regression guard: an automated caller branches on this status. If a
    // failure ever arrives as a 200, it files a broken file as a good backup.
    expect(res.status).toBe(500);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.body.error).toMatch(/connection refused/);
  });
});

describe('POST /api/admin/restore', () => {
  it('restores when the confirmation is exact', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    restoreDatabase.mockResolvedValue();

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

    expect(res.status).toBe(200);
    expect(restoreDatabase).toHaveBeenCalledWith(Buffer.from('archive-bytes'));
  });

  it('refuses a request with no confirmation, before spawning anything', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

    expect(res.status).toBe(400);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });

  it.each(['replace_all_data', 'REPLACE ALL DATA', 'yes', 'true'])(
    'refuses the near-miss confirmation %p',
    async (confirm) => {
      mockSql([], { authenticatedAs: 'admin' });

      const res = await request(app)
        .post('/api/admin/restore')
        .set('Cookie', authCookie('admin'))
        .field('confirm', confirm)
        .attach('file', Buffer.from('archive-bytes'), 'backup.dump');

      expect(res.status).toBe(400);
      expect(restoreDatabase).not.toHaveBeenCalled();
    }
  );

  it('refuses a confirmed request carrying no file', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA');

    expect(res.status).toBe(400);
    expect(restoreDatabase).not.toHaveBeenCalled();
  });

  it('surfaces the Postgres error when the archive is rejected', async () => {
    mockSql([], { authenticatedAs: 'admin' });
    restoreDatabase.mockRejectedValue(new Error('pg_restore: error: did not find magic string'));

    const res = await request(app)
      .post('/api/admin/restore')
      .set('Cookie', authCookie('admin'))
      .field('confirm', 'REPLACE_ALL_DATA')
      .attach('file', Buffer.from('not-an-archive'), 'backup.dump');

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/magic string/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx jest tests/backup.test.js`

Expected: FAIL — routes 404, `/api/admin/backup` is not mounted.

- [ ] **Step 3: Write the router**

Create `backend/src/routes/backupRouter.js`:

```javascript
const express = require('express');
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { authenticateApiToken } = require('../middleware/apiTokenAuth');
const { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES } = require('../services/pgBackup');

const router = express.Router();

/** The caller must send this exact string to restore. */
const CONFIRM_PHRASE = 'REPLACE_ALL_DATA';

// Held in memory and piped to pg_restore stdin — nothing touches disk, so a
// crash leaves no half-written archive and there is no path to traverse.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVE_BYTES },
});

router.use(authenticateApiToken);
router.use((req, res, next) => (req.user ? next() : authenticateToken(req, res, next)));
router.use(requireAdmin);

/**
 * GET /api/admin/backup - Download a pg_dump archive.
 *
 * The dump completes before a single header is sent. Streaming would commit a
 * 200 on the first chunk, so a mid-dump failure would be delivered as a
 * truncated file that an automated backup job records as a success.
 */
router.get('/backup', async (req, res) => {
  try {
    const archive = await dumpDatabase();
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="bookbinder-${stamp}.dump"`);
    return res.send(archive);
  } catch (error) {
    console.error('Database Backup Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/restore - Replace the database from an uploaded archive.
 *
 * The confirmation field is not a security control — the admin credential is.
 * It is a guard against automation firing the wrong way: a retried or
 * misconfigured POST cannot destroy the database by accident.
 */
router.post('/restore', upload.single('file'), async (req, res) => {
  if (req.body?.confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({
      error: `Restore replaces all data and cannot be undone. Send confirm="${CONFIRM_PHRASE}" to proceed.`,
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'A backup archive file is required.' });
  }

  try {
    await restoreDatabase(req.file.buffer);
    console.log(`♻️ Database restored from an archive uploaded by user ID ${req.user.id}.`);
    return res.json({
      message: 'Database restored successfully. You may need to sign in again.',
    });
  } catch (error) {
    console.error('Database Restore Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Mount it**

In `backend/src/app.js`, beside the Task 6 import and mount:

```javascript
const backupRouter = require('./routes/backupRouter');
```

```javascript
app.use('/api/admin', backupRouter);
```

Mount `/api/admin/tokens` **before** `/api/admin` so the more specific path wins.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest tests/backup.test.js`

Expected: PASS, 11 tests.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npx jest`

Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/backupRouter.js backend/src/app.js backend/tests/backup.test.js
git commit -m "feat(api): add admin database backup and restore endpoints"
```

---

### Task 8: `BackupCard` component

**Files:**
- Create: `frontend/src/components/BackupCard.jsx`
- Modify: `frontend/src/pages/AdminConsole.jsx` (import + render after the orphan-pruner card, around line 433)
- Test: `frontend/src/tests/backupCard.test.jsx`

**Interfaces:**
- Consumes: the endpoints from Tasks 6 and 7.
- Produces: a default-exported `<BackupCard />` taking no props. It owns its own fetch state.

It is a separate component rather than more lines in `AdminConsole.jsx` because that file is already 1186 lines. Match the existing card idiom: `<div style={styles.card} className="card">`, an `<h2 style={styles.cardTitle}>` with a lucide icon, and `className="btn btn-danger"` for the destructive action.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/tests/backupCard.test.jsx`:

```jsx
/**
 * The admin console's backup card.
 *
 * Two properties are worth pinning: a restore cannot be triggered without the
 * typed confirmation (the same string the API demands), and a minted token is
 * displayed once and never returns to the screen afterwards.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BackupCard from '../components/BackupCard';

beforeEach(() => {
  global.fetch = vi.fn((url, options = {}) => {
    if (url === '/api/admin/tokens' && (options.method || 'GET') === 'GET') {
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }
    if (url === '/api/admin/tokens' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'n8n nightly', token: 'bb_secretvalue' }),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
});

afterEach(() => vi.restoreAllMocks());

describe('Restore confirmation', () => {
  it('keeps the restore button disabled until the phrase matches exactly', async () => {
    render(<BackupCard />);

    const button = await screen.findByRole('button', { name: /restore database/i });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/type replace_all_data/i);
    await userEvent.type(input, 'replace_all_data');
    expect(button).toBeDisabled();

    await userEvent.clear(input);
    await userEvent.type(input, 'REPLACE_ALL_DATA');

    const file = new File(['archive'], 'backup.dump', { type: 'application/octet-stream' });
    await userEvent.upload(screen.getByLabelText(/backup archive/i), file);

    expect(button).toBeEnabled();
  });

  it('stays disabled with the phrase but no file chosen', async () => {
    render(<BackupCard />);

    const input = screen.getByLabelText(/type replace_all_data/i);
    await userEvent.type(input, 'REPLACE_ALL_DATA');

    expect(screen.getByRole('button', { name: /restore database/i })).toBeDisabled();
  });
});

describe('Avatar exclusion notice', () => {
  it('states that uploads are not in the archive', async () => {
    render(<BackupCard />);

    expect(await screen.findByText(/avatar images are not included/i)).toBeInTheDocument();
  });
});

describe('Token minting', () => {
  it('shows a new token once and not in the list afterwards', async () => {
    render(<BackupCard />);

    await userEvent.type(screen.getByLabelText(/token name/i), 'n8n nightly');
    await userEvent.click(screen.getByRole('button', { name: /generate token/i }));

    expect(await screen.findByText('bb_secretvalue')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(screen.queryByText('bb_secretvalue')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/tests/backupCard.test.jsx`

Expected: FAIL — `Failed to resolve import "../components/BackupCard"`.

- [ ] **Step 3: Write the component**

Create `frontend/src/components/BackupCard.jsx`:

```jsx
import React, { useState, useEffect, useCallback } from 'react';
import { Database, Download, Upload, Key, Trash2, AlertTriangle, Copy } from 'lucide-react';

/** The exact phrase the API demands. Both surfaces teach the same contract. */
const CONFIRM_PHRASE = 'REPLACE_ALL_DATA';

const UPLOADS_BACKUP_CMD =
  'docker run --rm -v bookbinder-uploads-data:/data -v "$PWD":/backup alpine \\\n' +
  '  tar czf /backup/bookbinder-uploads-$(date +%F).tar.gz -C /data .';

/**
 * Database backup, restore, and the API tokens that let n8n do it on a schedule.
 *
 * Lives outside AdminConsole.jsx, which is already long enough that another
 * card's worth of state would make it harder to read than it already is.
 */
export default function BackupCard() {
  const [tokens, setTokens] = useState([]);
  const [tokenName, setTokenName] = useState('');
  const [mintedToken, setMintedToken] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [archive, setArchive] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tokens');
      if (res.ok) setTokens(await res.json());
    } catch {
      // A token list that fails to load must not take the backup controls with it.
    }
  }, []);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  const handleDownload = async () => {
    setBusy('download');
    setError('');
    try {
      const res = await fetch('/api/admin/backup');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'The backup failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bookbinder-${new Date().toISOString().slice(0, 10)}.dump`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice('Backup downloaded.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRestore = async () => {
    setBusy('restore');
    setError('');
    try {
      const body = new FormData();
      body.append('file', archive);
      body.append('confirm', CONFIRM_PHRASE);

      const res = await fetch('/api/admin/restore', { method: 'POST', body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'The restore failed.');

      setNotice(payload.message || 'Database restored.');
      setConfirmText('');
      setArchive(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleMintToken = async () => {
    setError('');
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Could not create the token.');

      setMintedToken(payload.token);
      setTokenName('');
      loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRevokeToken = async (id) => {
    await fetch(`/api/admin/tokens/${id}`, { method: 'DELETE' });
    loadTokens();
  };

  const restoreReady = confirmText === CONFIRM_PHRASE && archive !== null;

  return (
    <div style={styles.card} className="card">
      <h2 style={styles.cardTitle}>
        <Database size={20} style={{ color: 'var(--accent-color)' }} />
        <span>Database Backup &amp; Restore</span>
      </h2>

      {error && <div style={styles.error}>{error}</div>}
      {notice && <div style={styles.notice}>{notice}</div>}

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Download</h3>
        <button className="btn btn-primary" onClick={handleDownload} disabled={busy === 'download'}>
          <Download size={18} />
          <span>{busy === 'download' ? 'Dumping database...' : 'Download backup'}</span>
        </button>
        <p style={styles.help}>
          Avatar images are not included — they live in a separate Docker volume that no
          database dump can reach. Back them up alongside it:
        </p>
        <pre style={styles.code}>{UPLOADS_BACKUP_CMD}</pre>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Restore</h3>
        <p style={styles.warning}>
          <AlertTriangle size={16} />
          <span>
            Restoring replaces every row in the database and cannot be undone. If the archive
            holds a different password for your account, you will be signed out.
          </span>
        </p>

        <label style={styles.label} htmlFor="restore-archive">Backup archive (.dump)</label>
        <input
          id="restore-archive"
          type="file"
          accept=".dump"
          onChange={(e) => setArchive(e.target.files[0] || null)}
        />

        <label style={styles.label} htmlFor="restore-confirm">
          Type {CONFIRM_PHRASE} to confirm
        </label>
        <input
          id="restore-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
        />

        <button
          className="btn btn-danger"
          onClick={handleRestore}
          disabled={!restoreReady || busy === 'restore'}
        >
          <Upload size={18} />
          <span>{busy === 'restore' ? 'Restoring...' : 'Restore database'}</span>
        </button>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>API tokens</h3>
        <p style={styles.help}>
          For scheduled backups from n8n. A token grants full administrative access to
          every user&apos;s data and can trigger a restore — treat it as a password.
        </p>

        <label style={styles.label} htmlFor="token-name">Token name</label>
        <input
          id="token-name"
          type="text"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="n8n nightly"
        />
        <button className="btn btn-secondary" onClick={handleMintToken} disabled={!tokenName.trim()}>
          <Key size={18} />
          <span>Generate token</span>
        </button>

        {mintedToken && (
          <div style={styles.mintedBox}>
            <p style={styles.mintedWarning}>
              Copy this now — it will never be shown again.
            </p>
            <code style={styles.mintedValue}>{mintedToken}</code>
            <div style={styles.mintedActions}>
              <button
                className="btn btn-secondary"
                onClick={() => navigator.clipboard?.writeText(mintedToken)}
              >
                <Copy size={16} />
                <span>Copy</span>
              </button>
              <button className="btn btn-secondary" onClick={() => setMintedToken(null)}>
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        )}

        <ul style={styles.tokenList}>
          {tokens.map((t) => (
            <li key={t.id} style={styles.tokenRow}>
              <div>
                <span style={styles.tokenName}>{t.name}</span>
                <span style={styles.tokenMeta}>
                  {t.last_used_at
                    ? `Last used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : 'Never used'}
                </span>
              </div>
              <button
                className="btn btn-danger"
                aria-label={`Revoke ${t.name}`}
                onClick={() => handleRevokeToken(t.id)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: 'var(--surface-color)',
    borderRadius: 'var(--radius-md)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    flex: '1 1 100%',
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--step-1)',
    fontWeight: 600,
  },
  section: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' },
  sectionTitle: { fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' },
  label: { fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 },
  help: { fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 },
  code: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    backgroundColor: 'var(--bg-color)',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    overflowX: 'auto',
    width: '100%',
    whiteSpace: 'pre',
  },
  warning: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    fontSize: '0.85rem',
    color: 'var(--danger-text)',
    lineHeight: 1.5,
  },
  error: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
    color: 'var(--danger-text)',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  notice: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'color-mix(in srgb, var(--success-color) 11%, transparent)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  mintedBox: {
    width: '100%',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  mintedWarning: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger-text)' },
  mintedValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.8rem',
    wordBreak: 'break-all',
    backgroundColor: 'var(--bg-color)',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
  },
  mintedActions: { display: 'flex', gap: '8px' },
  tokenList: { listStyle: 'none', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' },
  tokenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-color)',
  },
  tokenName: { display: 'block', fontWeight: 600, fontSize: '0.9rem' },
  tokenMeta: { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/tests/backupCard.test.jsx`

Expected: PASS, 4 tests.

- [ ] **Step 5: Render it in the admin console**

In `frontend/src/pages/AdminConsole.jsx`, add the import:

```jsx
import BackupCard from '../components/BackupCard';
```

and render it immediately after the closing `</div>` of the "Global Books Catalog Cache" card, before the user-audit card:

```jsx
<BackupCard />
```

- [ ] **Step 6: Run the full frontend suite and the linter**

Run: `cd frontend && npx vitest run && npm run lint`

Expected: PASS, zero lint warnings (the config runs with `--max-warnings 0`).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/BackupCard.jsx frontend/src/pages/AdminConsole.jsx frontend/src/tests/backupCard.test.jsx
git commit -m "feat(admin): add backup, restore and API token controls to the console"
```

---

### Task 9: Manual verification against real containers

**Files:**
- Modify: `README.md` (add a "Backups" section)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation, and proof the subsystem works outside the mocks.

The suite mocks `child_process`, so nothing so far has run a real `pg_dump`. This task is where that gets checked. **Do not skip it** — the mocked tests cannot catch a wrong package name, a missing binary, or a flag Postgres 16 rejects.

- [ ] **Step 1: Bring up the stack with the rebuilt image**

Run: `docker compose up -d --build`

Expected: both containers healthy. `docker logs bookbinder-app` shows `✅ Structural schema initialized successfully.`

- [ ] **Step 2: Confirm the new table applied**

Run: `docker exec -t bookbinder-db psql -U postgres -d bookbinder -c '\d api_tokens'`

Expected: the table prints with `token_hash` and `revoked_at` columns.

- [ ] **Step 3: Mint a token through the UI**

Open the admin console, generate a token named `verification`, and copy it.

- [ ] **Step 4: Download a backup with that token, as n8n would**

Run: `curl -sS -D- -o /tmp/verify.dump -H "Authorization: Bearer <token>" http://localhost:5000/api/admin/backup`

Expected: `200`, `Content-Disposition: attachment; filename="bookbinder-<today>.dump"`.

- [ ] **Step 5: Confirm the archive is a real dump, not an error page**

Run: `docker run --rm -v /tmp:/t postgres:16-alpine pg_restore --list /t/verify.dump | head`

Expected: a table of contents listing `TABLE DATA public users`, `books`, `bookshelves` and the rest. This is the check the mocked tests cannot make.

- [ ] **Step 6: Verify the confirmation guard rejects a real request**

Run: `curl -sS -o- -w '%{http_code}' -H "Authorization: Bearer <token>" -F file=@/tmp/verify.dump http://localhost:5000/api/admin/restore`

Expected: `400`, with the message naming `REPLACE_ALL_DATA`. No restore occurs.

- [ ] **Step 7: Restore for real and confirm the data survives**

Note a book title in the UI. Then run:

```bash
curl -sS -w '%{http_code}' -H "Authorization: Bearer <token>" \
  -F file=@/tmp/verify.dump -F confirm=REPLACE_ALL_DATA \
  http://localhost:5000/api/admin/restore
```

Expected: `200`. Reload the app — the same books are present. Signing in again may be required, which is the documented session behaviour.

- [ ] **Step 8: Verify a revoked token is refused**

Revoke the `verification` token in the UI, then repeat Step 4.

Expected: `401 {"error":"Invalid or revoked API token."}`

- [ ] **Step 9: Document it in the README**

Add a `## Backups` section covering: where the volumes live (`/var/lib/docker/volumes/bookbinder-pg-data/_data`), the admin console controls, the `docker run ... tar czf` command for avatars, and the n8n recipe:

```
Schedule (nightly)
  → HTTP Request
      GET https://<host>/api/admin/backup
      Header: Authorization: Bearer bb_...
      Response format: File
  → write to storage
```

Note that a failed dump returns `500` with a JSON body, so the workflow can branch on status rather than inspecting the bytes.

- [ ] **Step 10: Commit**

```bash
git add README.md
git commit -m "docs: document database backup, restore and n8n automation"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| Backup format (`--format=custom`) | 4 |
| Avatars excluded + `tar` remedy | 8 (UI), 9 (README) |
| Container changes (`postgresql16-client`) | 1 |
| `services/pgBackup.js`, no shell, `PGPASSWORD` in env | 4 |
| Export buffers, does not stream | 4, 7 |
| Restore pipes to stdin, `--single-transaction` | 4 |
| Endpoint table | 6 (tokens), 7 (backup/restore) |
| `confirm=REPLACE_ALL_DATA` guard | 7 (API), 8 (UI) |
| `api_tokens` table | 2 |
| Token generation + SHA-256 hashing | 3 |
| Bearer middleware, `req.user` shape, `last_used_at` | 5 |
| Bearer scoped to `/api/admin/*` | 6, 7 (mounting) |
| `BackupCard` component, three blocks | 8 |
| Failure mode: old backup refuses to restore | 7 (surfaces stderr), 9 (README) |
| Failure mode: restore logs the admin out | 7 (response copy), 8 (UI warning) |
| Failure mode: size cap | 4, 7 (multer limit) |
| Testing (mocked db + child_process) | 3–8 |
| Manual verification | 9 |

No spec requirement is unimplemented.

**Type consistency:** `dumpDatabase()` / `restoreDatabase(archive)` / `MAX_ARCHIVE_BYTES` are named identically in Tasks 4 and 7. `generateToken()` / `hashToken()` / `TOKEN_PREFIX` are identical in Tasks 3, 5 and 6. `authenticateApiToken` is identical in Tasks 5, 6 and 7. `CONFIRM_PHRASE` resolves to the same literal `REPLACE_ALL_DATA` in Tasks 7 and 8.

**Known deviation from the spec:** the spec's original Testing section called for round-trip tests against a real test database. This repo mocks the database layer wholesale and stands up no Postgres in its suite, so the spec was amended before this plan was written: automated tests mock `child_process`, and the round trip moved to Task 9's manual verification.
