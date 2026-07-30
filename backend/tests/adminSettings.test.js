/**
 * Administrative governance coverage (PRD §2 matrix, 4.4.3).
 *
 * Every /api/settings route sits behind requireAdmin; the admin console toggle
 * and the account auditing tools must be unreachable to a standard user.
 */
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');

const ALL_SETTINGS = /SELECT key, value FROM system_settings$/;
const UPDATE_SETTING = /UPDATE system_settings SET value/;
const ORPHAN_LIST = /FROM books b LEFT JOIN user_books ub ON b.id = ub.book_id WHERE ub.id IS NULL/;
const ORPHAN_PRUNE = /DELETE FROM books WHERE id IN/;
const USERS_AUDIT = /SELECT u.id, u.email, u.role, u.avatar_url, u.is_disabled, u.created_at/;
const UPDATE_DISABLED = /UPDATE users SET is_disabled/;
const UPDATE_ROLE = /UPDATE users SET role/;
const UPDATE_PASSWORD = /UPDATE users SET password_hash/;
const DELETE_USER = /DELETE FROM users WHERE id/;

describe('Admin guard on /api/settings (PRD §2)', () => {
  const cases = [
    ['get', '/api/settings'],
    ['put', '/api/settings'],
    ['get', '/api/settings/orphans'],
    ['post', '/api/settings/orphans/prune'],
    ['get', '/api/settings/users'],
    ['put', '/api/settings/users/2/disable'],
    ['put', '/api/settings/users/2/role'],
    ['put', '/api/settings/users/2/reset-password'],
    ['delete', '/api/settings/users/2'],
  ];

  it.each(cases)('rejects %s %s from a standard user with 403', async (method, path) => {
    mockSql([], { authenticatedAs: 'stranger' });

    const res = await request(app)[method](path).set('Cookie', authCookie('stranger')).send({});

    expect(res.status).toBe(403);
  });

  it.each(cases)('rejects %s %s from an anonymous caller with 401', async (method, path) => {
    mockSql([]);

    const res = await request(app)[method](path).send({});

    expect(res.status).toBe(401);
  });

  it('does not run any settings statement when a standard user is rejected', async () => {
    mockSql([], { authenticatedAs: 'stranger' });

    await request(app)
      .put('/api/settings')
      .set('Cookie', authCookie('stranger'))
      .send({ allow_open_registration: 'true' });

    expect(sqlCalls().some((c) => UPDATE_SETTING.test(c.sql))).toBe(false);
  });

  it('trusts the database role, not the role claim inside the token', async () => {
    // Token claims admin; the users row says otherwise and must win
    mockSql([], { authenticatedAs: 'stranger' });

    const res = await request(app)
      .get('/api/settings')
      .set('Cookie', authCookie('stranger', { role: 'admin' }));

    expect(res.status).toBe(403);
  });
});

describe('Registration switch management (Req 4.4.3)', () => {
  it('returns the settings dictionary to an admin', async () => {
    mockSql([[ALL_SETTINGS, [
      { key: 'allow_open_registration', value: 'false' },
      { key: 'enable_google_books', value: 'true' },
    ]]], { authenticatedAs: 'admin' });

    const res = await request(app).get('/api/settings').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ allow_open_registration: 'false', enable_google_books: 'true' });
  });

  it('persists the open-registration toggle', async () => {
    mockSql([
      [UPDATE_SETTING, []],
      [ALL_SETTINGS, [{ key: 'allow_open_registration', value: 'true' }]],
    ], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings')
      .set('Cookie', authCookie('admin'))
      .send({ allow_open_registration: 'true' });

    expect(res.status).toBe(200);
    expect(res.body.settings.allow_open_registration).toBe('true');

    const update = sqlCalls().find((c) => UPDATE_SETTING.test(c.sql));
    expect(update.params).toEqual(['true', 'allow_open_registration']);
  });

  it('ignores keys outside the permitted settings whitelist', async () => {
    mockSql([
      [UPDATE_SETTING, []],
      [ALL_SETTINGS, []],
    ], { authenticatedAs: 'admin' });

    await request(app)
      .put('/api/settings')
      .set('Cookie', authCookie('admin'))
      .send({ jwt_secret: 'pwned', allow_open_registration: 'true' });

    const updatedKeys = sqlCalls().filter((c) => UPDATE_SETTING.test(c.sql)).map((c) => c.params[1]);
    expect(updatedKeys).toEqual(['allow_open_registration']);
  });
});

describe('Global catalog index cleaning (PRD §2 admin-only)', () => {
  it('lists orphaned catalog rows with a count', async () => {
    mockSql([[ORPHAN_LIST, [{ id: 1, isbn: '9780306406157', title: 'Unreferenced' }]]], { authenticatedAs: 'admin' });

    const res = await request(app).get('/api/settings/orphans').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
  });

  it('prunes only books with no user_books reference', async () => {
    mockSql([[ORPHAN_PRUNE, { rows: [], rowCount: 4 }]], { authenticatedAs: 'admin' });

    const res = await request(app).post('/api/settings/orphans/prune').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body.prunedCount).toBe(4);
    // The WHERE clause is what keeps owned books safe
    expect(sqlCalls().find((c) => ORPHAN_PRUNE.test(c.sql)).sql).toMatch(/WHERE ub.id IS NULL/);
  });
});

describe('User account auditing (PRD §2 admin-only)', () => {
  it('returns accounts with inventory counts and no password hashes', async () => {
    mockSql([[USERS_AUDIT, [
      { id: 1, email: 'owner@library.com', role: 'user', is_disabled: false, bookshelf_count: '3', book_count: '17' },
    ]]], { authenticatedAs: 'admin' });

    const res = await request(app).get('/api/settings/users').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body[0].bookshelf_count).toBe('3');
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
  });

  it('disables another account', async () => {
    mockSql([[UPDATE_DISABLED, []]], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings/users/2/disable')
      .set('Cookie', authCookie('admin'))
      .send({ is_disabled: true });

    expect(res.status).toBe(200);
    expect(res.body.isDisabled).toBe(true);
  });

  it('promotes a user to admin', async () => {
    mockSql([[UPDATE_ROLE, []]], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings/users/2/role')
      .set('Cookie', authCookie('admin'))
      .send({ role: 'admin' });

    expect(res.status).toBe(200);
    expect(sqlCalls().find((c) => UPDATE_ROLE.test(c.sql)).params).toEqual(['admin', 2]);
  });

  it('rejects a role outside the schema constraint', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings/users/2/role')
      .set('Cookie', authCookie('admin'))
      .send({ role: 'superuser' });

    expect(res.status).toBe(400);
    expect(sqlCalls().some((c) => UPDATE_ROLE.test(c.sql))).toBe(false);
  });

  it('hashes an admin-issued password reset', async () => {
    mockSql([[UPDATE_PASSWORD, []]], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings/users/2/reset-password')
      .set('Cookie', authCookie('admin'))
      .send({ password: 'brand-new-pass' });

    expect(res.status).toBe(200);
    const stored = sqlCalls().find((c) => UPDATE_PASSWORD.test(c.sql)).params[0];
    expect(stored).not.toBe('brand-new-pass');
    expect(await bcrypt.compare('brand-new-pass', stored)).toBe(true);
  });

  it('enforces the minimum password length on admin resets', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .put('/api/settings/users/2/reset-password')
      .set('Cookie', authCookie('admin'))
      .send({ password: 'abc' });

    expect(res.status).toBe(400);
  });

  it('deletes another account', async () => {
    mockSql([[DELETE_USER, []]], { authenticatedAs: 'admin' });

    const res = await request(app).delete('/api/settings/users/2').set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
  });
});

describe('Self-action guards keep an admin from locking themselves out', () => {
  // The admin fixture is user id 9
  it.each([
    ['disable', () => request(app).put('/api/settings/users/9/disable').send({ is_disabled: true })],
    ['role change', () => request(app).put('/api/settings/users/9/role').send({ role: 'user' })],
    ['password reset', () => request(app).put('/api/settings/users/9/reset-password').send({ password: 'newpassword' })],
    ['deletion', () => request(app).delete('/api/settings/users/9')],
  ])('blocks self-%s with 400', async (_label, build) => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await build().set('Cookie', authCookie('admin'));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/blocked/i);
  });

  it('runs no mutation when a self-action is blocked', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    await request(app).delete('/api/settings/users/9').set('Cookie', authCookie('admin'));

    expect(sqlCalls().some((c) => DELETE_USER.test(c.sql))).toBe(false);
  });
});
