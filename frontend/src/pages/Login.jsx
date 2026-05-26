import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { Library, LogIn, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card} className="glass-panel">
        <div style={styles.brandHeader}>
          <Library size={44} style={styles.logo} />
          <h1 style={styles.brandTitle}>BookBinder</h1>
          <p style={styles.subtitle}>Physical Library Catalog Engine</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <h2 style={styles.title}>Sign In</h2>
          
          {error && (
            <div style={styles.errorBanner} className="error-shake">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. library@home.com"
              required
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Account Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your security password"
              required
              disabled={loading}
            />
          </div>

          <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={loading}>
            <LogIn size={20} />
            <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
          </button>
        </form>

        <div style={styles.footer}>
          <span>Need an account?</span>
          <Link to="/register" style={styles.footerLink}>Register here</Link>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    width: '100vw',
    backgroundColor: 'var(--bg-primary)',
    padding: '20px',
  },
  card: {
    width: '100%',
    maxWidth: '440px',
    padding: '40px 30px',
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    boxShadow: 'var(--shadow-lg)',
  },
  brandHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    gap: '4px',
  },
  logo: {
    color: 'var(--accent-color)',
    marginBottom: '8px',
  },
  brandTitle: {
    fontSize: '2rem',
    fontWeight: 850,
    background: 'var(--accent-gradient)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  title: {
    fontSize: '1.25rem',
    marginBottom: '20px',
    fontWeight: '700',
  },
  submitBtn: {
    marginTop: '8px',
    width: '100%',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    color: 'var(--danger-color)',
    fontSize: '0.85rem',
    marginBottom: '20px',
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    gap: '6px',
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    borderTop: '1px solid var(--border-glass)',
    paddingTop: '20px',
  },
  footerLink: {
    fontWeight: '700',
  },
};
