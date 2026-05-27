import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Library, FolderPlus, Compass, Users, Plus, X, BookOpen, Sparkles, RefreshCw, AlertTriangle, Book } from 'lucide-react';

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

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div className="skeleton" style={{ width: '200px', height: '32px', marginBottom: '20px' }}></div>
        <div style={styles.shelfGrid}>
          {[1, 2, 3].map((n) => (
            <div key={n} className="skeleton" style={{ height: '160px' }}></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.dashboardContainer}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.welcomeTitle}>My Libraries</h1>
          <p style={styles.welcomeSub}>Catalog, sort, and collaborate on home physical inventory.</p>
        </div>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button className="btn btn-secondary" onClick={handleOpenRoulette} style={styles.rouletteHeaderBtn}>
            <Sparkles size={18} style={{ color: 'var(--accent-color)', marginRight: '6px' }} />
            <span>Book Roulette</span>
          </button>
          
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <FolderPlus size={20} />
            <span>New Bookshelf</span>
          </button>
        </div>
      </header>

      {error && <div className="error-shake" style={styles.errorText}>{error}</div>}

      {/* 🏡 Personal Bookshelves Grid */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <BookOpen size={20} style={{ color: 'var(--accent-color)' }} />
          <h2 style={styles.sectionTitle}>Personal Bookshelves</h2>
        </div>

        {personalShelves.length === 0 ? (
          <div style={styles.emptyCard} className="glass-panel">
            <Compass size={40} style={{ color: 'var(--text-muted)' }} />
            <p>You haven't created any bookshelves yet.</p>
            <button className="btn btn-secondary" onClick={() => setIsModalOpen(true)}>
              Create Your First Shelf
            </button>
          </div>
        ) : (
          <div style={styles.shelfGrid}>
            {personalShelves.map((shelf) => (
              <Link key={shelf.id} to={`/bookshelves/${shelf.id}`} style={styles.shelfCard} className="glass-panel">
                <div style={styles.shelfCardHeader}>
                  <h3 style={styles.shelfName}>{shelf.name}</h3>
                  {shelf.is_wishlist ? (
                    <span style={{ ...styles.badge, ...styles.badgeWishlist }}>★ Wishlist</span>
                  ) : (
                    <span style={{ ...styles.badge, ...styles.badgeOwner }}>Owner</span>
                  )}
                </div>
                <p style={styles.shelfDesc}>{shelf.description || 'No descriptive notes added yet.'}</p>
                <div style={styles.cardFooter}>
                  <span>Indexed Catalog</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 👥 Shared Collaborative Bookshelves Grid */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <Users size={20} style={{ color: '#10b981' }} />
          <h2 style={styles.sectionTitle}>Shared & Collaborative Libraries</h2>
        </div>

        {sharedShelves.length === 0 ? (
          <div style={{ ...styles.emptyCard, minHeight: '120px' }} className="glass-panel">
            <p style={{ color: 'var(--text-muted)' }}>No libraries have been shared with you yet.</p>
          </div>
        ) : (
          <div style={styles.shelfGrid}>
            {sharedShelves.map((shelf) => (
              <Link key={shelf.id} to={`/bookshelves/${shelf.id}`} style={styles.shelfCard} className="glass-panel">
                <div style={styles.shelfCardHeader}>
                  <h3 style={styles.shelfName}>{shelf.name}</h3>
                  {shelf.is_wishlist ? (
                    <span style={{ ...styles.badge, ...styles.badgeWishlist }}>★ Wishlist</span>
                  ) : (
                    <span
                      style={{
                        ...styles.badge,
                        ...(shelf.role === 'collaborator' ? styles.badgeCollab : styles.badgeViewer),
                      }}
                    >
                      {shelf.role}
                    </span>
                  )}
                </div>
                <p style={styles.shelfDesc}>{shelf.description || 'No descriptive notes added yet.'}</p>
                <div style={styles.cardFooter}>
                  <span style={styles.ownerContext}>Owner: {shelf.owner_email}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* 🛠️ Create Bookshelf Modal Overlay */}
      {isModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="glass-panel error-shake">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Construct New Bookshelf</h3>
              <button style={styles.closeModalBtn} onClick={() => setIsModalOpen(false)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateShelf} style={styles.modalForm}>
              <div className="form-group">
                <label className="form-label">Bookshelf Name</label>
                <input
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
                <label className="form-label">Short Description</label>
                <textarea
                  className="form-input"
                  style={{ minHeight: '100px', resize: 'none' }}
                  value={newShelfDesc}
                  onChange={(e) => setNewShelfDesc(e.target.value)}
                  placeholder="Describe where this is situated (e.g. Oak wood bookcase by the window)"
                  disabled={createLoading}
                />
              </div>

              <div style={styles.modalActions}>
                <button type="button" className="btn btn-secondary" onClick={() => setIsModalOpen(false)} disabled={createLoading}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={createLoading}>
                  {createLoading ? 'Building...' : 'Create Shelf'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* 🎰 Book Roulette Modal Overlay */}
      {isRouletteModalOpen && (
        <div style={styles.modalOverlay}>
          <div style={styles.rouletteModalCard} className="glass-panel">
            <div style={{ ...styles.modalHeader, width: '100%' }}>
              <h3 style={styles.modalTitle}>
                <Sparkles size={20} style={{ color: 'var(--accent-color)', verticalAlign: 'middle', marginRight: '8px' }} />
                <span>Book Roulette Selection</span>
              </h3>
              <button style={styles.closeModalBtn} onClick={handleCloseRoulette} disabled={rouletteLoading}>
                <X size={20} />
              </button>
            </div>

            {rouletteLoading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: '12px' }}>
                <RefreshCw size={36} className="spin" style={{ color: 'var(--accent-color)' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: '600' }}>Choosing your next read...</span>
              </div>
            )}

            {rouletteError && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', gap: '12px', textAlign: 'center' }}>
                <AlertTriangle size={36} style={{ color: 'var(--danger-color)' }} />
                <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: '700' }}>{rouletteError}</span>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={handleCloseRoulette}
                  style={{ height: '36px', fontSize: '0.8rem', marginTop: '12px' }}
                >
                  Close
                </button>
              </div>
            )}

            {!rouletteLoading && rouletteBook && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%' }}>
                {rouletteBook.cover_image_url ? (
                  <img 
                    src={rouletteBook.cover_image_url} 
                    alt="" 
                    style={styles.rouletteCover} 
                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                  />
                ) : null}
                <div style={{ ...styles.rouletteCoverFallback, display: rouletteBook.cover_image_url ? 'none' : 'flex' }}>
                  <Book size={32} />
                </div>

                <div style={styles.rouletteBookTitle}>{rouletteBook.title}</div>
                <div style={styles.rouletteBookAuthor}>by {rouletteBook.author || 'Unknown Author'}</div>
                
                <span style={styles.rouletteShelfContext}>
                  📍 Located on shelf: <strong>{rouletteBook.bookshelf_name}</strong>
                </span>

                <div style={{ ...styles.modalActions, marginTop: '20px', gap: '16px', justifyContent: 'center', width: '100%' }}>
                  <button 
                    type="button" 
                    className="btn btn-secondary" 
                    onClick={fetchRouletteBook}
                    style={{ height: '40px', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RefreshCw size={16} />
                    <span>Roll Again</span>
                  </button>
                  <button 
                    type="button" 
                    className="btn btn-primary" 
                    onClick={() => {
                      handleCloseRoulette();
                      navigate(`/bookshelves/${rouletteBook.bookshelf_id}`);
                    }}
                    style={{ height: '40px' }}
                  >
                    <span>Read Now</span>
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
    paddingBottom: '40px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    width: '100%',
  },
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    width: '100%',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
  },
  welcomeTitle: {
    fontSize: '2.25rem',
    fontWeight: 800,
  },
  welcomeSub: {
    color: 'var(--text-secondary)',
    fontSize: '0.95rem',
  },
  errorText: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
    fontSize: '0.85rem',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTitle: {
    fontSize: '1.25rem',
    fontWeight: 750,
  },
  shelfGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '20px',
  },
  shelfCard: {
    display: 'flex',
    flexDirection: 'column',
    padding: '24px',
    borderRadius: 'var(--radius-md)',
    gap: '12px',
    cursor: 'pointer',
    textDecoration: 'none',
  },
  shelfCardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
  },
  shelfName: {
    fontSize: '1.15rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  shelfDesc: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
    flex: 1,
  },
  badge: {
    fontSize: '0.7rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
  },
  badgeOwner: {
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent-color)',
  },
  badgeWishlist: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    color: '#eab308',
    border: '1px solid rgba(234, 179, 8, 0.2)',
  },
  badgeCollab: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: '#10b981',
  },
  badgeViewer: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    color: '#f59e0b',
  },
  cardFooter: {
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '12px',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontWeight: '600',
  },
  ownerContext: {
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
  },
  emptyCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px 20px',
    textAlign: 'center',
    borderRadius: 'var(--radius-md)',
    gap: '16px',
    color: 'var(--text-secondary)',
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    backdropFilter: 'blur(4px)',
  },
  modalCard: {
    width: '100%',
    maxWidth: '500px',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: 'var(--shadow-lg)',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: '1.25rem',
    fontWeight: '750',
  },
  closeModalBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
  },
  modalForm: {
    display: 'flex',
    flexDirection: 'column',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px',
  },
  rouletteHeaderBtn: {
    height: '42px',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 16px',
    fontSize: '0.9rem',
    fontWeight: '600',
  },
  rouletteModalCard: {
    width: '100%',
    maxWidth: '460px',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    boxShadow: 'var(--shadow-lg)',
    borderRadius: 'var(--radius-lg)',
    textAlign: 'center',
    alignItems: 'center',
  },
  rouletteCover: {
    height: '180px',
    borderRadius: 'var(--radius-sm)',
    boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
    objectFit: 'cover',
    marginBottom: '8px',
  },
  rouletteCoverFallback: {
    height: '180px',
    width: '120px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 6px 16px rgba(0,0,0,0.5)',
    marginBottom: '8px',
    color: 'var(--text-muted)',
  },
  rouletteBookTitle: {
    fontSize: '1.2rem',
    fontWeight: '800',
    lineHeight: '1.3',
    color: 'var(--text-primary)',
    maxWidth: '360px',
  },
  rouletteBookAuthor: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    fontWeight: '600',
    marginTop: '4px',
  },
  rouletteShelfContext: {
    fontSize: '0.8rem',
    color: 'var(--accent-color)',
    backgroundColor: 'var(--accent-light)',
    padding: '6px 14px',
    borderRadius: '16px',
    fontWeight: '700',
    marginTop: '8px',
    display: 'inline-block',
  },
};
