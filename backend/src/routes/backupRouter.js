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

/**
 * multer's own errors carry no `.status`, so app.js's global handler would
 * report both of these as a bare 500. Handled here instead of globally,
 * since the right status and message depend on this route's own contract
 * (the field must be named "file").
 *
 * A client that sends the binary under any other field name
 * hits LIMIT_UNEXPECTED_FILE; "Unexpected field" paired with a 500 is a
 * miserable thing to debug against a webhook with no server console.
 */
function uploadArchive(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (!err) return next();

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File too large. Archives over ${MAX_ARCHIVE_BYTES} bytes are refused.`,
      });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        error: 'Unexpected field. The archive must be sent as the "file" field.',
      });
    }

    return next(err);
  });
}

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

    // The archive contains every user's row, bcrypt password hashes included —
    // it must never sit in a shared cache or a browser's disk cache.
    res.setHeader('Cache-Control', 'no-store');
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
router.post('/restore', uploadArchive, async (req, res) => {
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
