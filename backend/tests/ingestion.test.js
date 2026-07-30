/**
 * Ingestion pipeline coverage (PRD 3.2.1, 4.2.1, NFR 5.3).
 *
 * The pipeline's whole purpose is to protect the external rate limit by serving
 * the global catalog first, and to map identical books back to one shared row.
 */
const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');

const SHELF_LOOKUP = /SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled/;
const BOOK_BY_ISBN = /SELECT \* FROM books WHERE isbn/;
const EXTERNAL_SETTINGS = /SELECT key, value FROM system_settings WHERE key IN \('enable_google_books', 'enable_open_library'\)/;
const INSERT_BOOK = /INSERT INTO books/;
const MAP_DUP_CHECK = /SELECT id FROM user_books WHERE bookshelf_id = \$1 AND book_id = \$2/;
const INSERT_MAPPING = /INSERT INTO user_books/;

const VALID_ISBN13 = '9780306406157';
const shelfOwnedByOwner = [{ id: 100, user_id: 1, name: 'Basement Tubs', owner_disabled: false }];

const cachedBook = {
  id: 42,
  isbn: VALID_ISBN13,
  title: 'The Cached Title',
  author: 'A. Author',
  publisher: 'Pub House',
  cover_image_url: null,
  page_count: 300,
  publication_date: '1999',
};

/** Build a fetch double that records calls and returns a Google Books payload. */
function stubFetch(payload = { totalItems: 0, items: [] }, ok = true) {
  const fn = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  });
  global.fetch = fn;
  return fn;
}

afterEach(() => {
  delete global.fetch;
});

describe('ISBN validation gates the pipeline (Req 4.1.3)', () => {
  it('rejects a barcode that fails the ISBN checksum before any lookup', async () => {
    const fetchSpy = stubFetch();
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/scan/9780306406158')
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects a valid non-book EAN-13 product barcode', async () => {
    const fetchSpy = stubFetch();
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/scan/4006381333931')
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('applies the same gate to the metadata lookup endpoint', async () => {
    const fetchSpy = stubFetch();
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/books/lookup/12345').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a hyphenated ISBN by normalizing it first', async () => {
    stubFetch();
    mockSql([[BOOK_BY_ISBN, [cachedBook]]], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/books/lookup/978-0-306-40615-7').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    // The normalized form is what reaches the query
    expect(sqlCalls().find((c) => BOOK_BY_ISBN.test(c.sql)).params[0]).toBe(VALID_ISBN13);
  });
});

describe('Cache-first ingestion (PRD 3.2.1)', () => {
  it('serves a catalog hit without calling any external API', async () => {
    const fetchSpy = stubFetch();
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, [cachedBook]],
      [MAP_DUP_CHECK, []],
      [INSERT_MAPPING, [{ id: 7, physical_location: 'Row 4', notes: null }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100, physicalLocation: 'Row 4' });

    expect(res.status).toBe(201);
    expect(res.body.book.id).toBe(42);
    // The rate-limit protection the PRD asks for
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps the existing global row instead of inserting a duplicate book (Req 4.2.1)', async () => {
    stubFetch();
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, [cachedBook]],
      [MAP_DUP_CHECK, []],
      [INSERT_MAPPING, [{ id: 8 }]],
    ], { authenticatedAs: 'owner' });

    await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(sqlCalls().some((c) => INSERT_BOOK.test(c.sql))).toBe(false);
    const mapping = sqlCalls().find((c) => INSERT_MAPPING.test(c.sql));
    expect(mapping.params).toEqual(expect.arrayContaining([42]));
  });

  it('queries the external API and caches the result on a catalog miss', async () => {
    const fetchSpy = stubFetch({
      totalItems: 1,
      items: [{ volumeInfo: { title: 'Fetched Title', authors: ['Ext Author'], publisher: 'Ext Pub', pageCount: 120 } }],
    });

    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, []],
      [EXTERNAL_SETTINGS, [{ key: 'enable_google_books', value: 'true' }, { key: 'enable_open_library', value: 'true' }]],
      [INSERT_BOOK, [{ ...cachedBook, id: 77, title: 'Fetched Title' }]],
      [MAP_DUP_CHECK, []],
      [INSERT_MAPPING, [{ id: 9 }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(201);
    expect(fetchSpy).toHaveBeenCalled();
    // Cached into the global catalog so the next user scanning it is a cache hit
    expect(sqlCalls().some((c) => INSERT_BOOK.test(c.sql))).toBe(true);
  });

  it('honours the enable_google_books switch by skipping the disabled provider', async () => {
    const fetchSpy = stubFetch({ totalItems: 0 });
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, []],
      [EXTERNAL_SETTINGS, [{ key: 'enable_google_books', value: 'false' }, { key: 'enable_open_library', value: 'false' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(404);
    expect(res.body.fallbackToManual).toBe(true);
  });

  it('falls back to manual entry when no provider resolves the ISBN (NFR 5.3)', async () => {
    stubFetch({ totalItems: 0, items: [] });
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, []],
      [EXTERNAL_SETTINGS, [{ key: 'enable_google_books', value: 'true' }, { key: 'enable_open_library', value: 'true' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ fallbackToManual: true, isbn: VALID_ISBN13 });
  });

  it('degrades to manual entry when the provider throws rather than 500ing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, []],
      [EXTERNAL_SETTINGS, [{ key: 'enable_google_books', value: 'true' }, { key: 'enable_open_library', value: 'true' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(404);
    expect(res.body.fallbackToManual).toBe(true);
  });

  it('rejects a second copy of the same book on one shelf with 409', async () => {
    stubFetch();
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, [cachedBook]],
      [MAP_DUP_CHECK, [{ id: 7 }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(409);
    expect(sqlCalls().some((c) => INSERT_MAPPING.test(c.sql))).toBe(false);
  });

  it('requires a bookshelf target for the scan', async () => {
    stubFetch();
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post(`/api/books/scan/${VALID_ISBN13}`)
      .set('Cookie', authCookie('owner'))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('Manual entry path (fallback layout)', () => {
  it('requires a title', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/manual')
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100, author: 'No Title Given' });

    expect(res.status).toBe(400);
  });

  it('reuses an existing catalog row when the ISBN already exists', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [BOOK_BY_ISBN, [cachedBook]],
      [/UPDATE books SET title = COALESCE/, []],
      [MAP_DUP_CHECK, []],
      [INSERT_MAPPING, [{ id: 10 }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/manual')
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100, isbn: VALID_ISBN13, title: 'The Cached Title' });

    expect(res.status).toBe(201);
    expect(sqlCalls().some((c) => INSERT_BOOK.test(c.sql))).toBe(false);
  });

  it('creates a catalog row with a synthetic identifier when no ISBN is supplied', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [INSERT_BOOK, [{ id: 88, isbn: 'MANUAL-1', title: 'Handwritten Journal' }]],
      [MAP_DUP_CHECK, []],
      [INSERT_MAPPING, [{ id: 11 }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/books/manual')
      .set('Cookie', authCookie('owner'))
      .send({ bookshelfId: 100, title: 'Handwritten Journal' });

    expect(res.status).toBe(201);
    const insert = sqlCalls().find((c) => INSERT_BOOK.test(c.sql));
    expect(insert.params[0]).toMatch(/^MANUAL-/);
  });
});
