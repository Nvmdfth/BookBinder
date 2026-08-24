/**
 * Cover URLs arrive from Google Books as plain http://.
 *
 * The app is served over https behind a tunnel, and a browser blocks an http
 * image on an https page as mixed content — so every Google-sourced cover was
 * invisible in production while rendering perfectly on http://localhost, which
 * is why it went unnoticed. These assertions pin the upgrade.
 */
const { normalizeCoverUrl } = require('../src/utils/coverUrl');

describe('normalizeCoverUrl', () => {
  it('upgrades an http Google Books thumbnail to https', () => {
    expect(
      normalizeCoverUrl('http://books.google.com/books/content?id=abc&img=1')
    ).toBe('https://books.google.com/books/content?id=abc&img=1');
  });

  it('leaves an https URL untouched', () => {
    const url = 'https://covers.openlibrary.org/b/id/123-L.jpg';
    expect(normalizeCoverUrl(url)).toBe(url);
  });

  it('upgrades only the scheme, never an http:// appearing later in the URL', () => {
    expect(
      normalizeCoverUrl('http://example.com/img?next=http://elsewhere.test/x')
    ).toBe('https://example.com/img?next=http://elsewhere.test/x');
  });

  it('passes through a protocol-relative URL, which already inherits https', () => {
    expect(normalizeCoverUrl('//covers.example.com/a.jpg')).toBe('//covers.example.com/a.jpg');
  });

  it('passes through a same-origin path, used by locally stored covers', () => {
    expect(normalizeCoverUrl('/uploads/covers/a.jpg')).toBe('/uploads/covers/a.jpg');
  });

  it.each([null, undefined, ''])('returns null for %p, since the column is nullable', (input) => {
    expect(normalizeCoverUrl(input)).toBeNull();
  });

  it('returns null for a non-string, so a malformed provider payload cannot poison the row', () => {
    expect(normalizeCoverUrl({ url: 'http://x.test/a.jpg' })).toBeNull();
  });
});
