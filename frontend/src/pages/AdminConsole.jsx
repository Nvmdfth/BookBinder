import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthProvider';
import { 
  ShieldAlert, Settings, ToggleLeft, ToggleRight, Trash2, Users, 
  BookOpen, AlertCircle, CheckCircle, Database, Eye, RefreshCw
} from 'lucide-react';

export default function AdminConsole() {
  const { isAdmin } = useAuth();
  
  // Settings values
  const [settings, setSettings] = useState({
    allow_open_registration: 'false',
    enable_google_books: 'true',
    enable_open_library: 'true',
  });

  const [users, setUsers] = useState([]);
  const [orphanData, setOrphanData] = useState({ count: 0, orphans: [] });
  
  const [loading, setLoading] = useState(true);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const fetchAdminData = async () => {
    try {
      // 1. Fetch settings
      const settingsRes = await fetch('/api/settings');
      if (!settingsRes.ok) throw new Error('Failed to resolve settings.');
      const settingsData = await settingsRes.json();
      setSettings(settingsData);

      // 2. Fetch orphans list (Req 2.39 / 4.2.1 Secure Preview)
      const orphansRes = await fetch('/api/settings/orphans');
      if (orphansRes.ok) {
        const orphansData = await orphansRes.json();
        setOrphanData(orphansData);
      }

      // 3. Fetch accounts list
      const usersRes = await fetch('/api/settings/users');
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        setUsers(usersData);
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchAdminData();
    }
  }, [isAdmin]);

  const handleToggleSetting = async (key, currentValue) => {
    const newValue = currentValue === 'true' ? 'false' : 'true';
    const updatedSettings = { ...settings, [key]: newValue };
    
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save system parameters.');

      setSettings(data.settings);
      setSuccessMsg(`System switch "${key}" updated successfully.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  const handlePruneOrphans = async () => {
    if (!confirm(`⚠️ DANGER: Are you sure you want to bulk prune all ${orphanData.count} orphaned book catalog records? This will clear caching indexes that are not physically mapped on user shelves.`)) return;

    setCleanLoading(true);
    try {
      const res = await fetch('/api/settings/orphans/prune', {
        method: 'POST',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Database cleanup execution failed.');

      setOrphanData({ count: 0, orphans: [] });
      setSuccessMsg(`🧹 DB Cleanup Success: Pruned ${data.prunedCount} orphaned global books cache records.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err) {
      alert(err.message);
    } finally {
      setCleanLoading(false);
    }
  };

  // Helper handling image failures
  const handleImageError = (e) => {
    e.target.style.display = 'none';
    e.target.nextSibling.style.display = 'flex';
  };

  if (!isAdmin) {
    return (
      <div style={styles.errorContainer} className="glass-panel error-shake">
        <ShieldAlert size={44} style={{ color: 'var(--danger-color)' }} />
        <h2>Privilege Access Violation</h2>
        <p>Forbidden. This console settings area requires administrative credentials access parameters.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="skeleton" style={{ height: '300px', width: '100%', borderRadius: 'var(--radius-md)' }}></div>
    );
  }

  return (
    <div style={styles.consoleContainer}>
      <header style={styles.header}>
        <h1 style={styles.title}>Administrative Console</h1>
        <p style={styles.subtitle}>Enforce system settings switches, prune lookup caches, and audit user logs.</p>
      </header>

      {successMsg && (
        <div style={styles.successBanner}>
          <CheckCircle size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {error && (
        <div style={styles.errorBanner} className="error-shake">
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      <div style={styles.grid}>
        {/* Toggles Panel */}
        <div style={styles.card} className="glass-panel">
          <h2 style={styles.cardTitle}>
            <Settings size={20} style={{ color: 'var(--accent-color)' }} />
            <span>System Switches</span>
          </h2>
          
          <div style={styles.togglesList}>
            {/* Open registration toggle switch (Req 4.4.3) */}
            <div style={styles.toggleRow}>
              <div>
                <h4 style={styles.toggleName}>Open Account Registration</h4>
                <p style={styles.toggleDesc}>Allow guest users to register accounts on this instance.</p>
              </div>
              <button 
                style={styles.toggleBtn} 
                onClick={() => handleToggleSetting('allow_open_registration', settings.allow_open_registration)}
              >
                {settings.allow_open_registration === 'true' ? (
                  <ToggleRight size={44} style={{ color: 'var(--accent-color)' }} />
                ) : (
                  <ToggleLeft size={44} style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            </div>

            {/* Google Books Switch */}
            <div style={styles.toggleRow}>
              <div>
                <h4 style={styles.toggleName}>Enable Google Books API</h4>
                <p style={styles.toggleDesc}>Query Google Books for ISBN lookups on barcode ingestion.</p>
              </div>
              <button 
                style={styles.toggleBtn} 
                onClick={() => handleToggleSetting('enable_google_books', settings.enable_google_books)}
              >
                {settings.enable_google_books === 'true' ? (
                  <ToggleRight size={44} style={{ color: 'var(--accent-color)' }} />
                ) : (
                  <ToggleLeft size={44} style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            </div>

            {/* OpenLibrary Switch */}
            <div style={styles.toggleRow}>
              <div>
                <h4 style={styles.toggleName}>Enable OpenLibrary API</h4>
                <p style={styles.toggleDesc}>Query OpenLibrary database for fallback ISBN barcode lookups.</p>
              </div>
              <button 
                style={styles.toggleBtn} 
                onClick={() => handleToggleSetting('enable_open_library', settings.enable_open_library)}
              >
                {settings.enable_open_library === 'true' ? (
                  <ToggleRight size={44} style={{ color: 'var(--accent-color)' }} />
                ) : (
                  <ToggleLeft size={44} style={{ color: 'var(--text-muted)' }} />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Global Catalog Orphan Index Pruner (Req 2.39 / 4.2.1 Clean) */}
        <div style={styles.card} className="glass-panel">
          <h2 style={styles.cardTitle}>
            <Database size={20} style={{ color: 'var(--success-color)' }} />
            <span>Global Books Catalog Cache</span>
          </h2>

          <div style={styles.cleaningConsole}>
            <div style={styles.orphanCountRow}>
              <span style={styles.orphanCountVal}>{orphanData.count}</span>
              <div>
                <h4 style={styles.orphanCountTitle}>Orphaned Catalog Entries</h4>
                <p style={styles.orphanCountDesc}>Cached records not physically mapped inside any user bookshelves.</p>
              </div>
            </div>

            {orphanData.count > 0 && (
              <>
                {/* Secure Preview count/list list (Finalized in /grill-me) */}
                <div style={styles.previewContainer}>
                  <h4 style={styles.previewTitle}>Orphan Previews</h4>
                  <div style={styles.previewList}>
                    {orphanData.orphans.map((o) => (
                      <div key={o.id} style={styles.previewRow}>
                        <div style={styles.previewCover}>
                          {o.cover_image_url ? (
                            <img src={o.cover_image_url} alt="" style={styles.previewCoverImg} onError={handleImageError} />
                          ) : null}
                          <div style={styles.previewCoverFallback}><BookOpen size={12} /></div>
                        </div>
                        <div style={styles.previewInfo}>
                          <span style={styles.previewBookTitle}>{o.title}</span>
                          <span style={styles.previewBookAuthor}>{o.author}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button 
                  className="btn btn-danger" 
                  onClick={handlePruneOrphans} 
                  disabled={cleanLoading}
                  style={styles.pruneBtn}
                >
                  <Trash2 size={18} />
                  <span>{cleanLoading ? 'Pruning cache...' : 'Bulk Prune Orphaned Records'}</span>
                </button>
              </>
            )}

            {orphanData.count === 0 && (
              <div style={styles.emptyOrphansCard}>
                <CheckCircle size={24} style={{ color: 'var(--success-color)' }} />
                <span>Global catalog index is 100% clean. No orphaned records found.</span>
              </div>
            )}
          </div>
        </div>

        {/* User Account audits console */}
        <div style={{ ...styles.card, flex: '1 1 100%' }} className="glass-panel">
          <h2 style={styles.cardTitle}>
            <Users size={20} style={{ color: 'var(--accent-color)' }} />
            <span>Accounts User Audits Logs</span>
          </h2>
          
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>User ID</th>
                  <th style={styles.th}>Email Address</th>
                  <th style={styles.th}>System Role</th>
                  <th style={styles.th}>Registered On</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={styles.tr}>
                    <td style={styles.td}>#{u.id}</td>
                    <td style={styles.td}>
                      <div style={styles.tableUserEmail}>
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" style={styles.tableAvatarImg} />
                        ) : (
                          <div style={styles.tableAvatarFallback}>{u.email.slice(0, 2).toUpperCase()}</div>
                        )}
                        <span>{u.email}</span>
                      </div>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.roleBadge,
                        backgroundColor: u.role === 'admin' ? 'rgba(99, 102, 241, 0.1)' : 'var(--bg-primary)',
                        color: u.role === 'admin' ? 'var(--accent-color)' : 'var(--text-secondary)'
                      }}>
                        {u.role}
                      </span>
                    </td>
                    <td style={styles.td}>{new Date(u.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const styles = {
  consoleContainer: {
    paddingBottom: '40px',
    display: 'flex',
    flexDirection: 'column',
    gap: '32px',
    width: '100%',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  title: {
    fontSize: '2.25rem',
    fontWeight: 800,
  },
  subtitle: {
    color: 'var(--text-secondary)',
    fontSize: '0.95rem',
  },
  successBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  grid: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    width: '100%',
  },
  card: {
    flex: 1,
    minWidth: '320px',
    padding: '30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    borderRadius: 'var(--radius-md)',
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: '750',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  togglesList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginTop: '8px',
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
    gap: '12px',
  },
  toggleName: {
    fontSize: '0.95rem',
    fontWeight: '700',
    color: 'var(--text-primary)',
  },
  toggleDesc: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
    marginTop: '2px',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    padding: '4px',
  },
  cleaningConsole: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    marginTop: '8px',
  },
  orphanCountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-glass)',
  },
  orphanCountVal: {
    fontSize: '2.5rem',
    fontWeight: '800',
    color: 'var(--danger-color)',
    lineHeight: '1',
  },
  orphanCountTitle: {
    fontSize: '0.95rem',
    fontWeight: '700',
  },
  orphanCountDesc: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    lineHeight: '1.4',
    marginTop: '2px',
  },
  previewContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  previewTitle: {
    fontSize: '0.85rem',
    fontWeight: '700',
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  previewList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '140px',
    overflowY: 'auto',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px',
    backgroundColor: 'var(--bg-primary)',
  },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '6px',
    borderBottom: '1px solid var(--border-glass)',
  },
  previewCover: {
    width: '32px',
    aspectRatio: '0.7',
    backgroundColor: 'rgba(0,0,0,0.05)',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '2px',
  },
  previewCoverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  previewCoverFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text-muted)',
  },
  previewInfo: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  previewBookTitle: {
    fontSize: '0.85rem',
    fontWeight: '700',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--text-primary)',
  },
  previewBookAuthor: {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)',
  },
  pruneBtn: {
    width: '100%',
  },
  emptyOrphansCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    border: '1px solid rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
  },
  th: {
    padding: '14px 16px',
    borderBottom: '1px solid var(--border-glass)',
    fontSize: '0.8rem',
    fontWeight: '800',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  tr: {
    borderBottom: '1px solid var(--border-glass)',
    transition: 'var(--transition-smooth)',
  },
  td: {
    padding: '14px 16px',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
  },
  tableUserEmail: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  tableAvatarImg: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    objectFit: 'cover',
  },
  tableAvatarFallback: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent-light)',
    color: 'var(--accent-color)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.7rem',
    fontWeight: '750',
  },
  roleBadge: {
    fontSize: '0.7rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '40px',
    textAlign: 'center',
    gap: '16px',
    maxWidth: '500px',
    margin: '40px auto',
  },
};
