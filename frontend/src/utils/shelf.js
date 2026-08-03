/**
 * Shelf criteria — the filtering and ordering behind a bookshelf view.
 *
 * Lifted out of the page component so the rules can be asserted directly.
 * The default ordering in particular shipped inverted once already, and no
 * render test would have caught it.
 */

/**
 * Narrow a shelf to the volumes matching the active criteria.
 *
 * All three criteria compose — a location chip plus a text query plus a read
 * filter narrow together rather than the last one winning.
 */
export function filterBooks(books, { query = '', readFilter = 'all', locationFilter = '' } = {}) {
  const needle = query.trim().toLowerCase();

  return (books || []).filter((b) => {
    if (readFilter === 'read' && !b.is_read) return false;
    if (readFilter === 'unread' && b.is_read) return false;

    // Exact, so "Oak Case, Row 1" does not also pull in "Oak Case, Row 2"
    if (locationFilter && (b.physical_location || '').trim() !== locationFilter) return false;

    if (!needle) return true;
    return [b.title, b.author, b.publisher, b.physical_location, b.notes]
      .some((field) => field && field.toLowerCase().includes(needle));
  });
}

/** Order a shelf. Always returns a new array. */
export function sortBooks(books, mode) {
  const list = (books || []).slice();
  const by = (pick) => (a, b) => (pick(a) || '').localeCompare(pick(b) || '');

  if (mode === 'title') return list.sort(by((b) => b.title));
  if (mode === 'author') return list.sort(by((b) => b.author));
  if (mode === 'location') return list.sort(by((b) => b.physical_location));

  /*
   * 'recent' — ordered by the accession timestamp itself.
   *
   * Do not reinstate a plain reverse() here. The API returns newest-first and
   * handleScanSuccess prepends onto that, so array position says nothing about
   * recency; reversing put the volume you had just scanned at the bottom.
   * An undated row sorts last rather than jumping to the front.
   */
  const at = (b) => (b.mapping_created_at ? new Date(b.mapping_created_at).getTime() : -Infinity);
  return list.sort((a, b) => at(b) - at(a));
}

/** The distinct physical locations on a shelf, offered as filter chips. */
export function locationsOf(books) {
  const seen = [];
  for (const b of books || []) {
    const loc = (b.physical_location || '').trim();
    if (loc && !seen.includes(loc)) seen.push(loc);
  }
  return seen.sort((a, b) => a.localeCompare(b));
}
