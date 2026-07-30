/**
 * ISBN normalization and checksum validation (Req 4.1.3)
 *
 * Barcode scanners happily decode any EAN-13 they see — including the UPC on the
 * back of a cereal box. Validating the checksum is what separates "a barcode was
 * read" from "an ISBN was read".
 */

/**
 * Strip separators and normalize casing. ISBN-10 may end in 'X' as its check digit.
 */
function cleanISBN(isbn) {
  if (!isbn) return '';
  return String(isbn).replace(/[-\s]/g, '').toUpperCase().trim();
}

/**
 * Validate an ISBN-10 checksum: sum of digit * weight (10..1) must be divisible by 11.
 */
function isValidISBN10(isbn) {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(isbn[i]) * (10 - i);
  }
  sum += isbn[9] === 'X' ? 10 : Number(isbn[9]);

  return sum % 11 === 0;
}

/**
 * Validate an ISBN-13: Bookland prefix plus an EAN-13 checksum.
 *
 * The 978/979 prefix check is what distinguishes a book from any other EAN-13 —
 * a grocery product barcode can satisfy the checksum perfectly well.
 */
function isValidISBN13(isbn) {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;

  return check === Number(isbn[12]);
}

/**
 * Accept either ISBN form. Input may be raw (hyphenated/spaced) — it is cleaned first.
 */
function isValidISBN(isbn) {
  const cleaned = cleanISBN(isbn);
  return isValidISBN10(cleaned) || isValidISBN13(cleaned);
}

module.exports = {
  cleanISBN,
  isValidISBN,
  isValidISBN10,
  isValidISBN13,
};
