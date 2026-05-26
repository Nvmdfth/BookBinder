import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthProvider';
import { 
  ShieldAlert, Settings, ToggleLeft, ToggleRight, Trash2, Users, 
  BookOpen, AlertCircle, CheckCircle, Database, RefreshCw, Key, 
  X, Copy, UserCheck, UserMinus, ShieldCheck, Library
} from 'lucide-react';

export default function AdminConsole() {
  const { user: currentUser, isAdmin } = useAuth();
  
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

  // User Management Modals State
  const [resettingUser, setResettingUser] = useState(null); // User currently selected for password reset
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [copiedSuccess, setCopiedSuccess] = useState(false);
  const [deletingUser, setDeletingUser] = useState(null); // User currently selected for deletion
  const [deleteEmailConfirm, setDeleteEmailConfirm] = useState('');

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

      // 3. Fetch accounts list (returns bookshelf and physical book counts!) (Req 38)
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

  // Toggle user active/disabled status (Req 38 / 4.3 disabled)
  const handleToggleUserStatus = async (targetUser) => {
    if (targetUser.id === currentUser.id) return; // Safeguard

    const newDisabledState = !targetUser.is_disabled;
    try {
      const res = await fetch(`/api/settings/users/${targetUser.id}/disable`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_disabled: newDisabledState }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user status.');

      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, is_disabled: newDisabledState } : u))
      );
      setSuccessMsg(`Status updated successfully: "${targetUser.email}" is now ${newDisabledState ? 'disabled' : 'active'}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  // Toggle user role between user and admin (Req 38 promotion)
  const handleToggleUserRole = async (targetUser) => {
    if (targetUser.id === currentUser.id) return; // Safeguard

    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    const confirmMsg = newRole === 'admin' 
      ? `Promote "${targetUser.email}" to Administrator?` 
      : `Demote "${targetUser.email}" to standard user?`;

    if (!confirm(confirmMsg)) return;

    try {
      const res = await fetch(`/api/settings/users/${targetUser.id}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update user role.');

      setUsers((prev) =>
        prev.map((u) => (u.id === targetUser.id ? { ...u, role: newRole } : u))
      );
      setSuccessMsg(`Role updated successfully: "${targetUser.email}" is now an ${newRole}.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      alert(err.message);
    }
  };

  // Generate secure random password helper (Req 38)
  const generateRandomPassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let pass = 'BB-';
    for (let i = 0; i < 8; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setResetPasswordVal(pass);
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resettingUser || !resetPasswordVal.trim()) return;

    try {
      const res = await fetch(`/api/settings/users/${resettingUser.id}/reset-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPasswordVal }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password reset failed.');

      setSuccessMsg(`Password reset successfully for "${resettingUser.email}". Active sessions revoked.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      
      // Auto copy credentials popup
      navigator.clipboard.writeText(resetPasswordVal).catch(() => {});
      setCopiedSuccess(true);
      setTimeout(() => setCopiedSuccess(false), 2000);

    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteUser = async (e) => {
    e.preventDefault();
    if (!deletingUser || deleteEmailConfirm.trim().toLowerCase() !== deletingUser.email) return;

    try {
      const res = await fetch(`/api/settings/users/${deletingUser.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'User deletion failed.');

      setUsers((prev) => prev.filter((u) => u.id !== deletingUser.id));
      setDeletingUser(null);
      setDeleteEmailConfirm('');
      setSuccessMsg(`🗑️ Permanent Cascade: Purged user account and all physical library assets.`);
      setTimeout(() => setSuccessMsg(null), 4000);
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
        <p style={styles.subtitle}>Enforce system switches, manage accounts, audit physical metadata, and clean cache catalogs.</p>
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

        {/* Global Catalog Orphan Index Pruner */}
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

        {/* 👥 User Account audits & management console (v1.1) */}
        <div style={{ ...styles.card, flex: '1 1 100%' }} className="glass-panel">
          <h2 style={styles.cardTitle}>
            <Users size={20} style={{ color: 'var(--accent-color)' }} />
            <span>Accounts User Audits & Controls</span>
          </h2>
          
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Email Address</th>
                  <th style={styles.th}>System Role</th>
                  <th style={styles.th}>Physical Inventory</th>
                  <th style={styles.th}>Account Status</th>
                  <th style={{ ...styles.th, textAlign: 'right' }}>Administration Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isSelf = u.id === currentUser.id;
                  return (
                    <tr key={u.id} style={styles.tr}>
                      {/* Email and avatar */}
                      <td style={styles.td}>
                        <div style={styles.tableUserEmail}>
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt="" style={styles.tableAvatarImg} />
                          ) : (
                            <div style={styles.tableAvatarFallback}>{u.email.slice(0, 2).toUpperCase()}</div>
                          )}
                          <div style={styles.userTableEmailBlock}>
                            <span style={styles.tableEmailText}>{u.email}</span>
                            {isSelf && <span style={styles.selfLabel}>Current User</span>}
                          </div>
                        </div>
                      </td>

                      {/* Role & promoting triggers */}
                      <td style={styles.td}>
                        <div style={styles.roleBlock}>
                          <span style={{
                            ...styles.roleBadge,
                            backgroundColor: u.role === 'admin' ? 'var(--accent-light)' : 'var(--bg-primary)',
                            color: u.role === 'admin' ? 'var(--accent-color)' : 'var(--text-secondary)',
                            border: '1px solid var(--border-glass)'
                          }}>
                            {u.role}
                          </span>
                          {!isSelf && (
                            <button 
                              style={styles.inlineActionBtn}
                              onClick={() => handleToggleUserRole(u)}
                              title={u.role === 'admin' ? 'Demote to standard user' : 'Promote to administrator'}
                            >
                              <ShieldCheck size={14} />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* 📍 Physical inventory statistics (Req 38 / 4.2.1 Metadata Summary) */}
                      <td style={styles.td}>
                        <div style={styles.statsCol}>
                          <span style={styles.statsPill}>
                            <Library size={12} />
                            <span>{u.bookshelf_count} shelves</span>
                          </span>
                          <span style={{ ...styles.statsPill, backgroundColor: 'rgba(16, 185, 129, 0.08)', color: 'var(--success-color)' }}>
                            <BookOpen size={12} />
                            <span>{u.book_count} books</span>
                          </span>
                        </div>
                      </td>

                      {/* Status switches (Active vs. Disabled) */}
                      <td style={styles.td}>
                        {u.is_disabled ? (
                          <span style={{ ...styles.statusBadge, ...styles.badgeDisabled }}>Disabled</span>
                        ) : (
                          <span style={{ ...styles.statusBadge, ...styles.badgeActive }}>Active</span>
                        )}
                      </td>

                      {/* interactive user management console */}
                      <td style={{ ...styles.td, textAlign: 'right' }}>
                        <div style={styles.actionsCell}>
                          {isSelf ? (
                            <span style={styles.shieldedLabel}>Shielded</span>
                          ) : (
                            <>
                              {/* Enable/Disable Toggle */}
                              <button
                                style={{
                                  ...styles.actionIconBtn,
                                  color: u.is_disabled ? 'var(--success-color)' : 'var(--warning-color)'
                                }}
                                onClick={() => handleToggleUserStatus(u)}
                                title={u.is_disabled ? 'Enable Account' : 'Disable Account'}
                              >
                                {u.is_disabled ? <UserCheck size={18} /> : <UserMinus size={18} />}
                              </button>

                              {/* Reset Password */}
                              <button
                                style={{ ...styles.actionIconBtn, color: 'var(--accent-color)' }}
                                onClick={() => {
                                  setResettingUser(u);
                                  setResetPasswordVal('');
                                }}
                                title="Reset User Password"
                              >
                                <Key size={18} />
                              </button>

                              {/* Cascade Delete User */}
                              <button
                                style={{ ...styles.actionIconBtn, color: 'var(--danger-color)' }}
                                onClick={() => {
                                  setDeletingUser(u);
                                  setDeleteEmailConfirm('');
                                }}
                                title="Permanently Delete User"
                              >
                                <Trash2 size={18} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 🗝️ Password Reset Modal Overlay */}
      {resettingUser && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="glass-panel">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Password Reset Console</h3>
              <button style={styles.closeModalBtn} onClick={() => setResettingUser(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleResetPassword} style={styles.modalForm}>
              <div style={styles.warningSummaryRow}>
                <Key size={18} style={{ color: 'var(--accent-color)' }} />
                <span>Resetting password for: <strong>{resettingUser.email}</strong></span>
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">New Password</label>
                <div style={styles.pwdInputRow}>
                  <input
                    type="text"
                    className="form-input"
                    value={resetPasswordVal}
                    onChange={(e) => setResetPasswordVal(e.target.value)}
                    placeholder="Enter or generate temporary password"
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={generateRandomPassword}
                    style={styles.genBtn}
                  >
                    Generate Random
                  </button>
                </div>
              </div>

              {copiedSuccess && (
                <div style={styles.copiedBanner}>
                  <Copy size={14} />
                  <span>New password copied to clipboard!</span>
                </div>
              )}

              <div style={styles.modalActions}>
                <button type="button" className="btn btn-secondary" onClick={() => setResettingUser(null)}>
                  Close
                </button>
                <button type="submit" className="btn btn-primary">
                  Confirm Password Reset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 🗑️ Cascade Deletion Safety Warning Modal (Req 38 cascade) */}
      {deletingUser && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard} className="glass-panel error-shake">
            <div style={styles.modalHeader}>
              <h3 style={{ ...styles.modalTitle, color: 'var(--danger-color)' }}>⚠️ Permanent Cascade Deletion</h3>
              <button style={styles.closeModalBtn} onClick={() => setDeletingUser(null)}>
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleDeleteUser} style={styles.modalForm}>
              <div style={styles.dangerSummaryRow}>
                <AlertCircle size={24} />
                <div>
                  <h4 style={styles.dangerSummaryTitle}>Warning: Irreversible Purge</h4>
                  <p style={styles.dangerSummaryDesc}>
                    This will permanently delete the user account and **completely erase all bookshelves, shared libraries, and physical book catalog mappings** owned by this account.
                  </p>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">
                  To confirm, please type the recipient email address: <strong>{deletingUser.email}</strong>
                </label>
                <input
                  type="text"
                  className="form-input"
                  value={deleteEmailConfirm}
                  onChange={(e) => setDeleteEmailConfirm(e.target.value)}
                  placeholder="Type user's exact email address"
                  required
                />
              </div>

              <div style={styles.modalActions}>
                <button type="button" className="btn btn-secondary" onClick={() => setDeletingUser(null)}>
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="btn btn-danger" 
                  disabled={deleteEmailConfirm.trim().toLowerCase() !== deletingUser.email}
                >
                  Permanently Purge Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
    verticalAlign: 'middle',
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
  userTableEmailBlock: {
    display: 'flex',
    flexDirection: 'column',
  },
  tableEmailText: {
    fontWeight: '600',
  },
  selfLabel: {
    fontSize: '0.7rem',
    color: 'var(--accent-color)',
    fontWeight: '700',
    letterSpacing: '0.02em',
  },
  shieldedLabel: {
    fontSize: '0.75rem',
    fontWeight: '700',
    color: 'var(--text-muted)',
    backgroundColor: 'var(--bg-primary)',
    padding: '4px 12px',
    borderRadius: '4px',
    border: '1px solid var(--border-glass)',
  },
  roleBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  roleBadge: {
    fontSize: '0.7rem',
    fontWeight: '850',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
  },
  inlineActionBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    borderRadius: '4px',
    transition: 'var(--transition-smooth)',
  },
  statsCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statsPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.75rem',
    fontWeight: '700',
    color: 'var(--accent-color)',
    backgroundColor: 'var(--accent-light)',
    padding: '2px 8px',
    borderRadius: '4px',
    width: 'fit-content',
  },
  statusBadge: {
    fontSize: '0.7rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    padding: '4px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
    width: 'fit-content',
    display: 'inline-block',
  },
  badgeActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
  },
  badgeDisabled: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
  },
  actionsCell: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  actionIconBtn: {
    background: 'none',
    cursor: 'pointer',
    padding: '6px',
    borderRadius: '4px',
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'var(--bg-secondary)',
    border: '1px solid var(--border-glass)',
    transition: 'var(--transition-smooth)',
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
    gap: '12px',
  },
  warningSummaryRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
    fontSize: '0.85rem',
    border: '1px solid var(--border-glass)',
  },
  dangerSummaryRow: {
    display: 'flex',
    gap: '12px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    color: 'var(--danger-color)',
    border: '1px solid rgba(239, 68, 68, 0.15)',
  },
  dangerSummaryTitle: {
    fontSize: '0.95rem',
    fontWeight: '750',
  },
  dangerSummaryDesc: {
    fontSize: '0.8rem',
    lineHeight: '1.4',
    marginTop: '2px',
    color: 'var(--text-secondary)',
  },
  pwdInputRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  genBtn: {
    height: '45px',
    fontSize: '0.85rem',
    padding: '0 12px',
  },
  copiedBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.8rem',
    color: 'var(--success-color)',
    fontWeight: '700',
    marginTop: '2px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '12px',
  },
};
