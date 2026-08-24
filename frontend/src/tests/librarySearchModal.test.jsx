/**
 * The global search overlay.
 *
 * Its job is to answer "where is this book?" without making the user open
 * shelves one at a time — so the assertions that matter are that a result
 * names the shelf it lives on, and that choosing one lands on that shelf with
 * that exact copy open.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LibrarySearchModal from '../components/LibrarySearchModal';

const OWNED = {
  mapping_id: 7,
  book_id: 3,
  isbn: '9780441013593',
  title: 'Dune',
  author: 'Frank Herbert',
  cover_image_url: null,
  physical_location: 'Shelf 2, left side',
  notes: null,
  is_read: true,
  bookshelf_id: 4,
  bookshelf_name: 'Living Room',
  role: 'owner',
  owner_email: 'me@library.com',
  is_wishlist: false,
  matched_on: 'title',
};

const SHARED = {
  ...OWNED,
  mapping_id: 9,
  bookshelf_id: 8,
  bookshelf_name: "Sam's Sci-Fi",
  role: 'view',
  owner_email: 'sam@library.com',
  physical_location: 'Box 4',
};

let navigate;

function mockResults(results) {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ query: 'dune', results }) })
  );
}

beforeEach(() => {
  navigate = vi.fn();
  vi.useRealTimers();
});

afterEach(() => vi.restoreAllMocks());

function open(results = [OWNED]) {
  mockResults(results);
  render(<LibrarySearchModal onClose={() => {}} onNavigate={navigate} />);
}

describe('Searching', () => {
  it('does not query the server until two characters are entered', async () => {
    open();

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'd');

    await new Promise((r) => setTimeout(r, 400));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('queries once the query is long enough', async () => {
    open();

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][0]).toContain('/api/books/library-search?q=dune');
  });

  it('debounces, so typing a word is one request rather than one per keystroke', async () => {
    open();

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 400));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('Results', () => {
  it('names the shelf and the physical location for each copy', async () => {
    open();

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    expect(await screen.findByText('Living Room')).toBeInTheDocument();
    expect(screen.getByText(/Shelf 2, left side/)).toBeInTheDocument();
  });

  it('lists the same title once per shelf that holds a copy', async () => {
    open([OWNED, SHARED]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    await screen.findByText('Living Room');
    expect(screen.getByText("Sam's Sci-Fi")).toBeInTheDocument();
    // One row per copy. Counting the title text would over-count: BookVolume
    // renders it on the spine as well as the row rendering it as a heading.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it("marks a shared shelf and names its owner, so it is clear whose copy it is", async () => {
    open([SHARED]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    expect(await screen.findByText(/shared · sam@library\.com/)).toBeInTheDocument();
  });

  it('shows the note when the note is what matched, so the hit explains itself', async () => {
    open([{ ...OWNED, notes: 'signed by the author', matched_on: 'notes' }]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    expect(await screen.findByText(/signed by the author/)).toBeInTheDocument();
  });

  it('reports an empty search plainly rather than looking broken', async () => {
    open([]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');

    expect(await screen.findByText(/nothing in your library matches/i)).toBeInTheDocument();
  });
});

describe('Opening a result', () => {
  it('navigates to the shelf with that copy open', async () => {
    open([OWNED]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');
    await userEvent.click(await screen.findByRole('button', { name: /Dune/ }));

    expect(navigate).toHaveBeenCalledWith('/bookshelves/4?book=7');
  });

  it('opens the copy that was clicked, not the first one found', async () => {
    open([OWNED, SHARED]);

    await userEvent.type(screen.getByLabelText(/search your library by title/i), 'dune');
    await screen.findByText("Sam's Sci-Fi");

    const rows = screen.getAllByRole('button', { name: /Dune/ });
    await userEvent.click(rows[1]);

    expect(navigate).toHaveBeenCalledWith('/bookshelves/8?book=9');
  });
});
