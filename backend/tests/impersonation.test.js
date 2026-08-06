const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, mockSql, authCookie } = require('./helpers/testApp');
const { JWT_SECRET } = require('../src/middleware/authMiddleware');

const PASSWORD_HASH = '$2a$10$abcdefghijklmnopqrstuvCARRIEDSIG';

function impersonationCookie(targetUserId, adminUserId = 9) {
  const token = jwt.sign(
    { userId: targetUserId, impersonatorId: adminUserId, pwdSig: PASSWORD_HASH.slice(-10) },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  return [`token=${token}`];
}

describe('User Impersonation API (/api/auth/impersonate)', () => {
  it('allows an administrator to start impersonating a valid user', async () => {
    mockSql(
      [
        [
          /SELECT id, email, role, password_hash, is_disabled, avatar_url, theme, palette FROM users WHERE id = \$1/,
          { rows: [{ id: 1, email: 'owner@library.com', role: 'user', password_hash: PASSWORD_HASH, is_disabled: false, avatar_url: null, theme: 'light', palette: 'library-buckram' }] }
        ],
        [
          /SELECT id FROM bookshelves WHERE user_id = \$1 AND is_wishlist = TRUE/,
          { rows: [{ id: 10 }] }
        ]
      ],
      { authenticatedAs: 'admin' }
    );

    const res = await request(app)
      .post('/api/auth/impersonate/1')
      .set('Cookie', authCookie('admin'));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Impersonating owner@library.com');
    expect(res.body.user.id).toBe(1);
    expect(res.body.user.isImpersonating).toBe(true);
    expect(res.body.user.impersonator.id).toBe(9);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects impersonation requests from standard users with 403', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/auth/impersonate/2')
      .set('Cookie', authCookie('owner'));

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Administrative privileges required');
  });

  it('rejects self-impersonation by an admin with 400', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/auth/impersonate/9')
      .set('Cookie', authCookie('admin'));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot impersonate your own account');
  });

  it('rejects impersonating a disabled user account with 400', async () => {
    mockSql(
      [
        [
          /SELECT id, email, role, password_hash, is_disabled, avatar_url, theme, palette FROM users WHERE id = \$1/,
          { rows: [{ id: 2, email: 'disabled@library.com', role: 'user', password_hash: PASSWORD_HASH, is_disabled: true }] }
        ]
      ],
      { authenticatedAs: 'admin' }
    );

    const res = await request(app)
      .post('/api/auth/impersonate/2')
      .set('Cookie', authCookie('admin'));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot impersonate a disabled user');
  });

  it('allows switching back to main admin profile via /unimpersonate', async () => {
    mockSql(
      [
        [
          /SELECT id, email, role, is_disabled FROM users WHERE id = \$1/,
          { rows: [{ id: 9, email: 'admin@library.com', role: 'admin', is_disabled: false }] }
        ],
        [
          /SELECT id, email, role, password_hash, is_disabled, avatar_url, theme, palette FROM users WHERE id = \$1/,
          { rows: [{ id: 9, email: 'admin@library.com', role: 'admin', password_hash: PASSWORD_HASH, is_disabled: false, avatar_url: null, theme: 'light', palette: 'library-buckram' }] }
        ]
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/auth/unimpersonate')
      .set('Cookie', impersonationCookie(1, 9));

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Returned to main profile');
    expect(res.body.user.id).toBe(9);
    expect(res.body.user.isImpersonating).toBe(false);
    expect(res.body.user.impersonator).toBeNull();
  });

  it('rejects /unimpersonate when not currently impersonating with 400', async () => {
    mockSql([], { authenticatedAs: 'admin' });

    const res = await request(app)
      .post('/api/auth/unimpersonate')
      .set('Cookie', authCookie('admin'));

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Not currently in an impersonation session');
  });

  it('returns impersonating flag and admin details on GET /api/auth/me during impersonation', async () => {
    mockSql(
      [
        [
          /SELECT id, email, role, is_disabled FROM users WHERE id = \$1/,
          { rows: [{ id: 9, email: 'admin@library.com', role: 'admin', is_disabled: false }] }
        ],
        [
          /SELECT id FROM bookshelves WHERE user_id = \$1 AND is_wishlist = TRUE/,
          { rows: [{ id: 10 }] }
        ],
        [
          /SELECT id, email, role, avatar_url, theme, palette FROM users WHERE id = \$1/,
          { rows: [{ id: 1, email: 'owner@library.com', role: 'user', avatar_url: null, theme: 'light', palette: 'library-buckram' }] }
        ]
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', impersonationCookie(1, 9));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.isImpersonating).toBe(true);
    expect(res.body.impersonator.id).toBe(9);
    expect(res.body.impersonator.email).toBe('admin@library.com');
  });
});
