import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Download, Upload, Key, Trash2, AlertTriangle, Copy } from 'lucide-react';

/** The exact phrase the API demands. Both surfaces teach the same contract. */
const CONFIRM_PHRASE = 'REPLACE_ALL_DATA';

const UPLOADS_BACKUP_CMD =
  'docker run --rm -v bookbinder-uploads-data:/data -v "$PWD":/backup alpine \\\n' +
  '  tar czf /backup/bookbinder-uploads-$(date +%F).tar.gz -C /data .';

/**
 * Database backup, restore, and the API tokens that let n8n do it on a schedule.
 *
 * Lives outside AdminConsole.jsx, which is already long enough that another
 * card's worth of state would make it harder to read than it already is.
 */
export default function BackupCard() {
  const [tokens, setTokens] = useState([]);
  const [tokenName, setTokenName] = useState('');
  const [mintedToken, setMintedToken] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [archive, setArchive] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const archiveInputRef = useRef(null);

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/tokens');
      if (res.ok) setTokens(await res.json());
    } catch {
      // A token list that fails to load must not take the backup controls with it.
    }
  }, []);

  useEffect(() => { loadTokens(); }, [loadTokens]);

  const handleDownload = async () => {
    setBusy('download');
    setError('');
    try {
      const res = await fetch('/api/admin/backup');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'The backup failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bookbinder-${new Date().toISOString().slice(0, 10)}.dump`;
      // Firefox and older Safari can silently drop the download if the anchor
      // isn't attached to the document when clicked, or if the object URL is
      // revoked before the click has been processed.
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice('Backup downloaded.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRestore = async () => {
    setBusy('restore');
    setError('');
    try {
      const body = new FormData();
      body.append('file', archive);
      body.append('confirm', CONFIRM_PHRASE);

      const res = await fetch('/api/admin/restore', { method: 'POST', body });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'The restore failed.');

      setNotice(payload.message || 'Database restored.');
      setConfirmText('');
      setArchive(null);
      // The input is uncontrolled (a controlled file input can't be re-populated
      // by React), so its displayed filename has to be cleared imperatively too.
      if (archiveInputRef.current) archiveInputRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleMintToken = async () => {
    setBusy('mint');
    setError('');
    try {
      const res = await fetch('/api/admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tokenName }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || 'Could not create the token.');

      setMintedToken(payload.token);
      setTokenName('');
      loadTokens();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const handleRevokeToken = async (id, name) => {
    setError('');
    try {
      const res = await fetch(`/api/admin/tokens/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Could not revoke "${name}".`);
      loadTokens();
    } catch (err) {
      setError(err.message);
    }
  };

  const restoreReady = confirmText === CONFIRM_PHRASE && archive !== null;

  return (
    <div style={styles.card} className="card">
      <h2 style={styles.cardTitle}>
        <Database size={20} style={{ color: 'var(--accent-color)' }} />
        <span>Database Backup &amp; Restore</span>
      </h2>

      {error && <div style={styles.error}>{error}</div>}
      {notice && <div style={styles.notice}>{notice}</div>}

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Download</h3>
        <button className="btn btn-primary" onClick={handleDownload} disabled={busy === 'download'}>
          <Download size={18} />
          <span>{busy === 'download' ? 'Dumping database...' : 'Download backup'}</span>
        </button>
        <p style={styles.help}>
          Avatar images are not included — they live in a separate Docker volume that no
          database dump can reach. Back them up alongside it:
        </p>
        <pre style={styles.code}>{UPLOADS_BACKUP_CMD}</pre>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>Restore</h3>
        <p style={styles.warning}>
          <AlertTriangle size={16} />
          <span>
            Restoring replaces every row in the database and cannot be undone. If the archive
            holds a different password for your account, you will be signed out.
          </span>
        </p>

        <label style={styles.label} htmlFor="restore-archive">Backup archive (.dump)</label>
        <input
          id="restore-archive"
          type="file"
          accept=".dump"
          ref={archiveInputRef}
          onChange={(e) => setArchive(e.target.files[0] || null)}
        />

        <label style={styles.label} htmlFor="restore-confirm">
          Type {CONFIRM_PHRASE} to confirm
        </label>
        <input
          id="restore-confirm"
          type="text"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={CONFIRM_PHRASE}
        />

        <button
          className="btn btn-danger"
          onClick={handleRestore}
          disabled={!restoreReady || busy === 'restore'}
        >
          <Upload size={18} />
          <span>{busy === 'restore' ? 'Restoring...' : 'Restore database'}</span>
        </button>
      </section>

      <section style={styles.section}>
        <h3 style={styles.sectionTitle}>API tokens</h3>
        <p style={styles.help}>
          For scheduled backups from n8n. A token grants full administrative access to
          every user&apos;s data and can trigger a restore — treat it as a password.
        </p>

        <label style={styles.label} htmlFor="token-name">Token name</label>
        <input
          id="token-name"
          type="text"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="n8n nightly"
        />
        <button
          className="btn btn-secondary"
          onClick={handleMintToken}
          disabled={!tokenName.trim() || busy === 'mint'}
        >
          <Key size={18} />
          <span>{busy === 'mint' ? 'Generating...' : 'Generate token'}</span>
        </button>

        {mintedToken && (
          <div style={styles.mintedBox}>
            <p style={styles.mintedWarning}>
              Copy this now — it will never be shown again.
            </p>
            <code style={styles.mintedValue}>{mintedToken}</code>
            <div style={styles.mintedActions}>
              <button
                className="btn btn-secondary"
                onClick={() => navigator.clipboard?.writeText(mintedToken)}
              >
                <Copy size={16} />
                <span>Copy</span>
              </button>
              <button className="btn btn-secondary" onClick={() => setMintedToken(null)}>
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        )}

        <ul style={styles.tokenList}>
          {tokens.map((t) => (
            <li key={t.id} style={styles.tokenRow}>
              <div>
                <span style={styles.tokenName}>{t.name}</span>
                <span style={styles.tokenMeta}>
                  {t.last_used_at
                    ? `Last used ${new Date(t.last_used_at).toLocaleDateString()}`
                    : 'Never used'}
                </span>
              </div>
              <button
                className="btn btn-danger"
                aria-label={`Revoke ${t.name}`}
                onClick={() => handleRevokeToken(t.id, t.name)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: 'var(--surface)',
    borderRadius: 'var(--radius-md)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    flex: '1 1 100%',
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--step-1)',
    fontWeight: 600,
  },
  section: { display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'flex-start' },
  sectionTitle: { fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-secondary)' },
  label: { fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 },
  help: { fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 },
  code: {
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.75rem',
    backgroundColor: 'var(--bg-primary)',
    padding: '12px',
    borderRadius: 'var(--radius-sm)',
    overflowX: 'auto',
    width: '100%',
    whiteSpace: 'pre',
  },
  warning: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    fontSize: '0.85rem',
    color: 'var(--danger-text)',
    lineHeight: 1.5,
  },
  error: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
    color: 'var(--danger-text)',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  notice: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'color-mix(in srgb, var(--success-color) 11%, transparent)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  mintedBox: {
    width: '100%',
    padding: '16px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger-color)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  mintedWarning: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--danger-text)' },
  mintedValue: {
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.8rem',
    wordBreak: 'break-all',
    backgroundColor: 'var(--bg-primary)',
    padding: '10px',
    borderRadius: 'var(--radius-sm)',
  },
  mintedActions: { display: 'flex', gap: '8px' },
  tokenList: { listStyle: 'none', width: '100%', display: 'flex', flexDirection: 'column', gap: '8px' },
  tokenRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--bg-primary)',
  },
  tokenName: { display: 'block', fontWeight: 600, fontSize: '0.9rem' },
  tokenMeta: { display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)' },
};
