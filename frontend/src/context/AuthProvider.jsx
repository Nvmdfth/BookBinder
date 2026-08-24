import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);

  // Sync session on mount (Req 4.4.4 & NFR 5.4 HttpOnly cookie check)
  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setUser(data);
          setIsAuthenticated(true);
        }
      } catch (err) {
        console.error('Session restoration failed:', err);
      } finally {
        setLoading(false);
      }
    }
    checkSession();
  }, []);

  const login = async (email, password) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed. Please check your credentials.');
    }

    setUser(data.user);
    setIsAuthenticated(true);
    return data.user;
  };

  const register = async (email, password) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }

    return data;
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout API execution failed:', err);
    } finally {
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  const updateProfile = async (email, newPassword, currentPassword) => {
    const res = await fetch('/api/users/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, newPassword, currentPassword }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to update profile details.');
    }

    setUser(data.user);
    return data.user;
  };

  const updateAvatarUrl = (avatarUrl) => {
    setUser((prev) => (prev ? { ...prev, avatarUrl } : null));
  };

  const updateUserPreferences = async (theme, palette) => {
    const res = await fetch('/api/users/theme', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, palette }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to save theme preferences.');
    }

    setUser((prev) => (prev ? { ...prev, theme, palette } : null));
    return data;
  };

  const impersonateUser = async (targetUserId) => {
    const res = await fetch(`/api/auth/impersonate/${targetUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to start impersonation session.');
    }

    setUser(data.user);
    setIsAuthenticated(true);
    return data.user;
  };

  const stopImpersonation = async () => {
    const res = await fetch('/api/auth/unimpersonate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to end impersonation session.');
    }

    setUser(data.user);
    setIsAuthenticated(true);
    return data.user;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated,
        loading,
        login,
        register,
        logout,
        updateProfile,
        updateAvatarUrl,
        updateUserPreferences,
        impersonateUser,
        stopImpersonation,
        /*
         * The *effective* role, deliberately not the impersonator's.
         *
         * This once also returned true when an admin was impersonating, which
         * kept the Admin tab in the nav during impersonation. The server reads
         * the effective role, so every request behind that tab came back 403 —
         * a console that rendered and then failed at everything. It also broke
         * the point of impersonation, which is to see exactly what that user
         * sees. Getting back out is the banner's job, and that is gated on
         * isImpersonating rather than on this.
         */
        isAdmin: user?.role === 'admin',
        isImpersonating: !!user?.isImpersonating,
        impersonator: user?.impersonator || null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
