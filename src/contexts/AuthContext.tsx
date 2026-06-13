// src/contexts/AuthContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AuthUser } from '@/types';
import { getPermissionsForRole as getRolePerms } from '@/config/permissions';
import { logLogin, logLogout } from '@/lib/activity-logger';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  error: string | null;
  clearError: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => false,
  logout: () => {},
  error: null,
  clearError: () => {},
  refreshUser: async () => {},
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

/** Override global fetch to include x-user-id header for server-side permission verification */
function setupAuthFetch(userId: string | undefined) {
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (userId) {
      const headers = new Headers(init?.headers);
      if (!headers.has('x-user-id')) {
        headers.set('x-user-id', userId);
      }
      return originalFetch(input, { ...init, headers });
    }
    return originalFetch(input, init);
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Build AuthUser from server data
  const buildAuthUser = useCallback((userData: any): AuthUser => {
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
  }, []);

  // Refresh user data from server (permissions, suspension status)
  const refreshUser = useCallback(async () => {
    const stored = localStorage.getItem('erp_user');
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored);
      if (!parsed?.id) return;

      const res = await fetch(`/api/auth/me?userId=${parsed.id}`);
      if (!res.ok) return;

      const userData = await res.json();
      if (!userData?.id) return;

      // If account was suspended, force logout
      if (userData.isSuspended) {
        localStorage.removeItem('erp_user');
        setUser(null);
        setError('هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.');
        return;
      }

      const authUser = buildAuthUser(userData);
      setUser(authUser);
      localStorage.setItem('erp_user', JSON.stringify(authUser));
    } catch {
      // Silent fail - keep existing cached data
    }
  }, [buildAuthUser]);

  // Initialize: load from localStorage, then refresh from server
  useEffect(() => {
    const stored = localStorage.getItem('erp_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
        // Override global fetch to include user ID
        setupAuthFetch(parsed.id);
      } catch {
        localStorage.removeItem('erp_user');
      }
    }
    setLoading(false);

    // Refresh permissions from server after mount
    refreshUser();

    // Auto-refresh every 10 seconds
    refreshIntervalRef.current = setInterval(refreshUser, 10000);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [refreshUser]);

  // Update global fetch when user changes
  useEffect(() => {
    if (user?.id) {
      setupAuthFetch(user.id);
    }
  }, [user?.id]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
        return false;
      }

      const data = await res.json();
      const userData = data.user;

      if (!userData || !userData.id) {
        setError('حدث خطأ في استجابة الخادم');
        return false;
      }

      // Check if account is suspended
      if (userData.isSuspended) {
        setError('هذا الحساب موقوف مؤقتاً. تواصل مع مدير النظام.');
        return false;
      }

      const authUser = buildAuthUser(userData);
      setUser(authUser);
      localStorage.setItem('erp_user', JSON.stringify(authUser));
      // Override global fetch to include user ID
      setupAuthFetch(authUser.id);
      // Log login activity (fire-and-forget)
      logLogin(authUser.name);
      return true;
    } catch {
      setError('خطأ في الاتصال بالخادم');
      return false;
    } finally {
      setLoading(false);
    }
  }, [buildAuthUser]);

  const logout = useCallback(() => {
    // Log logout activity before clearing state (fire-and-forget)
    if (user) {
      logLogout(user.name);
    }
    setUser(null);
    localStorage.removeItem('erp_user');
    setError(null);
    // Remove fetch override
    setupAuthFetch(undefined);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, error, clearError, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
