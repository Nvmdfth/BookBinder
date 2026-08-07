const request = require('supertest');
const { app, mockSql, sqlCalls, authCookie } = require('./helpers/testApp');
const { isValidUPC, isValidBarcode, upcCore } = require('../src/utils/isbn');

/**
 * A book's UPC-A cannot be resolved by either configured metadata provider:
 * Google Books has no `upc:` search qualifier, and OpenLibrary's whole index
 * carries UPC identifiers on two editions. Querying them for a UPC therefore
 * costs four sequential round trips and returns nothing — so a UPC that is not
 * already known locally must fail immediately and be learned from the manual
 * form instead (Req 4.1.3).
 */
/** Shelf 5 is owned by user 1 (the 'owner' fixture), reached without a share row. */
const SHELF_ACCESS = [
  [
    /SELECT b.id, b.user_id, b.name, u.is_disabled AS owner_disabled/,
    [{ id: 5, user_id: 1, name: 'Basement Tubs', owner_disabled: false }],
  ],
];

describe('UPC Barcode Validation & Lookup', () => {
  const UPC = '070993005993';
  const UPC_WITH_PRICE = '07099300599340187';

  /** Guard: nothing in the UPC path may reach the network. */
  let fetchSpy;
  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(() => {
      throw new Error('External fetch must not be attempted for a UPC barcode');
    });
  });
  afterEach(() => {
    fetchSpy.mockRestore();
  });

  const catalogBook = {
    id: 1,
    isbn: '0446401870',
    title: 'Mucho Mojo',
    author: 'Joe R. Lansdale',
    publisher: 'Mysterious Press',
    cover_image_url: null,
    page_count: 308,
    publication_date: '1995',
  };

  describe('isValidUPC', () => {
    it('returns true for a valid 12-digit UPC-A barcode', () => {
      expect(isValidUPC(UPC)).toBe(true);
    });

    it('returns true for a valid 17-digit UPC-A + 5-digit extension barcode', () => {
      expect(isValidUPC(UPC_WITH_PRICE)).toBe(true);
    });

    it('returns false for an invalid UPC check digit', () => {
      expect(isValidUPC('070993005994')).toBe(false);
    });

    it('returns false for short or malformed numbers', () => {
      expect(isValidUPC('12345')).toBe(false);
      expect(isValidUPC('')).toBe(false);
      expect(isValidUPC(null)).toBe(false);
    });
  });

  describe('UPC-A reported in EAN-13 form', () => {
    /*
     * Decoders disagree about UPC-A: some hand back the 12 printed digits,
     * others the EAN-13 equivalent with a leading zero. Both denote the same
     * product code, and rejecting the second form means a scan where nothing
     * happens at all — no overlay, no beep, the camera simply keeps looking.
     */
    const EAN_FORM = `0${UPC}`;

    it('accepts a UPC-A carrying its leading EAN zero', () => {
      expect(isValidUPC(EAN_FORM)).toBe(true);
    });

    it('resolves both forms to the same 12-digit core', () => {
      expect(upcCore(EAN_FORM)).toBe(UPC);
      expect(upcCore(`0${UPC_WITH_PRICE}`)).toBe(UPC);
    });

    it('still rejects a 13-digit code that is not a valid UPC underneath', () => {
      expect(isValidUPC('0070993005994')).toBe(false);
    });

    it('leaves ISBN-13 alone, which is a distinct 978/979 prefix', () => {
      expect(isValidUPC('9780446401876')).toBe(false);
      expect(upcCore('9780446401876')).toBeNull();
      expect(isValidBarcode('9780446401876')).toBe(true);
    });
  });

  describe('upcCore', () => {
    it('returns the 12-digit core of a bare UPC', () => {
      expect(upcCore(UPC)).toBe(UPC);
    });

    it('strips the 5-digit price extension, which varies between printings', () => {
      expect(upcCore(UPC_WITH_PRICE)).toBe(UPC);
    });

    it('returns null for ISBNs and junk', () => {
      expect(upcCore('9780446401876')).toBeNull();
      expect(upcCore('0446401870')).toBeNull();
      expect(upcCore('nonsense')).toBeNull();
    });
  });

  describe('isValidBarcode', () => {
    it('accepts ISBN-10, ISBN-13, and UPC-A barcodes', () => {
      expect(isValidBarcode('0-446-40187-0')).toBe(true);
      expect(isValidBarcode('978-0446401876')).toBe(true);
      expect(isValidBarcode(UPC)).toBe(true);
    });

    it('rejects invalid product barcodes', () => {
      expect(isValidBarcode('000000000000')).toBe(false);
      expect(isValidBarcode('NOTABARCODE')).toBe(false);
    });
  });

  describe('GET /api/books/lookup/:isbn with UPC parameter', () => {
    it('resolves a UPC that has been learned against a catalog book', async () => {
      mockSql(
        [
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/JOIN book_barcodes/, [catalogBook]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .get(`/api/books/lookup/${UPC}`)
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Mucho Mojo');

      const aliasCall = sqlCalls().find((c) => /JOIN book_barcodes/.test(c.sql));
      expect(aliasCall.params).toEqual([UPC]);
    });

    it('matches on the 12-digit core when the scan carries a price extension', async () => {
      mockSql(
        [
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/JOIN book_barcodes/, [catalogBook]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .get(`/api/books/lookup/${UPC_WITH_PRICE}`)
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(200);
      const aliasCall = sqlCalls().find((c) => /JOIN book_barcodes/.test(c.sql));
      expect(aliasCall.params).toEqual([UPC]);
    });

    it('falls back to manual immediately for an unknown UPC, without any external call', async () => {
      mockSql(
        [
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/JOIN book_barcodes/, []],
        ],
        { authenticatedAs: 'owner' }
      );

      const started = Date.now();
      const res = await request(app)
        .get(`/api/books/lookup/${UPC}`)
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(404);
      expect(res.body.fallbackToManual).toBe(true);
      expect(res.body.barcodeType).toBe('upc');
      expect(res.body.barcode).toBe(UPC);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Regression guard: the previous implementation burned up to 12s here.
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('rejects invalid barcode parameters with 400', async () => {
      mockSql([], { authenticatedAs: 'owner' });

      const res = await request(app)
        .get('/api/books/lookup/INVALIDBARCODE')
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('A valid ISBN-10, ISBN-13, or UPC-A parameter is required');
    });

    it('probes the catalog by exact indexed ISBN, never a substring scan', async () => {
      mockSql(
        [[/SELECT \* FROM books WHERE isbn = \$1$/, [catalogBook]]],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .get('/api/books/lookup/9780446401876')
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(200);
      const probe = sqlCalls().find((c) => /SELECT \* FROM books WHERE isbn/.test(c.sql));
      // A non-sargable OR/substring predicate defeats the UNIQUE index on books.isbn
      expect(probe.sql).not.toMatch(/substring/i);
      expect(probe.sql).not.toMatch(/\bOR\b/i);
    });
  });

  describe('POST /api/books/scan/:isbn with UPC parameter', () => {
    const shelfAccess = SHELF_ACCESS;

    it('files a book whose UPC has already been learned', async () => {
      mockSql(
        [
          ...shelfAccess,
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/JOIN book_barcodes/, [catalogBook]],
          [/SELECT id FROM user_books WHERE bookshelf_id/, []],
          [/INSERT INTO user_books/, [{ id: 77, physical_location: null, notes: null, created_at: 'now' }]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .post(`/api/books/scan/${UPC}`)
        .set('Cookie', authCookie('owner'))
        .send({ bookshelfId: 5 });

      expect(res.status).toBe(201);
      expect(res.body.book.title).toBe('Mucho Mojo');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('falls back to manual immediately for an unknown UPC, without any external call', async () => {
      mockSql(
        [
          ...shelfAccess,
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/JOIN book_barcodes/, []],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .post(`/api/books/scan/${UPC}`)
        .set('Cookie', authCookie('owner'))
        .send({ bookshelfId: 5 });

      expect(res.status).toBe(404);
      expect(res.body.fallbackToManual).toBe(true);
      expect(res.body.barcodeType).toBe('upc');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/books/manual learns the scanned UPC', () => {
    const shelfAccess = SHELF_ACCESS;

    it('records the scanned barcode against the book so the next scan resolves locally', async () => {
      mockSql(
        [
          ...shelfAccess,
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/INSERT INTO books/, [catalogBook]],
          [/INSERT INTO book_barcodes/, []],
          [/SELECT id FROM user_books WHERE bookshelf_id/, []],
          [/INSERT INTO user_books/, [{ id: 78, physical_location: null, notes: null, created_at: 'now' }]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .post('/api/books/manual')
        .set('Cookie', authCookie('owner'))
        .send({
          bookshelfId: 5,
          isbn: '0446401870',
          title: 'Mucho Mojo',
          scannedBarcode: UPC_WITH_PRICE,
        });

      expect(res.status).toBe(201);

      const aliasInsert = sqlCalls().find((c) => /INSERT INTO book_barcodes/.test(c.sql));
      expect(aliasInsert).toBeDefined();
      // Stored on the 12-digit core so a reprint with a different price sticker still matches
      expect(aliasInsert.params).toEqual([UPC, catalogBook.id]);
    });

    it('does not record an alias when the entry carries no scanned barcode', async () => {
      mockSql(
        [
          ...shelfAccess,
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/INSERT INTO books/, [catalogBook]],
          [/SELECT id FROM user_books WHERE bookshelf_id/, []],
          [/INSERT INTO user_books/, [{ id: 79, physical_location: null, notes: null, created_at: 'now' }]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .post('/api/books/manual')
        .set('Cookie', authCookie('owner'))
        .send({ bookshelfId: 5, isbn: '0446401870', title: 'Mucho Mojo' });

      expect(res.status).toBe(201);
      expect(sqlCalls().some((c) => /INSERT INTO book_barcodes/.test(c.sql))).toBe(false);
    });

    it('ignores a scanned barcode that is an ISBN rather than a UPC', async () => {
      mockSql(
        [
          ...shelfAccess,
          [/SELECT \* FROM books WHERE isbn = \$1$/, []],
          [/INSERT INTO books/, [catalogBook]],
          [/SELECT id FROM user_books WHERE bookshelf_id/, []],
          [/INSERT INTO user_books/, [{ id: 80, physical_location: null, notes: null, created_at: 'now' }]],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .post('/api/books/manual')
        .set('Cookie', authCookie('owner'))
        .send({
          bookshelfId: 5,
          isbn: '0446401870',
          title: 'Mucho Mojo',
          scannedBarcode: '9780446401876',
        });

      expect(res.status).toBe(201);
      expect(sqlCalls().some((c) => /INSERT INTO book_barcodes/.test(c.sql))).toBe(false);
    });
  });
});
