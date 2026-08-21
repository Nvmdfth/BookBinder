const express = require('express');
const { query } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { generateToken, hashToken } = require('../utils/apiToken');

const router = express.Router();

// Cookie session only — deliberately, not authenticateApiToken. A Bearer
// token minting or revoking its own successor defeats revocation as an
// incident-response control: revoke the leaked token, and the attacker who
// used it to mint a fresh one still holds a credential the admin never
// issued. Token management therefore requires a browser session; Bearer
// tokens remain valid on backupRouter.js, the endpoint n8n actually calls.
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * GET /api/admin/tokens - List tokens. Values are unrecoverable by design, so
 * this returns metadata only.
 */
router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, last_used_at, created_at FROM api_tokens
        WHERE revoked_at IS NULL ORDER BY created_at DESC`
    );
    return res.json(result.rows);
  } catch (error) {
    console.error('List API Tokens Error:', error);
    return res.status(500).json({ error: 'Internal server error listing API tokens.' });
  }
});

/**
 * POST /api/admin/tokens - Mint a token.
 *
 * The only response in the system that contains a plaintext credential. The
 * caller stores it now or mints a new one later.
 */
router.post('/', async (req, res) => {
  const name = String(req.body?.name || '').trim();

  if (!name) {
    return res.status(400).json({ error: 'A descriptive token name is required.' });
  }

  try {
    const token = generateToken();
    const result = await query(
      `INSERT INTO api_tokens (user_id, name, token_hash) VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
      [req.user.id, name, hashToken(token)]
    );

    return res.status(201).json({ ...result.rows[0], token });
  } catch (error) {
    console.error('Create API Token Error:', error);
    return res.status(500).json({ error: 'Internal server error creating the API token.' });
  }
});

/**
 * DELETE /api/admin/tokens/:id - Revoke. The row stays so last_used_at remains
 * available to answer "was this leaked credential ever used?"
 */
router.delete('/:id', async (req, res) => {
  // A non-numeric id makes Postgres raise `invalid input syntax for type
  // integer`, which the catch below would otherwise report as a 500 where a
  // 404 belongs — the id simply doesn't name any token.
  if (!/^[1-9]\d*$/.test(req.params.id)) {
    return res.status(404).json({ error: 'API token not found.' });
  }

  try {
    const result = await query(
      'UPDATE api_tokens SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
      [req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'API token not found.' });
    }

    return res.json({ message: 'API token revoked.' });
  } catch (error) {
    console.error('Revoke API Token Error:', error);
    return res.status(500).json({ error: 'Internal server error revoking the API token.' });
  }
});

module.exports = router;
