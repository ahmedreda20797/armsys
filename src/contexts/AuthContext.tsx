// src/contexts/AuthContext.tsx
// JWT-based Authentication Context
// Replaces localStorage user object + x-user-id header with Bearer tokens

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AuthUser } from '@/types';
import { getPermissionsForRole as getRolePerms } from '@/config/permissions';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  error: string | null;
  errorKey: string | null;
  clearError: () => void;
  refreshUser: () => Promise<void>;
  accessToken: string | null;
  requiresPasswordChange: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => false,
  logout: async () => {},
  error: null,
  errorKey: null,
  clearError: () => {},
  refreshUser: async () => {},
  accessToken: null,
  requiresPasswordChange: false,
});

export function useAuth() {
  return useContext(AuthContext);
}

function extractNameFromEmail(email: string): string {
  const namePart = email.split('@')[0];
  return namePart.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function getRankForRole(role: string): string {
  switch (role) {
    case 'admin': return 'مدير النظام';
    case 'hr': return 'موارد بشرية';
    case 'manager': return 'مدير';
    case 'quality': return 'جودة';
    default: return 'موظف';
  }
}

/** Build AuthUser from server data */
function buildAuthUser(userData: any): AuthUser {
  let permissions = getRolePerms(userData.role);
  if (userData.permissions) {
    try {
      if (typeof userData.permissions === 'string') {
        permissions = { ...permissions, ...JSON.parse(userData.permissions) };
      } else {
        permissions = { ...permissions, ...userData.permissions };
      }
    } catch {
      /* use role defaults */
    }
  }

  return {
    id: userData.id,
    email: userData.email,
    name: userData.name || extractNameFromEmail(userData.email),
    role: userData.role,
    rank: userData.rank || getRankForRole(userData.role),
    permissions,
    isSuspended: userData.isSuspended || false,
    suspendedAt: userData.suspendedAt || null,
  };
}

// ─── Token Storage Keys ────────────────────────────
const ACCESS_TOKEN_KEY = 'erp_access_token';
const REFRESH_TOKEN_KEY = 'erp_refresh_token';
const USER_DATA_KEY = 'erp_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [requiresPasswordChange, setRequiresPasswordChange] = useState(false);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Token Refresh Logic ──────────────────────────
  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // Refresh token is invalid or expired — force logout
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(USER_DATA_KEY);
        setUser(null);
        setAccessToken(null);
        return null;
      }

      const data = await res.json();
      const newAccessToken = data.accessToken;
      const newRefreshToken = data.refreshToken;

      localStorage.setItem(ACCESS_TOKEN_KEY, newAccessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
      setAccessToken(newAccessToken);

      return newAccessToken;
    } catch {
      return null;
    }
  }, []);

  // ─── Fetch current user data from server ─────────
  const fetchCurrentUser = useCallback(async (token: string | null): Promise<AuthUser | null> => {
    if (!token) return null;

    try {
      const res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 401) {
        // Token expired — try refresh
        const newToken = await refreshAccessToken();
        if (!newToken) return null;

        const retryRes = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!retryRes.ok) return null;
        const retryData = await retryRes.json();
        return retryData ? buildAuthUser(retryData) : null;
      }

      if (res.status === 403) {
        // Account suspended
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
        localStorage.removeItem(USER_DATA_KEY);
        setUser(null);
        setAccessToken(null);
        setError('هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.');
        setErrorKey('ACCOUNT_SUSPENDED');
        return null;
      }

      if (!res.ok) return null;

      const userData = await res.json();
      return userData ? buildAuthUser(userData) : null;
    } catch {
      return null;
    }
  }, [refreshAccessToken]);

  // ─── Refresh user data (permissions, suspension) ─
  const refreshUser = useCallback(async () => {
    const token = accessToken || localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!token) return;

    try {
      // Try with current token first
      let res = await fetch('/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      // If 401, try refreshing
      if (res.status === 401) {
        const newToken = await refreshAccessToken();
        if (!newToken) return;
        res = await fetch('/api/auth/me', {
          headers: {
            'Authorization': `Bearer ${newToken}`,
            'Content-Type': 'application/json',
          },
        });
      }

      if (!res.ok) return;

      const userData = await res.json();
      if (!userData?.id) return;

      const authUser = buildAuthUser(userData);
      setUser(authUser);
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(authUser));
    } catch {
      // Silent fail — keep existing cached data
    }
  }, [accessToken, refreshAccessToken]);

  // ─── Initialize: restore session from stored tokens ─
  useEffect(() => {
    const initAuth = async () => {
      const storedToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (storedToken) {
        setAccessToken(storedToken);
        const userData = await fetchCurrentUser(storedToken);
        if (userData) {
          setUser(userData);
        } else if (storedRefreshToken) {
          // Access token expired, try refresh
          const newToken = await refreshAccessToken();
          if (newToken) {
            const userData = await fetchCurrentUser(newToken);
            if (userData) {
              setUser(userData);
            }
          }
        }
      }

      setLoading(false);
    };

    initAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh user data every 30 seconds (reduced from 10s)
  useEffect(() => {
    if (!user) return;

    refreshUser();
    refreshIntervalRef.current = setInterval(refreshUser, 30000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [user, refreshUser]);

  // ─── Proactive token refresh before expiry ───────
  // Access tokens last 15m — refresh at 12m
  useEffect(() => {
    if (!accessToken) return;

    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    // Schedule refresh 12 minutes from now
    refreshTimerRef.current = setTimeout(async () => {
      await refreshAccessToken();
    }, 12 * 60 * 1000);

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [accessToken, refreshAccessToken]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorKey(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    setErrorKey(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
        setErrorKey(data.errorKey || 'INVALID_CREDENTIALS');
        return false;
      }

      const { accessToken: newAccessToken, refreshToken, user: userData } = data;

      if (!userData || !userData.id || !newAccessToken) {
        setError('حدث خطأ في استجابة الخادم');
        return false;
      }

      // Store tokens securely
      localStorage.setItem(ACCESS_TOKEN_KEY, newAccessToken);
      localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

      // Build and store user data
      const authUser = buildAuthUser(userData);
      setUser(authUser);
      setAccessToken(newAccessToken);
      setRequiresPasswordChange(userData.requiresPasswordChange || false);
      localStorage.setItem(USER_DATA_KEY, JSON.stringify(authUser));

      return true;
    } catch {
      setError('خطأ في الاتصال بالخادم');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      const token = accessToken || localStorage.getItem(ACCESS_TOKEN_KEY);
      const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      if (token && refreshToken) {
        // Fire-and-forget server-side logout
        fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ refreshToken }),
        }).catch(() => {});
      }
    } catch {
      // Continue with client-side logout regardless
    } finally {
      // Clear all auth state
      setUser(null);
      setAccessToken(null);
      setRequiresPasswordChange(false);
      setError(null);
      setErrorKey(null);
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      localStorage.removeItem(USER_DATA_KEY);
    }
  }, [accessToken]);

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      error,
      errorKey,
      clearError,
      refreshUser,
      accessToken,
      requiresPasswordChange,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
