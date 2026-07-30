/**
 * The scanner gates its haptic/acoustic success signal on these functions
 * (Req 4.1.3), so they must agree with the backend validator that guards ingestion.
 */
import { describe, it, expect } from 'vitest';
import { cleanISBN, isValidISBN, isValidISBN10, isValidISBN13 } from '../utils/isbn';

describe('cleanISBN', () => {
  it('normalizes separators and casing', () => {
    expect(cleanISBN('978-0-306-40615-7')).toBe('9780306406157');
    expect(cleanISBN('0 8044 2957 x')).toBe('080442957X');
  });

  it('tolerates absent input', () => {
    expect(cleanISBN(null)).toBe('');
    expect(cleanISBN(undefined)).toBe('');
  });
});

describe('isValidISBN10', () => {
  it('accepts valid check digits including X', () => {
    expect(isValidISBN10('0306406152')).toBe(true);
    expect(isValidISBN10('080442957X')).toBe(true);
  });

  it('rejects a corrupted check digit', () => {
    expect(isValidISBN10('0306406153')).toBe(false);
  });
});

describe('isValidISBN13', () => {
  it('accepts 978 and 979 Bookland prefixes', () => {
    expect(isValidISBN13('9780306406157')).toBe(true);
    expect(isValidISBN13('9791234567896')).toBe(true);
  });

  it('rejects a product EAN-13 that passes the checksum but lacks the prefix', () => {
    expect(isValidISBN13('4006381333931')).toBe(false);
  });

  it('rejects a corrupted check digit', () => {
    expect(isValidISBN13('9780306406158')).toBe(false);
  });
});

describe('isValidISBN', () => {
  it('accepts either form, hyphenated or bare', () => {
    expect(isValidISBN('978-0-306-40615-7')).toBe(true);
    expect(isValidISBN('0306406152')).toBe(true);
  });

  it('rejects arbitrary scanned text', () => {
    expect(isValidISBN('HELLO-WORLD')).toBe(false);
    expect(isValidISBN('')).toBe(false);
    expect(isValidISBN(null)).toBe(false);
  });
});
