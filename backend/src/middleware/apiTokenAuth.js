const { query } = require('../db/db');
const { hashToken, TOKEN_PREFIX } = require('../utils/apiToken');

/**
 * Bearer authentication for automated clients, mounted on /api/admin only.
 *
 * Runs ahead of authenticateToken and falls through when there is no BookBinder
 * Bearer header, so the browser's cookie session is untouched. On success it
 * populates req.user in exactly the shape authenticateToken produces, so
 * requireAdmin and every downstream handler work without knowing which
 * credential got the caller in.
 *
 * The password-change revocation check from the cookie path is deliberately
 * absent: a scheduled job must survive an admin changing their password.
 * Revocation here is explicit, via revoked_at.
 */
async function authenticateApiToken(req, res, next) {
  const header = req.headers.authorization || '';

  if (!header.startsWith('Bearer ')) return next();

  const presented = header.slice('Bearer '.length).trim();

  // A JWT in a Bearer header is not ours; leave it for the cookie path to ignore.
  if (!presented.startsWith(TOKEN_PREFIX)) return next();

  try {
    const tokenRes = await query(
      `SELECT t.id AS token_id, u.id, u.email, u.role, u.is_disabled
         FROM api_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.revoked_at IS NULL`,
      [hashToken(presented)]
    );

    if (tokenRes.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or revoked API token.' });
    }

    const row = tokenRes.rows[0];

    if (row.is_disabled) {
      return res.status(401).json({ error: 'The account owning this token is disabled.' });
    }

    await query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [row.token_id]);

    req.user = { id: row.id, email: row.email, role: row.role };
    return next();
  } catch (error) {
    console.error('API Token Authentication Error:', error.message);
    return res.status(500).json({ error: 'Internal server error validating API token.' });
  }
}

module.exports = { authenticateApiToken };
