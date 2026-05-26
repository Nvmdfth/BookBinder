const jwt = require('jsonwebtoken');
const { query } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'bookbinder_super_secret_key';

/**
 * Protect routes - Verifies JWT cookie and enforces active session checks
 */
async function authenticateToken(req, res, next) {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No session token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Query database to ensure user exists and verify if session has been revoked (e.g. via password change)
    const userRes = await query(
      'SELECT id, email, role, password_hash FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      res.clearCookie('token');
      return res.status(401).json({ error: 'User no longer exists.' });
    }

    const dbUser = userRes.rows[0];
    
    // Revocation check: Extract last 10 characters of current password hash
    const currentSig = dbUser.password_hash.slice(-10);
    if (decoded.pwdSig !== currentSig) {
      console.log(`🔐 Session revoked for user ID ${dbUser.id} due to password change.`);
      res.clearCookie('token');
      return res.status(401).json({ error: 'Session expired due to credential changes. Please log in again.' });
    }

    // Set authenticated user context
    req.user = {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role,
    };

    next();
  } catch (error) {
    console.error('JWT Authentication Error:', error.message);
    res.clearCookie('token');
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }
}

/**
 * Admin Role Guard - Enforces administrator tier capabilities
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden. Administrative privileges required.' });
  }
  next();
}

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET,
};
