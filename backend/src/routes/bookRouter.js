const express = require('express');
const { query } = require('../db/db');
const { authenticateToken } = require('../middleware/authMiddleware');
const { verifyBookshelfAccess, requireCollaborator } = require('../middleware/shareMiddleware');
const { cleanISBN, isValidISBN, isValidBarcode, isValidUPC } = require('../utils/isbn');

const router = express.Router();

// Apply auth globally
router.use(authenticateToken);

/**
 * Timeout helper wrapping a promise with a millisecond boundary
 */
function withTimeout(promise, ms, errorMessage = 'Operation timed out') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(errorMessage));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

/**
 * Helper querying external metadata from Google Books and OpenLibrary
 */
async function queryExternalISBN(isbn) {
  // 1. Fetch system switch settings
  const settingsRes = await query(
    "SELECT key, value FROM system_settings WHERE key IN ('enable_google_books', 'enable_open_library')"
  );
  
  const settings = {};
  settingsRes.rows.forEach(r => {
    settings[r.key] = r.value === 'true';
  });

  let bookData = null;
  const isUpc = isValidUPC(isbn);
  const upcCore = isUpc ? isbn.slice(0, 12) : null;

  // 2. Query Google Books first if enabled
  if (settings.enable_google_books) {
    try {
      console.log(`🌐 Querying Google Books API for ${isUpc ? 'UPC' : 'ISBN'}: ${isbn}...`);
      const queryParam = isUpc ? `upc:${upcCore}` : `isbn:${isbn}`;
      let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(queryParam)}`;
      if (process.env.GOOGLE_BOOKS_API_KEY) {
        url += `&key=${process.env.GOOGLE_BOOKS_API_KEY}`;
      }

      // Execute with a 6-second timeout block (giving OpenLibrary space to execute inside the 12s overall limit)
      let res = await withTimeout(fetch(url), 6000, 'Google Books request timed out');
      let data = res.ok ? await res.json() : null;

      // Fallback query for UPC if specific upc: query returned 0 items
      if (isUpc && (!data || data.totalItems === 0)) {
        let fallbackUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(upcCore)}`;
        if (process.env.GOOGLE_BOOKS_API_KEY) {
          fallbackUrl += `&key=${process.env.GOOGLE_BOOKS_API_KEY}`;
        }
        res = await withTimeout(fetch(fallbackUrl), 6000, 'Google Books fallback request timed out');
        data = res.ok ? await res.json() : null;
      }

      if (data && data.totalItems > 0 && data.items && data.items[0].volumeInfo) {
        const info = data.items[0].volumeInfo;
        console.log(`✅ Match found on Google Books: "${info.title}"`);
        
        let resolvedIsbn = isbn;
        if (info.industryIdentifiers) {
          const isbn13 = info.industryIdentifiers.find(id => id.type === 'ISBN_13');
          const isbn10 = info.industryIdentifiers.find(id => id.type === 'ISBN_10');
          if (isbn13) resolvedIsbn = cleanISBN(isbn13.identifier);
          else if (isbn10) resolvedIsbn = cleanISBN(isbn10.identifier);
        }

        bookData = {
          isbn: resolvedIsbn,
          title: info.title || 'Unknown Title',
          author: info.authors ? info.authors.join(', ') : 'Unknown Author',
          publisher: info.publisher || 'Unknown Publisher',
          cover_image_url: info.imageLinks ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail) : null,
          page_count: info.pageCount || null,
          publication_date: info.publishedDate || null,
        };
      } else {
        if (res && !res.ok) {
          console.error(`⚠️ Google Books ISBN lookup responded with status: ${res.status}`);
          if (res.status === 429) {
            console.error(`💡 Rate limited by Google. Consider setting a GOOGLE_BOOKS_API_KEY in your .env configuration.`);
          }
        }
      }
    } catch (err) {
      console.error('⚠️ Google Books fetch failed:', err.message);
    }
  }

  // 3. Fallback to OpenLibrary if no match yet and enabled
  if (!bookData && settings.enable_open_library) {
    try {
      console.log(`🌐 Querying OpenLibrary API for ${isUpc ? 'UPC' : 'ISBN'}: ${isbn}...`);
      const bibKey = isUpc ? `UPC:${upcCore}` : `ISBN:${isbn}`;
      const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibKey)}&format=json&jscmd=data`;
      
      const res = await withTimeout(fetch(url), 6000, 'OpenLibrary request timed out');
      let data = res.ok ? await res.json() : null;

      if (data && data[bibKey]) {
        const info = data[bibKey];
        console.log(`✅ Match found on OpenLibrary: "${info.title}"`);

        const authorsStr = info.authors ? info.authors.map(a => a.name).join(', ') : 'Unknown Author';
        const publishersStr = info.publishers ? info.publishers.map(p => p.name).join(', ') : 'Unknown Publisher';
        const coverUrl = info.cover ? (info.cover.large || info.cover.medium || info.cover.small) : null;

        let resolvedIsbn = isbn;
        if (info.identifiers) {
          if (info.identifiers.isbn_13 && info.identifiers.isbn_13.length > 0) {
            resolvedIsbn = cleanISBN(info.identifiers.isbn_13[0]);
          } else if (info.identifiers.isbn_10 && info.identifiers.isbn_10.length > 0) {
            resolvedIsbn = cleanISBN(info.identifiers.isbn_10[0]);
          }
        }

        bookData = {
          isbn: resolvedIsbn,
          title: info.title || 'Unknown Title',
          author: authorsStr,
          publisher: publishersStr,
          cover_image_url: coverUrl,
          page_count: info.number_of_pages || null,
          publication_date: info.publish_date || null,
        };
      } else if (isUpc) {
        // Search Open Library by UPC query as secondary fallback
        const searchUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(upcCore)}&limit=1`;
        const searchRes = await withTimeout(fetch(searchUrl), 6000, 'OpenLibrary search timed out');
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.docs && searchData.docs.length > 0) {
            const doc = searchData.docs[0];
            console.log(`✅ Match found on OpenLibrary search: "${doc.title}"`);

            const resolvedIsbn = doc.isbn ? cleanISBN(doc.isbn[0]) : isbn;
            const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;

            bookData = {
              isbn: resolvedIsbn,
              title: doc.title || 'Unknown Title',
              author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
              publisher: doc.publisher ? doc.publisher[0] : 'Unknown Publisher',
              cover_image_url: coverUrl,
              page_count: doc.number_of_pages_median || null,
              publication_date: doc.first_publish_year ? String(doc.first_publish_year) : null,
            };
          }
        }
      }
    } catch (err) {
      console.error('⚠️ OpenLibrary fetch failed:', err.message);
    }
  }

  return bookData;
}

/**
 * GET /api/books/search - Search for books by title or author wildcards locally & externally (Req 1.2 Search)
 */
router.get('/search', async (req, res) => {
  const queryStr = req.query.q;

  if (!queryStr || queryStr.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters long.' });
  }

  try {
    const cleanedQuery = queryStr.trim();
    
    // 1. Fetch system switch settings for external searches
    const settingsRes = await query(
      "SELECT key, value FROM system_settings WHERE key IN ('enable_google_books', 'enable_open_library')"
    );
    
    const settings = {};
    settingsRes.rows.forEach(r => {
      settings[r.key] = r.value === 'true';
    });

    // 2. Search local database first using ILIKE wildcard searches
    const localBooks = await query(
      `SELECT id, isbn, title, author, publisher, cover_image_url, page_count, publication_date
       FROM books
       WHERE title ILIKE $1 OR author ILIKE $1
       LIMIT 10`,
      [`%${cleanedQuery}%`]
    );

    let results = localBooks.rows.map(b => ({
      ...b,
      source: 'local',
    }));

    const seenISBNs = new Set(results.map(r => r.isbn).filter(Boolean));

    // 3. Search Google Books if enabled
    if (settings.enable_google_books) {
      try {
        console.log(`🌐 Querying Google Books Search API for: "${cleanedQuery}"...`);
        let url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(cleanedQuery)}&maxResults=10`;
        if (process.env.GOOGLE_BOOKS_API_KEY) {
          url += `&key=${process.env.GOOGLE_BOOKS_API_KEY}`;
        }

        const gRes = await withTimeout(fetch(url), 5000, 'Google Books search request timed out');
        if (gRes.ok) {
          const data = await gRes.json();
          if (data.items && data.items.length > 0) {
            data.items.forEach(item => {
              const info = item.volumeInfo;
              if (info && info.title) {
                // Resolve ISBN
                let isbn = null;
                if (info.industryIdentifiers) {
                  const isbn13 = info.industryIdentifiers.find(id => id.type === 'ISBN_13');
                  const isbn10 = info.industryIdentifiers.find(id => id.type === 'ISBN_10');
                  isbn = isbn13 ? isbn13.identifier : (isbn10 ? isbn10.identifier : null);
                }

                // If ISBN already resolved in local hits, skip to avoid duplicates
                if (isbn && seenISBNs.has(isbn)) return;

                if (isbn) seenISBNs.add(isbn);

                results.push({
                  isbn: isbn || `GOOGLE-${item.id}`,
                  title: info.title,
                  author: info.authors ? info.authors.join(', ') : 'Unknown Author',
                  publisher: info.publisher || 'Unknown Publisher',
                  cover_image_url: info.imageLinks ? (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail) : null,
                  page_count: info.pageCount || null,
                  publication_date: info.publishedDate || null,
                  source: 'google_books',
                });
              }
            });
          }
        } else {
          console.error(`⚠️ Google Books Search API responded with status: ${gRes.status}`);
          if (gRes.status === 429) {
            console.error(`💡 Rate limited by Google. Consider setting a GOOGLE_BOOKS_API_KEY in your .env configuration.`);
          }
        }
      } catch (err) {
        console.error('⚠️ Google Books search request failed:', err.message);
      }
    }

    // 4. Search OpenLibrary if enabled and we have space
    if (settings.enable_open_library && results.length < 15) {
      try {
        console.log(`🌐 Querying OpenLibrary Search API for: "${cleanedQuery}"...`);
        const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanedQuery)}&limit=10`;

        const olRes = await withTimeout(fetch(url), 10000, 'OpenLibrary search request timed out');
        if (olRes.ok) {
          const data = await olRes.json();
          if (data.docs && data.docs.length > 0) {
            data.docs.forEach(doc => {
              let isbn = doc.isbn ? doc.isbn[0] : null;

              if (isbn && seenISBNs.has(isbn)) return;

              if (isbn) seenISBNs.add(isbn);

              const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : null;

              results.push({
                isbn: isbn || `OPENLIBRARY-${doc.key.split('/').pop()}`,
                title: doc.title,
                author: doc.author_name ? doc.author_name.join(', ') : 'Unknown Author',
                publisher: doc.publisher ? doc.publisher[0] : 'Unknown Publisher',
                cover_image_url: coverUrl,
                page_count: doc.number_of_pages_median || null,
                publication_date: doc.first_publish_year ? String(doc.first_publish_year) : null,
                source: 'open_library',
              });
            });
          }
        }
      } catch (err) {
        console.error('⚠️ OpenLibrary search request failed:', err.message);
      }
    }

    return res.json(results.slice(0, 15));

  } catch (error) {
    console.error('Search Book Router Error:', error);
    return res.status(500).json({ error: 'Internal server error executing search.' });
  }
});

/**
 * POST /api/books/scan/:isbn - Handle scan pipeline (cached check -> API lookup -> user mapping)
 */
router.post('/scan/:isbn', async (req, res, next) => {
  const { bookshelfId, physicalLocation, notes } = req.body;
  const isbn = cleanISBN(req.params.isbn);

  // Reject invalid barcodes outright rather than burning an external API call
  // and caching junk in the global catalog (Req 4.1.3)
  if (!isValidBarcode(isbn)) {
    return res.status(400).json({ error: 'A valid ISBN-10, ISBN-13, or UPC-A parameter is required.' });
  }

  // 1. Perform authorization verification on target bookshelf
  req.params.bookshelfId = bookshelfId; // Map parameter for check
  verifyBookshelfAccess(req, res, async () => {
    requireCollaborator(req, res, async () => {
      try {
        const activeBookshelfId = req.shelfAccess.bookshelfId;

        // 2. Database Deduplication Check: Check global catalog first
        let bookRes = await query('SELECT * FROM books WHERE isbn = $1 OR (length($1) >= 12 AND isbn = substring($1 from 1 for 12))', [isbn]);
        let book = null;

        if (bookRes.rows.length > 0) {
          book = bookRes.rows[0];
          console.log(`💾 Cache hit: retrieved "${book.title}" from local catalog index.`);
        } else {
          // 3. Fallback: Search external APIs (with 12-second total threshold)
          try {
            const externalData = await withTimeout(
              queryExternalISBN(isbn),
              12000,
              'External ISBN lookups timed out (12s limit reached)'
            );

            if (externalData) {
              // Save partial/complete metadata to global catalog
              const insertRes = await query(
                `INSERT INTO books (isbn, title, author, publisher, cover_image_url, page_count, publication_date)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING *`,
                [
                  externalData.isbn,
                  externalData.title,
                  externalData.author,
                  externalData.publisher,
                  externalData.cover_image_url,
                  externalData.page_count,
                  externalData.publication_date,
                ]
              );
              book = insertRes.rows[0];
            }
          } catch (timeoutErr) {
            console.error('⚠️ ISBN Ingestion lookup error:', timeoutErr.message);
            // Seamlessly signal frontend to redirect to pre-populated manual forms
            return res.status(404).json({
              fallbackToManual: true,
              isbn: isbn,
              error: 'External search lookup timed out. Please enter book details manually.',
            });
          }
        }

        // 4. Ingestion Fail: Book not resolved via caching or external lookup
        if (!book) {
          return res.status(404).json({
            fallbackToManual: true,
            isbn: isbn,
            error: 'Book details not found. Please enter details manually.',
          });
        }

        // 5. Prevent identical double map inside same shelf
        const mapCheck = await query(
          'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
          [activeBookshelfId, book.id]
        );

        if (mapCheck.rows.length > 0) {
          return res.status(409).json({
            error: `"${book.title}" is already mapped inside this bookshelf.`,
            book: book,
          });
        }

        // 6. Map Book to User's Bookshelf
        const newMap = await query(
          `INSERT INTO user_books (user_id, bookshelf_id, book_id, physical_location, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, physical_location, notes, created_at`,
          [
            req.user.id,
            activeBookshelfId,
            book.id,
            physicalLocation ? physicalLocation.trim() : null,
            notes ? notes.trim() : null,
          ]
        );

        return res.status(201).json({
          message: 'Book indexed and added to bookshelf successfully.',
          mapping: newMap.rows[0],
          book: book,
        });

      } catch (error) {
        console.error('Scan Book Router Error:', error);
        return res.status(500).json({ error: 'Internal server error cataloging barcode scan.' });
      }
    });
  });
});

/**
 * POST /api/books/manual - Manually create a book and map to a bookshelf
 */
router.post('/manual', async (req, res) => {
  const {
    bookshelfId,
    isbn,
    title,
    author,
    publisher,
    coverImageUrl,
    pageCount,
    publicationDate,
    physicalLocation,
    notes,
  } = req.body;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'A book title is required.' });
  }

  // 1. Verify access to target bookshelf
  req.params.bookshelfId = bookshelfId;
  verifyBookshelfAccess(req, res, async () => {
    requireCollaborator(req, res, async () => {
      try {
        const activeBookshelfId = req.shelfAccess.bookshelfId;
        const cleanedIsbn = cleanISBN(isbn) || null;
        let book = null;

        // 2. If ISBN provided, check global catalog first
        if (cleanedIsbn) {
          const bookRes = await query('SELECT * FROM books WHERE isbn = $1', [cleanedIsbn]);
          if (bookRes.rows.length > 0) {
            book = bookRes.rows[0];
            // Enrich existing cache if missing fields are provided
            await query(
              `UPDATE books 
               SET title = COALESCE($1, title), 
                   author = COALESCE($2, author), 
                   publisher = COALESCE($3, publisher), 
                   cover_image_url = COALESCE($4, cover_image_url), 
                   page_count = COALESCE($5, page_count), 
                   publication_date = COALESCE($6, publication_date) 
               WHERE id = $7`,
              [
                title.trim(),
                author ? author.trim() : null,
                publisher ? publisher.trim() : null,
                coverImageUrl ? coverImageUrl.trim() : null,
                pageCount ? parseInt(pageCount, 10) : null,
                publicationDate ? publicationDate.trim() : null,
                book.id,
              ]
            );
          }
        }

        // 3. If book still does not exist, create global catalog row
        if (!book) {
          // Generate a mock unique ISBN if not provided
          const finalIsbn = cleanedIsbn || `MANUAL-${Date.now()}`;
          const insertRes = await query(
            `INSERT INTO books (isbn, title, author, publisher, cover_image_url, page_count, publication_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              finalIsbn,
              title.trim(),
              author ? author.trim() : 'Unknown Author',
              publisher ? publisher.trim() : 'Unknown Publisher',
              coverImageUrl ? coverImageUrl.trim() : null,
              pageCount ? parseInt(pageCount, 10) : null,
              publicationDate ? publicationDate.trim() : null,
            ]
          );
          book = insertRes.rows[0];
        }

        // 4. Prevent duplicate bookshelf mapping
        const mapCheck = await query(
          'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
          [activeBookshelfId, book.id]
        );

        if (mapCheck.rows.length > 0) {
          return res.status(409).json({
            error: `"${book.title}" is already mapped inside this bookshelf.`,
            book: book,
          });
        }

        // 5. Create user_books shelf mapping association
        const newMap = await query(
          `INSERT INTO user_books (user_id, bookshelf_id, book_id, physical_location, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, physical_location, notes, created_at`,
          [
            req.user.id,
            activeBookshelfId,
            book.id,
            physicalLocation ? physicalLocation.trim() : null,
            notes ? notes.trim() : null,
          ]
        );

        return res.status(201).json({
          message: 'Book registered manually and added to bookshelf successfully.',
          mapping: newMap.rows[0],
          book: book,
        });

      } catch (error) {
        console.error('Manual Book Router Error:', error);
        return res.status(500).json({ error: 'Internal server error registering book manually.' });
      }
    });
  });
});

/**
 * PUT /api/books/mapping/:mappingId - Update physical location & custom notes (Collaborator/Owner)
 */
router.put('/mapping/:mappingId', async (req, res) => {
  const mappingId = parseInt(req.params.mappingId, 10);
  const { physicalLocation, notes, isRead, targetBookshelfId } = req.body;

  if (isNaN(mappingId)) {
    return res.status(400).json({ error: 'Invalid mapping ID.' });
  }

  try {
    // 1. Resolve bookshelf association to verify RBAC access
    const mapRes = await query('SELECT bookshelf_id, book_id, physical_location, notes, is_read FROM user_books WHERE id = $1', [mappingId]);
    if (mapRes.rows.length === 0) {
      return res.status(404).json({ error: 'Book bookshelf association not found.' });
    }

    const { bookshelf_id: bookshelfId, book_id: bookId, physical_location: currentLoc, notes: currentNotes, is_read: currentIsRead } = mapRes.rows[0];

    // 2. Verify access to shelf
    req.params.bookshelfId = bookshelfId;
    verifyBookshelfAccess(req, res, async () => {
      requireCollaborator(req, res, async () => {
        try {
          const finalLoc = physicalLocation !== undefined ? (physicalLocation ? physicalLocation.trim() : null) : currentLoc;
          const finalNotes = notes !== undefined ? (notes ? notes.trim() : null) : currentNotes;
          const finalIsRead = isRead !== undefined ? !!isRead : currentIsRead;
          
          let finalBookshelfId = bookshelfId;

          // Cross-Shelf Reassignment Verification (Req 1.5 Reassignment)
          if (targetBookshelfId && parseInt(targetBookshelfId, 10) !== bookshelfId) {
            const targetId = parseInt(targetBookshelfId, 10);

            // Verify write access to target shelf (owner/collaborator)
            const targetAccess = await query(
              `SELECT 'owner' AS role FROM bookshelves WHERE id = $1 AND user_id = $2
               UNION ALL
               SELECT permission AS role FROM shelf_shares WHERE bookshelf_id = $1 AND shared_with_user_id = $2`,
              [targetId, req.user.id]
            );

            if (targetAccess.rows.length === 0 || (targetAccess.rows[0].role !== 'owner' && targetAccess.rows[0].role !== 'collaborator')) {
              return res.status(403).json({ error: 'You do not have write access to the destination target bookshelf.' });
            }

            // Check if book is already mapped in target shelf to prevent duplicates
            const dupCheck = await query(
              'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
              [targetId, bookId]
            );

            if (dupCheck.rows.length > 0) {
              return res.status(409).json({ error: 'This book is already assigned to the destination target bookshelf.' });
            }

            finalBookshelfId = targetId;
          }

          // 3. Update annotations, read status, and bookshelf assignments atomically
          const updatedMap = await query(
            `UPDATE user_books 
             SET physical_location = $1, notes = $2, is_read = $3, bookshelf_id = $4
             WHERE id = $5 
             RETURNING id, physical_location, notes, is_read, bookshelf_id, book_id`,
            [finalLoc, finalNotes, finalIsRead, finalBookshelfId, mappingId]
          );

          return res.json({
            message: 'Book annotations updated successfully.',
            mapping: updatedMap.rows[0],
          });
        } catch (err) {
          console.error('Update Mapping SQL Error:', err);
          return res.status(500).json({ error: 'Database update failed.' });
        }
      });
    });

  } catch (error) {
    console.error('Update Book Mapping Router Error:', error);
    return res.status(500).json({ error: 'Internal server error updating book notes.' });
  }
});

/**
 * DELETE /api/books/mapping/:mappingId - Remove book mapping from bookshelf (Collaborator/Owner)
 */
router.post('/mapping/:mappingId/delete', async (req, res) => {
  const mappingId = parseInt(req.params.mappingId, 10);

  if (isNaN(mappingId)) {
    return res.status(400).json({ error: 'Invalid mapping ID.' });
  }

  try {
    // 1. Resolve bookshelf association
    const mapRes = await query('SELECT bookshelf_id, book_id FROM user_books WHERE id = $1', [mappingId]);
    if (mapRes.rows.length === 0) {
      return res.status(404).json({ error: 'Book mapping association not found.' });
    }

    const { bookshelf_id: bookshelfId } = mapRes.rows[0];

    // 2. Verify access to shelf
    req.params.bookshelfId = bookshelfId;
    verifyBookshelfAccess(req, res, async () => {
      requireCollaborator(req, res, async () => {
        try {
          // 3. Remove entry from user_books
          await query('DELETE FROM user_books WHERE id = $1', [mappingId]);
          
          return res.json({
            message: 'Book removed from bookshelf successfully.',
            mappingId: mappingId,
          });
        } catch (err) {
          console.error('Delete Mapping SQL Error:', err);
          return res.status(500).json({ error: 'Database deletion failed.' });
        }
      });
    });

  } catch (error) {
    console.error('Delete Book Mapping Router Error:', error);
    return res.status(500).json({ error: 'Internal server error deleting book mapping.' });
  }
});

/**
 * PUT /api/books/:bookId - Enrich/Edit global catalog details
 */
router.put('/:bookId', async (req, res) => {
  const bookId = parseInt(req.params.bookId, 10);
  const { title, author, publisher, coverImageUrl, pageCount, publicationDate } = req.body;

  if (isNaN(bookId)) {
    return res.status(400).json({ error: 'Invalid book ID.' });
  }

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'A book title is required.' });
  }

  try {
    // Standard catalog enrichment editable by authenticated users
    const updatedBook = await query(
      `UPDATE books 
       SET title = $1, author = $2, publisher = $3, 
           cover_image_url = $4, page_count = $5, publication_date = $6
       WHERE id = $7 
       RETURNING *`,
      [
        title.trim(),
        author ? author.trim() : 'Unknown Author',
        publisher ? publisher.trim() : 'Unknown Publisher',
        coverImageUrl ? coverImageUrl.trim() : null,
        pageCount ? parseInt(pageCount, 10) : null,
        publicationDate ? publicationDate.trim() : null,
        bookId,
      ]
    );

    if (updatedBook.rows.length === 0) {
      return res.status(404).json({ error: 'Global catalog book not found.' });
    }

    return res.json({
      message: 'Global catalog book details enriched successfully.',
      book: updatedBook.rows[0],
    });

  } catch (error) {
    console.error('Enrich Global Book Error:', error);
    return res.status(500).json({ error: 'Internal server error updating catalog details.' });
  }
});

/**
 * GET /api/books/lookup/:isbn - Perform metadata lookup without bookshelf mapping (cached check -> API lookup)
 */
router.get('/lookup/:isbn', async (req, res) => {
  const isbn = cleanISBN(req.params.isbn);

  if (!isValidBarcode(isbn)) {
    return res.status(400).json({ error: 'A valid ISBN-10, ISBN-13, or UPC-A parameter is required.' });
  }

  try {
    // 1. Check local catalog cache first
    let bookRes = await query('SELECT * FROM books WHERE isbn = $1 OR (length($1) >= 12 AND isbn = substring($1 from 1 for 12))', [isbn]);
    let book = null;

    if (bookRes.rows.length > 0) {
      book = bookRes.rows[0];
      console.log(`💾 Lookup cache hit: retrieved "${book.title}"`);
    } else {
      // 2. Lookup externally
      try {
        const externalData = await withTimeout(
          queryExternalISBN(isbn),
          12000,
          'External ISBN lookup timed out (12s limit)'
        );

        if (externalData) {
          // Insert into global catalog books table to cache it
          const insertRes = await query(
            `INSERT INTO books (isbn, title, author, publisher, cover_image_url, page_count, publication_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              externalData.isbn,
              externalData.title,
              externalData.author,
              externalData.publisher,
              externalData.cover_image_url,
              externalData.page_count,
              externalData.publication_date,
            ]
          );
          book = insertRes.rows[0];
        }
      } catch (timeoutErr) {
        console.error('⚠️ ISBN Lookup query timeout:', timeoutErr.message);
        return res.status(404).json({
          fallbackToManual: true,
          isbn: isbn,
          error: 'External search lookup timed out.',
        });
      }
    }

    if (!book) {
      return res.status(404).json({
        fallbackToManual: true,
        isbn: isbn,
        error: 'Book details not found.',
      });
    }

    return res.json(book);

  } catch (error) {
    console.error('ISBN Lookup Router Error:', error);
    return res.status(500).json({ error: 'Internal server error during metadata lookup.' });
  }
});

/**
 * GET /api/books/roulette - Select a random unread book from the user's bookshelves
 */
router.get('/roulette', async (req, res) => {
  const userId = req.user.id;

  try {
    const randomBookRes = await query(
      `SELECT ub.id AS mapping_id, b.title, b.author, b.cover_image_url, bs.name AS bookshelf_name, bs.id AS bookshelf_id
       FROM user_books ub
       JOIN books b ON ub.book_id = b.id
       JOIN bookshelves bs ON ub.bookshelf_id = bs.id
       LEFT JOIN shelf_shares ss ON bs.id = ss.bookshelf_id AND ss.shared_with_user_id = $1
       WHERE (bs.user_id = $1 OR ss.shared_with_user_id = $1)
         AND (ub.is_read = FALSE OR ub.is_read IS NULL)
       ORDER BY RANDOM()
       LIMIT 1`,
      [userId]
    );

    if (randomBookRes.rows.length === 0) {
      return res.status(404).json({ error: 'No unread books found in your bookshelves.' });
    }

    return res.json(randomBookRes.rows[0]);

  } catch (error) {
    console.error('Book Roulette Router Error:', error);
    return res.status(500).json({ error: 'Internal server error running Book Roulette.' });
  }
});

module.exports = router;
