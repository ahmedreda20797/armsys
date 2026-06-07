// src/contexts/AuthContext.tsx
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { AuthUser } from '@/types';
import { ADMIN_PERMISSIONS, HR_PERMISSIONS, MANAGER_PERMISSIONS, DEFAULT_PERMISSIONS } from '@/config/permissions';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  error: string | null;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => false,
  logout: () => {},
  error: null,
  clearError: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function getPermissionsForRole(role: string): Record<string, 'none' | 'read' | 'edit'> {
  switch (role) {
    case 'admin': return { ...ADMIN_PERMISSIONS };
    case 'hr': return { ...HR_PERMISSIONS };
    case 'manager': return { ...MANAGER_PERMISSIONS };
    default: return { ...DEFAULT_PERMISSIONS };
  }
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
    default: return 'موظف';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem('erp_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setUser(parsed);
      } catch {
        localStorage.removeItem('erp_user');
      }
    }
    setLoading(false);
  }, []);

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

      let permissions = getPermissionsForRole(userData.role);
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

      const authUser: AuthUser = {
        id: userData.id,
        email: userData.email,
        name: userData.name || extractNameFromEmail(userData.email),
        role: userData.role,
        rank: userData.rank || getRankForRole(userData.role),
        permissions,
      };

      setUser(authUser);
      localStorage.setItem('erp_user', JSON.stringify(authUser));
      return true;
    } catch {
      setError('خطأ في الاتصال بالخادم');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem('erp_user');
    setError(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, error, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}
