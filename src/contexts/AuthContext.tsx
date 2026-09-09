// src/contexts/AuthContext.tsx
// JWT-based Authentication Context
// Replaces localStorage user object + x-user-id header with Bearer tokens

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { AuthUser } from '@/types';
import { resolveEffectivePermissions } from '@/config/permissions';
import {
  AUTH_REFRESH_INTERVAL_MS,
  AUTH_FOREGROUND_STALE_MS,
  shouldPollNow,
  shouldRefreshOnForeground,
} from '@/lib/polling-policy';
import {
  LOGIN_ERROR_CODES,
  LOGIN_ERROR_MESSAGES,
  type LoginErrorCode,
  type LoginErrorField,
} from '@/lib/login-errors';

// ─── Structured login result ───────────────────────────────────────
// The caller maps `errorKey` to a field-specific Arabic message via
// lib/login-errors — raw server text is never matched or displayed
// blindly. `detail` is console-only diagnostics (never rendered).
export interface LoginResult {
  ok: boolean;
  errorKey: LoginErrorCode | string | null;
  field: LoginErrorField;
  message: string | null;
  detail?: string | null;
  remainingAttempts?: number | null;
  retryAfterSeconds?: number | null;
}

// A hung login request must never leave the user on a spinner — the
// fetch is aborted after this window and reported as NETWORK_ERROR.
// 45s because a COLD first login after a server restart can legitimately
// take ~20s: Firebase Admin SDK init + first OAuth token fetch + full
// users-table download (findFirst) + bcrypt migration rehash. Warm
// logins complete in ~1s; the timeout is the safety net, not the norm.
const LOGIN_TIMEOUT_MS = 45_000;

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
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
  login: async () => ({ ok: false, errorKey: null, field: 'general', message: null }),
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
  // Effective permissions = role preset, overridden by the optional
  // POSITION template, overridden by stored per-user entries.
  // Same resolution rule as the server (verifyPermission) — see
  // resolveEffectivePermissions in config/permissions.
  let stored: Record<string, unknown> | null = null;
  if (userData.permissions) {
    try {
      if (typeof userData.permissions === 'string') {
        stored = JSON.parse(userData.permissions);
      } else {
        stored = userData.permissions;
      }
    } catch {
      stored = null; /* use role defaults */
    }
  }
  const permissions = resolveEffectivePermissions(
    userData.role,
    stored,
    userData.positionPermissions ?? null,
  );

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
  // Ref to read latest accessToken without causing re-renders or callback recreation
  const accessTokenRef = useRef<string | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  // ─── Token Refresh Logic (with mutex) ────────────
  // Mutex lives in a ref so concurrent refresh calls are deduplicated
  // across renders (a render-scoped `let` would reset on every render).
  const refreshMutexRef = useRef<Promise<string | null> | null>(null);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    // Deduplicate concurrent refresh calls
    if (refreshMutexRef.current) return refreshMutexRef.current;

    refreshMutexRef.current = (async () => {
      try {
        const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
        if (!refreshToken) return null;

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
      } finally {
        refreshMutexRef.current = null;
      }
    })();

    return refreshMutexRef.current;
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
  // Uses refs to avoid dependency on accessToken (prevents infinite re-render loop)
  const refreshUser = useCallback(async () => {
    const token = accessTokenRef.current || localStorage.getItem(ACCESS_TOKEN_KEY);
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
  }, [refreshAccessToken]); // Stable deps only — accessToken read via ref

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
  }, []);  

  // ─── Background identity refresh (visibility-aware) ──────────
  // Picks up permission/suspension changes for UI reactivity. The
  // old 60s unconditional interval was the root cause of the idle
  // /api/auth/me churn. Server-side enforcement is unaffected (it
  // runs on every API request); this loop only refreshes the client
  // cache — every 5 minutes while visible, plus once when the tab
  // returns to the foreground with stale data. The 12-minute token
  // refresh below is independent and unchanged.
  useEffect(() => {
    if (!user) return;

    let lastRefreshAt = Date.now();

    const tick = () => {
      if (
        shouldPollNow({
          isVisible: typeof document === 'undefined' || !document.hidden,
          lastPollAt: lastRefreshAt,
          now: Date.now(),
          intervalMs: AUTH_REFRESH_INTERVAL_MS,
        })
      ) {
        lastRefreshAt = Date.now();
        refreshUser();
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) return;
      if (
        shouldRefreshOnForeground({
          lastFetchAt: lastRefreshAt,
          now: Date.now(),
          staleThresholdMs: AUTH_FOREGROUND_STALE_MS,
        })
      ) {
        lastRefreshAt = Date.now();
        refreshUser();
      }
    };

    refreshIntervalRef.current = setInterval(tick, AUTH_REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [!!user, refreshUser]); // !!user avoids object-reference churn

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

  // ─── Sync token from apiFetch auto-refresh ──────
  useEffect(() => {
    const handler = (e: Event) => {
      const data = (e as CustomEvent).detail;
      if (data?.accessToken) {
        setAccessToken(data.accessToken);
      }
    };
    window.addEventListener('erp:token-refreshed', handler);
    return () => window.removeEventListener('erp:token-refreshed', handler);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    setErrorKey(null);
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    setError(null);
    setErrorKey(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errorKey = (typeof data?.errorKey === 'string' && data.errorKey) || LOGIN_ERROR_CODES.SERVER_ERROR;
        // Technical details for debugging — codes and server-side
        // diagnostics only; credentials are never logged.
        console.error('[Auth] Login failed:', {
          status: res.status,
          errorKey,
          detail: data?.detail ?? data?.error ?? null,
        });
        return {
          ok: false,
          errorKey,
          field: data?.field === 'email' || data?.field === 'password' ? data.field : 'general',
          message: typeof data?.error === 'string' ? data.error : null,
          detail: typeof data?.detail === 'string' ? data.detail : null,
          remainingAttempts: typeof data?.remainingAttempts === 'number' ? data.remainingAttempts : null,
          retryAfterSeconds: typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null,
        };
      }

      const { accessToken: newAccessToken, refreshToken, user: userData } = data || {};

      if (!userData || !userData.id || !newAccessToken) {
        console.error('[Auth] Login returned an invalid payload:', data);
        return {
          ok: false,
          errorKey: LOGIN_ERROR_CODES.SERVER_ERROR,
          field: 'general',
          message: LOGIN_ERROR_MESSAGES.SERVER_ERROR,
        };
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

      return { ok: true, errorKey: null, field: 'general', message: null };
    } catch (err: any) {
      // Network failure or the timeout abort — same safe message either way.
      const timedOut = err?.name === 'AbortError';
      console.error(
        '[Auth] Login network error:',
        timedOut ? `request aborted after ${LOGIN_TIMEOUT_MS}ms (timeout)` : err
      );
      return {
        ok: false,
        errorKey: LOGIN_ERROR_CODES.NETWORK_ERROR,
        field: 'general',
        message: LOGIN_ERROR_MESSAGES.NETWORK_ERROR,
      };
    } finally {
      clearTimeout(timeoutId);
      // Deliberately NOT touching the global `loading` here — it drives
      // the full-screen session overlay (AppShell / page.tsx) and would
      // unmount the login form mid-request, wiping inline field errors.
      // The LoginPage owns its submit spinner and resets it in finally.
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
