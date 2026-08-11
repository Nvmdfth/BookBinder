import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { LogIn, AlertCircle } from 'lucide-react';
import AuthCard from '../components/AuthCard';

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
    <AuthCard
      accession="BB · CARD 001 · BORROWER ACCESS"
      footer={
        <p style={styles.footer}>
          Need an account?{' '}
          <Link to="/register" style={styles.footerLink}>Register here</Link>
        </p>
      }
    >
      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.titleRow}>
          <h2 style={styles.title}>Sign In</h2>
          <span className="stamp stamp-tilt stamp-muted">Members</span>
        </div>

        {error && (
          <div style={styles.errorBanner} className="error-shake">
            <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
            <span>{error}</span>
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="login-email">Email Address</label>
          <input
            id="login-email"
            type="email"
            className="form-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="library@home.com"
            required
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="login-password">Account Password</label>
          <input
            id="login-password"
            type="password"
            className="form-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            required
            disabled={loading}
          />
        </div>

        <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={loading}>
          <LogIn size={18} />
          <span>{loading ? 'Checking the register…' : 'Sign In'}</span>
        </button>
      </form>
    </AuthCard>
  );
}

const styles = {
  form: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    marginBottom: '20px',
  },
  title: {
    fontSize: 'var(--step-2)',
    fontWeight: 600,
  },
  submitBtn: {
    marginTop: '4px',
    width: '100%',
  },
  errorBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '11px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--danger-color)',
    background: 'color-mix(in srgb, var(--danger-color) 8%, transparent)',
    color: 'var(--danger-text)',
    fontSize: '0.85rem',
    marginBottom: '18px',
  },
  footer: {
    textAlign: 'center',
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
  },
  footerLink: {
    fontWeight: 700,
  },
};
