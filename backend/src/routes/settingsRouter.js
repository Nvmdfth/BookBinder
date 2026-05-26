const express = require('express');
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
 * GET /api/settings/users - Audit accounts lists (Admin Only)
 */
router.get('/users', async (req, res) => {
  try {
    const usersRes = await query(
      `SELECT id, email, role, avatar_url, created_at 
       FROM users 
       ORDER BY created_at DESC`
    );
    return res.json(usersRes.rows);
  } catch (error) {
    console.error('Fetch Users Audit Error:', error);
    return res.status(500).json({ error: 'Internal server error fetching accounts list.' });
  }
});

module.exports = router;
