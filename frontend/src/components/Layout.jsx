import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthProvider';
import { useTheme } from '../context/ThemeProvider';
import { readSetting, writeSetting } from '../utils/storage';
import {
  BookMarked, User, ShieldAlert, Sun, Moon, LogOut,
  PanelLeftClose, PanelLeftOpen, UserCheck, ArrowLeft,
} from 'lucide-react';

const RAIL_KEY = 'bookbinder_nav_collapsed';

export default function Layout({ children }) {
  const { user, logout, isAdmin, isImpersonating, stopImpersonation } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  // The rail state outlives the session: someone working at 500 volumes wants
  // the cover space back permanently, not once per page load.
  const [collapsed, setCollapsed] = useState(() => readSetting(RAIL_KEY) === 'true');

  const toggleRail = () => {
    setCollapsed((prev) => {
      writeSetting(RAIL_KEY, !prev);
      return !prev;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleStopImpersonation = async () => {
    try {
      await stopImpersonation();
      navigate('/admin');
    } catch (err) {
      alert(err.message);
    }
  };

  // Initials for the avatar fallback
  const getInitials = (email) => {
    if (!email) return 'B';
    return email.split('@')[0].slice(0, 2).toUpperCase();
  };

  const menuItems = [
    { name: 'Catalog', path: '/', icon: <BookMarked size={21} /> },
    { name: 'Profile', path: '/profile', icon: <User size={21} /> },
  ];

  // Admin console route mount (Req 4.4.3)
  if (isAdmin) {
    menuItems.push({ name: 'Admin', path: '/admin', icon: <ShieldAlert size={21} /> });
  }

  const isActiveRoute = (path) => location.pathname === path;

  const avatar = (size) =>
    user?.avatarUrl ? (
      <img src={user.avatarUrl} alt="" style={{ ...styles.avatarImg, width: size, height: size }} />
    ) : (
      <div style={{ ...styles.avatarFallback, width: size, height: size }}>
        {getInitials(user?.email)}
      </div>
    );

  return (
    <div className={`app-shell${collapsed ? ' app-shell-rail' : ''}`}>
      {/* Desktop sidebar */}
      <aside className="app-sidebar">
        <div className="nav-brand">
          <BookMarked size={26} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          {!collapsed && (
            <div style={styles.brandText}>
              <span style={styles.brandName}>BookBinder</span>
              <span className="typed" style={styles.brandSub}>Home Catalog</span>
            </div>
          )}
        </div>

        <hr className="rule-double" style={{ margin: '16px 4px 14px' }} />

        <nav style={styles.navMenu}>
          {menuItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              title={item.name}
              className={`nav-link${isActiveRoute(item.path) ? ' nav-link-active' : ''}`}
            >
              {item.icon}
              <span className="nav-label">{item.name}</span>
            </Link>
          ))}
        </nav>

        <div className="nav-footer">
          <button
            className="nav-footer-btn"
            onClick={toggleRail}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
            <span className="nav-label">Collapse</span>
          </button>

          <button className="nav-footer-btn" onClick={toggleTheme} title="Switch theme">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
            <span className="nav-label">{isDark ? 'Daylight' : 'Reading Lamp'}</span>
          </button>

          <button
            className="nav-footer-btn"
            style={{ color: 'var(--danger-color)' }}
            onClick={handleLogout}
            title="Sign out"
          >
            <LogOut size={20} />
            <span className="nav-label">Sign Out</span>
          </button>

          {/* Borrower card */}
          <div className="nav-user">
            {avatar('32px')}
            {!collapsed && (
              <div style={styles.userInfo}>
                <span style={styles.userEmail} title={user?.email}>{user?.email}</span>
                <span className="typed" style={styles.userRole}>{user?.role}</span>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="app-mobile-header">
        <div style={styles.brand}>
          <BookMarked size={23} style={{ color: 'var(--accent-color)' }} />
          <span style={{ ...styles.brandName, fontSize: '1.06rem' }}>BookBinder</span>
        </div>
        <div style={styles.mobileActions}>
          <button
            className="btn btn-ghost"
            style={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {isDark ? <Sun size={19} /> : <Moon size={19} />}
          </button>
          <button
            className="btn btn-ghost"
            style={{ ...styles.iconBtn, color: 'var(--danger-color)' }}
            onClick={handleLogout}
            aria-label="Sign out"
          >
            <LogOut size={19} />
          </button>
        </div>
      </header>

      <main className="app-main">
        {isImpersonating && (
          <div style={styles.impersonationBanner} role="alert">
            <div style={styles.impersonationBannerContent}>
              <UserCheck size={18} style={{ color: 'var(--warning-color)' }} />
              <span>
                Currently Impersonating <strong>{user?.email}</strong>.
              </span>
            </div>
            <button
              className="btn btn-secondary"
              style={styles.switchBackBtn}
              onClick={handleStopImpersonation}
            >
              <ArrowLeft size={16} />
              <span>Switch back to main profile</span>
            </button>
          </div>
        )}
        <div className="app-content">{children}</div>
      </main>

      {/* Sticky thumb-reachable tray (Req 4.1.1) */}
      <nav className="app-bottom-tray">
        {menuItems.map((item) => (
          <Link
            key={item.name}
            to={item.path}
            className={`tray-link${isActiveRoute(item.path) ? ' tray-link-active' : ''}`}
          >
            {item.icon}
            <span>{item.name}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const styles = {
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  brandText: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
  },
  brandName: {
    fontFamily: 'var(--font-display)',
    fontSize: '1.19rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
    color: 'var(--text-primary)',
  },
  brandSub: {
    fontSize: '0.56rem',
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginTop: '3px',
  },
  avatarImg: {
    borderRadius: 'var(--radius-xs)',
    objectFit: 'cover',
    border: '1px solid var(--rule)',
    flexShrink: 0,
  },
  avatarFallback: {
    borderRadius: 'var(--radius-xs)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--accent-color)',
    color: 'var(--bg-secondary)',
    fontFamily: 'var(--font-stamp)',
    fontSize: '0.75rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  userEmail: {
    fontSize: '0.75rem',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: 'var(--text-primary)',
  },
  userRole: {
    fontSize: '0.56rem',
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
  },
  mobileActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  iconBtn: {
    minHeight: '44px',
    minWidth: '44px',
    padding: '8px',
  },
  impersonationBanner: {
    width: '100%',
    maxWidth: '1120px',
    background: 'color-mix(in srgb, var(--warning-color) 12%, var(--bg-secondary))',
    border: '1px dashed var(--warning-color)',
    borderRadius: 'var(--radius-md)',
    padding: '12px 20px',
    marginBottom: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    boxShadow: 'var(--shadow-sm)',
  },
  impersonationBannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
  },
  switchBackBtn: {
    padding: '4px 12px',
    fontSize: '0.82rem',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
};
