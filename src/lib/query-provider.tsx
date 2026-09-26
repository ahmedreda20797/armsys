'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_STALE_TIME_MS, DEFAULT_GC_TIME_MS } from '@/lib/cache/cache-policy';
import { attachCacheDiagnostics } from '@/lib/cache/cache-diagnostics';

// ══════════════════════════════════════════════════════════════
//  React Query Configuration — Optimized for ERP
//
//  The QueryClient IS the canonical client data cache (§CACHE):
//  cache keys, stale-while-revalidate, deduplication, race
//  sequencing, bounded memory and error states are all owned here.
//  Freshness numbers live in lib/cache/cache-policy.ts — the
//  defaults below cover every hook that doesn't declare its own.
// ══════════════════════════════════════════════════════════════

function makeQueryClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 30s — no refetch while fresh,
        // stale-while-revalidate afterwards (§10).
        staleTime: DEFAULT_STALE_TIME_MS,
        // Unused entries survive 30 minutes after their last observer
        // unmounts: navigating back to a page restores the snapshot
        // instead of re-downloading (§9/§28), and memory stays
        // bounded by what was actually visited (§29).
        gcTime: DEFAULT_GC_TIME_MS,
        // Retry failed requests once (not 3x default — faster UX)
        retry: 1,
        // Refetch on window focus for live updates across users
        refetchOnWindowFocus: true,
        // Refetch on reconnect (server handles its own TTLs)
        refetchOnReconnect: true,
      },
      mutations: {
        // Don't retry mutations
        retry: false,
      },
    },
  });

  // Development-only HIT/MISS/REVALIDATING/UPDATED/INVALIDATED log.
  attachCacheDiagnostics(client);
  return client;
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

// ══════════════════════════════════════════════════════════════
//  Generic API Fetcher — canonical implementation lives in
//  lib/api-fetch.ts (shared token-refresh mutex with authFetch).
//  Re-exported here to keep every existing import path stable.
// ══════════════════════════════════════════════════════════════

export { apiFetch } from '@/lib/api-fetch';
