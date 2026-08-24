/**
 * What the credential limiter is allowed to cover.
 *
 * Mounting it on the whole /api/auth prefix looked tidy and broke the app:
 * AuthProvider calls GET /api/auth/me on every load to check the session, so a
 * user who reloaded ten times in a quarter hour started getting 429 on the
 * session check — which the client reads as being signed out. The limiter must
 * cover only the endpoints that accept a guess.
 *
 * Builds its own app after setting a small limit, rather than using the shared
 * harness, because setupEnv raises the limits so router tests can run freely.
 */
const request = require('supertest');

jest.mock('../src/db/db', () => ({
  query: jest.fn(),
  pool: { connect: jest.fn(), on: jest.fn() },
  initDb: jest.fn(),
}));

const { query } = require('../src/db/db');

let app;

beforeEach(() => {
  jest.resetModules();
  process.env.RATE_LIMIT_AUTH_MAX = '2';
  // Re-require after the env change so the limiter picks the small value up.
  const { createApp } = require('../src/app');
  app = createApp();
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(() => {
  process.env.RATE_LIMIT_AUTH_MAX = '1000000';
});

describe('Endpoints that accept a credential guess', () => {
  it('throttles repeated login attempts', async () => {
    const attempt = () =>
      request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });

    await attempt();
    await attempt();

    expect((await attempt()).status).toBe(429);
  });

  it('counts login and register against one shared budget', async () => {
    await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
    await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });

    // Two guesses already spent: registering must not hand out a fresh ten.
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.c', password: 'xxxxxxxxxx' });

    expect(res.status).toBe(429);
  });
});

describe('Endpoints that accept no guess', () => {
  it('never throttles the session check, which the client calls on every load', async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).not.toBe(429);
    }
  });

  it('never throttles the registration-status probe the sign-up page reads', async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).get('/api/auth/registration-status');
      expect(res.status).not.toBe(429);
    }
  });

  it('never throttles logout, so a throttled user can still sign out cleanly', async () => {
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).not.toBe(429);
    }
  });
});
