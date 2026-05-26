import React, { useState, useRef } from 'react';
import { useAuth } from '../context/AuthProvider';
import { User, Mail, ShieldAlert, Key, Upload, AlertCircle, CheckCircle } from 'lucide-react';

export default function ProfileSettings() {
  const { user, updateProfile, updateAvatarUrl } = useAuth();
  
  const [email, setEmail] = useState(user?.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Status Alerts
  const [profileMessage, setProfileMessage] = useState(null);
  const [avatarMessage, setAvatarMessage] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [avatarLoading, setAvatarLoading] = useState(false);

  const fileInputRef = useRef(null);

  const handleProfileSubmit = async (e) => {
    e.preventDefault();
    setProfileMessage(null);

    if (newPassword && newPassword !== confirmPassword) {
      return setProfileMessage({ type: 'error', text: 'New passwords do not match.' });
    }

    setProfileLoading(true);
    try {
      await updateProfile(email, newPassword || null, currentPassword);
      setProfileMessage({ type: 'success', text: 'Profile updated successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setProfileMessage({ type: 'error', text: err.message });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Standard client checks
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return setAvatarMessage({ type: 'error', text: 'JPEG, PNG, or WebP images only.' });
    }
    if (file.size > 5 * 1024 * 1024) {
      return setAvatarMessage({ type: 'error', text: 'Image file size cannot exceed 5MB.' });
    }

    setAvatarLoading(true);
    setAvatarMessage(null);

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const res = await fetch('/api/users/profile/avatar', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Avatar upload failed.');

      updateAvatarUrl(data.avatarUrl);
      setAvatarMessage({ type: 'success', text: 'Profile picture updated!' });
    } catch (err) {
      setAvatarMessage({ type: 'error', text: err.message });
    } finally {
      setAvatarLoading(false);
    }
  };

  // Helper resolving user initials for HSL avatar fallback
  const getInitials = (email) => {
    if (!email) return 'B';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  return (
    <div style={styles.profileContainer}>
      <header style={styles.header}>
        <h1 style={styles.title}>Account Settings</h1>
        <p style={styles.subtitle}>Manage your library profile credentials and picture avatars.</p>
      </header>

      <div style={styles.grid}>
        {/* Left Card - Avatar Upload (Multer) */}
        <div style={styles.card} className="glass-panel">
          <h2 style={styles.cardTitle}>Profile Picture</h2>
          
          <div style={styles.avatarBlock}>
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="User Avatar" style={styles.avatarPreview} />
            ) : (
              <div style={styles.avatarFallback}>{getInitials(user?.email)}</div>
            )}
            
            <div style={styles.avatarMeta}>
              <span style={styles.roleBadge}>{user?.role}</span>
              <span style={styles.mimeInfo}>JPEG, PNG, WebP (Max 5MB)</span>
            </div>
          </div>

          {avatarMessage && (
            <div style={{
              ...styles.messageBanner,
              backgroundColor: avatarMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: avatarMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }}>
              {avatarMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{avatarMessage.text}</span>
            </div>
          )}

          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAvatarChange} 
            style={{ display: 'none' }}
            accept="image/*"
            disabled={avatarLoading}
          />
          
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={() => fileInputRef.current.click()}
            disabled={avatarLoading}
            style={styles.uploadBtn}
          >
            <Upload size={18} />
            <span>{avatarLoading ? 'Uploading...' : 'Upload New Picture'}</span>
          </button>
        </div>

        {/* Right Card - Profile Credentials */}
        <div style={{ ...styles.card, flex: 2 }} className="glass-panel">
          <h2 style={styles.cardTitle}>Security Details</h2>

          {profileMessage && (
            <div style={{
              ...styles.messageBanner,
              backgroundColor: profileMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: profileMessage.type === 'success' ? 'var(--success-color)' : 'var(--danger-color)',
            }} className={profileMessage.type === 'error' ? 'error-shake' : ''}>
              {profileMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
              <span>{profileMessage.text}</span>
            </div>
          )}

          <form onSubmit={handleProfileSubmit} style={styles.form}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input 
                type="email" 
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={profileLoading}
              />
            </div>

            <div style={styles.divider}>
              <Key size={16} style={{ color: 'var(--text-muted)' }} />
              <span style={styles.dividerText}>Update Password (Optional)</span>
            </div>

            <div className="form-group">
              <label className="form-label">New Password</label>
              <input 
                type="password" 
                className="form-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Leave blank to keep current"
                disabled={profileLoading}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input 
                type="password" 
                className="form-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                disabled={profileLoading}
              />
            </div>

            <div style={{ ...styles.divider, margin: '24px 0 16px 0' }}></div>

            <div className="form-group">
              <label className="form-label" style={{ color: 'var(--danger-color)' }}>Current Password *</label>
              <input 
                type="password" 
                className="form-input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password to save changes"
                required
                disabled={profileLoading}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={profileLoading}>
              <span>{profileLoading ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const styles = {
  profileContainer: {
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
  grid: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
    width: '100%',
  },
  card: {
    flex: 1,
    minWidth: '300px',
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
  },
  avatarBlock: {
    display: 'flex',
    alignItems: 'center',
    gap: '20px',
    marginTop: '8px',
  },
  avatarPreview: {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    objectFit: 'cover',
    border: '3px solid var(--accent-color)',
    boxShadow: 'var(--shadow-md)',
  },
  avatarFallback: {
    width: '96px',
    height: '96px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-gradient)',
    color: '#ffffff',
    fontSize: '2.25rem',
    fontWeight: '700',
    boxShadow: 'var(--shadow-md)',
  },
  avatarMeta: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  roleBadge: {
    fontSize: '0.75rem',
    fontWeight: '800',
    textTransform: 'uppercase',
    color: 'var(--accent-color)',
    backgroundColor: 'var(--accent-light)',
    padding: '4px 8px',
    borderRadius: '4px',
    letterSpacing: '0.05em',
    width: 'fit-content',
  },
  mimeInfo: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontWeight: '600',
  },
  uploadBtn: {
    width: '100%',
  },
  messageBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '12px 16px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    margin: '16px 0 12px 0',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '8px',
  },
  dividerText: {
    fontSize: '0.8rem',
    fontWeight: '700',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  submitBtn: {
    width: '100%',
    marginTop: '12px',
  },
};
