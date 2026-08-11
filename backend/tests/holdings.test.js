const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie, USERS } = require('./helpers/testApp');

/**
 * Scanning away from a shelf asks a question the shelf-bound pipeline never had
 * to: "is this already somewhere in my library?" The answer rides along with the
 * metadata lookup, and a filing endpoint keyed on the catalog row — not on a
 * barcode — completes the round trip.
 */

const HOLDINGS_SQL = /FROM user_books ub JOIN bookshelves bs/;

const catalogBook = {
  id: 42,
  isbn: '9780441013593',
  title: 'Dune',
  author: 'Frank Herbert',
  publisher: 'Ace',
  cover_image_url: null,
  page_count: 412,
  publication_date: '1965',
};

/** Shelf 5 is owned by user 1 ('owner'); reached without a share row. */
const OWNED_SHELF = [
  /SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled/,
  [{ id: 5, user_id: USERS.owner.id, name: 'Sci-Fi', owner_disabled: false }],
];

/** Shelf 7 belongs to the owner but is reached by another user through a share. */
const SHARED_SHELF = [
  /SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled/,
  [{ id: 7, user_id: USERS.owner.id, name: "Owner's shelf", owner_disabled: false }],
];

describe('GET /api/books/lookup/:isbn holdings', () => {
  beforeEach(() => {
    jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('A cached catalog hit must not reach the network');
    });
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const lookup = () =>
    request(app).get('/api/books/lookup/9780441013593').set('Cookie', authCookie('owner'));

  it('reports an empty array for a book held on no shelf', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]],
        [HOLDINGS_SQL, []],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await lookup();

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Dune');
    // Not held is an ordinary answer, not a missing book
    expect(res.body.holdings).toEqual([]);
  });

  it('reports a shelf the user owns', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]],
        [
          HOLDINGS_SQL,
          [{
            mapping_id: 900,
            bookshelf_id: 5,
            bookshelf_name: 'Sci-Fi',
            is_wishlist: false,
            physical_location: 'Living room, B2',
            is_read: true,
            role: 'owner',
          }],
        ],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await lookup();

    expect(res.status).toBe(200);
    expect(res.body.holdings).toHaveLength(1);
    expect(res.body.holdings[0]).toMatchObject({
      bookshelf_name: 'Sci-Fi',
      role: 'owner',
      physical_location: 'Living room, B2',
    });
  });

  it('scopes the probe to the book and the requesting user', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]],
        [HOLDINGS_SQL, []],
      ],
      { authenticatedAs: 'owner' }
    );

    await lookup();

    const probe = sqlCalls().find((c) => HOLDINGS_SQL.test(c.sql));
    expect(probe.params).toEqual([catalogBook.id, USERS.owner.id]);
  });

  it('counts view-only and collaborator shares, so a shared copy is still a copy', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]],
        [
          HOLDINGS_SQL,
          [
            { mapping_id: 901, bookshelf_id: 7, bookshelf_name: 'Dad\'s shelf', is_wishlist: false, physical_location: null, is_read: false, role: 'view' },
            { mapping_id: 902, bookshelf_id: 8, bookshelf_name: 'Book club', is_wishlist: false, physical_location: null, is_read: false, role: 'collaborator' },
          ],
        ],
      ],
      { authenticatedAs: 'collaborator' }
    );

    const res = await request(app)
      .get('/api/books/lookup/9780441013593')
      .set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(200);
    expect(res.body.holdings.map((h) => h.role)).toEqual(['view', 'collaborator']);
  });

  it('carries the wishlist flag, which means wanted rather than owned', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]],
        [
          HOLDINGS_SQL,
          [{
            mapping_id: 903,
            bookshelf_id: 9,
            bookshelf_name: 'Wishlist',
            is_wishlist: true,
            physical_location: null,
            is_read: false,
            role: 'owner',
          }],
        ],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await lookup();

    expect(res.body.holdings[0].is_wishlist).toBe(true);
  });

  it('does not probe holdings for a barcode that resolved to nothing', async () => {
    mockSql(
      [
        [/SELECT \* FROM books WHERE isbn = \$1$/, []],
        [/JOIN book_barcodes/, []],
      ],
      { authenticatedAs: 'owner' }
    );

    // A UPC never reaches the network, so this 404s without an external call
    const res = await request(app)
      .get('/api/books/lookup/070993005993')
      .set('Cookie', authCookie('owner'));

    expect(res.status).toBe(404);
    expect(sqlCalls().some((c) => HOLDINGS_SQL.test(c.sql))).toBe(false);
  });

  it('requires a session', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/books/lookup/9780441013593');

    expect(res.status).toBe(401);
  });
});

describe('POST /api/books/file', () => {
  const BOOK_BY_ID = /SELECT \* FROM books WHERE id = \$1/;
  const DUPE_CHECK = /SELECT id FROM user_books WHERE bookshelf_id/;

  it('maps a resolved catalog book onto a shelf the user owns', async () => {
    mockSql(
      [
        OWNED_SHELF,
        [BOOK_BY_ID, [catalogBook]],
        [DUPE_CHECK, []],
        [/INSERT INTO user_books/, [{ id: 500, physical_location: 'Loft', notes: null, created_at: 'now' }]],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 42, bookshelfId: 5, physicalLocation: 'Loft' });

    expect(res.status).toBe(201);
    expect(res.body.book.title).toBe('Dune');
    expect(res.body.mapping.id).toBe(500);

    const insert = sqlCalls().find((c) => /INSERT INTO user_books/.test(c.sql));
    expect(insert.params).toEqual([USERS.owner.id, 5, 42, 'Loft', null]);
  });

  it('never re-resolves the barcode, which is the whole point of filing by id', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('Filing a known catalog row must not reach a metadata provider');
    });

    mockSql(
      [
        OWNED_SHELF,
        [BOOK_BY_ID, [catalogBook]],
        [DUPE_CHECK, []],
        [/INSERT INTO user_books/, [{ id: 501, physical_location: null, notes: null, created_at: 'now' }]],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 42, bookshelfId: 5 });

    expect(res.status).toBe(201);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sqlCalls().some((c) => /JOIN book_barcodes/.test(c.sql))).toBe(false);

    fetchSpy.mockRestore();
  });

  it('files a manually created book, whose synthetic ISBN no barcode route would accept', async () => {
    const manualBook = { ...catalogBook, id: 43, isbn: 'MANUAL-1754870400000', title: 'Zine, unnumbered' };

    mockSql(
      [
        OWNED_SHELF,
        [BOOK_BY_ID, [manualBook]],
        [DUPE_CHECK, []],
        [/INSERT INTO user_books/, [{ id: 502, physical_location: null, notes: null, created_at: 'now' }]],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 43, bookshelfId: 5 });

    expect(res.status).toBe(201);
    expect(res.body.book.isbn).toBe('MANUAL-1754870400000');
  });

  it('rejects a view-only share with 403 before touching the catalog', async () => {
    mockSql(
      [
        SHARED_SHELF,
        [/SELECT permission FROM shelf_shares/, [{ permission: 'view' }]],
        [BOOK_BY_ID, [catalogBook]],
      ],
      { authenticatedAs: 'viewer' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('viewer'))
      .send({ bookId: 42, bookshelfId: 7 });

    expect(res.status).toBe(403);
    expect(sqlCalls().some((c) => /INSERT INTO user_books/.test(c.sql))).toBe(false);
  });

  it('allows a collaborator share', async () => {
    mockSql(
      [
        SHARED_SHELF,
        [/SELECT permission FROM shelf_shares/, [{ permission: 'collaborator' }]],
        [BOOK_BY_ID, [catalogBook]],
        [DUPE_CHECK, []],
        [/INSERT INTO user_books/, [{ id: 503, physical_location: null, notes: null, created_at: 'now' }]],
      ],
      { authenticatedAs: 'collaborator' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('collaborator'))
      .send({ bookId: 42, bookshelfId: 7 });

    expect(res.status).toBe(201);
    // The mapping is attributed to whoever filed it, not to the shelf's owner
    const insert = sqlCalls().find((c) => /INSERT INTO user_books/.test(c.sql));
    expect(insert.params[0]).toBe(USERS.collaborator.id);
  });

  it('rejects a stranger with 403', async () => {
    mockSql(
      [
        SHARED_SHELF,
        [/SELECT permission FROM shelf_shares/, []],
        [BOOK_BY_ID, [catalogBook]],
      ],
      { authenticatedAs: 'stranger' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('stranger'))
      .send({ bookId: 42, bookshelfId: 7 });

    expect(res.status).toBe(403);
  });

  it('returns 409 when the book is already on that shelf', async () => {
    mockSql(
      [
        OWNED_SHELF,
        [BOOK_BY_ID, [catalogBook]],
        [DUPE_CHECK, [{ id: 900 }]],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 42, bookshelfId: 5 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already mapped');
    expect(sqlCalls().some((c) => /INSERT INTO user_books/.test(c.sql))).toBe(false);
  });

  it('returns 404 for a book id that is not in the catalog', async () => {
    mockSql(
      [
        OWNED_SHELF,
        [BOOK_BY_ID, []],
      ],
      { authenticatedAs: 'owner' }
    );

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 99999, bookshelfId: 5 });

    // A bare insert would surface the foreign key breach as a 500
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found in the catalog');
  });

  it('rejects a non-numeric book id with 400', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 'not-a-number', bookshelfId: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('A valid book ID is required');
  });

  it('rejects a missing bookshelf id with 400', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/file')
      .set('Cookie', authCookie('owner'))
      .send({ bookId: 42 });

    expect(res.status).toBe(400);
  });

  it('requires a session', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app).post('/api/books/file').send({ bookId: 42, bookshelfId: 5 });

    expect(res.status).toBe(401);
  });
});
