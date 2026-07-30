const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query } = require('../db/db');
const { authenticateToken, JWT_SECRET } = require('../middleware/authMiddleware');

const router = express.Router();

const REGISTRATION_DISABLED_MESSAGE =
  'Public registration is currently disabled on this instance. Please contact your system administrator for access.';

/**
 * Resolve the allow_open_registration switch state (Req 4.4.1)
 */
async function isOpenRegistrationEnabled() {
  const settingsRes = await query(
    "SELECT value FROM system_settings WHERE key = 'allow_open_registration'"
  );
  return settingsRes.rows.length > 0 && settingsRes.rows[0].value === 'true';
}

/**
 * GET /api/auth/registration-status - Public switch probe (Req 4.4.2)
 *
 * Unauthenticated by design: the registration view needs to know whether to render
 * its inputs or the locked fallback message before any credentials exist.
 */
router.get('/registration-status', async (req, res) => {
  try {
    const open = await isOpenRegistrationEnabled();
    return res.json({
      allowOpenRegistration: open,
      message: open ? null : REGISTRATION_DISABLED_MESSAGE,
    });
  } catch (error) {
    console.error('Registration Status Route Error:', error);
    // Fail closed: on error the UI shows the locked fallback rather than a form
    // that would be rejected by the API guard anyway.
    return res.status(500).json({
      allowOpenRegistration: false,
      error: 'Internal server error resolving registration availability.',
    });
  }
});

/**
 * POST /api/auth/register - User Registration
 */
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Enforce admin switch check (allow_open_registration) BEFORE payload
    // validation, so a disabled instance answers 403 regardless of body shape (Req 4.4.4)
    if (!await isOpenRegistrationEnabled()) {
      return res.status(403).json({ error: REGISTRATION_DISABLED_MESSAGE });
    }

    if (!email || !password || password.trim().length < 6) {
      return res.status(400).json({ error: 'Valid email and a password of at least 6 characters are required.' });
    }

    // 2. Check if user already exists
    const checkUser = await query('SELECT id FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    if (checkUser.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    // 3. Hash password and save new user record
    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash(password, salt);

    const newUser = await query(
      `INSERT INTO users (email, password_hash, role) 
       VALUES ($1, $2, 'user') 
       RETURNING id, email, role, avatar_url, theme, palette`,
      [email.trim().toLowerCase(), passHash]
    );

    // Seed the default wishlist shelf immediately on registration!
    await ensureUserWishlist(newUser.rows[0].id);

    return res.status(201).json({
      message: 'Account registered successfully.',
      user: newUser.rows[0]
    });

  } catch (error) {
    console.error('Registration Route Error:', error);
    return res.status(500).json({ error: 'Internal server error processing registration.' });
  }
});

/**
 * POST /api/auth/login - User Authentication Login
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password fields are required.' });
  }

  try {
    // 1. Fetch user records
    const userRes = await query(
      'SELECT id, email, password_hash, role, avatar_url, is_disabled, theme, palette FROM users WHERE email = $1',
      [email.trim().toLowerCase()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password credentials.' });
    }

    const user = userRes.rows[0];

    // Check if account is disabled (Req 38)
    if (user.is_disabled) {
      return res.status(403).json({ error: 'Your account has been disabled by a system administrator. Please contact support.' });
    }

    // 2. Verify Hashed Password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password credentials.' });
    }

    // 3. Generate password signature for revocation check
    const pwdSig = user.password_hash.slice(-10);

    // 4. Generate JWT payload with 30-day token
    const token = jwt.sign(
      { userId: user.id, role: user.role, pwdSig },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // 5. Deliver Cookie (30 days lifespan persistent)
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in milliseconds
    });

    // Seed the default wishlist shelf if missing on login!
    await ensureUserWishlist(user.id);

    return res.json({
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        avatarUrl: user.avatar_url,
        theme: user.theme,
        palette: user.palette,
      }
    });

  } catch (error) {
    console.error('Login Route Error:', error);
    return res.status(500).json({ error: 'Internal server error processing login.' });
  }
});

/**
 * POST /api/auth/logout - End Session
 */
router.post('/logout', (req, res) => {
  // Attributes must match those used when the cookie was issued, otherwise
  // browsers keep the original cookie and the session survives logout.
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  return res.json({ message: 'Session closed successfully.' });
});

/**
 * Helper: Ensure each user has a default system Wishlist shelf (Req 1.2 Wishlist)
 */
async function ensureUserWishlist(userId) {
  try {
    const checkWishlist = await query(
      'SELECT id FROM bookshelves WHERE user_id = $1 AND is_wishlist = TRUE',
      [userId]
    );
    if (checkWishlist.rows.length === 0) {
      console.log(`✨ Seeding default Wishlist bookshelf for user ID: ${userId}...`);
      await query(
        `INSERT INTO bookshelves (user_id, name, description, is_wishlist)
         VALUES ($1, 'Wishlist', 'My personal reading wishlist for books I want to read.', TRUE)`,
        [userId]
      );
    }
  } catch (err) {
    console.error('⚠️ Failed to seed/verify Wishlist bookshelf:', err);
  }
}

/**
 * GET /api/auth/me - Verify Current Session
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    // Seed the default wishlist shelf if missing on me check!
    await ensureUserWishlist(req.user.id);

    // Return complete profile mapping
    const userRes = await query(
      'SELECT id, email, role, avatar_url, theme, palette FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User profiles could not be resolved.' });
    }

    const user = userRes.rows[0];
    return res.json({
      id: user.id,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatar_url,
      theme: user.theme,
      palette: user.palette,
    });
  } catch (error) {
    console.error('Verify Me Error:', error);
    return res.status(500).json({ error: 'Internal server error resolving user details.' });
  }
});

module.exports = router;
