const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');

// Import Route Handlers
const authRouter = require('./routes/authRouter');
const userRouter = require('./routes/userRouter');
const bookshelfRouter = require('./routes/bookshelfRouter');
const bookRouter = require('./routes/bookRouter');
const shareRouter = require('./routes/shareRouter');
const settingsRouter = require('./routes/settingsRouter');
const { createAuthLimiter, createAdminLimiter } = require('./middleware/rateLimit');
const apiTokenRouter = require('./routes/apiTokenRouter');
const backupRouter = require('./routes/backupRouter');

/**
 * Builds the configured Express application.
 *
 * Kept separate from index.js so tests can mount the app with supertest without
 * binding a port or booting the database.
 */
function createApp() {
  const app = express();

  /*
   * Honour X-Forwarded-Proto so req.secure reflects the browser's connection
   * rather than the last hop. The session cookie's Secure flag is derived from
   * it, and behind a TLS-terminating proxy the socket itself is plain HTTP.
   *
   * This is the *number of proxies* in front of the app, not a boolean, and the
   * distinction is load-bearing now that the rate limiters below key on req.ip.
   * Under `true`, Express takes the leftmost X-Forwarded-For entry — a value the
   * client writes — so an attacker could mint a fresh rate-limit budget on every
   * request simply by varying the header. Counting hops instead means req.ip is
   * the address the nearest trusted proxy observed, which a client cannot forge.
   *
   * The default of 1 matches the documented deployment: a Cloudflare Tunnel
   * terminating TLS and forwarding to this port. Set TRUST_PROXY_HOPS=0 when the
   * container is exposed directly, or to the real count when chaining proxies —
   * too high is a spoofable rate limit, too low buckets every client together.
   */
  app.set('trust proxy', Number.parseInt(process.env.TRUST_PROXY_HOPS ?? '1', 10) || 0);

  // Enforce modern security middlewares
  app.use(cors({
    origin: process.env.CORS_ORIGIN || true, // Trust origin headers dynamically in local dev
    credentials: true,
  }));

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Serve uploads statically (Avatars / uploaded covers)
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

  // Register API Route Mounts
  /*
   * Throttle the credential surface before the routers see it. Login and
   * registration are the endpoints an internet-exposed instance gets guessed
   * at, and bcrypt alone is a cost per attempt, not a ceiling on them.
   */
  app.use('/api/auth', createAuthLimiter(), authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/bookshelves', bookshelfRouter);
  app.use('/api/books', bookRouter);
  app.use('/api/shares', shareRouter);
  app.use('/api/settings', settingsRouter);
  // Mounted ahead of the less-specific /api/admin router so this more
  // specific path always wins the match.
  /*
   * The admin surface is bounded separately: a leaked API token must not be
   * usable to pull the whole user table, password hashes included, on a loop.
   */
  const adminLimiter = createAdminLimiter();
  app.use('/api/admin/tokens', adminLimiter, apiTokenRouter);
  app.use('/api/admin', adminLimiter, backupRouter);

  // Health Check API
  app.get('/api/health', (req, res) => {
    return res.json({ status: 'ok', time: new Date() });
  });

  // Production SPA Static Hosting & Catch-All Routing
  if (process.env.NODE_ENV === 'production') {
    const staticPath = path.join(__dirname, '../../frontend/dist');
    console.log(`📦 Production static frontend path resolved: ${staticPath}`);

    app.use(express.static(staticPath));

    // Wildcard mapping ensures React Router routes load correctly
    app.get('*', (req, res) => {
      // Prevent swallowing API or assets errors
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
        return res.status(404).json({ error: 'Endpoint not found.' });
      }
      return res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  // Global Exception Handler
  app.use((err, req, res, next) => {
    console.error('🔥 Global Express Exception caught:', err.message);
    return res.status(err.status || 500).json({
      error: err.message || 'Internal server error processing your request.',
    });
  });

  return app;
}

module.exports = { createApp };
