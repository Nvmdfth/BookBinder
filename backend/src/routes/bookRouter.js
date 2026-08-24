const express = require('express');
const { query, withTransaction } = require('../db/db');
const { normalizeCoverUrl } = require('../utils/coverUrl');
const { authenticateToken } = require('../middleware/authMiddleware');
const { verifyBookshelfAccess, requireCollaborator } = require('../middleware/shareMiddleware');
const { cleanISBN, isValidISBN, isValidBarcode, upcCore } = require('../utils/isbn');

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
 * Resolve a scanned barcode against the local catalog.
 *
 * An ISBN is matched on the books.isbn unique index directly. A UPC-A has no
 * row of its own — it resolves through the book_barcodes alias table, keyed on
 * the 12-digit core so a reprint with a different price add-on still matches.
 */
async function findCatalogBook(barcode) {
  const direct = await query('SELECT * FROM books WHERE isbn = $1', [barcode]);
  if (direct.rows.length > 0) return direct.rows[0];

  const core = upcCore(barcode);
  if (!core) return null;

  const alias = await query(
    `SELECT b.* FROM books b
     JOIN book_barcodes bb ON bb.book_id = b.id
     WHERE bb.barcode = $1`,
    [core]
  );
  return alias.rows[0] || null;
}

/**
 * Every shelf visible to this user that already carries the given book.
 *
 * "Visible" spans owned shelves and shelves shared with them under either
 * permission: a copy sitting on a shelf someone shared with you is still a copy
 * you can reach, and a scanner that stayed quiet about it would send you out to
 * buy a second one. The role each holding carries lets the client offer a
 * filing action only where the write would actually be allowed.
 *
 * The CASE/LEFT JOIN pair resolves the role exactly as the UNION ALL in
 * bookshelfRouter does, so the two cannot drift on what 'owner' means. The
 * UNIQUE (bookshelf_id, shared_with_user_id) constraint caps the join at one
 * row per shelf, so owning a shelf that is also shared with you — which the
 * schema permits — cannot report the book twice.
 */
async function findHoldings(bookId, userId) {
  const res = await query(
    `SELECT ub.id AS mapping_id, bs.id AS bookshelf_id, bs.name AS bookshelf_name,
            bs.is_wishlist, ub.physical_location, ub.is_read,
            CASE WHEN bs.user_id = $2 THEN 'owner' ELSE ss.permission END AS role
       FROM user_books ub
       JOIN bookshelves bs ON ub.bookshelf_id = bs.id
       LEFT JOIN shelf_shares ss
         ON ss.bookshelf_id = bs.id AND ss.shared_with_user_id = $2
      WHERE ub.book_id = $1
        AND (bs.user_id = $2 OR ss.shared_with_user_id IS NOT NULL)
      ORDER BY bs.name ASC`,
    [bookId, userId]
  );

  return res.rows;
}

/**
 * Record the UPC a book was scanned under, so the next scan skips the manual form.
 *
 * Re-entering a barcode reassigns it: the correction the user just typed is more
 * trustworthy than whatever the alias pointed at before.
 *
 * Takes the executor so it can join the caller's transaction: the alias points
 * at a book row, and learning it outside the unit that writes that row would
 * leave the mapping dangling if the ingestion is rolled back.
 */
async function learnBarcodeAlias(barcode, bookId, exec = query) {
  const core = upcCore(barcode);
  if (!core) return;

  await exec(
    `INSERT INTO book_barcodes (barcode, book_id)
     VALUES ($1, $2)
     ON CONFLICT (barcode) DO UPDATE SET book_id = EXCLUDED.book_id`,
    [core, bookId]
  );
  console.log(`🔖 Learned barcode ${core} for book ${bookId}`);
}

/**
 * The 404 body that hands an unresolvable scan to the manual entry form.
 *
 * A UPC is flagged so the client knows not to prefill it as the ISBN — it is a
 * product code, not a book identifier — and can send it back to be learned.
 */
function manualFallback(barcode, error) {
  const core = upcCore(barcode);
  return {
    fallbackToManual: true,
    isbn: barcode,
    barcode: core || barcode,
    barcodeType: core ? 'upc' : 'isbn',
    error,
  };
}

/**
 * Helper querying external metadata from Google Books and OpenLibrary
 */
async function queryExternalISBN(isbn) {
  // Neither provider can resolve a book UPC — Google Books has no upc: search
  // qualifier, and OpenLibrary indexes UPC identifiers on a couple of editions.
  // Asking them costs four sequential round trips to return nothing, so a
  // non-ISBN barcode never reaches the network at all.
  if (!isValidISBN(isbn)) return null;

  // 1. Fetch system switch settings
  const settingsRes = await query(
    "SELECT key, value FROM system_settings WHERE key IN ('enable_google_books', 'enable_open_library')"
  );
  
  const settings = {};
  settingsRes.rows.forEach(r => {
    settings[r.key] = r.value === 'true';
  });

  let bookData = null;

  // 2. Query Google Books first if enabled
  if (settings.enable_google_books) {
    try {
      console.log(`🌐 Querying Google Books API for ISBN: ${isbn}...`);
      let url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
      if (process.env.GOOGLE_BOOKS_API_KEY) {
        url += `&key=${process.env.GOOGLE_BOOKS_API_KEY}`;
      }

      // Execute with a 6-second timeout block (giving OpenLibrary space to execute inside the 12s overall limit)
      const res = await withTimeout(fetch(url), 6000, 'Google Books request timed out');
      if (res.ok) {
        const data = await res.json();
        if (data.totalItems > 0 && data.items && data.items[0].volumeInfo) {
          const info = data.items[0].volumeInfo;
          console.log(`✅ Match found on Google Books: "${info.title}"`);

          bookData = {
            isbn: isbn,
            title: info.title || 'Unknown Title',
            author: info.authors ? info.authors.join(', ') : 'Unknown Author',
            publisher: info.publisher || 'Unknown Publisher',
            cover_image_url: normalizeCoverUrl(info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)),
            page_count: info.pageCount || null,
            publication_date: info.publishedDate || null,
          };
        }
      } else {
        console.error(`⚠️ Google Books ISBN lookup responded with status: ${res.status}`);
        if (res.status === 429) {
          console.error(`💡 Rate limited by Google. Consider setting a GOOGLE_BOOKS_API_KEY in your .env configuration.`);
        }
      }
    } catch (err) {
      console.error('⚠️ Google Books fetch failed:', err.message);
    }
  }

  // 3. Fallback to OpenLibrary if no match yet and enabled
  if (!bookData && settings.enable_open_library) {
    try {
      console.log(`🌐 Querying OpenLibrary API for ISBN: ${isbn}...`);
      const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`;

      const res = await withTimeout(fetch(url), 6000, 'OpenLibrary request timed out');
      if (res.ok) {
        const data = await res.json();
        const bibKey = `ISBN:${isbn}`;

        if (data[bibKey]) {
          const info = data[bibKey];
          console.log(`✅ Match found on OpenLibrary: "${info.title}"`);

          const authorsStr = info.authors ? info.authors.map(a => a.name).join(', ') : 'Unknown Author';
          const publishersStr = info.publishers ? info.publishers.map(p => p.name).join(', ') : 'Unknown Publisher';
          const coverUrl = info.cover ? (info.cover.large || info.cover.medium || info.cover.small) : null;

          bookData = {
            isbn: isbn,
            title: info.title || 'Unknown Title',
            author: authorsStr,
            publisher: publishersStr,
            cover_image_url: normalizeCoverUrl(coverUrl),
            page_count: info.number_of_pages || null,
            publication_date: info.publish_date || null,
          };
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
                  cover_image_url: normalizeCoverUrl(info.imageLinks && (info.imageLinks.thumbnail || info.imageLinks.smallThumbnail)),
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
                cover_image_url: normalizeCoverUrl(coverUrl),
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
        let book = await findCatalogBook(isbn);

        let externalData = null;

        if (book) {
          console.log(`💾 Cache hit: retrieved "${book.title}" from local catalog index.`);
        } else {
          /*
           * 3. Fallback: Search external APIs (with 12-second total threshold).
           *
           * Deliberately outside the transaction below. A pooled client held
           * across a network call this long would starve concurrent scans, so
           * the metadata is resolved first and only then written.
           */
          try {
            externalData = await withTimeout(
              queryExternalISBN(isbn),
              12000,
              'External ISBN lookups timed out (12s limit reached)'
            );
          } catch (timeoutErr) {
            console.error('⚠️ ISBN Ingestion lookup error:', timeoutErr.message);
            // Seamlessly signal frontend to redirect to pre-populated manual forms
            return res.status(404).json(
              manualFallback(isbn, 'External search lookup timed out. Please enter book details manually.')
            );
          }
        }

        // 4. Ingestion Fail: Book not resolved via caching or external lookup
        if (!book && !externalData) {
          return res.status(404).json(
            manualFallback(isbn, 'Book details not found. Please enter details manually.')
          );
        }

        /*
         * 5. Catalog row and shelf mapping are one unit of work.
         *
         * On the pool these autocommit separately, so a failure after the books
         * insert leaves a catalog row no user_books row references. Nothing
         * cascades that direction, so it would survive as an orphan until an
         * admin pruned it by hand.
         */
        const outcome = await withTransaction(async (tx) => {
          let catalogBook = book;

          if (!catalogBook) {
            // Save partial/complete metadata to global catalog
            const insertRes = await tx(
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
            catalogBook = insertRes.rows[0];
          }

          // Prevent identical double map inside same shelf
          const mapCheck = await tx(
            'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
            [activeBookshelfId, catalogBook.id]
          );

          if (mapCheck.rows.length > 0) {
            return {
              status: 409,
              body: {
                error: `"${catalogBook.title}" is already mapped inside this bookshelf.`,
                book: catalogBook,
              },
            };
          }

          // Map Book to User's Bookshelf
          const newMap = await tx(
            `INSERT INTO user_books (user_id, bookshelf_id, book_id, physical_location, notes)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, physical_location, notes, created_at`,
            [
              req.user.id,
              activeBookshelfId,
              catalogBook.id,
              physicalLocation ? physicalLocation.trim() : null,
              notes ? notes.trim() : null,
            ]
          );

          return {
            status: 201,
            body: {
              message: 'Book indexed and added to bookshelf successfully.',
              mapping: newMap.rows[0],
              book: catalogBook,
            },
          };
        });

        // Sent only once the transaction has committed, so a commit failure
        // surfaces as a 500 rather than a success the database never kept.
        return res.status(outcome.status).json(outcome.body);

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
    scannedBarcode,
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

        /*
         * Catalog row, barcode alias and shelf mapping are one unit of work.
         *
         * This path resolves nothing externally, so the whole sequence can be
         * held open. On the pool each statement autocommits alone: a failure
         * partway through would leave a catalog row nothing references — and
         * possibly a barcode alias pointing at it — with no cascade to clean
         * either up, since the FK only runs books → user_books.
         */
        const outcome = await withTransaction(async (tx) => {
          let book = null;

          // 2. If ISBN provided, check global catalog first
          if (cleanedIsbn) {
            const bookRes = await tx('SELECT * FROM books WHERE isbn = $1', [cleanedIsbn]);
            if (bookRes.rows.length > 0) {
              book = bookRes.rows[0];
              // Enrich existing cache if missing fields are provided
              await tx(
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
                  normalizeCoverUrl(coverImageUrl && coverImageUrl.trim()),
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
            const insertRes = await tx(
              `INSERT INTO books (isbn, title, author, publisher, cover_image_url, page_count, publication_date)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *`,
              [
                finalIsbn,
                title.trim(),
                author ? author.trim() : 'Unknown Author',
                publisher ? publisher.trim() : 'Unknown Publisher',
                normalizeCoverUrl(coverImageUrl && coverImageUrl.trim()),
                pageCount ? parseInt(pageCount, 10) : null,
                publicationDate ? publicationDate.trim() : null,
              ]
            );
            book = insertRes.rows[0];
          }

          // 3b. Learn the barcode this entry came from. A UPC-A cannot be resolved
          // by any provider, so the only way the next scan of this paperback skips
          // this form is by remembering what the user just told us.
          await learnBarcodeAlias(scannedBarcode, book.id, tx);

          // 4. Prevent duplicate bookshelf mapping
          const mapCheck = await tx(
            'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
            [activeBookshelfId, book.id]
          );

          if (mapCheck.rows.length > 0) {
            return {
              status: 409,
              body: {
                error: `"${book.title}" is already mapped inside this bookshelf.`,
                book: book,
              },
            };
          }

          // 5. Create user_books shelf mapping association
          const newMap = await tx(
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

          return {
            status: 201,
            body: {
              message: 'Book registered manually and added to bookshelf successfully.',
              mapping: newMap.rows[0],
              book: book,
            },
          };
        });

        // Sent only once the transaction has committed, so a commit failure
        // surfaces as a 500 rather than a success the database never kept.
        return res.status(outcome.status).json(outcome.body);

      } catch (error) {
        console.error('Manual Book Router Error:', error);
        return res.status(500).json({ error: 'Internal server error registering book manually.' });
      }
    });
  });
});

/**
 * POST /api/books/file - Map an already-resolved catalog book onto a bookshelf
 *
 * The scan pipeline takes a barcode because it is resolving one. A caller holding
 * a confirmed catalog row is past that: re-entering through /scan/:isbn would
 * repeat findCatalogBook for a book it already has, and would fail outright for a
 * manually created one, whose synthetic MANUAL-<timestamp> ISBN cannot pass the
 * isValidBarcode guard that route opens with. Filing by book id is the operation
 * actually being performed.
 */
router.post('/file', async (req, res) => {
  const { bookshelfId, physicalLocation, notes } = req.body;
  const bookId = parseInt(req.body.bookId, 10);

  if (isNaN(bookId)) {
    return res.status(400).json({ error: 'A valid book ID is required.' });
  }

  req.params.bookshelfId = bookshelfId;
  verifyBookshelfAccess(req, res, async () => {
    requireCollaborator(req, res, async () => {
      try {
        const activeBookshelfId = req.shelfAccess.bookshelfId;

        // The id arrives from the client, so it is a claim about the catalog, not
        // a fact. An unchecked insert would trip the foreign key as a 500.
        const bookRes = await query('SELECT * FROM books WHERE id = $1', [bookId]);
        if (bookRes.rows.length === 0) {
          return res.status(404).json({ error: 'Book not found in the catalog.' });
        }
        const book = bookRes.rows[0];

        const mapCheck = await query(
          'SELECT id FROM user_books WHERE bookshelf_id = $1 AND book_id = $2',
          [activeBookshelfId, bookId]
        );

        if (mapCheck.rows.length > 0) {
          return res.status(409).json({
            error: `"${book.title}" is already mapped inside this bookshelf.`,
            book: book,
          });
        }

        const newMap = await query(
          `INSERT INTO user_books (user_id, bookshelf_id, book_id, physical_location, notes)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id, physical_location, notes, created_at`,
          [
            req.user.id,
            activeBookshelfId,
            bookId,
            physicalLocation ? physicalLocation.trim() : null,
            notes ? notes.trim() : null,
          ]
        );

        return res.status(201).json({
          message: 'Book added to bookshelf successfully.',
          mapping: newMap.rows[0],
          book: book,
        });

      } catch (error) {
        console.error('File Book Router Error:', error);
        return res.status(500).json({ error: 'Internal server error filing book.' });
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
        normalizeCoverUrl(coverImageUrl && coverImageUrl.trim()),
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
    let book = await findCatalogBook(isbn);

    if (book) {
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
        return res.status(404).json(manualFallback(isbn, 'External search lookup timed out.'));
      }
    }

    if (!book) {
      return res.status(404).json(manualFallback(isbn, 'Book details not found.'));
    }

    // Scanning away from a shelf, "do I already own this?" is the question being
    // asked, so the answer travels with the metadata rather than costing a second
    // round trip. A book held nowhere reports an empty array, never a 404.
    const holdings = await findHoldings(book.id, req.user.id);

    return res.json({ ...book, holdings });

  } catch (error) {
    console.error('ISBN Lookup Router Error:', error);
    return res.status(500).json({ error: 'Internal server error during metadata lookup.' });
  }
});

/**
 * GET /api/books/library-search - Search every shelf the caller can see.
 *
 * Distinct from /search above, which hunts the global catalogue and external
 * providers for a book to *add*. This one answers the question the app exists
 * for — "do I already own this, and where did I put it?" — across shelves,
 * which previously required opening each one and filtering it by hand.
 *
 * One row per user_books mapping, not per book: two shelves holding the same
 * title are two physical copies in two places, each with its own location and
 * its own mapping_id for the caller to open.
 */
router.get('/library-search', async (req, res) => {
  const rawQuery = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  // Two characters is the floor the wildcard search already uses. Below it the
  // pattern matches most of the library, which is slow and useless in equal
  // measure — so refuse before reaching the database.
  if (rawQuery.length < 2) {
    return res.status(400).json({ error: 'Enter at least two characters to search your library.' });
  }

  const pattern = `%${rawQuery}%`;

  try {
    /*
     * The visible CTE is the access boundary, and it mirrors the union in
     * bookshelfRouter's shelf listing: a shelf qualifies either because the
     * caller owns it or because a shelf_shares row grants it to them. A shelf
     * belonging to someone else and never shared satisfies neither branch, so
     * it cannot reach the join below.
     */
    const searchRes = await query(
      `WITH visible AS (
         SELECT b.id AS bookshelf_id, b.name AS bookshelf_name, b.is_wishlist,
                'owner' AS role, u.email AS owner_email
           FROM bookshelves b
           JOIN users u ON b.user_id = u.id
          WHERE b.user_id = $1

         UNION ALL

         SELECT b.id AS bookshelf_id, b.name AS bookshelf_name, b.is_wishlist,
                s.permission AS role, u.email AS owner_email
           FROM bookshelves b
           JOIN shelf_shares s ON b.id = s.bookshelf_id
           JOIN users u ON b.user_id = u.id
          WHERE s.shared_with_user_id = $1
       )
       SELECT ub.id AS mapping_id, bk.id AS book_id, bk.isbn, bk.title, bk.author,
              bk.cover_image_url, ub.physical_location, ub.notes, ub.is_read,
              v.bookshelf_id, v.bookshelf_name, v.role, v.owner_email, v.is_wishlist,
              CASE WHEN bk.title ILIKE $2 THEN 'title'
                   WHEN bk.author ILIKE $2 THEN 'author'
                   WHEN bk.isbn ILIKE $2 THEN 'isbn'
                   WHEN ub.physical_location ILIKE $2 THEN 'location'
                   ELSE 'notes'
              END AS matched_on
         FROM user_books ub
         JOIN books bk ON ub.book_id = bk.id
         JOIN visible v ON ub.bookshelf_id = v.bookshelf_id
        WHERE bk.title ILIKE $2 OR bk.author ILIKE $2 OR bk.isbn ILIKE $2
           OR ub.physical_location ILIKE $2 OR ub.notes ILIKE $2
        ORDER BY bk.title ASC, v.bookshelf_name ASC
        LIMIT 50`,
      [req.user.id, pattern]
    );

    return res.json({ query: rawQuery, results: searchRes.rows });

  } catch (error) {
    console.error('Library Search Router Error:', error);
    return res.status(500).json({ error: 'Internal server error searching your library.' });
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
