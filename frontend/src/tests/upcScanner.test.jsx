import { describe, it, expect } from 'vitest';
import { isValidUPC, isValidBarcode } from '../utils/isbn';

describe('Frontend UPC Barcode Validation', () => {
  it('validates 12-digit UPC-A codes', () => {
    expect(isValidUPC('070993005993')).toBe(true);
    expect(isValidUPC('070993005994')).toBe(false);
  });

  it('validates 17-digit UPC-A + extension codes', () => {
    expect(isValidUPC('07099300599340187')).toBe(true);
  });

  it('isValidBarcode accepts ISBNs and UPCs', () => {
    expect(isValidBarcode('0446401870')).toBe(true);
    expect(isValidBarcode('9780446401876')).toBe(true);
    expect(isValidBarcode('070993005993')).toBe(true);
    expect(isValidBarcode('123456')).toBe(false);
  });
});
