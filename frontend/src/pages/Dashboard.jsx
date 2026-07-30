import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderPlus, Compass, Users, X, BookOpen, Sparkles, RefreshCw,
  AlertTriangle, Book, MapPin,
} from 'lucide-react';

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

  /** Stamp treatment per access scope, mirroring the RBAC vocabulary. */
  const roleStamp = (shelf) => {
    if (shelf.is_wishlist) return <span className="stamp stamp-tilt stamp-warning">★ Wishlist</span>;
    if (shelf.role === 'owner') return <span className="stamp stamp-tilt">Owner</span>;
    if (shelf.role === 'collaborator') return <span className="stamp stamp-tilt stamp-success">Collaborator</span>;
    return <span className="stamp stamp-tilt stamp-muted">View Only</span>;
  };

  const shelfCard = (shelf, index) => (
    <Link
      key={shelf.id}
      to={`/bookshelves/${shelf.id}`}
      className="card card-spine card-link card-in"
      style={{ ...styles.shelfCard, animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <div style={styles.shelfCardHeader}>
        <h3 style={styles.shelfName}>{shelf.name}</h3>
        {roleStamp(shelf)}
      </div>

      <hr className="rule-line" style={{ margin: '2px 0 10px' }} />

      <p style={styles.shelfDesc}>
        {shelf.description || 'No descriptive notes added yet.'}
      </p>

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
        <div style={styles.modalOverlay} onClick={() => !createLoading && setIsModalOpen(false)}>
          <div
            className="card card-spine card-in"
            style={styles.modalCard}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div>
                <span className="eyebrow">New Entry</span>
                <h3 style={styles.modalTitle}>Construct Bookshelf</h3>
              </div>
              <button
                className="btn btn-ghost"
                style={styles.closeModalBtn}
                onClick={() => setIsModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

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
          </div>
        </div>
      )}

      {/* Book Roulette Modal */}
      {isRouletteModalOpen && (
        <div style={styles.modalOverlay} onClick={() => !rouletteLoading && handleCloseRoulette()}>
          <div
            className="card card-spine card-in"
            style={{ ...styles.modalCard, maxWidth: '440px', textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.modalHeader}>
              <div style={{ textAlign: 'left' }}>
                <span className="eyebrow">Shelf Lottery</span>
                <h3 style={styles.modalTitle}>Book Roulette</h3>
              </div>
              <button
                className="btn btn-ghost"
                style={styles.closeModalBtn}
                onClick={handleCloseRoulette}
                disabled={rouletteLoading}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <hr className="rule-double" style={{ margin: '0 0 18px' }} />

            {rouletteLoading && (
              <div style={styles.rouletteState}>
                <RefreshCw size={30} className="spin" style={{ color: 'var(--accent-color)' }} />
                <span className="typed">Drawing from the drawer…</span>
              </div>
            )}

            {rouletteError && (
              <div style={styles.rouletteState}>
                <AlertTriangle size={30} style={{ color: 'var(--danger-color)' }} />
                <span style={{ fontSize: '0.88rem', fontWeight: 600 }}>{rouletteError}</span>
                <button type="button" className="btn btn-secondary" onClick={handleCloseRoulette}>
                  Close
                </button>
              </div>
            )}

            {!rouletteLoading && rouletteBook && (
              <div style={styles.rouletteResult}>
                {rouletteBook.cover_image_url ? (
                  <img
                    src={rouletteBook.cover_image_url}
                    alt=""
                    style={styles.rouletteCover}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div
                  style={{
                    ...styles.rouletteCoverFallback,
                    display: rouletteBook.cover_image_url ? 'none' : 'flex',
                  }}
                >
                  <Book size={30} />
                </div>

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
          </div>
        </div>
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
    color: 'var(--danger-color)',
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
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
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(28, 20, 12, 0.55)',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  modalCard: {
    width: '100%',
    maxWidth: '480px',
    padding: '22px 26px 26px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '10px',
  },
  modalTitle: {
    fontSize: 'var(--step-2)',
    fontWeight: 600,
    marginTop: '2px',
  },
  closeModalBtn: {
    minHeight: '32px',
    padding: '6px',
    marginTop: '2px',
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
  rouletteCover: {
    height: '168px',
    borderRadius: 'var(--radius-xs)',
    boxShadow: 'var(--shadow-md)',
    objectFit: 'cover',
    border: '1px solid var(--rule)',
    marginBottom: '6px',
  },
  rouletteCoverFallback: {
    height: '168px',
    width: '112px',
    borderRadius: 'var(--radius-xs)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--rule)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: 'var(--shadow-md)',
    marginBottom: '6px',
    color: 'var(--text-muted)',
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
