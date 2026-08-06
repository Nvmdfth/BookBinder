/**
 * Filing a scan run into a shelf (Req 5.3).
 *
 * The tray is the loop someone actually uses at a bookshelf: confirm volumes at
 * the camera, then file the whole run in one go. A crash on the last step files
 * the books but loses the screen, which is the worst of both — the write landed
 * and the user cannot see it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** Drive the scanner directly: the camera is not the subject here. */
const scannerProps = vi.hoisted(() => ({ current: null }));
vi.mock('../components/BarcodeScanner', () => ({
  default: (props) => {
    scannerProps.current = props;
    return <div data-testid="scanner" />;
  },
}));

import BookshelfDetails from '../pages/BookshelfDetails';

const WISHLIST = {
  id: 1,
  name: 'Wishlist',
  description: 'My personal reading wishlist.',
  ownerEmail: 'owner@library.com',
  isOwner: true,
  isWishlist: true,
  accessRole: 'owner',
  books: [],
};

const SCANNED = {
  isbn: '0446401870',
  title: 'Mucho Mojo',
  author: 'Joe R. Lansdale',
  publisher: 'Grand Central Pub',
  cover_image_url: null,
  page_count: 304,
  publication_date: '1995',
};

/** What POST /api/books/scan/:isbn actually answers on a successful file. */
const scanResponse = {
  message: 'Book indexed and added to bookshelf successfully.',
  mapping: { id: 151, physical_location: null, notes: null, created_at: '2026-08-06T18:07:59.035Z' },
  book: { id: 152, ...SCANNED },
};

function renderShelf() {
  return render(
    <MemoryRouter initialEntries={['/bookshelf/1']}>
      <Routes>
        <Route path="/bookshelf/:id" element={<BookshelfDetails />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Filing a scan tray into a shelf', () => {
  let errorSpy;

  beforeEach(() => {
    scannerProps.current = null;
    // A render crash surfaces here rather than as a failed assertion
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      if (String(url).includes('/api/bookshelves/1') && (!options || options.method === undefined)) {
        return { ok: true, status: 200, json: async () => WISHLIST };
      }
      if (String(url).includes('/api/books/scan/')) {
        return { ok: true, status: 201, json: async () => scanResponse };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the shelf on screen after the run is filed', async () => {
    const user = userEvent.setup();
    renderShelf();

    await waitFor(() => expect(screen.getByText('Wishlist')).toBeInTheDocument());

    // Open the scanner and confirm a volume into the tray
    await user.click(screen.getByRole('button', { name: /start scanning ingests/i }));
    await waitFor(() => expect(scannerProps.current?.onConfirm).toBeTypeOf('function'));
    scannerProps.current.onConfirm(SCANNED);

    const fileBtn = await screen.findByRole('button', { name: /file 1 into wishlist/i });
    await user.click(fileBtn);

    // The book is written either way; the question is whether the page survives
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/books/scan/0446401870'),
        expect.objectContaining({ method: 'POST' })
      )
    );

    // A blank screen is the failure under guard: the shelf must still be there,
    // showing the volume that was just filed.
    await waitFor(() => expect(screen.getByText('Wishlist')).toBeInTheDocument());
    expect(screen.getAllByText('Mucho Mojo').length).toBeGreaterThan(0);

    const crash = errorSpy.mock.calls.find((c) => String(c[0]).match(/error|exception/i));
    expect(crash, `render crashed: ${crash && crash[0]}`).toBeUndefined();
  });
});
