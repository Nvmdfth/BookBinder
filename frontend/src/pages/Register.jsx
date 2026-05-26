import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { Library, UserPlus, AlertCircle, ShieldAlert } from 'lucide-react';

export default function Register() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  
  const navigate = useNavigate();

  // Proactive registration switch check on boot (Req 4.4.2)
  useEffect(() => {
    async function checkRegistrationSwitch() {
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}), // Empty body triggers switch check first
        });
        
        if (res.status === 403) {
          setIsLocked(true);
        }
      } catch (err) {
        console.warn('Registration switch check fail:', err);
      }
    }
    checkRegistrationSwitch();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      return setError('Passwords do not match.');
    }

    setLoading(true);

    try {
      await register(email, password);
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2500);
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

        {/* 🔒 Locked Out Fallback View (Req 4.4.2) */}
        {isLocked ? (
          <div style={styles.lockedContainer}>
            <ShieldAlert size={48} style={styles.lockedIcon} className="error-shake" />
            <h2 style={styles.lockedTitle}>Registration Locked</h2>
            <p style={styles.lockedMsg}>
              Public registration is currently disabled on this instance. Please contact your system administrator for access.
            </p>
            <Link to="/login" className="btn btn-secondary" style={{ width: '100%', marginTop: '12px' }}>
              Return to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <h2 style={styles.title}>Register Account</h2>

            {error && (
              <div style={styles.errorBanner} className="error-shake">
                <AlertCircle size={18} />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div style={styles.successBanner}>
                <span>Account registered successfully! Redirecting to login...</span>
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
                disabled={loading || success}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Must be at least 6 characters"
                required
                disabled={loading || success}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm Password</label>
              <input
                type="password"
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                required
                disabled={loading || success}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={loading || success}>
              <UserPlus size={20} />
              <span>{loading ? 'Creating Account...' : 'Register'}</span>
            </button>
          </form>
        )}

        {!isLocked && (
          <div style={styles.footer}>
            <span>Already have an account?</span>
            <Link to="/login" style={styles.footerLink}>Sign In here</Link>
          </div>
        )}
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
  successBanner: {
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    marginBottom: '20px',
    fontWeight: '600',
  },
  lockedContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '20px 10px',
    gap: '16px',
  },
  lockedIcon: {
    color: 'var(--warning-color)',
  },
  lockedTitle: {
    fontSize: '1.25rem',
    color: 'var(--text-primary)',
    fontWeight: '750',
  },
  lockedMsg: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: '1.6',
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
