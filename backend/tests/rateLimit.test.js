/**
 * Brute-force throttling on the credential and admin surfaces.
 *
 * Before this, POST /api/auth/login accepted unlimited attempts at whatever
 * rate an attacker could send them, on a port a tunnel exposes to the
 * internet. bcrypt made each guess cost CPU, which throttles the defender as
 * much as the attacker.
 *
 * The limiter is built by a factory rather than declared at module scope so
 * these tests can exercise the real middleware at a small limit, instead of
 * being skipped in the test environment and shipping unverified.
 */
const express = require('express');
const request = require('supertest');
const { createRateLimiter } = require('../src/middleware/rateLimit');

function appWith(limiter) {
  const app = express();
  app.use('/guarded', limiter, (req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('allows requests up to the limit and rejects the next one with 429', async () => {
    const app = appWith(createRateLimiter({ limit: 2, message: 'Slow down.' }));

    expect((await request(app).get('/guarded')).status).toBe(200);
    expect((await request(app).get('/guarded')).status).toBe(200);
    expect((await request(app).get('/guarded')).status).toBe(429);
  });

  it('answers with JSON, so an API client can read the refusal', async () => {
    const app = appWith(createRateLimiter({ limit: 1, message: 'Too many attempts.' }));

    await request(app).get('/guarded');
    const blocked = await request(app).get('/guarded');

    expect(blocked.headers['content-type']).toMatch(/application\/json/);
    expect(blocked.body.error).toBe('Too many attempts.');
  });

  it('advertises the standard RateLimit headers and omits the legacy ones', async () => {
    const app = appWith(createRateLimiter({ limit: 5, message: 'Slow down.' }));

    const res = await request(app).get('/guarded');

    expect(res.headers).toHaveProperty('ratelimit-limit');
    expect(res.headers).not.toHaveProperty('x-ratelimit-limit');
  });

  it('keeps separate budgets per client address', async () => {
    // Two proxied clients behind one hop: exhausting one must not block the other.
    const app = express();
    app.set('trust proxy', 1);
    app.use('/guarded', createRateLimiter({ limit: 1, message: 'Slow down.' }), (req, res) =>
      res.json({ ok: true })
    );

    await request(app).get('/guarded').set('X-Forwarded-For', '203.0.113.1');
    const sameClient = await request(app).get('/guarded').set('X-Forwarded-For', '203.0.113.1');
    const otherClient = await request(app).get('/guarded').set('X-Forwarded-For', '203.0.113.9');

    expect(sameClient.status).toBe(429);
    expect(otherClient.status).toBe(200);
  });
});
