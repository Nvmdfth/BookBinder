/**
 * Scanning without a shelf in mind.
 *
 * The question this flow answers is "do I already have this, and if not where
 * does it go?" — so the checks here are about routing a capture to the right
 * panel, keeping view-only shelves out of reach, and not writing anything until
 * the run is filed.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/** Drive the scanner directly: the camera is not the subject here. */
const scannerProps = vi.hoisted(() => ({ current: null }));
vi.mock('../components/BarcodeScanner', () => ({
  default: (props) => {
    scannerProps.current = props;
    return <div data-testid="scanner" />;
  },
}));

import ScanModal from '../components/ScanModal';

const SHELVES = [
  { id: 1, name: 'Sci-Fi', role: 'owner', is_wishlist: false },
  { id: 2, name: 'Book club', role: 'collaborator', is_wishlist: false },
  { id: 3, name: "Dad's shelf", role: 'view', is_wishlist: false },
  { id: 4, name: 'Wishlist', role: 'owner', is_wishlist: true },
];

const DUNE = {
  id: 42,
  isbn: '9780441013593',
  title: 'Dune',
  author: 'Frank Herbert',
  cover_image_url: null,
  holdings: [],
};

const HELD_DUNE = {
  ...DUNE,
  holdings: [
    {
      mapping_id: 900,
      bookshelf_id: 1,
      bookshelf_name: 'Sci-Fi',
      is_wishlist: false,
      physical_location: 'Living room, B2',
      is_read: true,
      role: 'owner',
    },
  ],
};

/** Route fetch by URL so a test states only what it cares about. */
function mockApi({ shelves = SHELVES, file, manual } = {}) {
  return vi.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
    if (String(url).includes('/api/bookshelves')) {
      return { ok: true, status: 200, json: async () => shelves };
    }
    if (String(url).includes('/api/books/file')) {
      return file ? file(options) : { ok: true, status: 201, json: async () => ({ mapping: { id: 1 } }) };
    }
    if (String(url).includes('/api/books/manual')) {
      return manual ? manual(options) : { ok: true, status: 201, json: async () => ({ mapping: { id: 2 } }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

const renderModal = () =>
  render(
    <MemoryRouter>
      <ScanModal onClose={() => {}} />
    </MemoryRouter>
  );

/** Wait for the shelf list, which every filing decision depends on. */
const readyModal = async () => {
  renderModal();
  await waitFor(() => expect(scannerProps.current).not.toBeNull());
  await screen.findByTestId('scanner');
};

describe('ScanModal', () => {
  let fetchSpy;

  beforeEach(() => {
    scannerProps.current = null;
    fetchSpy = mockApi();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('routing a capture', () => {
    it('sends a book held nowhere straight to the shelf picker', async () => {
      await readyModal();

      scannerProps.current.onConfirm(DUNE);

      expect(await screen.findByText('Where does it go?')).toBeInTheDocument();
      expect(screen.queryByText('Already in your library')).not.toBeInTheDocument();
    });

    it('shows where a held book lives, with its shelf and location', async () => {
      await readyModal();

      scannerProps.current.onConfirm(HELD_DUNE);

      expect(await screen.findByText('Already in your library')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sci-Fi' })).toHaveAttribute('href', '/bookshelves/1');
      expect(screen.getByText(/Living room, B2/)).toBeInTheDocument();
    });

    it('calls a wishlist holding wanted rather than owned', async () => {
      await readyModal();

      scannerProps.current.onConfirm({
        ...DUNE,
        holdings: [{
          mapping_id: 901,
          bookshelf_id: 4,
          bookshelf_name: 'Wishlist',
          is_wishlist: true,
          physical_location: null,
          is_read: false,
          role: 'owner',
        }],
      });

      expect(await screen.findByText(/On your wishlist/)).toBeInTheDocument();
      expect(screen.queryByText(/In your library/)).not.toBeInTheDocument();
    });

    it('names a shared shelf as shared, not as yours', async () => {
      await readyModal();

      scannerProps.current.onConfirm({
        ...DUNE,
        holdings: [{
          mapping_id: 902,
          bookshelf_id: 3,
          bookshelf_name: "Dad's shelf",
          is_wishlist: false,
          physical_location: null,
          is_read: false,
          role: 'view',
        }],
      });

      expect(await screen.findByText(/On a shelf shared with you/)).toBeInTheDocument();
    });

    it('reaches the picker from a holdings result via "Add to another shelf"', async () => {
      const user = userEvent.setup();
      await readyModal();

      scannerProps.current.onConfirm(HELD_DUNE);
      await user.click(await screen.findByRole('button', { name: 'Add to another shelf' }));

      expect(await screen.findByText('Where does it go?')).toBeInTheDocument();
    });

    it('drops a capture that lands while a panel is already up', async () => {
      await readyModal();

      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');

      // The decoder is briefly live between a confirmation and the parent's brake
      scannerProps.current.onConfirm({ ...DUNE, id: 43, title: 'Neuromancer' });

      await waitFor(() => {
        expect(screen.getByText('Dune')).toBeInTheDocument();
      });
      expect(screen.queryByText('Neuromancer')).not.toBeInTheDocument();
    });
  });

  describe('the shelf picker', () => {
    it('offers only shelves the backend would accept a write to', async () => {
      await readyModal();

      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');

      const options = within(screen.getByRole('combobox')).getAllByRole('option');
      const labels = options.map((o) => o.textContent);

      expect(labels.some((l) => l.includes('Sci-Fi'))).toBe(true);
      expect(labels.some((l) => l.includes('Book club'))).toBe(true);
      expect(labels.some((l) => l.includes('Wishlist'))).toBe(true);
      // A view-only share is never a filing target (Req 4.3.2)
      expect(labels.some((l) => l.includes("Dad's shelf"))).toBe(false);
    });

    it('disables a shelf the book already sits on, which would only 409', async () => {
      await readyModal();

      scannerProps.current.onConfirm(HELD_DUNE);
      await screen.findByText('Already in your library');
      await userEvent.click(screen.getByRole('button', { name: 'Add to another shelf' }));

      const sciFi = await screen.findByRole('option', { name: /Sci-Fi/ });
      expect(sciFi).toBeDisabled();
      expect(screen.getByRole('option', { name: /Book club/ })).not.toBeDisabled();
    });

    it('keeps the camera paused while a panel is up, and releases it after', async () => {
      const user = userEvent.setup();
      await readyModal();

      expect(scannerProps.current.paused).toBe(false);

      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');
      expect(scannerProps.current.paused).toBe(true);

      await user.selectOptions(screen.getByRole('combobox'), '1');
      await user.click(screen.getByRole('button', { name: 'Add to tray' }));

      await waitFor(() => expect(scannerProps.current.paused).toBe(false));
    });

    it('writes nothing when a volume is added to the tray', async () => {
      const user = userEvent.setup();
      await readyModal();

      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');
      await user.selectOptions(screen.getByRole('combobox'), '1');
      await user.click(screen.getByRole('button', { name: 'Add to tray' }));

      await screen.findByText(/Frank Herbert → Sci-Fi/);
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/books/'))).toBe(false);
    });
  });

  describe('filing the run', () => {
    const addDuneToShelf = async (user, shelfValue = '1') => {
      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');
      await user.selectOptions(screen.getByRole('combobox'), shelfValue);
      await user.click(screen.getByRole('button', { name: 'Add to tray' }));
      await screen.findByText(new RegExp(`Frank Herbert →`));
    };

    it('files a catalog volume by book id, not by barcode', async () => {
      const user = userEvent.setup();
      await readyModal();
      await addDuneToShelf(user);

      await user.click(screen.getByRole('button', { name: /File 1 volume/ }));

      await screen.findByText('Filed 1 volume.');
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/api/books/file'));
      expect(JSON.parse(call[1].body)).toEqual({ bookId: 42, bookshelfId: 1 });
    });

    it('keeps a failed row in the tray, carrying its reason', async () => {
      const user = userEvent.setup();
      fetchSpy.mockRestore();
      fetchSpy = mockApi({
        file: () => ({
          ok: false,
          status: 409,
          json: async () => ({ error: '"Dune" is already mapped inside this bookshelf.' }),
        }),
      });

      await readyModal();
      await addDuneToShelf(user);
      await user.click(screen.getByRole('button', { name: /File 1 volume/ }));

      expect(await screen.findByText(/already mapped inside this bookshelf/)).toBeInTheDocument();
      expect(screen.getByText(/Frank Herbert → Sci-Fi/)).toBeInTheDocument();
    });

    it('reports a partial run honestly', async () => {
      const user = userEvent.setup();
      let calls = 0;
      fetchSpy.mockRestore();
      fetchSpy = mockApi({
        file: () => {
          calls += 1;
          return calls === 1
            ? { ok: true, status: 201, json: async () => ({ mapping: { id: 1 } }) }
            : { ok: false, status: 500, json: async () => ({ error: 'Database unavailable.' }) };
        },
      });

      await readyModal();
      await addDuneToShelf(user, '1');
      // The same book onto a second shelf is a legitimate second row
      scannerProps.current.onConfirm(DUNE);
      await screen.findByText('Where does it go?');
      await user.selectOptions(screen.getByRole('combobox'), '2');
      await user.click(screen.getByRole('button', { name: 'Add to tray' }));

      await user.click(await screen.findByRole('button', { name: /File 2 volumes/ }));

      expect(
        await screen.findByText('Filed 1, but 1 could not be filed. They are still in the tray.')
      ).toBeInTheDocument();
    });
  });

  describe('a barcode nothing could identify', () => {
    it('opens the manual form in the modal for an unresolvable ISBN', async () => {
      await readyModal();

      scannerProps.current.onScanSuccess('9781234567897');

      expect(await screen.findByText('Not in any catalog')).toBeInTheDocument();
      expect(screen.getByText('9781234567897')).toBeInTheDocument();
    });

    it('opens the same form for an unlearned UPC', async () => {
      await readyModal();

      scannerProps.current.onManualFallback({ barcode: '070993005993', barcodeType: 'upc' });

      expect(await screen.findByText('Not in any catalog')).toBeInTheDocument();
      expect(screen.getByText('070993005993')).toBeInTheDocument();
    });

    it('files a manual entry through the manual route, carrying the barcode to be learned', async () => {
      const user = userEvent.setup();
      await readyModal();

      scannerProps.current.onManualFallback({ barcode: '070993005993', barcodeType: 'upc' });
      await screen.findByText('Not in any catalog');

      await user.type(screen.getByPlaceholderText('Required'), 'Mucho Mojo');
      await user.type(screen.getByPlaceholderText('Optional'), 'Joe R. Lansdale');
      await user.selectOptions(screen.getByRole('combobox'), '1');
      await user.click(screen.getByRole('button', { name: 'Add to tray' }));

      await user.click(await screen.findByRole('button', { name: /File 1 volume/ }));

      await screen.findByText('Filed 1 volume.');
      const call = fetchSpy.mock.calls.find(([url]) => String(url).includes('/api/books/manual'));
      expect(JSON.parse(call[1].body)).toEqual({
        bookshelfId: 1,
        title: 'Mucho Mojo',
        author: 'Joe R. Lansdale',
        scannedBarcode: '070993005993',
      });
    });
  });

  describe('when there is nowhere to file', () => {
    it('says so rather than offering an empty picker', async () => {
      fetchSpy.mockRestore();
      fetchSpy = mockApi({ shelves: [{ id: 3, name: "Dad's shelf", role: 'view', is_wishlist: false }] });

      renderModal();

      expect(
        await screen.findByText(/need a bookshelf you can write to/)
      ).toBeInTheDocument();
    });

    it('surfaces a failure to load shelves', async () => {
      fetchSpy.mockRestore();
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error fetching bookshelves.' }),
      });

      renderModal();

      expect(
        await screen.findByText('Internal server error fetching bookshelves.')
      ).toBeInTheDocument();
    });
  });
});
