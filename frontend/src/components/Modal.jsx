import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * The shell every overlay in the app shares.
 *
 * The three overlays this replaces each reimplemented the backdrop and each
 * omitted the same things: no Escape, no dialog semantics, and no focus
 * management — so a keyboard user could tab straight out of an open dialog into
 * the page behind it, and a screen reader was never told a dialog had opened.
 * Centralising it means those cannot drift apart again.
 */
/** Everything a user can reach with Tab. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  onClose,
  title,
  eyebrow,
  labelledBy,
  width = '500px',
  children,
  /** Set when a request is in flight and dismissing would strand it. */
  busy = false,
  className = '',
  style,
  bodyStyle,
}) {
  const panelRef = useRef(null);
  const bodyRef = useRef(null);
  const headingId = useId();

  /*
   * The setup effect below runs exactly once, so it cannot close over onClose
   * or busy directly — callers pass inline arrows, which change identity on
   * every parent render. Depending on them re-ran mount/unmount on each
   * keystroke: the cleanup threw focus back to the opener and the setup then
   * pulled it to the close button, so typing a name containing a space
   * activated Close and dismissed the dialog.
   */
  const latest = useRef({ onClose, busy });
  useEffect(() => {
    latest.current = { onClose, busy };
  });

  useEffect(() => {
    // Whatever had focus when the dialog opened gets it back on close
    const opener = document.activeElement;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!latest.current.busy) latest.current.onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      // Focus trap. Querying on each Tab rather than once on mount keeps it
      // correct for dialogs whose contents change while open.
      const focusable = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);

    /*
     * Move focus into the dialog's *content*. Searching the whole panel would
     * land on the close button, since it precedes the body in document order
     * and querySelector resolves a selector list by document order, not by the
     * order the selectors are written in. Nobody opens a form to focus Close.
     */
    const target =
      bodyRef.current?.querySelector(FOCUSABLE) || panelRef.current?.querySelector(FOCUSABLE);
    target?.focus();

    // The page behind must not scroll under an open dialog
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <div
      style={styles.overlay}
      onClick={() => !busy && onClose()}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`card card-in ${className}`.trim()}
        style={{ ...styles.panel, maxWidth: width, ...style }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? headingId : undefined)}
      >
        {title && (
          <header style={styles.header}>
            <div style={{ minWidth: 0 }}>
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              <h3 id={headingId} style={styles.title}>{title}</h3>
            </div>
            <button
              className="btn btn-ghost"
              style={styles.close}
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
            >
              <X size={19} />
            </button>
          </header>
        )}

        {/* A title-less dialog still needs a way out that is not the Escape key */}
        {!title && (
          <button
            className="btn btn-ghost"
            style={styles.closeFloating}
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X size={19} />
          </button>
        )}

        <div ref={bodyRef} style={bodyStyle}>{children}</div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(28, 20, 12, 0.6)',
    zIndex: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  panel: {
    position: 'relative',
    width: '100%',
    maxHeight: '92vh',
    overflowY: 'auto',
    padding: '22px 26px 26px',
    boxShadow: 'var(--shadow-lg)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
    marginBottom: '10px',
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 'var(--step-2)',
    fontWeight: 600,
    marginTop: '2px',
  },
  close: {
    minHeight: '38px',
    minWidth: '38px',
    padding: '8px',
    flex: 'none',
  },
  closeFloating: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    zIndex: 2,
    minHeight: '38px',
    minWidth: '38px',
    padding: '8px',
  },
};
