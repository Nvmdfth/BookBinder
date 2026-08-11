import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { isValidUPC, isValidBarcode, upcCore } from '../utils/isbn';
import BarcodeScanner from '../components/BarcodeScanner';

/**
 * The camera hands the decode callback to html5-qrcode, so the tests drive the
 * component by capturing that callback and invoking it with a barcode — the
 * same thing a real scan does.
 */
let decodeCallback = null;

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor() {
      this.isScanning = true;
    }
    async start(_camera, _config, onDecoded) {
      decodeCallback = onDecoded;
    }
    async stop() {
      this.isScanning = false;
    }
    pause() {}
    resume() {}
  },
}));

const UPC = '070993005993';
const ISBN13 = '9780446401876';

describe('Frontend UPC Barcode Validation', () => {
  it('validates 12-digit UPC-A codes', () => {
    expect(isValidUPC(UPC)).toBe(true);
    expect(isValidUPC('070993005994')).toBe(false);
  });

  it('validates 17-digit UPC-A + extension codes', () => {
    expect(isValidUPC('07099300599340187')).toBe(true);
  });

  it('isValidBarcode accepts ISBNs and UPCs', () => {
    expect(isValidBarcode('0446401870')).toBe(true);
    expect(isValidBarcode(ISBN13)).toBe(true);
    expect(isValidBarcode(UPC)).toBe(true);
    expect(isValidBarcode('123456')).toBe(false);
  });

  it('upcCore strips the price add-on and rejects ISBNs', () => {
    expect(upcCore(UPC)).toBe(UPC);
    expect(upcCore('07099300599340187')).toBe(UPC);
    expect(upcCore(ISBN13)).toBeNull();
  });

  // Some decoders report UPC-A as its EAN-13 equivalent, with a leading zero.
  // Rejecting that form is a scan where nothing at all happens.
  it('accepts UPC-A in the leading-zero EAN-13 form', () => {
    expect(isValidUPC(`0${UPC}`)).toBe(true);
    expect(isValidBarcode(`0${UPC}`)).toBe(true);
    expect(upcCore(`0${UPC}`)).toBe(UPC);
  });

  it('does not mistake an ISBN-13 for a zero-prefixed UPC', () => {
    expect(isValidUPC(ISBN13)).toBe(false);
    expect(upcCore(ISBN13)).toBeNull();
  });
});

describe('BarcodeScanner UPC handling', () => {
  let vibrate;

  beforeEach(async () => {
    decodeCallback = null;
    vibrate = vi.fn();
    vi.stubGlobal('navigator', { ...navigator, vibrate });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Start the camera and wait for html5-qrcode to hand over its decode callback. */
  async function startScanning(props = {}) {
    const user = userEvent.setup();
    render(<BarcodeScanner onScanSuccess={vi.fn()} {...props} />);
    await user.click(screen.getByRole('button', { name: /start barcode scanner/i }));
    await waitFor(() => expect(decodeCallback).toBeTruthy());
    return user;
  }

  it('keeps the camera up and offers a retry when a UPC is not in the catalog', async () => {
    const onScanSuccess = vi.fn();
    const onManualFallback = vi.fn();
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ fallbackToManual: true, barcodeType: 'upc', barcode: UPC }),
    });

    await startScanning({ onScanSuccess, onManualFallback });
    decodeCallback(UPC);

    await waitFor(() => expect(screen.getByText(/not in your catalog/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /scan again/i })).toBeInTheDocument();

    // Regression guard: the failed UPC used to close the camera and jump
    // straight to the manual form without asking.
    expect(onScanSuccess).not.toHaveBeenCalled();
    expect(onManualFallback).not.toHaveBeenCalled();
  });

  it('hands the barcode to the manual form only when the user chooses to', async () => {
    const onManualFallback = vi.fn();
    fetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ fallbackToManual: true, barcodeType: 'upc', barcode: UPC }),
    });

    const user = await startScanning({ onManualFallback });
    decodeCallback(UPC);

    await waitFor(() => expect(screen.getByText(/not in your catalog/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /enter manually/i }));

    await waitFor(() =>
      expect(onManualFallback).toHaveBeenCalledWith({ barcode: UPC, barcodeType: 'upc' })
    );
  });

  it('withholds the captured signal for a UPC until it resolves to a book', async () => {
    let resolveLookup;
    fetch.mockReturnValue(new Promise((resolve) => { resolveLookup = resolve; }));

    await startScanning();
    decodeCallback(UPC);

    // A product code is not a book yet — buzzing here would be a false "got it"
    await waitFor(() => expect(screen.getByText(/fetching book details/i)).toBeInTheDocument());
    expect(vibrate).not.toHaveBeenCalled();

    resolveLookup({
      ok: true,
      status: 200,
      json: async () => ({ isbn: '0446401870', title: 'Mucho Mojo', author: 'Joe R. Lansdale' }),
    });

    await waitFor(() => expect(screen.getByText(/is this the correct book/i)).toBeInTheDocument());
    expect(screen.getAllByText('Mucho Mojo').length).toBeGreaterThan(0);
    expect(vibrate).toHaveBeenCalled();
  });

  it('signals immediately for a Bookland EAN, which is a book by construction', async () => {
    fetch.mockReturnValue(new Promise(() => {}));

    await startScanning();
    decodeCallback(ISBN13);

    await waitFor(() => expect(vibrate).toHaveBeenCalled());
  });
});
