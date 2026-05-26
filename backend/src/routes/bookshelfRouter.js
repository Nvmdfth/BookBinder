const express = require('express');
const { query } = require('../db/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const { verifyBookshelfAccess, requireOwner } = require('../middleware/shareMiddleware');

const router = express.Router();

// Apply auth check globally to bookshelves routes
router.use(authenticateToken);

/**
 * GET /api/bookshelves - Retrieve user's bookshelves (owned & shared libraries)
 */
router.get('/', async (req, res) => {
  const userId = req.user.id;

  try {
    // Elegant SQL query utilizing UNION ALL to pull owned and shared libraries in a single run
    const shelvesRes = await query(
      `SELECT b.id, b.name, b.description, b.created_at, 'owner' AS role, u.email AS owner_email, b.is_wishlist
       FROM bookshelves b
       JOIN users u ON b.user_id = u.id
       WHERE b.user_id = $1
       
       UNION ALL
       
       SELECT b.id, b.name, b.description, b.created_at, s.permission AS role, u.email AS owner_email, b.is_wishlist
       FROM bookshelves b
       JOIN shelf_shares s ON b.id = s.bookshelf_id
       JOIN users u ON b.user_id = u.id
       WHERE s.shared_with_user_id = $1
       
       ORDER BY name ASC`,
      [userId]
    );

    return res.json(shelvesRes.rows);

  } catch (error) {
    console.error('Fetch Bookshelves Router Error:', error);
    return res.status(500).json({ error: 'Internal server error fetching bookshelves.' });
  }
});

/**
 * POST /api/bookshelves - Create a new bookshelf
 */
router.post('/', async (req, res) => {
  const { name, description } = req.body;
  const userId = req.user.id;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'A bookshelf name is required.' });
  }

  try {
    const newShelf = await query(
      `INSERT INTO bookshelves (user_id, name, description) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, description, created_at`,
      [userId, name.trim(), description ? description.trim() : null]
    );

    return res.status(201).json({
      message: 'Bookshelf created successfully.',
      bookshelf: {
        ...newShelf.rows[0],
        role: 'owner',
      },
    });

  } catch (error) {
    console.error('Create Bookshelf Router Error:', error);
    return res.status(500).json({ error: 'Internal server error creating bookshelf.' });
  }
});

/**
 * GET /api/bookshelves/:id - Fetch individual bookshelf details & mapped books
 */
router.get('/:id', verifyBookshelfAccess, async (req, res) => {
  const bookshelfId = req.shelfAccess.bookshelfId;
  const userAccessRole = req.shelfAccess.role;

  try {
    // 1. Query shelf details (owner context)
    const shelfRes = await query(
      `SELECT b.id, b.name, b.description, b.created_at, u.email AS owner_email, u.id AS owner_id, b.is_wishlist
       FROM bookshelves b
       JOIN users u ON b.user_id = u.id
       WHERE b.id = $1`,
      [bookshelfId]
    );

    const shelf = shelfRes.rows[0];

    // 2. Query books linked to this bookshelf
    const booksRes = await query(
      `SELECT ub.id AS mapping_id, b.id AS book_id, b.isbn, b.title, b.author, 
              b.publisher, b.cover_image_url, b.page_count, b.publication_date, 
              ub.physical_location, ub.notes, ub.created_at AS mapping_created_at, ub.is_read
       FROM user_books ub
       JOIN books b ON ub.book_id = b.id
       WHERE ub.bookshelf_id = $1
       ORDER BY ub.created_at DESC`,
      [bookshelfId]
    );

    return res.json({
      id: shelf.id,
      name: shelf.name,
      description: shelf.description,
      ownerEmail: shelf.owner_email,
      isOwner: shelf.owner_id === req.user.id,
      isWishlist: !!shelf.is_wishlist,
      accessRole: userAccessRole, // 'owner', 'collaborator', or 'view'
      books: booksRes.rows,
    });

  } catch (error) {
    console.error('Get Bookshelf Details Router Error:', error);
    return res.status(500).json({ error: 'Internal server error resolving bookshelf details.' });
  }
});

/**
 * PUT /api/bookshelves/:id - Update bookshelf details (Owner Only)
 */
router.put('/:id', verifyBookshelfAccess, requireOwner, async (req, res) => {
  const { name, description } = req.body;
  const bookshelfId = req.shelfAccess.bookshelfId;

  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'A bookshelf name is required.' });
  }

  try {
    // Safety guard preventing modifications to default system Wishlist shelf
    const checkWishlist = await query('SELECT is_wishlist FROM bookshelves WHERE id = $1', [bookshelfId]);
    if (checkWishlist.rows.length > 0 && checkWishlist.rows[0].is_wishlist) {
      return res.status(400).json({ error: 'Operation blocked. The default system Wishlist bookshelf details cannot be modified.' });
    }

    const updatedShelf = await query(
      `UPDATE bookshelves 
       SET name = $1, description = $2 
       WHERE id = $3 
       RETURNING id, name, description, created_at`,
      [name.trim(), description ? description.trim() : null, bookshelfId]
    );

    return res.json({
      message: 'Bookshelf details updated successfully.',
      bookshelf: updatedShelf.rows[0],
    });

  } catch (error) {
    console.error('Update Bookshelf Router Error:', error);
    return res.status(500).json({ error: 'Internal server error updating bookshelf details.' });
  }
});

/**
 * DELETE /api/bookshelves/:id - Remove bookshelf container (Owner Only)
 */
router.post('/:id/delete', verifyBookshelfAccess, requireOwner, async (req, res) => {
  const bookshelfId = req.shelfAccess.bookshelfId;

  try {
    // Safety guard preventing deletion of default system Wishlist shelf
    const checkWishlist = await query('SELECT is_wishlist FROM bookshelves WHERE id = $1', [bookshelfId]);
    if (checkWishlist.rows.length > 0 && checkWishlist.rows[0].is_wishlist) {
      return res.status(400).json({ error: 'Operation blocked. The default system Wishlist bookshelf cannot be deleted.' });
    }

    await query('DELETE FROM bookshelves WHERE id = $1', [bookshelfId]);
    return res.json({ message: 'Bookshelf and all its mappings removed successfully.' });
  } catch (error) {
    console.error('Delete Bookshelf Router Error:', error);
    return res.status(500).json({ error: 'Internal server error deleting bookshelf.' });
  }
});

module.exports = router;
