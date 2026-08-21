const express = require('express');
const multer = require('multer');
const { authenticateToken, requireAdmin } = require('../middleware/authMiddleware');
const { authenticateApiToken } = require('../middleware/apiTokenAuth');
const { dumpDatabase, restoreDatabase, MAX_ARCHIVE_BYTES } = require('../services/pgBackup');

const router = express.Router();

/** The caller must send this exact string to restore. */
const CONFIRM_PHRASE = 'REPLACE_ALL_DATA';

// Held in memory and piped to pg_restore stdin — nothing touches disk, so a
// crash leaves no half-written archive and there is no path to traverse.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARCHIVE_BYTES },
});

router.use(authenticateApiToken);
router.use((req, res, next) => (req.user ? next() : authenticateToken(req, res, next)));
router.use(requireAdmin);

/**
 * GET /api/admin/backup - Download a pg_dump archive.
 *
 * The dump completes before a single header is sent. Streaming would commit a
 * 200 on the first chunk, so a mid-dump failure would be delivered as a
 * truncated file that an automated backup job records as a success.
 */
router.get('/backup', async (req, res) => {
  try {
    const archive = await dumpDatabase();
    const stamp = new Date().toISOString().slice(0, 10);

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="bookbinder-${stamp}.dump"`);
    return res.send(archive);
  } catch (error) {
    console.error('Database Backup Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/admin/restore - Replace the database from an uploaded archive.
 *
 * The confirmation field is not a security control — the admin credential is.
 * It is a guard against automation firing the wrong way: a retried or
 * misconfigured POST cannot destroy the database by accident.
 */
router.post('/restore', upload.single('file'), async (req, res) => {
  if (req.body?.confirm !== CONFIRM_PHRASE) {
    return res.status(400).json({
      error: `Restore replaces all data and cannot be undone. Send confirm="${CONFIRM_PHRASE}" to proceed.`,
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'A backup archive file is required.' });
  }

  try {
    await restoreDatabase(req.file.buffer);
    console.log(`♻️ Database restored from an archive uploaded by user ID ${req.user.id}.`);
    return res.json({
      message: 'Database restored successfully. You may need to sign in again.',
    });
  } catch (error) {
    console.error('Database Restore Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
