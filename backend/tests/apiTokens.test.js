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

  // I4: a Bearer token must not be able to manage tokens at all, admin-owned
  // or not — otherwise a leaked token can mint its own successor, and
  // revoking the leaked one no longer removes the attacker's access.
  it.each(cases)('rejects %s %s carrying a valid admin Bearer token with 401, cookie-only', async (method, path) => {
    mockSql([]);

    const res = await request(app)[method](path)
      .set('Authorization', 'Bearer bb_validtoken')
      .send({ name: 'x' });

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

  // M3: a non-numeric id used to reach Postgres and raise "invalid input
  // syntax for type integer", which surfaced as a 500 where 404 belongs.
  it.each(['abc', '1.5', '-1', '0', '1e3'])(
    '404s a non-numeric id %p without querying the database',
    async (id) => {
      mockSql([], { authenticatedAs: 'admin' });

      const res = await request(app)
        .delete(`/api/admin/tokens/${encodeURIComponent(id)}`)
        .set('Cookie', authCookie('admin'));

      expect(res.status).toBe(404);
      expect(sqlCalls().some((c) => REVOKE_TOKEN.test(c.sql))).toBe(false);
    }
  );
});
