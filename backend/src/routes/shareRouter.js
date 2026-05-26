const express = require('express');
const { query } = require('../db/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const { verifyBookshelfAccess, requireOwner } = require('../middleware/shareMiddleware');

const router = express.Router();

// Apply auth globally
router.use(authenticateToken);

/**
 * GET /api/shares/:bookshelfId - List all active shares on a bookshelf (Owner Only)
 */
router.get('/:bookshelfId', async (req, res, next) => {
  req.params.id = req.params.bookshelfId; // Map param for verify access
  verifyBookshelfAccess(req, res, async () => {
    requireOwner(req, res, async () => {
      try {
        const bookshelfId = req.shelfAccess.bookshelfId;

        const sharesRes = await query(
          `SELECT s.id, s.bookshelf_id, s.shared_with_user_id AS user_id, 
                  u.email, s.permission, s.created_at
           FROM shelf_shares s
           JOIN users u ON s.shared_with_user_id = u.id
           WHERE s.bookshelf_id = $1
           ORDER BY u.email ASC`,
          [bookshelfId]
        );

        return res.json(sharesRes.rows);

      } catch (error) {
        console.error('List Shares Router Error:', error);
        return res.status(500).json({ error: 'Internal server error resolving bookshelf sharing records.' });
      }
    });
  });
});

/**
 * POST /api/shares/:bookshelfId - Share bookshelf with another user by email (Owner Only)
 */
router.post('/:bookshelfId', async (req, res, next) => {
  const { email, permission } = req.body;
  req.params.id = req.params.bookshelfId;

  if (!email || !permission || !['view', 'collaborator'].includes(permission)) {
    return res.status(400).json({ error: 'A valid email and permission level (view or collaborator) are required.' });
  }

  const targetEmail = email.trim().toLowerCase();

  verifyBookshelfAccess(req, res, async () => {
    requireOwner(req, res, async () => {
      try {
        const bookshelfId = req.shelfAccess.bookshelfId;

        // 1. Owner check: cannot share with self
        if (req.user.email === targetEmail) {
          return res.status(400).json({ error: 'You cannot share a bookshelf with your own account.' });
        }

        // 2. Fetch target user
        const userRes = await query('SELECT id FROM users WHERE email = $1', [targetEmail]);
        if (userRes.rows.length === 0) {
          return res.status(404).json({
            error: `No BookBinder user found for "${email}". The recipient must register an account first.`,
          });
        }

        const targetUserId = userRes.rows[0].id;

        // 3. Prevent duplicate shares
        const shareCheck = await query(
          'SELECT id FROM shelf_shares WHERE bookshelf_id = $1 AND shared_with_user_id = $2',
          [bookshelfId, targetUserId]
        );

        if (shareCheck.rows.length > 0) {
          // If share exists, update it to the new permission level instead of throwing error
          const updateRes = await query(
            `UPDATE shelf_shares 
             SET permission = $1 
             WHERE bookshelf_id = $2 AND shared_with_user_id = $3
             RETURNING id, bookshelf_id, shared_with_user_id, permission, created_at`,
            [permission, bookshelfId, targetUserId]
          );

          return res.json({
            message: 'Bookshelf share updated successfully.',
            share: {
              ...updateRes.rows[0],
              email: targetEmail,
            },
          });
        }

        // 4. Create new share mapping
        const newShare = await query(
          `INSERT INTO shelf_shares (bookshelf_id, shared_with_user_id, permission) 
           VALUES ($1, $2, $3) 
           RETURNING id, bookshelf_id, shared_with_user_id, permission, created_at`,
          [bookshelfId, targetUserId, permission]
        );

        return res.status(201).json({
          message: 'Bookshelf shared successfully.',
          share: {
            ...newShare.rows[0],
            email: targetEmail,
          },
        });

      } catch (error) {
        console.error('Create Share Router Error:', error);
        return res.status(500).json({ error: 'Internal server error creating sharing credentials.' });
      }
    });
  });
});

/**
 * DELETE /api/shares/remove/:shareId - Revoke sharing access (Owner Only)
 */
router.post('/remove/:shareId', async (req, res) => {
  const shareId = parseInt(req.params.shareId, 10);

  if (isNaN(shareId)) {
    return res.status(400).json({ error: 'Invalid share ID.' });
  }

  try {
    // 1. Resolve bookshelf association
    const shareRes = await query('SELECT bookshelf_id FROM shelf_shares WHERE id = $1', [shareId]);
    if (shareRes.rows.length === 0) {
      return res.status(404).json({ error: 'Sharing record not found.' });
    }

    const bookshelfId = shareRes.rows[0].bookshelf_id;

    // 2. Verify access to shelf (must be bookshelf owner to revoke access)
    req.params.bookshelfId = bookshelfId;
    verifyBookshelfAccess(req, res, async () => {
      requireOwner(req, res, async () => {
        try {
          await query('DELETE FROM shelf_shares WHERE id = $1', [shareId]);
          return res.json({ message: 'Sharing access revoked successfully.', shareId: shareId });
        } catch (err) {
          console.error('Delete Share SQL Error:', err);
          return res.status(500).json({ error: 'Database revocation query failed.' });
        }
      });
    });

  } catch (error) {
    console.error('Delete Share Router Error:', error);
    return res.status(500).json({ error: 'Internal server error deleting sharing access.' });
  }
});

module.exports = router;
