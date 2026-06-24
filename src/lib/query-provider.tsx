'use client';

import React, { useState, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ═══════════════════════════════════════════════════
//  React Query Configuration — Optimized for ERP
// ═══════════════════════════════════════════════════

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 10 seconds (matches server cache TTL)
        staleTime: 10_000,
        // Keep data in cache for 5 minutes after becoming stale
        gcTime: 5 * 60 * 1000,
        // Retry failed requests once (not 3x default — faster UX)
        retry: 1,
        // Refetch on window focus for live updates across users
        refetchOnWindowFocus: true,
        // Don't refetch on reconnect (server cache handles this)
        refetchOnReconnect: true,
      },
      mutations: {
        // Don't retry mutations
        retry: false,
      },
    },
  });
}

// Singleton query client — survives across re-renders
let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always make a new client (no shared state across requests)
    return makeQueryClient();
  }
  // Browser: reuse existing client or create new one
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => getQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

// ═══════════════════════════════════════════════════
//  Token Refresh Mutex — prevents concurrent refreshes
// ═══════════════════════════════════════════════════

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessTokenLocked(): Promise<string | null> {
  // If a refresh is already in-flight, piggyback on it
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const refreshToken = localStorage.getItem('erp_refresh_token');
      if (!refreshToken) return null;

      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (!res.ok) {
        // Refresh failed — clear tokens (AuthContext will handle full logout)
        localStorage.removeItem('erp_access_token');
        localStorage.removeItem('erp_refresh_token');
        localStorage.removeItem('erp_user');
        return null;
      }

      const data = await res.json();
      localStorage.setItem('erp_access_token', data.accessToken);
      localStorage.setItem('erp_refresh_token', data.refreshToken);

      // Dispatch a custom event so AuthContext syncs the new token
      window.dispatchEvent(new CustomEvent('erp:token-refreshed', { detail: data }));

      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ═══════════════════════════════════════════════════
//  Generic API Fetcher with 401 auto-retry
// ═══════════════════════════════════════════════════

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);

  // Add Authorization Bearer token if not already present
  if (!headers.has('Authorization') && typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('erp_access_token');
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      // ignore
    }
  }

  let res = await fetch(url, { ...options, headers });

  // ─── 401 Auto-Retry with Token Refresh ─────────
  if (res.status === 401 && typeof window !== 'undefined') {
    const newToken = await refreshAccessTokenLocked();

    if (newToken) {
      // Retry the original request with the fresh token
      headers.set('Authorization', `Bearer ${newToken}`);
      res = await fetch(url, { ...options, headers });
    }
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// ═══════════════════════════════════════════════════
//  Optimistic Update Helper
// ═══════════════════════════════════════════════════

export function useOptimisticUpdate() {
  const utils = useCallback(() => {
    // Return a no-op rollback for now
    return { rollback: () => {} };
  }, []);

  return utils;
}