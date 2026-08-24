/**
 * Opening one copy by URL.
 *
 * Global search hands the user to /bookshelves/:id?book=:mappingId, and the
 * shelf must open that exact copy in the same detail view a click on the shelf
 * would have opened. A URL rather than router state, so the link survives a
 * refresh and can be shared.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import BookshelfDetails from '../pages/BookshelfDetails';

const SHELF = {
  id: 4,
  name: 'Living Room',
  description: '',
  ownerEmail: 'me@library.com',
  isOwner: true,
  isWishlist: false,
  accessRole: 'owner',
  books: [
    {
      mapping_id: 7,
      book_id: 3,
      isbn: '9780441013593',
      title: 'Dune',
      author: 'Frank Herbert',
      cover_image_url: null,
      physical_location: 'Shelf 2, left side',
      notes: null,
      is_read: false,
      mapping_created_at: '2026-01-01T00:00:00Z',
    },
    {
      mapping_id: 8,
      book_id: 5,
      isbn: '9780547928227',
      title: 'The Hobbit',
      author: 'J.R.R. Tolkien',
      cover_image_url: null,
      physical_location: 'Shelf 1',
      notes: null,
      is_read: false,
      mapping_created_at: '2026-01-02T00:00:00Z',
    },
  ],
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (String(url).includes('/api/bookshelves/4')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SHELF) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
  });
});

afterEach(() => vi.restoreAllMocks());

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/bookshelves/:id" element={<BookshelfDetails />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('?book= deep link', () => {
  it('opens the requested copy once the shelf has loaded', async () => {
    renderAt('/bookshelves/4?book=7');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(dialog).toHaveTextContent('Dune');
  });

  it('opens the copy named in the URL, not merely the first on the shelf', async () => {
    renderAt('/bookshelves/4?book=8');

    const dialog = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(dialog).toHaveTextContent('The Hobbit');
  });

  it('opens nothing when the param is absent', async () => {
    renderAt('/bookshelves/4');

    await screen.findByText('Living Room');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('loads the shelf normally when the copy is gone — moved or deleted since', async () => {
    renderAt('/bookshelves/4?book=999');

    await screen.findByText('Living Room');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
