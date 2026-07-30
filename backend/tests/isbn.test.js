const { cleanISBN, isValidISBN, isValidISBN10, isValidISBN13 } = require('../src/utils/isbn');

describe('ISBN normalization (cleanISBN)', () => {
  it('strips hyphens and whitespace and upper-cases the check digit', () => {
    expect(cleanISBN('978-0-306-40615-7')).toBe('9780306406157');
    expect(cleanISBN(' 0 306 40615 x ')).toBe('030640615X');
  });

  it('returns an empty string for absent input rather than throwing', () => {
    expect(cleanISBN(null)).toBe('');
    expect(cleanISBN(undefined)).toBe('');
    expect(cleanISBN('')).toBe('');
  });
});

describe('ISBN-10 checksum validation', () => {
  it.each([
    ['0306406152', 'weighted sum divisible by 11'],
    ['080442957X', 'X check digit representing 10'],
    ['0136091814', 'standard technical title'],
  ])('accepts %s (%s)', (isbn) => {
    expect(isValidISBN10(isbn)).toBe(true);
  });

  it('rejects a single-digit transcription error', () => {
    // 0306406152 is valid; flipping the final digit must fail the checksum
    expect(isValidISBN10('0306406153')).toBe(false);
  });

  it('rejects wrong lengths and misplaced X', () => {
    expect(isValidISBN10('030640615')).toBe(false);
    expect(isValidISBN10('03064061521')).toBe(false);
    expect(isValidISBN10('03X6406152')).toBe(false);
  });
});

describe('ISBN-13 checksum validation', () => {
  it.each([
    ['9780306406157', 'canonical ISBN-13 example'],
    ['9781861972712', 'check digit 2'],
    ['9780132350884', 'check digit 4'],
  ])('accepts %s (%s)', (isbn) => {
    expect(isValidISBN13(isbn)).toBe(true);
  });

  it('rejects a transposition error that preserves length', () => {
    expect(isValidISBN13('9780306406158')).toBe(false);
  });

  it('rejects a non-book EAN-13 whose checksum is valid', () => {
    // 4006381333931 is a real product barcode with a correct EAN-13 check digit.
    // Only the missing 978/979 Bookland prefix separates it from an ISBN.
    expect(isValidISBN13('4006381333931')).toBe(false);
  });

  it('accepts the 979 Bookland prefix, not just 978', () => {
    expect(isValidISBN13('9791234567896')).toBe(true);
  });

  it('rejects non-numeric and short input', () => {
    expect(isValidISBN13('978030640615X')).toBe(false);
    expect(isValidISBN13('978030640615')).toBe(false);
  });
});

describe('isValidISBN accepts either form and normalizes first', () => {
  it('validates hyphenated input of both lengths', () => {
    expect(isValidISBN('978-0-306-40615-7')).toBe(true);
    expect(isValidISBN('0-8044-2957-X')).toBe(true);
  });

  it('rejects arbitrary strings', () => {
    expect(isValidISBN('not-a-barcode')).toBe(false);
    expect(isValidISBN('')).toBe(false);
    expect(isValidISBN(null)).toBe(false);
  });
});
