'use client';

// ══════════════════════════════════════════════════════════════
//  useUnseenCounts / useMarkSeen — sidebar "new items" badges
//
//  §PERF contract:
//    • ONE shared query for the whole app (sidebar + marker share it).
//    • staleTime 30s + 90s background refetch (visible tab only) +
//      refetch on window focus — cheap, never per-keystroke.
//    • mark-seen flips the LOCAL cache to 0 immediately (badge
//      disappears in the same frame) and PATCHes the server in the
//      background WITHOUT invalidating the summary (zero refetch).
// ══════════════════════════════════════════════════════════════

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/query-provider';
import { isUnseenMonitoredPage } from '@/lib/unseen';

export const unseenKeys = {
  summary: ['unseen', 'summary'] as const,
};

interface UnseenSummary {
  counts: Record<string, number>;
  serverTime: string;
}

export function useUnseenCounts() {
  return useQuery<UnseenSummary>({
    queryKey: unseenKeys.summary,
    queryFn: () => apiFetch<UnseenSummary>('/api/unseen'),
    staleTime: 30_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}

/** Unread count for a sidebar page id (0 when none / not monitored). */
export function unseenCountOf(counts: Record<string, number> | undefined, pageId: string): number {
  if (!counts || !isUnseenMonitoredPage(pageId)) return 0;
  return counts[pageId] ?? 0;
}

/**
 * Mark a module as seen for the CURRENT USER ONLY. Optimistic: the
 * local cache zeroes the badge at once, the POST runs in the
 * background, and on failure the next background refetch restores
 * the truth (best-effort UI state, exactly like the AttentionPanel
 * collapse persistence).
 */
export function useMarkSeen() {
  const qc = useQueryClient();
  return (pageId: string) => {
    if (!isUnseenMonitoredPage(pageId)) return;
    qc.setQueryData<UnseenSummary>(unseenKeys.summary, (prev) =>
      prev ? { ...prev, counts: { ...prev.counts, [pageId]: 0 } } : prev,
    );
    void apiFetch('/api/unseen', {
      method: 'POST',
      body: JSON.stringify({ page: pageId }),
    }).catch(() => {
      // Best-effort — the next poll/focus refetch reconciles.
      void qc.invalidateQueries({ queryKey: unseenKeys.summary });
    });
  };
}
