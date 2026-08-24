import React, { useState, useEffect, useRef } from 'react';
import { Search, SearchX, Loader2, MapPin, Users, StickyNote } from 'lucide-react';
import Modal from './Modal';
import BookVolume from './BookVolume';

/** Below this the pattern matches most of the library; the API refuses it too. */
const MIN_QUERY = 2;

/** Long enough that typing a word is one request, short enough to feel live. */
const DEBOUNCE_MS = 250;

/**
 * Search every shelf the user can see.
 *
 * The shelf view can already filter the shelf you have open; what was missing
 * was the question asked away from any shelf — "do I own this, and where did I
 * put it?" Answering it meant opening shelves one at a time.
 *
 * A result is a *copy*, not a title: the same book on two shelves appears
 * twice, because the useful part of the answer is which shelf and which box.
 * Choosing one hands its shelf and mapping id back to the caller, which opens
 * the same detail view a click on the shelf itself would have.
 */
export default function LibrarySearchModal({ onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setSearched(false);
      setError('');
      return undefined;
    }

    /*
     * Two guards on one request: the timer collapses a burst of keystrokes into
     * a single call, and `abandoned` drops a response whose query has already
     * been typed past — otherwise a slow early request can land after a fast
     * later one and repopulate the list with stale results.
     */
    let abandoned = false;

    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`/api/books/library-search?q=${encodeURIComponent(trimmed)}`);
        const payload = await res.json().catch(() => ({}));
        if (abandoned) return;
        if (!res.ok) throw new Error(payload.error || 'The search failed.');
        setResults(payload.results || []);
        setSearched(true);
      } catch (err) {
        if (!abandoned) {
          setError(err.message);
          setResults([]);
        }
      } finally {
        if (!abandoned) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      abandoned = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleOpen = (result) => {
    onNavigate(`/bookshelves/${result.bookshelf_id}?book=${result.mapping_id}`);
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Search Your Library" width="620px">
      <div style={styles.searchRow}>
        <Search size={18} style={styles.searchIcon} aria-hidden="true" />
        <input
          ref={inputRef}
          id="library-search-input"
          className="form-input"
          type="search"
          autoComplete="off"
          aria-label="Search your library by title, author, ISBN, location, or note"
          placeholder="Title, author, ISBN, location, or a note…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={styles.input}
        />
        {loading && <Loader2 size={16} className="spin" style={styles.spinner} aria-hidden="true" />}
      </div>

      <p style={styles.hint}>
        Looks across every shelf you own or that someone has shared with you.
      </p>

      {error && <div style={styles.error}>{error}</div>}

      {searched && results.length === 0 && !loading && (
        <div style={styles.empty}>
          <SearchX size={22} style={{ color: 'var(--text-muted)' }} />
          <span>Nothing in your library matches that.</span>
        </div>
      )}

      <ul style={styles.list}>
        {results.map((r) => (
          <li key={r.mapping_id}>
            <button type="button" style={styles.row} onClick={() => handleOpen(r)}>
              <span style={styles.cover}>
                <BookVolume
                  title={r.title}
                  author={r.author}
                  coverUrl={r.cover_image_url}
                  seed={r.isbn || r.mapping_id}
                  isRead={r.is_read}
                />
              </span>

              <span style={styles.meta}>
                <span style={styles.title}>{r.title}</span>
                <span style={styles.author}>{r.author || 'Unknown author'}</span>

                <span style={styles.shelfRow}>
                  <span style={styles.shelf}>{r.bookshelf_name}</span>
                  {r.is_wishlist && <span style={styles.chip}>wishlist</span>}
                  {r.role !== 'owner' && (
                    <span style={styles.chip}>
                      <Users size={11} aria-hidden="true" />
                      {`shared · ${r.owner_email}`}
                    </span>
                  )}
                </span>

                {r.physical_location && (
                  <span style={styles.location}>
                    <MapPin size={12} aria-hidden="true" />
                    {r.physical_location}
                  </span>
                )}

                {/* A notes-only hit is otherwise unexplained: the row would show
                    nothing containing what the user typed. */}
                {r.matched_on === 'notes' && r.notes && (
                  <span style={styles.note}>
                    <StickyNote size={12} aria-hidden="true" />
                    {r.notes}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

const styles = {
  searchRow: { position: 'relative', display: 'flex', alignItems: 'center' },
  searchIcon: { position: 'absolute', left: '12px', color: 'var(--text-muted)' },
  input: { paddingLeft: '38px', width: '100%' },
  spinner: { position: 'absolute', right: '12px', color: 'var(--text-muted)' },
  hint: { fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '8px' },
  error: {
    marginTop: '12px',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
    color: 'var(--danger-text)',
    fontSize: '0.85rem',
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '28px 12px',
    color: 'var(--text-secondary)',
    fontSize: '0.9rem',
  },
  list: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginTop: '14px',
    maxHeight: '52vh',
    overflowY: 'auto',
  },
  row: {
    display: 'flex',
    gap: '14px',
    alignItems: 'flex-start',
    width: '100%',
    textAlign: 'left',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
    background: 'transparent',
    border: '1px solid transparent',
    cursor: 'pointer',
  },
  cover: { flexShrink: 0, width: '46px' },
  meta: { display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 },
  title: { fontWeight: 600, fontSize: '0.95rem' },
  author: { fontSize: '0.82rem', color: 'var(--text-secondary)' },
  shelfRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', marginTop: '2px' },
  shelf: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent-color)' },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '0.68rem',
    padding: '1px 7px',
    borderRadius: '999px',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-muted)',
  },
  location: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
  },
  note: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    fontSize: '0.78rem',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
  },
};
