import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, BookMarked, Check, Library, RefreshCw, Star, Trash2 } from 'lucide-react';
import Modal from './Modal';
import BarcodeScanner from './BarcodeScanner';
import BookVolume from './BookVolume';

/**
 * Scanning without a shelf in mind.
 *
 * The shelf-bound scanner answers "add this to the shelf I am standing at".
 * Standing in a bookshop the question is different and comes in two parts: do I
 * already have this, and if not, where does it go? So each capture is checked
 * against every shelf the user can see before anything is written, and the
 * destination is chosen per volume rather than once for the run.
 *
 * Nothing reaches the database until the run is filed. That keeps a scan of
 * thirty spines a single decision to commit, and makes backing out of a
 * mis-scan a matter of removing a row rather than undoing a write.
 */

/** A shelf the backend would actually accept a write to (Req 4.3.2). */
const isWriteable = (shelf) => shelf.role === 'owner' || shelf.role === 'collaborator';

/**
 * How a holding should be described.
 *
 * A wishlist records a book the user wants, not one they have, so reporting it
 * as "already in your library" would answer the bookshop question backwards.
 */
function describeHolding(holding) {
  if (holding.is_wishlist) return 'On your wishlist';
  if (holding.role === 'owner') return 'In your library';
  return 'On a shelf shared with you';
}

export default function ScanModal({ onClose }) {
  const [shelves, setShelves] = useState([]);
  const [shelvesError, setShelvesError] = useState(null);
  const [loadingShelves, setLoadingShelves] = useState(true);

  // 'scanning' | 'holdings' | 'picker' | 'manual'
  const [step, setStep] = useState('scanning');
  const [pending, setPending] = useState(null);
  const [pendingBarcode, setPendingBarcode] = useState('');

  const [tray, setTray] = useState([]);
  const [filing, setFiling] = useState(false);
  const [message, setMessage] = useState(null);

  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [chosenShelfId, setChosenShelfId] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/bookshelves');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load your bookshelves.');
        if (!cancelled) setShelves(data);
      } catch (err) {
        if (!cancelled) setShelvesError(err.message);
      } finally {
        if (!cancelled) setLoadingShelves(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const writeableShelves = shelves.filter(isWriteable);

  const backToScanning = () => {
    setPending(null);
    setPendingBarcode('');
    setChosenShelfId('');
    setManualTitle('');
    setManualAuthor('');
    setStep('scanning');
  };

  /**
   * A volume resolved at the camera.
   *
   * The guard is deliberate: the decoder is briefly live again between a
   * confirmation and the parent's brake taking effect, so a second capture can
   * land while a panel of ours is already up. Dropping it is correct — the user
   * is answering a question about the previous book, not this one.
   */
  const handleConfirm = (book) => {
    if (step !== 'scanning') return;
    setMessage(null);
    setPending(book);
    setChosenShelfId('');
    setStep(book.holdings && book.holdings.length > 0 ? 'holdings' : 'picker');
  };

  /**
   * A barcode nothing could identify. Both routes into this state have already
   * torn the camera down (BarcodeScanner stops before handing off either an
   * unresolvable ISBN or an unlearned UPC), so the form is the only thing on
   * screen and restarting the camera afterwards costs one tap.
   */
  const handleUnresolved = (barcode) => {
    setMessage(null);
    setPending(null);
    setPendingBarcode(barcode || '');
    setManualTitle('');
    setManualAuthor('');
    setChosenShelfId('');
    setStep('manual');
  };

  /** Shelves this pending book already sits on — offering them would only 409. */
  const blockedShelfIds = new Set([
    ...(pending?.holdings || []).map((h) => h.bookshelf_id),
    ...tray.filter((t) => pending && t.bookId === pending.id).map((t) => t.shelfId),
  ]);

  const addCatalogToTray = () => {
    const shelf = writeableShelves.find((s) => String(s.id) === String(chosenShelfId));
    if (!shelf || !pending) return;

    setTray((prev) => [
      ...prev,
      {
        trayId: `book-${pending.id}-shelf-${shelf.id}`,
        kind: 'catalog',
        // Keyed on the catalog row, not the ISBN: a manually created book carries
        // a synthetic MANUAL-<timestamp> ISBN, so two of them would look distinct
        // while pointing at the same row.
        bookId: pending.id,
        title: pending.title,
        author: pending.author,
        coverUrl: pending.cover_image_url,
        isbn: pending.isbn,
        shelfId: shelf.id,
        shelfName: shelf.name,
      },
    ]);

    backToScanning();
  };

  const addManualToTray = (e) => {
    e.preventDefault();
    const shelf = writeableShelves.find((s) => String(s.id) === String(chosenShelfId));
    if (!shelf || !manualTitle.trim()) return;

    setTray((prev) => [
      ...prev,
      {
        trayId: `manual-${pendingBarcode || 'none'}-${Date.now()}`,
        kind: 'manual',
        title: manualTitle.trim(),
        author: manualAuthor.trim(),
        coverUrl: null,
        // Carried so learnBarcodeAlias records it and the next scan of this
        // cover resolves locally instead of returning to this form.
        barcode: pendingBarcode,
        shelfId: shelf.id,
        shelfName: shelf.name,
      },
    ]);

    backToScanning();
  };

  const removeFromTray = (trayId) =>
    setTray((prev) => prev.filter((t) => t.trayId !== trayId));

  /** File the whole run. Sequential, so a failure stops on the row that caused it. */
  const fileTray = async () => {
    setFiling(true);
    setMessage(null);

    const failures = [];
    let filed = 0;

    for (const row of tray) {
      try {
        const res =
          row.kind === 'manual'
            ? await fetch('/api/books/manual', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  bookshelfId: row.shelfId,
                  title: row.title,
                  author: row.author || null,
                  scannedBarcode: row.barcode || null,
                }),
              })
            : await fetch('/api/books/file', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookId: row.bookId, bookshelfId: row.shelfId }),
              });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not file this volume.');
        filed += 1;
      } catch (err) {
        failures.push({ ...row, error: err.message });
      }
    }

    // Rows that landed leave the tray; rows that did not stay, carrying the reason
    setTray(failures);
    setFiling(false);

    if (failures.length === 0) {
      setMessage({
        type: 'success',
        text: `Filed ${filed} ${filed === 1 ? 'volume' : 'volumes'}.`,
      });
    } else {
      setMessage({
        type: 'error',
        text:
          filed > 0
            ? `Filed ${filed}, but ${failures.length} could not be filed. They are still in the tray.`
            : `Could not file ${failures.length} ${failures.length === 1 ? 'volume' : 'volumes'}.`,
      });
    }
  };

  const shelfPicker = (labelText) => (
    <label style={styles.field}>
      <span className="eyebrow">{labelText}</span>
      <select
        className="form-input"
        value={chosenShelfId}
        onChange={(e) => setChosenShelfId(e.target.value)}
      >
        <option value="">Choose a bookshelf…</option>
        {writeableShelves.map((s) => (
          <option key={s.id} value={s.id} disabled={blockedShelfIds.has(s.id)}>
            {s.name}
            {blockedShelfIds.has(s.id) ? ' — already there' : ''}
            {s.role === 'collaborator' ? ' (shared)' : ''}
          </option>
        ))}
      </select>
    </label>
  );

  const noWriteableShelves = !loadingShelves && writeableShelves.length === 0;

  return (
    <Modal
      onClose={onClose}
      title="Scan a book"
      eyebrow="Anywhere in your library"
      width="560px"
      busy={filing}
    >
      {shelvesError && (
        <div style={{ ...styles.banner, ...styles.bannerError }} role="alert">
          <AlertCircle size={17} />
          <span>{shelvesError}</span>
        </div>
      )}

      {noWriteableShelves && !shelvesError && (
        <div style={{ ...styles.banner, ...styles.bannerError }} role="alert">
          <AlertCircle size={17} />
          <span>You need a bookshelf you can write to before you can file a scan.</span>
        </div>
      )}

      {message && (
        <div
          style={{
            ...styles.banner,
            ...(message.type === 'success' ? styles.bannerSuccess : styles.bannerError),
          }}
          role="status"
        >
          {message.type === 'success' ? <Check size={17} /> : <AlertCircle size={17} />}
          <span>{message.text}</span>
        </div>
      )}

      <div style={styles.stage}>
        <BarcodeScanner
          paused={step !== 'scanning'}
          onConfirm={handleConfirm}
          onScanSuccess={handleUnresolved}
          onManualFallback={({ barcode }) => handleUnresolved(barcode)}
        />

        {step === 'holdings' && pending && (
          <div style={styles.panel}>
            <span className="eyebrow" style={{ color: 'var(--accent-color)' }}>
              Already in your library
            </span>

            <BookVolume
              title={pending.title}
              author={pending.author}
              coverUrl={pending.cover_image_url}
              seed={pending.isbn}
              size="sm"
              style={{ width: '78px' }}
            />

            <div>
              <div style={styles.panelTitle}>{pending.title}</div>
              <div style={styles.panelAuthor}>by {pending.author || 'Unknown author'}</div>
            </div>

            <ul style={styles.holdingList}>
              {pending.holdings.map((h) => (
                <li key={h.mapping_id} style={styles.holdingRow}>
                  {h.is_wishlist ? (
                    <Star size={15} style={{ color: 'var(--warning-color)', flexShrink: 0 }} />
                  ) : (
                    <Library size={15} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/bookshelves/${h.bookshelf_id}`} onClick={onClose} style={styles.holdingLink}>
                      {h.bookshelf_name}
                    </Link>
                    <div style={styles.holdingMeta}>
                      {describeHolding(h)}
                      {h.physical_location ? ` · ${h.physical_location}` : ''}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div style={styles.panelActions}>
              <button className="btn btn-secondary" style={styles.panelBtn} onClick={backToScanning}>
                Scan Again
              </button>
              <button
                className="btn btn-primary"
                style={styles.panelBtn}
                onClick={() => setStep('picker')}
                disabled={noWriteableShelves}
              >
                Add to another shelf
              </button>
            </div>
          </div>
        )}

        {step === 'picker' && pending && (
          <div style={styles.panel}>
            <span className="eyebrow" style={{ color: 'var(--accent-color)' }}>
              Where does it go?
            </span>

            <div>
              <div style={styles.panelTitle}>{pending.title}</div>
              <div style={styles.panelAuthor}>by {pending.author || 'Unknown author'}</div>
            </div>

            {shelfPicker('Bookshelf')}

            <div style={styles.panelActions}>
              <button className="btn btn-secondary" style={styles.panelBtn} onClick={backToScanning}>
                Skip
              </button>
              <button
                className="btn btn-primary"
                style={styles.panelBtn}
                onClick={addCatalogToTray}
                disabled={!chosenShelfId}
              >
                Add to tray
              </button>
            </div>
          </div>
        )}

        {step === 'manual' && (
          <form style={styles.panel} onSubmit={addManualToTray}>
            <span className="eyebrow" style={{ color: 'var(--accent-color)' }}>
              Not in any catalog
            </span>

            <p style={styles.panelNote}>
              No provider could identify this barcode. Enter it once and the code is
              remembered for next time.
            </p>

            {pendingBarcode && <code style={styles.barcodeChip}>{pendingBarcode}</code>}

            <label style={styles.field}>
              <span className="eyebrow">Title</span>
              <input
                className="form-input"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="Required"
                required
              />
            </label>

            <label style={styles.field}>
              <span className="eyebrow">Author</span>
              <input
                className="form-input"
                value={manualAuthor}
                onChange={(e) => setManualAuthor(e.target.value)}
                placeholder="Optional"
              />
            </label>

            {shelfPicker('Bookshelf')}

            <div style={styles.panelActions}>
              <button
                type="button"
                className="btn btn-secondary"
                style={styles.panelBtn}
                onClick={backToScanning}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                style={styles.panelBtn}
                disabled={!manualTitle.trim() || !chosenShelfId}
              >
                Add to tray
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Session tray — the run so far, committed in one go */}
      <div style={styles.tray}>
        <div style={styles.trayHead}>
          <span className="eyebrow">
            <BookMarked size={13} style={{ verticalAlign: '-2px', marginRight: '6px' }} />
            Scan tray
          </span>
          <span className="typed" style={styles.trayCount}>
            {tray.length} {tray.length === 1 ? 'VOLUME' : 'VOLUMES'}
          </span>
        </div>

        {tray.length === 0 ? (
          <p style={styles.trayEmpty}>
            Confirmed volumes gather here. Nothing is filed until you say so.
          </p>
        ) : (
          <>
            {tray.map((row) => (
              <div key={row.trayId} style={styles.trayRow}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.trayTitle}>{row.title}</div>
                  <div style={styles.trayMeta}>
                    {row.author || 'Unknown author'} → {row.shelfName}
                  </div>
                  {row.error && <div style={styles.trayError}>{row.error}</div>}
                </div>
                <button
                  className="btn btn-ghost"
                  style={styles.trayRemove}
                  onClick={() => removeFromTray(row.trayId)}
                  disabled={filing}
                  aria-label={`Remove ${row.title} from the tray`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

            <div style={styles.trayActions}>
              <button
                className="btn btn-secondary"
                style={styles.panelBtn}
                onClick={() => setTray([])}
                disabled={filing}
              >
                Clear
              </button>
              <button
                className="btn btn-primary"
                style={styles.panelBtn}
                onClick={fileTray}
                disabled={filing}
              >
                {filing ? (
                  <>
                    <RefreshCw size={15} className="spin" style={{ marginRight: '7px' }} />
                    Filing…
                  </>
                ) : (
                  `File ${tray.length} ${tray.length === 1 ? 'volume' : 'volumes'}`
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const styles = {
  stage: {
    position: 'relative',
  },
  panel: {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--rule)',
    borderRadius: 'var(--radius-md)',
    padding: '18px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: '10px',
    overflowY: 'auto',
  },
  panelTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '1rem',
    fontWeight: 650,
    lineHeight: 1.3,
    color: 'var(--text-primary)',
  },
  panelAuthor: {
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
  },
  panelNote: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
    maxWidth: '300px',
  },
  panelActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    width: '100%',
    marginTop: '4px',
  },
  panelBtn: {
    height: '38px',
    padding: '0 16px',
    fontSize: '0.83rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    width: '100%',
    maxWidth: '320px',
    textAlign: 'left',
  },
  holdingList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    width: '100%',
    maxWidth: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    textAlign: 'left',
  },
  holdingRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '8px 10px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-raised)',
    border: '1px solid var(--rule)',
  },
  holdingLink: {
    fontSize: '0.86rem',
    fontWeight: 650,
    color: 'var(--text-primary)',
  },
  holdingMeta: {
    fontSize: '0.74rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  barcodeChip: {
    fontFamily: 'var(--font-stamp), monospace',
    fontSize: '0.78rem',
    letterSpacing: '0.09em',
    padding: '3px 9px',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--surface-raised)',
    color: 'var(--text-secondary)',
  },
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '10px 13px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.83rem',
    marginBottom: '12px',
  },
  bannerError: {
    background: 'color-mix(in srgb, var(--danger-color) 11%, transparent)',
    color: 'var(--danger-text)',
  },
  bannerSuccess: {
    background: 'color-mix(in srgb, var(--success-color) 13%, transparent)',
    color: 'var(--text-primary)',
  },
  tray: {
    marginTop: '18px',
    paddingTop: '14px',
    borderTop: '1px solid var(--rule)',
  },
  trayHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '10px',
  },
  trayCount: {
    fontSize: '0.62rem',
    letterSpacing: '0.15em',
    color: 'var(--text-muted)',
  },
  trayEmpty: {
    fontSize: '0.82rem',
    color: 'var(--text-muted)',
    lineHeight: 1.5,
  },
  trayRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 0',
    borderBottom: '1px dashed var(--rule)',
  },
  trayTitle: {
    fontSize: '0.87rem',
    fontWeight: 620,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  trayMeta: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  trayError: {
    fontSize: '0.75rem',
    color: 'var(--danger-text)',
    marginTop: '3px',
  },
  trayRemove: {
    minHeight: '36px',
    minWidth: '36px',
    padding: '7px',
    color: 'var(--danger-text)',
    flexShrink: 0,
  },
  trayActions: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'flex-end',
    marginTop: '12px',
  },
};
