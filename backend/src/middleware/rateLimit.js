const rateLimit = require('express-rate-limit');

/** Fifteen minutes, the window both limiters below count within. */
const WINDOW_MS = 15 * 60 * 1000;

/**
 * Read a positive integer from the environment, falling back when unset or
 * malformed so a typo cannot silently disable throttling.
 */
function envLimit(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Build a limiter.
 *
 * Exposed as a factory rather than a ready-made instance so the tests can
 * exercise the real middleware at a small limit. A limiter declared at module
 * scope can only be tested by being disabled in the test environment, which
 * ships the one piece of security middleware nobody has watched work.
 *
 * Keying is by `req.ip`, which is only trustworthy when `trust proxy` is set to
 * the actual number of proxies in front of the app — see app.js. With a
 * permissive setting a client can forge X-Forwarded-For and mint a fresh
 * budget per request, which is why that value is now explicit.
 */
function createRateLimiter({ limit, message, windowMs = WINDOW_MS }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message },
  });
}

/**
 * Credential endpoints: login, registration, password reset.
 *
 * Ten attempts per quarter hour is far above what a person typing their own
 * password needs, and far below what credential stuffing requires.
 */
function createAuthLimiter() {
  return createRateLimiter({
    limit: envLimit('RATE_LIMIT_AUTH_MAX', 10),
    message: 'Too many attempts. Please wait a few minutes and try again.',
  });
}

/**
 * Administrative endpoints, including database backup and restore.
 *
 * Looser than the credential limiter because a legitimate admin session makes
 * many calls, but bounded: a leaked API token cannot be used to pull the entire
 * user table — password hashes included — on a loop.
 */
function createAdminLimiter() {
  return createRateLimiter({
    limit: envLimit('RATE_LIMIT_ADMIN_MAX', 60),
    message: 'Too many administrative requests. Please wait a few minutes and try again.',
  });
}

module.exports = {
  createRateLimiter,
  createAuthLimiter,
  createAdminLimiter,
  WINDOW_MS,
};
