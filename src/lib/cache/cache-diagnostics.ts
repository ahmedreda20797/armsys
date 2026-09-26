// ══════════════════════════════════════════════════════════════
//  Cache Diagnostics — development-only observability (§45).
//
//  Two dev-only instruments, both silent in production builds:
//
//  1. attachCacheDiagnostics(queryClient) — logs cache lifecycle
//     events: MISS (first fetch), REVALIDATING (stale refetch),
//     UPDATED, INVALIDATED, ERROR, plus REQUEST DEDUPED when a fetch
//     for an in-flight query is coalesced.
//
//  2. devRequestCounter (in lib/api-fetch.ts) — counts actual network
//     requests per endpoint so "reads reduced" is measurable (§46):
//     window.__qnalysApiStats() prints the table.
//
//  No sensitive data is logged — keys and endpoints only.
// ══════════════════════════════════════════════════════════════

import type { QueryClient, Query } from '@tanstack/react-query';

const isDev = process.env.NODE_ENV !== 'production';

function label(query: Query): string {
  const key = JSON.stringify(query.queryKey);
  return key.length > 90 ? `${key.slice(0, 87)}…` : key;
}

export function attachCacheDiagnostics(queryClient: QueryClient): void {
  if (!isDev || typeof window === 'undefined') return;
  if ((queryClient as unknown as { __diagnosticsAttached?: boolean }).__diagnosticsAttached) return;
  (queryClient as unknown as { __diagnosticsAttached?: boolean }).__diagnosticsAttached = true;

  const log = (tag: string, key: string, extra = '') => {
    // Compact single-line dev log — grep-friendly [cache] prefix.
    console.debug(`[cache] ${tag.padEnd(13)} ${key}${extra ? ` ${extra}` : ''}`);
  };

  queryClient.getQueryCache().subscribe((event) => {
    const query = event.query;
    const key = label(query);
    switch (event.type) {
      case 'added':
        log('MISS', key);
        break;
      case 'updated': {
        const action = event.action as { type?: string };
        if (action.type === 'fetch') {
          const willDedup =
            query.state.fetchStatus === 'fetching' && query.state.data !== undefined;
          // The fetch action is applied before the fetcher dedup check;
          // a second fetch on an already-fetching query with data is
          // the coalesced case from the subscriber's point of view.
          log(willDedup ? 'REQUEST DEDUPED' : 'REVALIDATING', key);
        } else if (action.type === 'success') {
          log('UPDATED', key);
        } else if (action.type === 'error') {
          log('ERROR', key);
        } else if (action.type === 'invalidate') {
          log('INVALIDATED', key);
        }
        break;
      }
      default:
        break;
    }
  });
}

/** Cache snapshot for quick dev inspection (console). */
export function cacheStats(queryClient: QueryClient): {
  entries: number;
  byPrefix: Record<string, number>;
} {
  const cache = queryClient.getQueryCache();
  const byPrefix: Record<string, number> = {};
  for (const query of cache.getAll()) {
    const prefix = String(query.queryKey[0] ?? '?');
    byPrefix[prefix] = (byPrefix[prefix] ?? 0) + 1;
  }
  return { entries: cache.getAll().length, byPrefix };
}

export const CACHE_DIAGNOSTICS_DEV = isDev;
