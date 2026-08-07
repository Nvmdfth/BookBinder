/**
 * ISBN normalization and checksum validation (Req 4.1.3)
 *
 * Mirrors backend/src/utils/isbn.js. The scanner uses this to gate its success
 * signals: a decoded barcode that is not a valid ISBN must not trigger the
 * vibration/tone, since those signals tell the user "captured" without them
 * needing to look at the screen.
 */

/**
 * Strip separators and normalize casing. ISBN-10 may end in 'X' as its check digit.
 */
export function cleanISBN(isbn) {
  if (!isbn) return '';
  return String(isbn).replace(/[-\s]/g, '').toUpperCase().trim();
}

/**
 * Validate an ISBN-10 checksum: sum of digit * weight (10..1) must be divisible by 11.
 */
export function isValidISBN10(isbn) {
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
 * a grocery product barcode can satisfy the checksum perfectly well, and the
 * scanner must not signal success for one.
 */
export function isValidISBN13(isbn) {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;

  return check === Number(isbn[12]);
}

/**
 * Reduce a scan to the UPC-A digits as printed.
 *
 * Decoders disagree about UPC-A: some report the 12 printed digits, others the
 * EAN-13 equivalent with a leading zero. Both denote the same product code, so
 * the zero is dropped before anything else looks at the number — otherwise the
 * scanner silently ignores half the paperbacks it is pointed at. ISBN-13 is
 * unaffected: Bookland is a 978/979 prefix, never a leading zero.
 */
export function stripEanPrefix(code) {
  const str = String(code || '').trim();
  return /^0\d{12}(\d{5})?$/.test(str) ? str.slice(1) : str;
}

/**
 * Validate a 12-digit UPC-A barcode (or 17-digit UPC-A + 5-digit extension),
 * in either the bare or the leading-zero EAN-13 form.
 */
export function isValidUPC(code) {
  if (!code) return false;
  const str = stripEanPrefix(code);
  if (!/^\d{12}(\d{5})?$/.test(str)) return false;

  const upc12 = str.slice(0, 12);
  if (/^(\d)\1+$/.test(upc12)) return false;

  let oddSum = 0;
  let evenSum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = Number(upc12[i]);
    if (i % 2 === 0) {
      oddSum += digit;
    } else {
      evenSum += digit;
    }
  }
  const check = (10 - ((oddSum * 3 + evenSum) % 10)) % 10;
  return check === Number(upc12[11]);
}

/**
 * The 12-digit core of a UPC-A scan, or null if the code is not a UPC.
 *
 * A paperback's UPC is followed by a 5-digit price add-on that changes between
 * printings, so only the core identifies the edition.
 */
export function upcCore(code) {
  const cleaned = stripEanPrefix(cleanISBN(code));
  return isValidUPC(cleaned) ? cleaned.slice(0, 12) : null;
}

/**
 * Accept either ISBN (10 or 13) or UPC-A barcode.
 */
export function isValidBarcode(code) {
  const cleaned = cleanISBN(code);
  return isValidISBN10(cleaned) || isValidISBN13(cleaned) || isValidUPC(cleaned);
}

/**
 * Accept either ISBN form. Input may be raw (hyphenated/spaced) — it is cleaned first.
 */
export function isValidISBN(isbn) {
  const cleaned = cleanISBN(isbn);
  return isValidISBN10(cleaned) || isValidISBN13(cleaned);
}
