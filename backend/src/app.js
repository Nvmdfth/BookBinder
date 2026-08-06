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
   * Spoofing the header only makes a client's own cookie more restrictive, so
   * trusting it costs nothing here.
   */
  app.set('trust proxy', true);

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
  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/bookshelves', bookshelfRouter);
  app.use('/api/books', bookRouter);
  app.use('/api/shares', shareRouter);
  app.use('/api/settings', settingsRouter);

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
