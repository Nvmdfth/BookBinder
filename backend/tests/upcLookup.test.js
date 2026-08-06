const request = require('supertest');
const { app, mockSql, authCookie } = require('./helpers/testApp');
const { isValidUPC, isValidBarcode } = require('../src/utils/isbn');

describe('UPC Barcode Validation & Lookup', () => {
  describe('isValidUPC', () => {
    it('returns true for a valid 12-digit UPC-A barcode', () => {
      expect(isValidUPC('070993005993')).toBe(true);
    });

    it('returns true for a valid 17-digit UPC-A + 5-digit extension barcode', () => {
      expect(isValidUPC('07099300599340187')).toBe(true);
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

  describe('isValidBarcode', () => {
    it('accepts ISBN-10, ISBN-13, and UPC-A barcodes', () => {
      expect(isValidBarcode('0-446-40187-0')).toBe(true);
      expect(isValidBarcode('978-0446401876')).toBe(true);
      expect(isValidBarcode('070993005993')).toBe(true);
    });

    it('rejects invalid product barcodes', () => {
      expect(isValidBarcode('000000000000')).toBe(false);
      expect(isValidBarcode('NOTABARCODE')).toBe(false);
    });
  });

  describe('GET /api/books/lookup/:isbn with UPC parameter', () => {
    it('accepts valid 12-digit UPC barcode parameter and performs lookup', async () => {
      mockSql(
        [
          [
            /SELECT \* FROM books WHERE isbn = \$1/,
            {
              rows: [
                {
                  id: 1,
                  isbn: '0446401870',
                  title: 'Mucho Mojo',
                  author: 'Joe R. Lansdale',
                  publisher: 'Mysterious Press',
                  cover_image_url: null,
                  page_count: 308,
                  publication_date: '1995',
                },
              ],
            },
          ],
        ],
        { authenticatedAs: 'owner' }
      );

      const res = await request(app)
        .get('/api/books/lookup/070993005993')
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(200);
      expect(res.body.title).toBe('Mucho Mojo');
    });

    it('rejects invalid barcode parameters with 400', async () => {
      mockSql([], { authenticatedAs: 'owner' });

      const res = await request(app)
        .get('/api/books/lookup/INVALIDBARCODE')
        .set('Cookie', authCookie('owner'));

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('A valid ISBN-10, ISBN-13, or UPC-A parameter is required');
    });
  });
});
