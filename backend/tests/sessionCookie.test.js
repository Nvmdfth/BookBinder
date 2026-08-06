/**
 * Session cookie transport attributes (NFR 5.4).
 *
 * A `Secure` cookie is discarded by browsers on any plain-HTTP origin that is
 * not localhost. Deriving that flag from the build mode therefore breaks every
 * LAN client — http://192.168.x.x:5000 logs in, the browser drops the cookie,
 * and every later request arrives with no session — while localhost keeps
 * working and hides the fault. The flag has to follow the actual connection.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, mockSql } = require('./helpers/testApp');

const LOGIN_LOOKUP = /SELECT id, email, password_hash, role, avatar_url, is_disabled/;
const WISHLIST_CHECK = /FROM bookshelves WHERE user_id = \$1 AND is_wishlist/;

async function loginRows() {
  return [{
    id: 1,
    email: 'owner@library.com',
    password_hash: await bcrypt.hash('correct-horse', 10),
    role: 'user',
    avatar_url: null,
    is_disabled: false,
    theme: 'dark',
    palette: 'indigo',
  }];
}

async function login(headers = {}) {
  mockSql([
    [LOGIN_LOOKUP, await loginRows()],
    [WISHLIST_CHECK, [{ id: 5 }]],
  ]);

  const req = request(app).post('/api/auth/login');
  for (const [k, v] of Object.entries(headers)) req.set(k, v);
  return req.send({ email: 'owner@library.com', password: 'correct-horse' });
}

function tokenCookie(res) {
  return (res.headers['set-cookie'] || []).find((c) => c.startsWith('token='));
}

describe('Session cookie Secure attribute', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('omits Secure over a plain HTTP connection, so LAN clients keep the session', async () => {
    process.env.NODE_ENV = 'production';

    const res = await login();

    expect(res.status).toBe(200);
    expect(tokenCookie(res)).not.toMatch(/Secure/i);
  });

  it('sets Secure when the request arrived over HTTPS via a terminating proxy', async () => {
    const res = await login({ 'X-Forwarded-Proto': 'https' });

    expect(res.status).toBe(200);
    expect(tokenCookie(res)).toMatch(/Secure/i);
  });

  it('keeps HttpOnly and SameSite regardless of transport (NFR 5.4)', async () => {
    const plain = await login();
    const secure = await login({ 'X-Forwarded-Proto': 'https' });

    for (const cookie of [tokenCookie(plain), tokenCookie(secure)]) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    }
  });

  it('clears the session with attributes matching the issued cookie', async () => {
    // Mismatched attributes leave the original cookie in place and the session
    // survives logout — the reason these options are shared rather than retyped.
    const res = await request(app).post('/api/auth/logout');

    const cookie = tokenCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).not.toMatch(/Secure/i);
  });
});
