/**
 * Authorization matrix coverage for the social sharing pipeline (PRD 3.2.2, 4.3).
 *
 * The rule under test: a shelf is reachable only by its owner or by an explicit
 * shelf_shares row, and 'view' scope must be blocked from every mutation at the
 * routing layer — not merely hidden in the UI (Req 4.3.2).
 */
const request = require('supertest');
const { app, mockSql, authCookie } = require('./helpers/testApp');

const SHELF_LOOKUP = /SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled/;
const SHARE_LOOKUP = /SELECT permission FROM shelf_shares WHERE bookshelf_id = \$1 AND shared_with_user_id = \$2/;
const SHELF_DETAILS = /SELECT b.id, b.name, b.description, b.created_at, u.email AS owner_email, u.id AS owner_id/;
const SHELF_BOOKS = /FROM user_books ub JOIN books b ON ub.book_id = b.id WHERE ub.bookshelf_id/;
const MAPPING_LOOKUP = /SELECT bookshelf_id, book_id, physical_location, notes, is_read FROM user_books WHERE id/;
const MAPPING_DELETE_LOOKUP = /SELECT bookshelf_id, book_id FROM user_books WHERE id/;
const UPDATE_MAPPING = /UPDATE user_books SET physical_location/;
const DELETE_MAPPING = /DELETE FROM user_books WHERE id/;
const UPDATE_SHELF = /UPDATE bookshelves SET name/;
const WISHLIST_FLAG = /SELECT is_wishlist FROM bookshelves WHERE id/;
const SHARES_LIST = /FROM shelf_shares s JOIN users u ON s.shared_with_user_id = u.id/;
const INSERT_SHARE = /INSERT INTO shelf_shares/;
const USER_BY_EMAIL = /SELECT id FROM users WHERE email/;
const SHARE_DUP_CHECK = /SELECT id FROM shelf_shares WHERE bookshelf_id = \$1 AND shared_with_user_id = \$2/;

/** Shelf 100 is owned by user 1 (the 'owner' fixture). */
const shelfOwnedByOwner = [{ id: 100, user_id: 1, name: 'Basement Tubs', owner_disabled: false }];

/** Handlers for a shelf that user X reaches through a share of the given scope. */
function sharedShelf(permission) {
  return [
    [SHELF_LOOKUP, shelfOwnedByOwner],
    [SHARE_LOOKUP, permission ? [{ permission }] : []],
  ];
}

describe('GET /api/bookshelves/:id read access (Req 4.3.1)', () => {
  const readHandlers = [
    [SHELF_DETAILS, [{ id: 100, name: 'Basement Tubs', description: null, created_at: null, owner_email: 'owner@library.com', owner_id: 1, is_wishlist: false }]],
    [SHELF_BOOKS, [{ mapping_id: 7, book_id: 3, title: 'Dune', physical_location: 'Plastic tub under workbench' }]],
  ];

  it('lets the owner read their own shelf', async () => {
    mockSql([[SHELF_LOOKUP, shelfOwnedByOwner], ...readHandlers], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/bookshelves/100').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    expect(res.body.accessRole).toBe('owner');
    expect(res.body.isOwner).toBe(true);
  });

  it('lets a view-scope recipient read the shelf and its location annotations', async () => {
    mockSql([...sharedShelf('view'), ...readHandlers], { authenticatedAs: 'viewer' });

    const res = await request(app).get('/api/bookshelves/100').set('Cookie', authCookie('viewer'));

    expect(res.status).toBe(200);
    expect(res.body.accessRole).toBe('view');
    expect(res.body.isOwner).toBe(false);
    // Req 4.3.2 explicitly grants viewers the physical location text
    expect(res.body.books[0].physical_location).toBe('Plastic tub under workbench');
  });

  it('returns 403 for a user with no ownership and no share row', async () => {
    mockSql(sharedShelf(null), { authenticatedAs: 'stranger' });

    const res = await request(app).get('/api/bookshelves/100').set('Cookie', authCookie('stranger'));

    expect(res.status).toBe(403);
  });

  it('returns 404 for a shelf that does not exist', async () => {
    mockSql([[SHELF_LOOKUP, []]], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/bookshelves/999').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(404);
  });

  it('rejects a non-numeric shelf id before touching the database', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/bookshelves/not-an-id').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(400);
  });

  it('denies share recipients once the shelf owner is disabled', async () => {
    mockSql([
      [SHELF_LOOKUP, [{ id: 100, user_id: 1, name: 'Basement Tubs', owner_disabled: true }]],
      [SHARE_LOOKUP, [{ permission: 'collaborator' }]],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app).get('/api/bookshelves/100').set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it('requires an authenticated session', async () => {
    mockSql([]);

    const res = await request(app).get('/api/bookshelves/100');

    expect(res.status).toBe(401);
  });
});

describe('View-only scope is blocked at the routing layer (Req 4.3.2)', () => {
  it('rejects an annotation update from a view-scope user', async () => {
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: 'Shelf A', notes: null, is_read: false }]],
      ...sharedShelf('view'),
    ], { authenticatedAs: 'viewer' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('viewer'))
      .send({ physicalLocation: 'Moved by an unauthorized viewer' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/collaborator/i);
  });

  it('does not issue the UPDATE statement when the viewer is rejected', async () => {
    const { sqlCalls } = require('./helpers/testApp');
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: 'Shelf A', notes: null, is_read: false }]],
      ...sharedShelf('view'),
    ], { authenticatedAs: 'viewer' });

    await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('viewer'))
      .send({ physicalLocation: 'nope' });

    expect(sqlCalls().some((c) => UPDATE_MAPPING.test(c.sql))).toBe(false);
  });

  it('rejects a book removal from a view-scope user', async () => {
    mockSql([
      [MAPPING_DELETE_LOOKUP, [{ bookshelf_id: 100, book_id: 3 }]],
      ...sharedShelf('view'),
    ], { authenticatedAs: 'viewer' });

    const res = await request(app)
      .post('/api/books/mapping/7/delete')
      .set('Cookie', authCookie('viewer'));

    expect(res.status).toBe(403);
  });

  it('rejects a manual book creation into a view-scope shelf', async () => {
    mockSql(sharedShelf('view'), { authenticatedAs: 'viewer' });

    const res = await request(app)
      .post('/api/books/manual')
      .set('Cookie', authCookie('viewer'))
      .send({ bookshelfId: 100, title: 'Smuggled Title' });

    expect(res.status).toBe(403);
  });

  it('rejects a scan ingestion into a view-scope shelf', async () => {
    mockSql(sharedShelf('view'), { authenticatedAs: 'viewer' });

    const res = await request(app)
      .post('/api/books/scan/9780306406157')
      .set('Cookie', authCookie('viewer'))
      .send({ bookshelfId: 100 });

    expect(res.status).toBe(403);
  });

  it('rejects a shelf rename from a view-scope user', async () => {
    mockSql(sharedShelf('view'), { authenticatedAs: 'viewer' });

    const res = await request(app)
      .put('/api/bookshelves/100')
      .set('Cookie', authCookie('viewer'))
      .send({ name: 'Renamed by viewer' });

    expect(res.status).toBe(403);
  });
});

describe('Collaborator scope grants writes but not ownership (Req 4.3.3)', () => {
  it('allows a collaborator to update the physical location text', async () => {
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: 'Shelf A', notes: null, is_read: false }]],
      ...sharedShelf('collaborator'),
      [UPDATE_MAPPING, [{ id: 7, physical_location: 'East wall stack, behind the desk', notes: null, is_read: false, bookshelf_id: 100, book_id: 3 }]],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ physicalLocation: 'East wall stack, behind the desk' });

    expect(res.status).toBe(200);
    expect(res.body.mapping.physical_location).toBe('East wall stack, behind the desk');
  });

  it('preserves unspecified fields instead of nulling them', async () => {
    let updateParams = null;
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: 'Keep me', notes: 'Keep these notes', is_read: true }]],
      ...sharedShelf('collaborator'),
      [UPDATE_MAPPING, (params) => { updateParams = params; return [{ id: 7 }]; }],
    ], { authenticatedAs: 'collaborator' });

    // Only is_read is supplied; location and notes must survive untouched
    await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ isRead: false });

    expect(updateParams[0]).toBe('Keep me');
    expect(updateParams[1]).toBe('Keep these notes');
    expect(updateParams[2]).toBe(false);
  });

  it('accepts freeform unstructured location text (Req 4.2.3)', async () => {
    const freeform = 'Plastic storage tub under the basement workbench, behind the paint cans';
    let updateParams = null;
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: null, notes: null, is_read: false }]],
      ...sharedShelf('collaborator'),
      [UPDATE_MAPPING, (params) => { updateParams = params; return [{ id: 7 }]; }],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ physicalLocation: freeform });

    expect(res.status).toBe(200);
    expect(updateParams[0]).toBe(freeform);
  });

  it('allows a collaborator to remove a book', async () => {
    mockSql([
      [MAPPING_DELETE_LOOKUP, [{ bookshelf_id: 100, book_id: 3 }]],
      ...sharedShelf('collaborator'),
      [DELETE_MAPPING, []],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .post('/api/books/mapping/7/delete')
      .set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(200);
  });

  it('still refuses to let a collaborator rename the shelf (owner-only)', async () => {
    mockSql(sharedShelf('collaborator'), { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/bookshelves/100')
      .set('Cookie', authCookie('collaborator'))
      .send({ name: 'Collaborator rename attempt' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);
  });

  it('refuses to let a collaborator delete the shelf', async () => {
    mockSql(sharedShelf('collaborator'), { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .post('/api/bookshelves/100/delete')
      .set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(403);
  });

  it('refuses to let a collaborator manage the share list', async () => {
    mockSql(sharedShelf('collaborator'), { authenticatedAs: 'collaborator' });

    const res = await request(app).get('/api/shares/100').set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(403);
  });
});

describe('Cross-shelf reassignment checks the destination shelf', () => {
  const TARGET_ACCESS = /SELECT 'owner' AS role FROM bookshelves WHERE id = \$1 AND user_id = \$2/;
  const TARGET_DUP = /SELECT id FROM user_books WHERE bookshelf_id = \$1 AND book_id = \$2/;

  it('rejects a move into a shelf the user cannot write to', async () => {
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: null, notes: null, is_read: false }]],
      ...sharedShelf('collaborator'),
      [TARGET_ACCESS, []],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ targetBookshelfId: 555 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/destination/i);
  });

  it('rejects a move that would duplicate the book in the destination', async () => {
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: null, notes: null, is_read: false }]],
      ...sharedShelf('collaborator'),
      [TARGET_ACCESS, [{ role: 'owner' }]],
      [TARGET_DUP, [{ id: 42 }]],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ targetBookshelfId: 555 });

    expect(res.status).toBe(409);
  });

  it('writes the new bookshelf id when the destination is writable and free', async () => {
    let updateParams = null;
    mockSql([
      [MAPPING_LOOKUP, [{ bookshelf_id: 100, book_id: 3, physical_location: null, notes: null, is_read: false }]],
      ...sharedShelf('collaborator'),
      [TARGET_ACCESS, [{ role: 'collaborator' }]],
      [TARGET_DUP, []],
      [UPDATE_MAPPING, (params) => { updateParams = params; return [{ id: 7, bookshelf_id: 555 }]; }],
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app)
      .put('/api/books/mapping/7')
      .set('Cookie', authCookie('collaborator'))
      .send({ targetBookshelfId: 555 });

    expect(res.status).toBe(200);
    expect(updateParams[3]).toBe(555);
  });
});

describe('Share management is owner-only (Req 4.3)', () => {
  it('lists shares for the owner', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [SHARES_LIST, [{ id: 1, bookshelf_id: 100, user_id: 3, email: 'viewer@library.com', permission: 'view' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app).get('/api/shares/100').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(200);
    expect(res.body[0].permission).toBe('view');
  });

  it('rejects an unrecognized permission scope', async () => {
    mockSql([], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/shares/100')
      .set('Cookie', authCookie('owner'))
      .send({ email: 'viewer@library.com', permission: 'superuser' });

    expect(res.status).toBe(400);
  });

  it('refuses to share a shelf with its own owner', async () => {
    mockSql([[SHELF_LOOKUP, shelfOwnedByOwner]], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/shares/100')
      .set('Cookie', authCookie('owner'))
      .send({ email: 'owner@library.com', permission: 'view' });

    expect(res.status).toBe(400);
  });

  it('reports 404 when the invited email has no account', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [USER_BY_EMAIL, []],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/shares/100')
      .set('Cookie', authCookie('owner'))
      .send({ email: 'ghost@library.com', permission: 'view' });

    expect(res.status).toBe(404);
  });

  it('creates a collaborator share for a registered recipient', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [USER_BY_EMAIL, [{ id: 2 }]],
      [SHARE_DUP_CHECK, []],
      [INSERT_SHARE, [{ id: 5, bookshelf_id: 100, shared_with_user_id: 2, permission: 'collaborator' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/shares/100')
      .set('Cookie', authCookie('owner'))
      .send({ email: 'collab@library.com', permission: 'collaborator' });

    expect(res.status).toBe(201);
    expect(res.body.share.permission).toBe('collaborator');
  });

  it('upgrades an existing share in place rather than erroring', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [USER_BY_EMAIL, [{ id: 3 }]],
      [SHARE_DUP_CHECK, [{ id: 5 }]],
      [/UPDATE shelf_shares SET permission/, [{ id: 5, bookshelf_id: 100, shared_with_user_id: 3, permission: 'collaborator' }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .post('/api/shares/100')
      .set('Cookie', authCookie('owner'))
      .send({ email: 'viewer@library.com', permission: 'collaborator' });

    expect(res.status).toBe(200);
    expect(res.body.share.permission).toBe('collaborator');
  });

  it('blocks a non-owner from revoking a share', async () => {
    mockSql([
      [/SELECT bookshelf_id FROM shelf_shares WHERE id/, [{ bookshelf_id: 100 }]],
      ...sharedShelf('collaborator'),
    ], { authenticatedAs: 'collaborator' });

    const res = await request(app).post('/api/shares/remove/5').set('Cookie', authCookie('collaborator'));

    expect(res.status).toBe(403);
  });
});

describe('Default Wishlist shelf is protected from structural edits', () => {
  it('blocks renaming the wishlist', async () => {
    mockSql([
      [SHELF_LOOKUP, [{ id: 101, user_id: 1, name: 'Wishlist', owner_disabled: false }]],
      [WISHLIST_FLAG, [{ is_wishlist: true }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .put('/api/bookshelves/101')
      .set('Cookie', authCookie('owner'))
      .send({ name: 'Renamed Wishlist' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wishlist/i);
  });

  it('blocks deleting the wishlist', async () => {
    mockSql([
      [SHELF_LOOKUP, [{ id: 101, user_id: 1, name: 'Wishlist', owner_disabled: false }]],
      [WISHLIST_FLAG, [{ is_wishlist: true }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app).post('/api/bookshelves/101/delete').set('Cookie', authCookie('owner'));

    expect(res.status).toBe(400);
  });

  it('still allows renaming an ordinary shelf', async () => {
    mockSql([
      [SHELF_LOOKUP, shelfOwnedByOwner],
      [WISHLIST_FLAG, [{ is_wishlist: false }]],
      [UPDATE_SHELF, [{ id: 100, name: 'Attic Boxes', description: null }]],
    ], { authenticatedAs: 'owner' });

    const res = await request(app)
      .put('/api/bookshelves/100')
      .set('Cookie', authCookie('owner'))
      .send({ name: 'Attic Boxes' });

    expect(res.status).toBe(200);
    expect(res.body.bookshelf.name).toBe('Attic Boxes');
  });
});
