/**
 * GET /api/bookshelves — the accession figures the dashboard is built on.
 *
 * The redesigned dashboard reads its whole "Accession Record" panel (volumes,
 * percentage read, filed this month) and every shelf card's spine strip off
 * this one response. The counts therefore have to arrive with the listing
 * rather than being fanned out into a request per shelf.
 */
const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');

const SHELF_LISTING = /FROM bookshelves b JOIN users u/;

function shelfRow(overrides = {}) {
  return {
    id: 1,
    name: 'Study · Oak Case',
    description: 'Four rows behind the desk.',
    created_at: '2026-01-04T10:00:00.000Z',
    role: 'owner',
    owner_email: 'owner@library.com',
    is_wishlist: false,
    book_count: 204,
    read_count: 131,
    filed_this_month: 7,
    ...overrides,
  };
}

describe('Bookshelf listing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('projects the accession counts alongside each shelf', async () => {
    mockSql([[SHELF_LISTING, [shelfRow()]]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .get('/api/bookshelves')
      .set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      book_count: 204,
      read_count: 131,
      filed_this_month: 7,
    });
  });

  it('counts owned and shared shelves in a single round trip', async () => {
    mockSql([[SHELF_LISTING, [shelfRow(), shelfRow({ id: 6, role: 'view' })]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/bookshelves').set('Cookie', authCookie('owner'));

    // One statement for the listing; the auth middleware's user lookup is the
    // only other query the request is allowed to make.
    const listings = sqlCalls().filter((c) => SHELF_LISTING.test(c.sql));
    expect(listings).toHaveLength(1);

    const [{ sql }] = listings;
    // Both arms of the UNION must carry the counts, or a shared shelf's card
    // renders an empty spine strip while an owned one does not.
    expect(sql.match(/AS book_count/g)).toHaveLength(2);
    expect(sql.match(/AS read_count/g)).toHaveLength(2);
    expect(sql.match(/AS filed_this_month/g)).toHaveLength(2);
  });

  it('scopes "filed this month" to the current calendar month', async () => {
    mockSql([[SHELF_LISTING, [shelfRow()]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/bookshelves').set('Cookie', authCookie('owner'));

    const [{ sql }] = sqlCalls().filter((c) => SHELF_LISTING.test(c.sql));
    expect(sql).toMatch(/date_trunc\('month', CURRENT_TIMESTAMP\)/);
  });

  it('returns counts as numbers, not the strings COUNT would otherwise yield', async () => {
    // node-postgres hands back bigint as a string; the dashboard sums these, so
    // an uncast count would concatenate instead of add.
    mockSql([[SHELF_LISTING, [shelfRow()]]], { authenticatedAs: 'owner' });

    await request(app).get('/api/bookshelves').set('Cookie', authCookie('owner'));

    const [{ sql }] = sqlCalls().filter((c) => SHELF_LISTING.test(c.sql));
    expect(sql.match(/\)::int AS/g)).toHaveLength(6);
  });
});
