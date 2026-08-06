/**
 * Camera teardown on unmount.
 *
 * html5-qrcode's stop() throws *synchronously* — a plain string, before any
 * promise exists — when the scanner is already stopping
 * ("Cannot transition to a new state, already under transition") or already
 * stopped. A trailing .catch() cannot see that, and an exception escaping an
 * effect cleanup takes React's entire tree down with it: the whole page goes
 * blank, header and navigation included.
 *
 * The mock below reproduces that contract exactly, because it is the only part
 * of the library that matters here.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const instances = vi.hoisted(() => []);

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor() {
      this.isScanning = false;
      this.stopping = false;
      this.stopCalls = 0;
      instances.push(this);
    }

    async start(_camera, _config, onDecoded) {
      this.isScanning = true;
      this.onDecoded = onDecoded;
    }

    stop() {
      this.stopCalls += 1;

      // The real library's two synchronous throw paths
      if (!this.isScanning) throw 'Cannot stop, scanner is not running or paused.';
      if (this.stopping) throw 'Cannot transition to a new state, already under transition';

      this.stopping = true;
      // isScanning is only cleared once the camera actually closes, i.e. later
      return Promise.resolve().then(() => {
        this.isScanning = false;
        this.stopping = false;
      });
    }

    pause() {}
    resume() {}
  },
}));

import BarcodeScanner from '../components/BarcodeScanner';

describe('BarcodeScanner camera teardown', () => {
  beforeEach(() => {
    instances.length = 0;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function startCamera() {
    const user = userEvent.setup();
    const view = render(<BarcodeScanner onScanSuccess={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /start ingestion scanner/i }));
    await waitFor(() => expect(instances[0]?.isScanning).toBe(true));
    return view;
  }

  it('unmounts a running scanner without throwing out of the cleanup', async () => {
    const { unmount } = await startCamera();

    // A throw here is what blanks the page in the browser
    expect(() => unmount()).not.toThrow();
  });

  it('stops the camera exactly once, never re-entering a stop in flight', async () => {
    const { unmount } = await startCamera();

    unmount();

    expect(instances[0].stopCalls).toBe(1);
  });

  it('survives an unmount after the camera was already stopped', async () => {
    const view = await startCamera();

    // Mimic the library having finished a stop triggered elsewhere
    instances[0].isScanning = false;

    expect(() => view.unmount()).not.toThrow();
  });
});
