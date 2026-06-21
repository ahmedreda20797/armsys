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
//  Generic API Fetcher
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

  const res = await fetch(url, {
    ...options,
    headers,
  });

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
