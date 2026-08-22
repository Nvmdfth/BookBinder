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
