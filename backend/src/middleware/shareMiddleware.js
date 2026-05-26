const { query } = require('../db/db');

/**
 * Validates bookshelf access permissions and registers access roles in req.shelfAccess
 */
async function verifyBookshelfAccess(req, res, next) {
  // Extract bookshelf ID from request parameter variants
  const bookshelfId = parseInt(
    req.params.bookshelfId || req.params.id || req.body.bookshelfId,
    10
  );

  if (isNaN(bookshelfId)) {
    return res.status(400).json({ error: 'Invalid or missing bookshelf ID parameter.' });
  }

  try {
    // 1. Fetch bookshelf details and check if the owner is disabled (Req 38 / 4.3)
    const shelfRes = await query(
      `SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled 
       FROM bookshelves b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = $1`,
      [bookshelfId]
    );

    if (shelfRes.rows.length === 0) {
      return res.status(404).json({ error: 'Bookshelf not found.' });
    }

    const shelf = shelfRes.rows[0];
    const userId = req.user.id;

    // Block collaborators/viewers from accessing shared bookshelves of disabled owners
    if (shelf.owner_disabled && shelf.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied. The owner of this bookshelf has had their account disabled.' });
    }

    // 2. Access Check: Owner
    if (shelf.user_id === userId) {
      req.shelfAccess = {
        role: 'owner',
        bookshelfId: shelf.id,
        name: shelf.name,
      };
      return next();
    }

    // 3. Access Check: Share Junction
    const shareRes = await query(
      'SELECT permission FROM shelf_shares WHERE bookshelf_id = $1 AND shared_with_user_id = $2',
      [bookshelfId, userId]
    );

    if (shareRes.rows.length > 0) {
      const permission = shareRes.rows[0].permission; // 'view' or 'collaborator'
      req.shelfAccess = {
        role: permission,
        bookshelfId: shelf.id,
        name: shelf.name,
      };
      return next();
    }

    // If no access found, access denied
    return res.status(403).json({ error: 'Access denied. You do not have permissions for this bookshelf.' });

  } catch (error) {
    console.error('Bookshelf Access Middleware Error:', error);
    return res.status(500).json({ error: 'Internal server error validating access.' });
  }
}

/**
 * Restricts access to bookshelf owners only (e.g. deleting shelf, editing shelf details, managing shelf shares)
 */
function requireOwner(req, res, next) {
  if (!req.shelfAccess || req.shelfAccess.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied. Only the bookshelf owner can perform this action.' });
  }
  next();
}

/**
 * Restricts access to mutative actions, allowing only owner and collaborator tiers (blocking view-only shares)
 */
function requireCollaborator(req, res, next) {
  if (!req.shelfAccess || (req.shelfAccess.role !== 'owner' && req.shelfAccess.role !== 'collaborator')) {
    return res.status(403).json({ error: 'Access denied. Collaborator status required for this action.' });
  }
  next();
}

module.exports = {
  verifyBookshelfAccess,
  requireOwner,
  requireCollaborator,
};
