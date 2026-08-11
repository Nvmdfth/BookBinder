import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * The app's last line of defence against a white screen.
 *
 * React unmounts the entire tree when a render or commit throws, so without a
 * boundary any single bad property access blanks the whole page and takes the
 * error with it — the user sees nothing and there is nothing to report. This
 * keeps the page standing and puts the message on screen, which is the only
 * way a fault on someone else's phone ever becomes diagnosable.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept in the console for desktop debugging; the panel below covers mobile,
    // where there is usually no console to read.
    console.error('Unhandled UI error:', error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={styles.wrapper}>
        <div style={styles.card} className="card">
          <AlertTriangle size={34} style={{ color: 'var(--danger-text)' }} />
          <h2 style={styles.title}>Something broke on this screen</h2>
          <p style={styles.desc}>
            Your data is safe — anything already saved was saved. Reload to carry on.
          </p>

          <pre style={styles.detail}>{String(error?.message || error)}</pre>

          <button className="btn btn-primary" onClick={this.handleReload}>
            <RefreshCw size={18} />
            <span>Reload</span>
          </button>
        </div>
      </div>
    );
  }
}

const styles = {
  wrapper: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '60vh',
    padding: '20px',
  },
  card: {
    maxWidth: '480px',
    width: '100%',
    padding: '28px 22px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '14px',
  },
  title: {
    fontSize: '1.15rem',
  },
  desc: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.5',
  },
  detail: {
    width: '100%',
    margin: 0,
    padding: '10px 12px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'var(--surface-raised)',
    color: 'var(--danger-text)',
    fontSize: '0.75rem',
    lineHeight: '1.45',
    textAlign: 'left',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    overflowX: 'auto',
  },
};
