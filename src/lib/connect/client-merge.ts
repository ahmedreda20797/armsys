// src/lib/connect/client-merge.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — CLIENT CACHE MERGE (pure, React-free)
//
//  Pure merge functions the React Query layer applies to the messages
//  cache. No network, no state — trivially unit-testable and shared
//  by the initial page, the "load older" pagination and every sync
//  round (new + updated messages arrive separately and MUST dedupe).
//
//  Message identity = server message id (push key). Ordering =
//  ascending id (push keys are time-ordered; §ORDERING). Tombstones
//  (deletedAt set) keep their position, lose their body.
// ══════════════════════════════════════════════════════════════

import type { ConversationSyncPayload, MessageView } from './types';

/** Sort ascending by push key (== chronological). */
function byId(a: MessageView, b: MessageView): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Replace-or-append merge on message id (idempotent under replays). */
export function mergeMessages(existing: MessageView[], incoming: MessageView[]): MessageView[] {
  if (incoming.length === 0) return existing;
  const map = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) map.set(m.id, m);
  return Array.from(map.values()).sort(byId);
}

/** Remove optimistic (temp) entries once real ones arrived. */
export function dropTempMessage(existing: MessageView[], tempId: string): MessageView[] {
  return existing.filter((m) => m.id !== tempId);
}

export interface MessagesCacheShape {
  messages: MessageView[];
  /** Oldest loaded key (pagination cursor for "load older"). */
  oldestKey: string | null;
  /** true when older history exists beyond oldestKey. */
  hasOlder: boolean;
  /** Newest known message id — the sync cursor. */
  cursor: string | null;
  /**
   * §SYNC-CONTINUATION — the updated-messages cursor (epoch ms) the
   * client echoes back as `sinceMs`. Advances only past processed
   * records (server-provided), so >100-update bursts paginate safely.
   */
  updatedCursorMs: number | null;
  /** §SYNC-CONTINUATION — push key of the last processed update at
   *  `updatedCursorMs` (composite cursor; ties order by key). */
  updatedCursorKey: string | null;
  /** serverTimeMs of the last completed round (fallback sinceMs). */
  syncedAtMs: number | null;
}

export function makeInitialCache(messages: MessageView[], hasOlder: boolean, oldestKey: string | null, newestKey: string | null): MessagesCacheShape {
  return { messages, oldestKey, hasOlder, cursor: newestKey, updatedCursorMs: null, updatedCursorKey: null, syncedAtMs: null };
}

/**
 * Apply one sync round to the cache: new messages append (deduped),
 * updated messages replace in place (edits + tombstones), cursor
 * advances forward only. Returns a NEW cache object (immutability —
 * safe for React Query setQueryData).
 */
export function applySyncPayload(cache: MessagesCacheShape, payload: ConversationSyncPayload): MessagesCacheShape {
  const incoming = mergeMessages(cache.messages, [
    ...payload.newMessages,
    ...payload.updatedMessages,
  ]);
  const cursorAdvance = payload.cursor && (!cache.cursor || payload.cursor > cache.cursor)
    ? payload.cursor
    : cache.cursor;
  // §SYNC-CONTINUATION — all cursors advance forward only; a
  // slower/stale round can never regress them. The composite updated
  // cursor (ms + key) advances only past processed records.
  const updatedAdvance = payload.updatedCursorMs !== null && payload.updatedCursorMs !== undefined
    && (cache.updatedCursorMs === null || payload.updatedCursorMs > cache.updatedCursorMs
      || (payload.updatedCursorMs === cache.updatedCursorMs && payload.updatedCursorKey && (!cache.updatedCursorKey || payload.updatedCursorKey > cache.updatedCursorKey)))
    ? { ms: payload.updatedCursorMs, key: payload.updatedCursorKey ?? cache.updatedCursorKey }
    : { ms: cache.updatedCursorMs, key: cache.updatedCursorKey };
  const syncedAtAdvance = payload.serverTimeMs && (cache.syncedAtMs === null || payload.serverTimeMs > cache.syncedAtMs)
    ? payload.serverTimeMs
    : cache.syncedAtMs;
  return {
    ...cache,
    messages: incoming,
    cursor: cursorAdvance,
    updatedCursorMs: updatedAdvance.ms,
    updatedCursorKey: updatedAdvance.key,
    syncedAtMs: syncedAtAdvance,
    // Sync never changes pagination state of OLDER history.
    oldestKey: cache.oldestKey ?? (incoming.length > 0 ? incoming[0].id : null),
  };
}

/** Prepend an older page (ascending) + update pagination state. */
export function prependOlderPage(cache: MessagesCacheShape, older: MessageView[], hasOlder: boolean, oldestKey: string | null): MessagesCacheShape {
  const merged = mergeMessages(older, cache.messages);
  return {
    ...cache,
    messages: merged,
    hasOlder,
    oldestKey: oldestKey ?? cache.oldestKey,
  };
}
