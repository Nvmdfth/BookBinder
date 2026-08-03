/**
 * Ordering and criteria for a shelf.
 *
 * The "recently added" default shipped inverted: the code reversed the array on
 * the assumption the API returned oldest-first, but bookshelfRouter orders
 * created_at DESC and a scan prepends on top of that — so the volume you had
 * just scanned landed at the very bottom of the default view. The sort is now
 * driven by the accession timestamp, and this pins that down.
 */
import { describe, it, expect } from 'vitest';
import { sortBooks, filterBooks } from '../utils/shelf';

const BOOKS = [
  { mapping_id: 3, title: 'Piranesi', author: 'Clarke', physical_location: 'Bedside stack', is_read: true, mapping_created_at: '2026-03-01T09:00:00Z' },
  { mapping_id: 1, title: 'Dune', author: 'Herbert', physical_location: 'Oak Case, Row 1', is_read: false, mapping_created_at: '2026-01-01T09:00:00Z' },
  { mapping_id: 2, title: 'Anathem', author: 'Stephenson', physical_location: 'Oak Case, Row 2', is_read: true, mapping_created_at: '2026-02-01T09:00:00Z' },
];

const titlesOf = (list) => list.map((b) => b.title);

describe('sortBooks', () => {
  it('puts the most recent accession first', () => {
    expect(titlesOf(sortBooks(BOOKS, 'recent'))).toEqual(['Piranesi', 'Anathem', 'Dune']);
  });

  it('orders by accession date, not by array position', () => {
    // The shape the bug relied on: a freshly scanned volume prepended onto a
    // payload that was already newest-first
    const justScanned = { mapping_id: 4, title: 'Hyperion', mapping_created_at: '2026-04-01T09:00:00Z' };
    const asStored = [justScanned, ...BOOKS];

    expect(titlesOf(sortBooks(asStored, 'recent'))[0]).toBe('Hyperion');
  });

  it('keeps a volume with no accession date last rather than first', () => {
    const undated = { mapping_id: 9, title: 'Unknown provenance' };

    const ordered = titlesOf(sortBooks([undated, ...BOOKS], 'recent'));
    expect(ordered[ordered.length - 1]).toBe('Unknown provenance');
  });

  it.each([
    ['title', ['Anathem', 'Dune', 'Piranesi']],
    ['author', ['Piranesi', 'Dune', 'Anathem']],
    ['location', ['Piranesi', 'Dune', 'Anathem']],
  ])('sorts by %s', (mode, expected) => {
    expect(titlesOf(sortBooks(BOOKS, mode))).toEqual(expected);
  });

  it('does not mutate the array it is given', () => {
    const original = [...BOOKS];
    sortBooks(BOOKS, 'title');

    expect(BOOKS).toEqual(original);
  });
});

describe('filterBooks', () => {
  const all = { query: '', readFilter: 'all', locationFilter: '' };

  it('returns everything with no criteria', () => {
    expect(filterBooks(BOOKS, all)).toHaveLength(3);
  });

  it.each([
    ['read', ['Piranesi', 'Anathem']],
    ['unread', ['Dune']],
  ])('narrows to %s', (readFilter, expected) => {
    expect(titlesOf(filterBooks(BOOKS, { ...all, readFilter }))).toEqual(expected);
  });

  it('matches a location exactly rather than by prefix', () => {
    // "Oak Case, Row 1" must not pull in "Oak Case, Row 2"
    const result = filterBooks(BOOKS, { ...all, locationFilter: 'Oak Case, Row 1' });

    expect(titlesOf(result)).toEqual(['Dune']);
  });

  it('searches title, author and location together, case-insensitively', () => {
    expect(titlesOf(filterBooks(BOOKS, { ...all, query: 'herb' }))).toEqual(['Dune']);
    expect(titlesOf(filterBooks(BOOKS, { ...all, query: 'BEDSIDE' }))).toEqual(['Piranesi']);
  });

  it('combines criteria rather than letting the last one win', () => {
    const result = filterBooks(BOOKS, {
      query: 'oak',
      readFilter: 'read',
      locationFilter: '',
    });

    expect(titlesOf(result)).toEqual(['Anathem']);
  });
});
