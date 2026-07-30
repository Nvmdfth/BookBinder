const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, mockSql, authCookie, PASSWORD_HASH } = require('./helpers/testApp');

const SETTINGS_LOOKUP = /SELECT value FROM system_settings WHERE key = 'allow_open_registration'/;
const USER_BY_EMAIL = /SELECT id FROM users WHERE email/;
const LOGIN_LOOKUP = /SELECT id, email, password_hash, role, avatar_url, is_disabled, theme, palette FROM users WHERE email/;
const WISHLIST_CHECK = /SELECT id FROM bookshelves WHERE user_id = \$1 AND is_wishlist = TRUE/;
const INSERT_USER = /INSERT INTO users/;
const INSERT_WISHLIST = /INSERT INTO bookshelves/;
const ME_LOOKUP = /SELECT id, email, role, avatar_url, theme, palette FROM users WHERE id/;

const DISABLED_MESSAGE =
  'Public registration is currently disabled on this instance. Please contact your system administrator for access.';

describe('GET /api/auth/registration-status (Req 4.4.2)', () => {
  it('is reachable without a session, so the register view can decide what to render', async () => {
    mockSql([[SETTINGS_LOOKUP, [{ value: 'true' }]]]);

    const res = await request(app).get('/api/auth/registration-status');

    expect(res.status).toBe(200);
    expect(res.body.allowOpenRegistration).toBe(true);
  });

  it('reports the locked state with the exact PRD fallback message', async () => {
    mockSql([[SETTINGS_LOOKUP, [{ value: 'false' }]]]);

    const res = await request(app).get('/api/auth/registration-status');

    expect(res.status).toBe(200);
    expect(res.body.allowOpenRegistration).toBe(false);
    expect(res.body.message).toBe(DISABLED_MESSAGE);
  });

  it('fails closed when the settings lookup errors', async () => {
    mockSql([[SETTINGS_LOOKUP, () => { throw new Error('db down'); }]]);

    const res = await request(app).get('/api/auth/registration-status');

    expect(res.status).toBe(500);
    expect(res.body.allowOpenRegistration).toBe(false);
  });
});

describe('POST /api/auth/register switch enforcement (Req 4.4.1 / 4.4.4)', () => {
  it('returns 403 when allow_open_registration is false', async () => {
    mockSql([[SETTINGS_LOOKUP, [{ value: 'false' }]]]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@library.com', password: 'validpass123' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe(DISABLED_MESSAGE);
  });

  it('checks the switch before validating the payload, so a malformed body still yields 403', async () => {
    // Regression guard: validating the body first made this answer 400, which
    // meant the register view could never detect the locked instance.
    mockSql([[SETTINGS_LOOKUP, [{ value: 'false' }]]]);

    const res = await request(app).post('/api/auth/register').send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe(DISABLED_MESSAGE);
  });

  it('treats a missing settings row as closed rather than open', async () => {
    mockSql([[SETTINGS_LOOKUP, []]]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@library.com', password: 'validpass123' });

    expect(res.status).toBe(403);
  });

  it('creates the account and seeds a wishlist when registration is open', async () => {
    mockSql([
      [SETTINGS_LOOKUP, [{ value: 'true' }]],
      [USER_BY_EMAIL, []],
      [INSERT_USER, [{ id: 11, email: 'new@library.com', role: 'user', avatar_url: null, theme: 'dark', palette: 'indigo' }]],
      [WISHLIST_CHECK, []],
      [INSERT_WISHLIST, []],
    ]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: '  NEW@Library.com ', password: 'validpass123' });

    expect(res.status).toBe(201);
    expect(res.body.user.id).toBe(11);
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('normalizes the email to lower case before the uniqueness check', async () => {
    const seen = [];
    mockSql([
      [SETTINGS_LOOKUP, [{ value: 'true' }]],
      [USER_BY_EMAIL, (params) => { seen.push(params[0]); return []; }],
      [INSERT_USER, (params) => { seen.push(params[0]); return [{ id: 12, email: params[0], role: 'user' }]; }],
      [WISHLIST_CHECK, []],
      [INSERT_WISHLIST, []],
    ]);

    await request(app)
      .post('/api/auth/register')
      .send({ email: '  MixedCase@Library.COM ', password: 'validpass123' });

    expect(seen).toEqual(['mixedcase@library.com', 'mixedcase@library.com']);
  });

  it('rejects a short password once the instance is open', async () => {
    mockSql([[SETTINGS_LOOKUP, [{ value: 'true' }]]]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'new@library.com', password: 'short' });

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate email with 409', async () => {
    mockSql([
      [SETTINGS_LOOKUP, [{ value: 'true' }]],
      [USER_BY_EMAIL, [{ id: 1 }]],
    ]);

    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'owner@library.com', password: 'validpass123' });

    expect(res.status).toBe(409);
  });

  it('stores a bcrypt hash rather than the plaintext password', async () => {
    let storedHash = null;
    mockSql([
      [SETTINGS_LOOKUP, [{ value: 'true' }]],
      [USER_BY_EMAIL, []],
      [INSERT_USER, (params) => { storedHash = params[1]; return [{ id: 13, email: params[0], role: 'user' }]; }],
      [WISHLIST_CHECK, []],
      [INSERT_WISHLIST, []],
    ]);

    await request(app)
      .post('/api/auth/register')
      .send({ email: 'hash@library.com', password: 'validpass123' });

    expect(storedHash).not.toBe('validpass123');
    expect(storedHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('validpass123', storedHash)).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  /** Login compares against a real bcrypt hash, so build one for the fixture. */
  async function loginRows(overrides = {}) {
    const hash = await bcrypt.hash('correct-horse', 10);
    return [{
      id: 1,
      email: 'owner@library.com',
      password_hash: hash,
      role: 'user',
      avatar_url: null,
      is_disabled: false,
      theme: 'dark',
      palette: 'indigo',
      ...overrides,
    }];
  }

  it('issues the session as an HttpOnly, SameSite cookie (NFR 5.4)', async () => {
    mockSql([
      [LOGIN_LOOKUP, await loginRows()],
      [WISHLIST_CHECK, [{ id: 5 }]],
    ]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@library.com', password: 'correct-horse' });

    expect(res.status).toBe(200);

    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('token='));
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it('never returns the password hash in the response body', async () => {
    mockSql([
      [LOGIN_LOOKUP, await loginRows()],
      [WISHLIST_CHECK, [{ id: 5 }]],
    ]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@library.com', password: 'correct-horse' });

    expect(JSON.stringify(res.body)).not.toContain('$2');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('answers 401 with an indistinguishable message for unknown email and wrong password', async () => {
    mockSql([[LOGIN_LOOKUP, []]]);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@library.com', password: 'whatever' });

    mockSql([[LOGIN_LOOKUP, await loginRows()]]);
    const wrongPass = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@library.com', password: 'wrong-password' });

    expect(unknown.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    // Identical wording avoids disclosing which accounts exist
    expect(unknown.body.error).toBe(wrongPass.body.error);
  });

  it('blocks a disabled account with 403 and issues no cookie', async () => {
    mockSql([[LOGIN_LOOKUP, await loginRows({ is_disabled: true })]]);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@library.com', password: 'correct-horse' });

    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the cookie using the attributes it was set with', async () => {
    mockSql([]);

    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('token='));
    // Mismatched attributes leave the original cookie in place in real browsers
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
  });
});

describe('GET /api/auth/me session guards', () => {
  it('rejects a request with no cookie', async () => {
    mockSql([]);

    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    mockSql([]);
    const forged = require('jsonwebtoken').sign({ userId: 1, role: 'admin' }, 'attacker-secret');

    const res = await request(app).get('/api/auth/me').set('Cookie', [`token=${forged}`]);

    expect(res.status).toBe(401);
  });

  it('revokes a session whose password signature no longer matches (post password change)', async () => {
    mockSql([
      [
        /SELECT id, email, role, password_hash, is_disabled FROM users WHERE id/,
        [{ id: 1, email: 'owner@library.com', role: 'user', password_hash: 'ROTATED_HASH_ENDING', is_disabled: false }],
      ],
    ]);

    const res = await request(app).get('/api/auth/me').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/credential changes/i);
  });

  it('blocks a valid token belonging to a since-disabled account', async () => {
    mockSql([
      [
        /SELECT id, email, role, password_hash, is_disabled FROM users WHERE id/,
        [{ id: 1, email: 'owner@library.com', role: 'user', password_hash: PASSWORD_HASH, is_disabled: true }],
      ],
    ]);

    const res = await request(app).get('/api/auth/me').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(403);
  });

  it('resolves the profile for a valid session', async () => {
    mockSql([
      [WISHLIST_CHECK, [{ id: 5 }]],
      [ME_LOOKUP, [{ id: 1, email: 'owner@library.com', role: 'user', avatar_url: null, theme: 'light', palette: 'emerald' }]],
    ]);

    const res = await request(app).get('/api/auth/me').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 1, email: 'owner@library.com', theme: 'light', palette: 'emerald' });
  });
});
