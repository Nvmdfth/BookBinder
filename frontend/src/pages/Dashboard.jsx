import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderPlus, Compass, Users, BookOpen, Sparkles, RefreshCw,
  AlertTriangle, MapPin,
} from 'lucide-react';
import BookVolume, { CLOTHS } from '../components/BookVolume';
import Modal from '../components/Modal';

/**
 * The miniature shelf of spines on a bookshelf card.
 *
 * Nine spines, with widths and heights derived from the shelf id so a given
 * shelf always looks like itself. Sized against the shelf's own volume count so
 * a drawer of eleven books does not present the same full block as one of four
 * hundred — the card should read as "how much is in here" at a glance.
 */
function SpineStrip({ shelfId, count }) {
  const spines = useMemo(() => {
    // An empty drawer draws no spines at all — a single stub beside a count of
    // zero reads as a rendering fault. Anything non-empty gets at least one.
    const filled = count === 0 ? 0 : Math.max(1, Math.min(9, Math.round((count / 40) * 9)));
    return Array.from({ length: filled }, (_, i) => ({
      w: 4 + ((shelfId * 5 + i * 3) % 5),
      h: 62 + ((shelfId * 11 + i * 17) % 38),
      c: CLOTHS[(shelfId * 3 + i) % CLOTHS.length],
    }));
  }, [shelfId, count]);

  return (
    <div className="spine-row" aria-hidden="true">
      {spines.map((s, i) => (
        <span key={i} className="spine" style={{ width: `${s.w}px`, height: `${s.h}%`, background: s.c }} />
      ))}
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [shelves, setShelves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Create Modal Overlay State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newShelfName, setNewShelfName] = useState('');
  const [newShelfDesc, setNewShelfDesc] = useState('');
  const [createLoading, setCreateLoading] = useState(false);

  // Book Roulette Modal State (Req v1.4)
  const [isRouletteModalOpen, setIsRouletteModalOpen] = useState(false);
  const [rouletteBook, setRouletteBook] = useState(null);
  const [rouletteLoading, setRouletteLoading] = useState(false);
  const [rouletteError, setRouletteError] = useState(null);

  const fetchRouletteBook = async () => {
    setRouletteLoading(true);
    setRouletteError(null);
    setRouletteBook(null);
    try {
      const res = await fetch('/api/books/roulette');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to select a random book.');
      }
      setRouletteBook(data);
    } catch (err) {
      console.error('Roulette fetch error:', err);
      setRouletteError(err.message || 'Failed to fetch selection.');
    } finally {
      setRouletteLoading(false);
    }
  };

  const handleOpenRoulette = () => {
    setIsRouletteModalOpen(true);
    fetchRouletteBook();
  };

  const handleCloseRoulette = () => {
    setIsRouletteModalOpen(false);
    setRouletteBook(null);
    setRouletteError(null);
  };

  const fetchShelves = async () => {
    try {
      const res = await fetch('/api/bookshelves');
      if (!res.ok) throw new Error('Failed to retrieve bookshelves list.');
      const data = await res.json();
      setShelves(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchShelves();
  }, []);

  const handleCreateShelf = async (e) => {
    e.preventDefault();
    if (!newShelfName.trim()) return;

    setCreateLoading(true);
    try {
      const res = await fetch('/api/bookshelves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newShelfName, description: newShelfDesc }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to construct bookshelf.');

      setShelves((prev) => [...prev, data.bookshelf]);
      setIsModalOpen(false);
      setNewShelfName('');
      setNewShelfDesc('');
    } catch (err) {
      alert(err.message);
    } finally {
      setCreateLoading(false);
    }
  };

  const personalShelves = shelves.filter((s) => s.role === 'owner');
  const sharedShelves = shelves.filter((s) => s.role !== 'owner');

  /**
   * The accession record. Only shelves you own count towards it — a read-only
   * window onto someone else's cookbooks is not part of your accession.
   */
  const accession = useMemo(() => {
    const volumes = personalShelves.reduce((n, s) => n + (s.book_count || 0), 0);
    const read = personalShelves.reduce((n, s) => n + (s.read_count || 0), 0);
    const filed = personalShelves.reduce((n, s) => n + (s.filed_this_month || 0), 0);
    return {
      volumes,
      read,
      unread: volumes - read,
      filed,
      shelves: personalShelves.length,
      readPct: volumes > 0 ? Math.round((read / volumes) * 100) : 0,
    };
  }, [personalShelves]);

  /** Stamp treatment per access scope, mirroring the RBAC vocabulary. */
  const roleStamp = (shelf) => {
    if (shelf.is_wishlist) return <span className="stamp stamp-tilt stamp-warning">★ Wishlist</span>;
    if (shelf.role === 'owner') return <span className="stamp stamp-tilt">Owner</span>;
    if (shelf.role === 'collaborator') return <span className="stamp stamp-tilt stamp-success">Collaborator</span>;
    return <span className="stamp stamp-tilt stamp-muted">View Only</span>;
  };

  /** The colour of the spine edge down the card's leading side. */
  const shelfTint = (shelf) => {
    if (shelf.is_wishlist) return 'var(--warning-color)';
    if (shelf.role === 'collaborator') return 'var(--success-color)';
    if (shelf.role === 'view') return 'var(--text-muted)';
    return CLOTHS[shelf.id % CLOTHS.length];
  };

  const shelfCard = (shelf, index) => (
    <Link
      key={shelf.id}
      to={`/bookshelves/${shelf.id}`}
      className="card card-spine card-link card-in"
      style={{
        ...styles.shelfCard,
        '--spine-color': shelfTint(shelf),
        animationDelay: `${Math.min(index, 8) * 35}ms`,
      }}
    >
      <div style={styles.shelfCardHeader}>
        <h3 style={styles.shelfName}>{shelf.name}</h3>
        {roleStamp(shelf)}
      </div>

      <hr className="rule-line" style={{ margin: '2px 0 10px' }} />

      <p style={styles.shelfDesc}>
        {shelf.description || 'No descriptive notes added yet.'}
      </p>

      {/* How much is in this drawer, read at a glance */}
      <div style={styles.shelfMeasure}>
        <SpineStrip shelfId={shelf.id} count={shelf.book_count || 0} />
        <span style={styles.shelfCount}>{shelf.book_count ?? 0}</span>
      </div>

      <div style={styles.cardFooter}>
        <span className="typed" style={styles.footerText}>
          {shelf.role === 'owner' ? 'Personal drawer' : `Owner · ${shelf.owner_email}`}
        </span>
      </div>
    </Link>
  );

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="skeleton" style={{ width: '220px', height: '38px' }} />
        <div className="skeleton" style={{ width: '320px', height: '16px', marginBottom: '10px' }} />
        <div style={styles.shelfGrid}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: '168px' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      <header className="page-head" style={styles.header}>
        <div>
          <span className="eyebrow">The Collection</span>
          <h1 className="page-title" style={{ marginTop: '4px' }}>My Libraries</h1>
          <p className="page-subtitle">
            Catalog, sort, and collaborate on your home physical inventory.
          </p>
        </div>

        <div style={styles.headerActions}>
          <button className="btn btn-secondary" onClick={handleOpenRoulette}>
            <Sparkles size={17} />
            <span>Book Roulette</span>
          </button>

          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <FolderPlus size={17} />
            <span>New Bookshelf</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-shake" style={styles.errorText}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Accession record — the figures for the collection as a whole */}
      <div className="card" style={styles.accession}>
        <div style={styles.accessionHead}>
          <span className="eyebrow">Accession Record</span>
          <div style={styles.dottedFill} />
          <span className="typed" style={styles.accessionStamp}>
            {accession.volumes === 0
              ? 'NOT YET OPENED'
              : accession.filed > 0
                ? 'UPDATED THIS MONTH'
                : 'NO NEW ACCESSIONS'}
          </span>
        </div>

        {/* A grid of zeroes reads as a broken widget rather than an empty one,
            so a collection with nothing in it says so and points somewhere. */}
        {accession.volumes === 0 ? (
          <p style={styles.accessionEmpty}>
            {accession.shelves === 0
              ? 'No shelves yet. Build one, then scan or search a book onto it — the figures fill in from there.'
              : 'Nothing filed yet. Open a shelf and scan a barcode to start the record.'}
          </p>
        ) : (
        <>
        <div className="stat-grid">
          <div>
            <div className="stat-value">{accession.volumes}</div>
            <div className="stat-label">Volumes</div>
          </div>
          <div>
            <div className="stat-value">{accession.shelves}</div>
            <div className="stat-label">Shelves</div>
          </div>
          <div>
            {/*
              Colour tracks the value, not the metric. Nothing has been read
              yet at 0%, so painting it green reports an achievement that has
              not happened; it falls back to the neutral stat colour until
              there is progress to celebrate.
            */}
            <div
              className="stat-value"
              style={accession.readPct > 0 ? { color: 'var(--success-color)' } : undefined}
            >
              {accession.readPct}%
            </div>
            <div className="stat-label">Read</div>
          </div>
          <div>
            <div className="stat-value" style={{ color: 'var(--accent-color)' }}>
              {accession.filed}
            </div>
            <div className="stat-label">Filed this month</div>
          </div>
        </div>

        <div style={{ marginTop: '18px' }}>
          <div className="meter">
            <span
              style={{ width: `${accession.readPct}%`, background: 'var(--success-color)' }}
            />
          </div>
          <div className="meter-key">
            <span>
              <span className="meter-swatch" style={{ background: 'var(--success-color)' }} />
              {accession.read} READ
            </span>
            <span>
              <span
                className="meter-swatch"
                style={{ background: 'var(--sunk)', border: '1px solid var(--rule)' }}
              />
              {accession.unread} UNREAD
            </span>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Personal Bookshelves */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <BookOpen size={17} style={{ color: 'var(--accent-color)' }} />
          <h2 style={styles.sectionTitle}>Personal Bookshelves</h2>
          <span className="typed" style={styles.sectionCount}>
            {personalShelves.length} {personalShelves.length === 1 ? 'drawer' : 'drawers'}
          </span>
        </div>
        <hr className="rule-double" style={{ margin: '0 0 16px' }} />

        {personalShelves.length === 0 ? (
          <div style={styles.emptyCard}>
            <Compass size={34} style={{ color: 'var(--text-muted)' }} />
            <p style={{ color: 'var(--text-secondary)' }}>
              You haven't created any bookshelves yet.
            </p>
            <button className="btn btn-secondary" onClick={() => setIsModalOpen(true)}>
              Create Your First Shelf
            </button>
          </div>
        ) : (
          <div style={styles.shelfGrid}>{personalShelves.map(shelfCard)}</div>
        )}
      </section>

      {/* Shared & Collaborative */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <Users size={17} style={{ color: 'var(--success-color)' }} />
          <h2 style={styles.sectionTitle}>Shared With Me</h2>
          <span className="typed" style={styles.sectionCount}>
            {sharedShelves.length} {sharedShelves.length === 1 ? 'drawer' : 'drawers'}
          </span>
        </div>
        <hr className="rule-double" style={{ margin: '0 0 16px' }} />

        {sharedShelves.length === 0 ? (
          <div style={{ ...styles.emptyCard, padding: '30px 20px' }}>
            <p className="typed" style={{ color: 'var(--text-muted)' }}>
              No libraries have been shared with you yet.
            </p>
          </div>
        ) : (
          <div style={styles.shelfGrid}>{sharedShelves.map(shelfCard)}</div>
        )}
      </section>

      {/* Create Bookshelf Modal */}
      {isModalOpen && (
        <Modal
          onClose={() => setIsModalOpen(false)}
          eyebrow="New Entry"
          title="Construct Bookshelf"
          className="card-spine"
          busy={createLoading}
        >
            <hr className="rule-double" style={{ margin: '0 0 18px' }} />

            <form onSubmit={handleCreateShelf} style={styles.modalForm}>
              <div className="form-group">
                <label className="form-label" htmlFor="shelf-name">Bookshelf Name</label>
                <input
                  id="shelf-name"
                  type="text"
                  className="form-input"
                  value={newShelfName}
                  onChange={(e) => setNewShelfName(e.target.value)}
                  placeholder="e.g. Living Room Stack A"
                  required
                  disabled={createLoading}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="shelf-desc">Short Description</label>
                <textarea
                  id="shelf-desc"
                  className="form-input"
                  value={newShelfDesc}
                  onChange={(e) => setNewShelfDesc(e.target.value)}
                  placeholder="Where does this live? e.g. Oak bookcase by the window"
                  disabled={createLoading}
                />
              </div>

              <div style={styles.modalActions}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={createLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createLoading}>
                  {createLoading ? 'Filing…' : 'Create Shelf'}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Book Roulette Modal */}
      {isRouletteModalOpen && (
        <Modal
          onClose={handleCloseRoulette}
          eyebrow="Shelf Lottery"
          title="Book Roulette"
          width="440px"
          className="card-spine"
          busy={rouletteLoading}
          bodyStyle={{ textAlign: 'center' }}
        >
            <hr className="rule-double" style={{ margin: '0 0 18px' }} />

            {rouletteLoading && (
              <div style={styles.rouletteState}>
                <RefreshCw size={30} className="spin" style={{ color: 'var(--accent-color)' }} />
                <span className="typed">Drawing from the drawer…</span>
              </div>
            )}

            {rouletteError && (
              <div style={styles.rouletteState}>
                <AlertTriangle size={30} style={{ color: 'var(--danger-text)' }} />
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{rouletteError}</span>
                <button type="button" className="btn btn-secondary" onClick={handleCloseRoulette}>
                  Close
                </button>
              </div>
            )}

            {!rouletteLoading && rouletteBook && (
              <div style={styles.rouletteResult}>
                <BookVolume
                  title={rouletteBook.title}
                  author={rouletteBook.author}
                  coverUrl={rouletteBook.cover_image_url}
                  seed={rouletteBook.isbn || rouletteBook.id || rouletteBook.title}
                  style={{ width: '108px', marginBottom: '8px' }}
                />

                <h4 style={styles.rouletteBookTitle}>{rouletteBook.title}</h4>
                <p style={styles.rouletteBookAuthor}>
                  by {rouletteBook.author || 'Unknown Author'}
                </p>

                <span className="stamp stamp-tilt" style={styles.rouletteShelfContext}>
                  <MapPin size={11} />
                  {rouletteBook.bookshelf_name}
                </span>

                <div style={styles.rouletteActions}>
                  <button type="button" className="btn btn-secondary" onClick={fetchRouletteBook}>
                    <RefreshCw size={15} />
                    <span>Roll Again</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      handleCloseRoulette();
                      navigate(`/bookshelves/${rouletteBook.bookshelf_id}`);
                    }}
                  >
                    <span>Go To Shelf</span>
                  </button>
                </div>
              </div>
            )}
        </Modal>
      )}
    </div>
  );
}

const styles = {
  dashboardContainer: {
    paddingBottom: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '34px',
    width: '100%',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    width: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    gap: '18px',
    marginBottom: 0,
  },
  headerActions: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  errorText: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    padding: '11px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger-color)',
    background: 'color-mix(in srgb, var(--danger-color) 8%, transparent)',
    color: 'var(--danger-text)',
    fontSize: '0.85rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: 'var(--step-1)',
    fontWeight: 600,
  },
  sectionCount: {
    marginLeft: 'auto',
    color: 'var(--text-muted)',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  shelfGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(272px, 1fr))',
    gap: '16px',
  },
  shelfCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: '18px 20px 16px 24px',
    cursor: 'pointer',
    textDecoration: 'none',
    minHeight: '160px',
  },
  shelfCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
  },
  shelfName: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.22rem',
    fontWeight: 600,
    lineHeight: 1.25,
    color: 'var(--text-primary)',
  },
  shelfDesc: {
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.55,
    flex: 1,
  },
  shelfMeasure: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '10px',
    marginTop: '13px',
  },
  shelfCount: {
    marginLeft: 'auto',
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.95rem',
    fontWeight: 700,
    lineHeight: 1,
    color: 'var(--text-primary)',
  },
  accession: {
    padding: '20px 22px',
  },
  accessionHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '9px',
    marginBottom: '14px',
  },
  dottedFill: {
    flex: 1,
    borderTop: '1px dotted var(--rule)',
  },
  accessionStamp: {
    fontSize: '0.63rem',
    letterSpacing: '0.1em',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  accessionEmpty: {
    fontSize: '0.88rem',
    lineHeight: 1.6,
    color: 'var(--text-secondary)',
    maxWidth: '460px',
  },
  cardFooter: {
    borderTop: '1px solid var(--rule)',
    paddingTop: '10px',
    marginTop: '12px',
  },
  footerText: {
    color: 'var(--text-muted)',
    fontSize: '0.68rem',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  emptyCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '44px 20px',
    textAlign: 'center',
    gap: '14px',
    border: '1.5px dashed var(--rule)',
    borderRadius: 'var(--radius-md)',
    background: 'color-mix(in srgb, var(--bg-secondary) 45%, transparent)',
  },
  modalForm: {
    display: 'flex',
    flexDirection: 'column',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '6px',
  },
  rouletteState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '14px',
    padding: '28px 0',
  },
  rouletteResult: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
  },
  rouletteBookTitle: {
    fontSize: '1.2rem',
    fontWeight: 600,
    lineHeight: 1.3,
    maxWidth: '340px',
  },
  rouletteBookAuthor: {
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
  },
  rouletteShelfContext: {
    marginTop: '8px',
  },
  rouletteActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    marginTop: '20px',
    width: '100%',
  },
};
