import React from 'react';
import { BookMarked } from 'lucide-react';

/**
 * The shell shared by the sign-in and registration screens.
 *
 * Presented as a physical catalog card: ruled header, typewriter accession
 * line, and the punched rod hole along the bottom edge that every drawer card
 * has. Both screens render outside <Layout>, so this carries their chrome.
 */
export default function AuthCard({ accession, children, footer }) {
  return (
    <div style={styles.page}>
      <div style={styles.stack}>
        <div className="card card-spine card-in" style={styles.card}>
          <header style={styles.head}>
            <div style={styles.brandRow}>
              <BookMarked size={26} style={{ color: 'var(--accent-color)' }} />
              <h1 style={styles.brandName}>BookBinder</h1>
            </div>
            <span className="eyebrow">Home Library Catalog</span>
            <hr className="rule-double" style={{ margin: '14px 0 0' }} />
          </header>

          {children}

          {/* Punched rod hole, as on a real drawer card */}
          <div style={styles.punchRow} aria-hidden="true">
            <span style={styles.punchHole} />
          </div>
        </div>

        {accession && (
          <p className="typed" style={styles.accession}>
            {accession}
          </p>
        )}

        {footer}
      </div>
    </div>
  );
}

const styles = {
  page: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100%',
    padding: '24px 18px',
  },
  stack: {
    width: '100%',
    maxWidth: '432px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  card: {
    padding: '30px 28px 18px',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: 'var(--shadow-lg)',
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    marginBottom: '22px',
  },
  brandRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
  },
  brandName: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.85rem',
    fontWeight: 600,
    letterSpacing: '-0.022em',
    color: 'var(--text-primary)',
  },
  punchRow: {
    display: 'flex',
    justifyContent: 'center',
    marginTop: '18px',
  },
  punchHole: {
    width: '26px',
    height: '13px',
    borderRadius: '13px',
    background: 'var(--sunk)',
    boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.22)',
    border: '1px solid var(--rule)',
  },
  accession: {
    textAlign: 'center',
    color: 'var(--text-muted)',
    fontSize: '0.66rem',
    letterSpacing: '0.14em',
  },
};
