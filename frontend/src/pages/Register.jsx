import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { UserPlus, AlertCircle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import AuthCard from '../components/AuthCard';

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
        const res = await fetch('/api/auth/registration-status');
        const data = await res.json();
        setIsLocked(!data.allowOpenRegistration);
      } catch (err) {
        console.warn('Registration switch check fail:', err);
        // Fail closed rather than showing a form the API would reject
        setIsLocked(true);
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
    <AuthCard
      accession={isLocked ? 'BB · CARD 002 · DRAWER SEALED' : 'BB · CARD 002 · NEW BORROWER'}
      footer={
        !isLocked && (
          <p style={styles.footer}>
            Already have an account?{' '}
            <Link to="/login" style={styles.footerLink}>Sign In here</Link>
          </p>
        )
      }
    >
      {/* Locked Out Fallback View (Req 4.4.2) */}
      {isLocked ? (
        <div style={styles.locked}>
          <ShieldAlert size={40} style={{ color: 'var(--warning-color)' }} className="error-shake" />
          <span className="stamp stamp-tilt stamp-warning" style={styles.lockedStamp}>
            Registration Closed
          </span>
          <p style={styles.lockedMsg}>
            Public registration is currently disabled on this instance. Please contact your system
            administrator for access.
          </p>
          <Link to="/login" className="btn btn-secondary" style={{ width: '100%', marginTop: '4px' }}>
            Return to Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.titleRow}>
            <h2 style={styles.title}>Register Account</h2>
            <span className="stamp stamp-tilt stamp-muted">New Card</span>
          </div>

          {error && (
            <div style={styles.errorBanner} className="error-shake">
              <AlertCircle size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div style={styles.successBanner}>
              <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span>Account registered successfully! Redirecting to login…</span>
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="register-email">Email Address</label>
            <input
              id="register-email"
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="library@home.com"
              required
              disabled={loading || success}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="register-password">Password</label>
            <input
              id="register-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              required
              disabled={loading || success}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="register-confirm">Confirm Password</label>
            <input
              id="register-confirm"
              type="password"
              className="form-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              required
              disabled={loading || success}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={styles.submitBtn}
            disabled={loading || success}
          >
            <UserPlus size={18} />
            <span>{loading ? 'Filing your card…' : 'Register'}</span>
          </button>
        </form>
      )}
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
  successBanner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '9px',
    padding: '11px 14px',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--success-color)',
    background: 'color-mix(in srgb, var(--success-color) 8%, transparent)',
    color: 'var(--success-color)',
    fontSize: '0.85rem',
    fontWeight: 600,
    marginBottom: '18px',
  },
  locked: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    padding: '8px 4px',
    gap: '14px',
  },
  lockedStamp: {
    fontSize: '0.72rem',
    padding: '5px 12px',
  },
  lockedMsg: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.65,
  },
  footer: {
    textAlign: 'center',
    fontSize: '0.88rem',
    color: 'var(--text-secondary)',
  },
};
