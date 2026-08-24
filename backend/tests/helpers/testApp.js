/**
 * Shared harness for router tests.
 *
 * The database layer is mocked rather than containerized: these tests exercise
 * routing, RBAC and validation logic, so the value is in asserting which SQL a
 * request issues and how it reacts to given rows — not in Postgres itself.
 */
const jwt = require('jsonwebtoken');

// Mocked for every consumer of the module, since all routers require this same path.
//
// withTransaction is the real implementation rather than a stand-in: the whole
// point of the routes that use it is the BEGIN/COMMIT/ROLLBACK sequencing, and a
// double would let that sequencing be wrong while the tests stayed green. Only
// the driver underneath is faked. The transaction client shares one handler
// table with the pooled query, so a test declares its SQL once no matter which
// of the two issues it, and sqlCalls() sees the statements from both.
const mockQuery = jest.fn();

jest.mock('../../src/db/db', () => {
  const { withTransaction } = require('../../src/db/transaction');
  const pool = {
    connect: async () => ({
      query: (text, params) => mockQuery(text, params),
      release: () => {},
    }),
    on: jest.fn(),
  };

  return {
    query: mockQuery,
    pool,
    initDb: jest.fn(),
    withTransaction: (fn) => withTransaction(pool, fn),
  };
});

const { query } = require('../../src/db/db');
const { createApp } = require('../../src/app');
const { JWT_SECRET } = require('../../src/middleware/authMiddleware');

const app = createApp();

/** Canonical bcrypt-shaped hash; its last 10 chars are the session revocation signature. */
const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuvCARRIEDSIG';

const USERS = {
  owner: { id: 1, email: 'owner@library.com', role: 'user' },
  collaborator: { id: 2, email: 'collab@library.com', role: 'user' },
  viewer: { id: 3, email: 'viewer@library.com', role: 'user' },
  stranger: { id: 4, email: 'stranger@library.com', role: 'user' },
  admin: { id: 9, email: 'admin@library.com', role: 'admin' },
};

/**
 * Build a signed session cookie for one of the fixture users.
 */
function authCookie(userKey, overrides = {}) {
  const user = { ...USERS[userKey], ...overrides };
  const token = jwt.sign(
    { userId: user.id, role: user.role, pwdSig: PASSWORD_HASH.slice(-10) },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  return [`token=${token}`];
}

/**
 * Install SQL handlers. Each entry is [regex, rowsOrFactory]; the first pattern
 * matching the statement wins. Unmatched statements throw, so a test can never
 * silently pass against SQL it did not intend to run.
 *
 * Default handlers for the authMiddleware user lookup and the holdings probe are
 * appended last, so a test may supply its own to exercise the disabled/revoked
 * session paths or to assert on holdings.
 */
function mockSql(handlers, { authenticatedAs = 'owner', authOverrides = {} } = {}) {
  const authUser = { ...USERS[authenticatedAs], ...authOverrides };

  const all = [
    ...handlers,
    [
      /SELECT id, email, role, password_hash, is_disabled FROM users WHERE id/,
      [{
        id: authUser.id,
        email: authUser.email,
        role: authUser.role,
        password_hash: PASSWORD_HASH,
        is_disabled: authUser.is_disabled ?? false,
      }],
    ],
    /*
     * Every successful metadata lookup asks which of the user's shelves already
     * carry the book. That is incidental to most tests here, so it defaults to
     * "held nowhere" rather than forcing each one to restate it.
     */
    [/FROM user_books ub JOIN bookshelves bs/, []],
    /*
     * Transaction control statements. Tests asserting atomicity read these back
     * out of sqlCalls() rather than handling them, so they default to succeeding.
     */
    [/^(BEGIN|COMMIT|ROLLBACK)$/, []],
  ];

  query.mockImplementation(async (text, params) => {
    const normalized = String(text).replace(/\s+/g, ' ').trim();

    for (const [pattern, rows] of all) {
      if (pattern.test(normalized)) {
        const resolved = typeof rows === 'function' ? await rows(params) : rows;
        // A handler may return a full pg result to control rowCount
        if (resolved && !Array.isArray(resolved) && 'rows' in resolved) return resolved;
        return { rows: resolved || [], rowCount: (resolved || []).length };
      }
    }

    throw new Error(`Unhandled SQL in test: ${normalized}`);
  });

  return query;
}

/** Convenience matcher: statements the test asserts were issued. */
function sqlCalls() {
  return query.mock.calls.map(([text, params]) => ({
    sql: String(text).replace(/\s+/g, ' ').trim(),
    params,
  }));
}

module.exports = {
  app,
  query,
  mockSql,
  sqlCalls,
  authCookie,
  USERS,
  PASSWORD_HASH,
};
