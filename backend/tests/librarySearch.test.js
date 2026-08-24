/**
 * Global library search.
 *
 * The question this endpoint answers — "do I own this, and where is it?" — was
 * previously only answerable by scanning the physical book or opening shelves
 * one at a time. It searches across every shelf the caller can see, and returns
 * one row per *mapping* rather than per book: the same title on two shelves is
 * two copies in two places, and each needs its own location and its own way in.
 */
const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');

const SEARCH = /FROM user_books ub JOIN books bk/;

const ROW = {
  mapping_id: 7,
  book_id: 3,
  isbn: '9780441013593',
  title: 'Dune',
  author: 'Frank Herbert',
  cover_image_url: 'https://example.test/dune.jpg',
  physical_location: 'Shelf 2, left side',
  notes: null,
  is_read: true,
  bookshelf_id: 4,
  bookshelf_name: 'Living Room',
  role: 'owner',
  owner_email: 'owner@library.com',
  is_wishlist: false,
  matched_on: 'title',
};

describe('Access', () => {
  it('rejects an anonymous caller with 401', async () => {
    mockSql([]);

    const res = await request(app).get('/api/books/library-search?q=dune');

    expect(res.status).toBe(401);
  });

  it('is available to a standard user — this is not an admin tool', async () => {
    mockSql([[SEARCH, [ROW]]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .get('/api/books/library-search?q=dune')
      .set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
  });
});

describe('Query validation', () => {
  it.each([['', 'missing'], ['a', 'one character'], ['   ', 'only whitespace']])(
    'rejects %p (%s) with 400 and never touches the database',
    async (q) => {
      mockSql([], { authenticatedAs: 'owner' });

      const res = await request(app)
        .get(`/api/books/library-search?q=${encodeURIComponent(q)}`)
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(400);
      expect(sqlCalls().some((c) => SEARCH.test(c.sql))).toBe(false);
    }
  );
});

describe('Visibility', () => {
  it('scopes owned shelves to the caller and shared shelves to a share row', async () => {
    mockSql([[SEARCH, [ROW]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/books/library-search?q=dune').set('Cookie', authCookie('owner'));

    const { sql, params } = sqlCalls().find((c) => SEARCH.test(c.sql));

    // Both halves of the union must be bound to the caller: one by ownership,
    // one by an explicit share. A shelf belonging to someone else that was
    // never shared satisfies neither, which is the whole boundary.
    expect(sql).toMatch(/WHERE b\.user_id = \$1/);
    expect(sql).toMatch(/JOIN shelf_shares s ON b\.id = s\.bookshelf_id/);
    expect(sql).toMatch(/WHERE s\.shared_with_user_id = \$1/);
    expect(params[0]).toBe(1);
  });

  it('caps the result set so a one-letter-over-minimum query cannot dump the library', async () => {
    mockSql([[SEARCH, [ROW]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/books/library-search?q=du').set('Cookie', authCookie('owner'));

    expect(sqlCalls().find((c) => SEARCH.test(c.sql)).sql).toMatch(/LIMIT 50/);
  });
});

describe('Matching', () => {
  it('matches title, author, isbn, physical location and notes', async () => {
    mockSql([[SEARCH, [ROW]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/books/library-search?q=dune').set('Cookie', authCookie('owner'));

    const { sql, params } = sqlCalls().find((c) => SEARCH.test(c.sql));

    expect(sql).toMatch(/bk\.title ILIKE \$2/);
    expect(sql).toMatch(/bk\.author ILIKE \$2/);
    expect(sql).toMatch(/bk\.isbn ILIKE \$2/);
    expect(sql).toMatch(/ub\.physical_location ILIKE \$2/);
    expect(sql).toMatch(/ub\.notes ILIKE \$2/);
    expect(params[1]).toBe('%dune%');
  });

  it('reports which field matched, so a notes-only hit can explain itself', async () => {
    mockSql([[SEARCH, [{ ...ROW, notes: 'signed by the author', matched_on: 'notes' }]]], {
      authenticatedAs: 'owner',
    });

    const res = await request(app)
      .get('/api/books/library-search?q=signed')
      .set('Cookie', authCookie('owner'));

    expect(res.body.results[0].matched_on).toBe('notes');
    expect(sqlCalls().find((c) => SEARCH.test(c.sql)).sql).toMatch(/CASE WHEN bk\.title ILIKE/);
  });

  it('trims the query, so a stray space does not become part of the pattern', async () => {
    mockSql([[SEARCH, []]], { authenticatedAs: 'owner' });

    await request(app)
      .get('/api/books/library-search?q=%20dune%20')
      .set('Cookie', authCookie('owner'));

    expect(sqlCalls().find((c) => SEARCH.test(c.sql)).params[1]).toBe('%dune%');
  });
});

describe('Response shape', () => {
  it('returns each copy with the shelf it lives on and the mapping needed to open it', async () => {
    mockSql([[SEARCH, [ROW]]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .get('/api/books/library-search?q=dune')
      .set('Cookie', authCookie('owner'));

    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0]).toMatchObject({
      mapping_id: 7,
      bookshelf_id: 4,
      bookshelf_name: 'Living Room',
      physical_location: 'Shelf 2, left side',
      role: 'owner',
    });
  });

  it('returns the same title twice when two shelves each hold a copy', async () => {
    const shared = {
      ...ROW,
      mapping_id: 9,
      bookshelf_id: 8,
      bookshelf_name: "Sam's Sci-Fi",
      role: 'view',
      owner_email: 'sam@library.com',
      physical_location: 'Box 4',
    };
    mockSql([[SEARCH, [ROW, shared]]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .get('/api/books/library-search?q=dune')
      .set('Cookie', authCookie('owner'));

    expect(res.body.results.map((r) => r.mapping_id)).toEqual([7, 9]);
    expect(res.body.results.map((r) => r.bookshelf_name)).toEqual(['Living Room', "Sam's Sci-Fi"]);
  });

  it('returns an empty list rather than 404 when nothing matches', async () => {
    mockSql([[SEARCH, []]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .get('/api/books/library-search?q=zzzz')
      .set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });
});
