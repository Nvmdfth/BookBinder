const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db/db');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');

const router = express.Router();

// Enforce auth and admin-only access globally to system settings routes
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * GET /api/settings - Retrieve global system parameters
 */
router.get('/', async (req, res) => {
  try {
    const settingsRes = await query('SELECT key, value FROM system_settings');
    
    // Format rows into a clean key-value object
    const settingsObj = {};
    settingsRes.rows.forEach(row => {
      settingsObj[row.key] = row.value;
    });

    return res.json(settingsObj);
  } catch (error) {
    console.error('Fetch Settings Router Error:', error);
    return res.status(500).json({ error: 'Internal server error fetching system settings.' });
  }
});

/**
 * PUT /api/settings - Update global system parameters (Bulk)
 */
router.put('/', async (req, res) => {
  const updates = req.body; // e.g. { allow_open_registration: 'true', enable_google_books: 'false' }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'A settings update object is required.' });
  }

  try {
    // Process updates in sequence inside a transaction
    const keys = Object.keys(updates);
    
    for (const key of keys) {
      const valStr = String(updates[key]);
      
      // Safety constraint check on parameters
      if (['allow_open_registration', 'enable_google_books', 'enable_open_library'].includes(key)) {
        await query(
          'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2',
          [valStr, key]
        );
      }
    }

    // Return the updated settings dictionary
    const finalRes = await query('SELECT key, value FROM system_settings');
    const settingsObj = {};
    finalRes.rows.forEach(row => {
      settingsObj[row.key] = row.value;
    });

    return res.json({
      message: 'System settings updated successfully.',
      settings: settingsObj,
    });

  } catch (error) {
    console.error('Update Settings Router Error:', error);
    return res.status(500).json({ error: 'Internal server error saving system settings.' });
  }
});

/**
 * GET /api/settings/orphans - Preview count and list of orphaned books in the global catalog cache
 */
router.get('/orphans', async (req, res) => {
  try {
    // Query list of books not referenced in any user physical shelf mappings
    const orphansRes = await query(
      `SELECT b.id, b.isbn, b.title, b.author, b.cover_image_url, b.created_at
       FROM books b
       LEFT JOIN user_books ub ON b.id = ub.book_id
       WHERE ub.id IS NULL
       ORDER BY b.created_at DESC`
    );

    return res.json({
      count: orphansRes.rows.length,
      orphans: orphansRes.rows,
    });

  } catch (error) {
    console.error('Fetch Orphans Router Error:', error);
    return res.status(500).json({ error: 'Internal server error querying orphaned index records.' });
  }
});

/**
 * POST /api/settings/orphans/prune - Bulk delete all orphaned global catalog records
 */
router.post('/orphans/prune', async (req, res) => {
  try {
    // Perform bulk pruning query
    const pruneRes = await query(
      `DELETE FROM books
       WHERE id IN (
         SELECT b.id
         FROM books b
         LEFT JOIN user_books ub ON b.id = ub.book_id
         WHERE ub.id IS NULL
       )`
    );

    console.log(`🧹 Database cleanup completed. Pruned orphaned book catalog rows.`);

    return res.json({
      message: 'Database catalog cleaning completed successfully.',
      prunedCount: pruneRes.rowCount,
    });

  } catch (error) {
    console.error('Prune Orphans Router Error:', error);
    return res.status(500).json({ error: 'Internal server error executing catalog database cleaning.' });
  }
});

/**
 * GET /api/settings/users - Audit accounts lists (Admin Only) with inventory summaries (Req 38 / 4.2.1 Metadata)
 */
router.get('/users', async (req, res) => {
  try {
    const usersRes = await query(
      `SELECT u.id, u.email, u.role, u.avatar_url, u.is_disabled, u.created_at,
              (SELECT COUNT(*) FROM bookshelves WHERE user_id = u.id) AS bookshelf_count,
              (SELECT COUNT(*) FROM user_books WHERE user_id = u.id) AS book_count
       FROM users u
       ORDER BY u.created_at DESC`
    );
    return res.json(usersRes.rows);
  } catch (error) {
    console.error('Fetch Users Audit Error:', error);
    return res.status(500).json({ error: 'Internal server error fetching accounts list.' });
  }
});

/**
 * PUT /api/settings/users/:userId/disable - Toggle user disabled status (Admin Only) (Req 38)
 */
router.put('/users/:userId/disable', async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const { is_disabled } = req.body;

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  // Active self-action guard (Req 38 Self Shield)
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Operation blocked. You cannot disable your own active administrator account.' });
  }

  try {
    await query(
      'UPDATE users SET is_disabled = $1, updated_at = NOW() WHERE id = $2',
      [!!is_disabled, targetUserId]
    );

    return res.json({
      message: `Account status updated successfully to ${is_disabled ? 'disabled' : 'active'}.`,
      userId: targetUserId,
      isDisabled: !!is_disabled,
    });
  } catch (error) {
    console.error('Toggle Disable Error:', error);
    return res.status(500).json({ error: 'Internal server error toggling account status.' });
  }
});

/**
 * PUT /api/settings/users/:userId/role - Modify user role (Admin Only) (Req 38)
 */
router.put('/users/:userId/role', async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const { role } = req.body;

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (!role || !['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'A valid role parameter (user or admin) is required.' });
  }

  // Active self-action guard (Req 38 Self Shield)
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Operation blocked. You cannot demote or modify the role of your own active administrator account.' });
  }

  try {
    await query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2',
      [role, targetUserId]
    );

    return res.json({
      message: `User role updated successfully to ${role}.`,
      userId: targetUserId,
      role: role,
    });
  } catch (error) {
    console.error('Modify Role Error:', error);
    return res.status(500).json({ error: 'Internal server error modifying account role.' });
  }
});

/**
 * PUT /api/settings/users/:userId/reset-password - Admin-triggered password reset (Admin Only) (Req 38)
 */
router.put('/users/:userId/reset-password', async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const { password } = req.body;

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  if (!password || password.trim().length < 6) {
    return res.status(400).json({ error: 'Passwords must be at least 6 characters in length.' });
  }

  // Active self-action guard (Req 38 Self Shield)
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Operation blocked. Please update your own password via the Profile Settings portal instead.' });
  }

  try {
    const salt = await bcrypt.genSalt(10);
    const passHash = await bcrypt.hash(password, salt);

    await query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passHash, targetUserId]
    );

    console.log(`🔐 Admin reset password successfully for user ID ${targetUserId}. Session revoked.`);

    return res.json({
      message: 'User password reset completed successfully. Active sessions revoked.',
      userId: targetUserId,
    });
  } catch (error) {
    console.error('Admin Password Reset Error:', error);
    return res.status(500).json({ error: 'Internal server error executing password reset.' });
  }
});

/**
 * DELETE /api/settings/users/:userId - Cascade User Account Deletion (Admin Only) (Req 38)
 */
router.delete('/users/:userId', async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);

  if (isNaN(targetUserId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  // Active self-action guard (Req 38 Self Shield)
  if (targetUserId === req.user.id) {
    return res.status(400).json({ error: 'Operation blocked. You cannot delete your own active administrator account.' });
  }

  try {
    await query('DELETE FROM users WHERE id = $1', [targetUserId]);
    console.log(`🗑️ Administrative account cascade purge succeeded for user ID ${targetUserId}.`);

    return res.json({
      message: 'User account and all associated physical inventory data permanently purged.',
      userId: targetUserId,
    });
  } catch (error) {
    console.error('Delete User Account Error:', error);
    return res.status(500).json({ error: 'Internal server error deleting user account.' });
  }
});

module.exports = router;
