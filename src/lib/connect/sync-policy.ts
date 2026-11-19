// src/lib/connect/sync-policy.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — CLIENT SYNC POLICY (pure, DOM-free)
//
//  The decision layer for §SPEC-11 optimized polling, mirroring the
//  lib/polling-policy.ts conventions so the behavior is unit-testable:
//
//    • Active conversation: ~10s polling (ACTIVE_CONVERSATION_POLL_MS).
//    • Conversation list: ~30s background polling (slower).
//    • Hidden tab: NO polling (React Query's
//      refetchIntervalInBackground:false drives it; shouldPollNow is
//      the pure decision the tests pin).
//    • Foreground return: immediate refresh when stale.
//    • Overlap prevention: a poll never fires while a previous sync
//      round for the same conversation is still pending.
//    • Failure handling: retries back off instead of hammering a
//      failing endpoint (the poll interval grows after consecutive
//      failures, capped).
// ══════════════════════════════════════════════════════════════

import {
  ACTIVE_CONVERSATION_POLL_MS,
  CONVERSATION_LIST_POLL_MS,
  SYNC_MIN_GAP_MS,
} from './constants';

/** How often the ACTIVE conversation syncs (visible tab). */
export function activePollIntervalMs(consecutiveFailures: number): number {
  // Backoff: 1x → 2x → 4x → 8x (capped) on consecutive failures.
  const factor = Math.min(2 ** Math.max(0, consecutiveFailures), 8);
  return ACTIVE_CONVERSATION_POLL_MS * factor;
}

/** How often the conversation list refreshes (visible tab). */
export function listPollIntervalMs(): number {
  return CONVERSATION_LIST_POLL_MS;
}

/** Should a poll fire right now? Hidden tabs never poll. */
export function shouldPollNow(args: {
  isVisible: boolean;
  lastPollAt: number | null;
  now: number;
  intervalMs: number;
}): boolean {
  if (!args.isVisible) return false;
  if (args.lastPollAt === null) return true;
  return args.now - args.lastPollAt >= args.intervalMs;
}

/**
 * Overlap guard: may a NEW sync round start? A round that is still
 * pending (or finished less than SYNC_MIN_GAP_MS ago) blocks a new
 * one — overlapping requests would race the cursor forward.
 */
export function mayStartSyncRound(args: {
  hasPendingRound: boolean;
  lastRoundFinishedAt: number | null;
  now: number;
}): boolean {
  if (args.hasPendingRound) return false;
  if (args.lastRoundFinishedAt === null) return true;
  return args.now - args.lastRoundFinishedAt >= SYNC_MIN_GAP_MS;
}

/** Foreground return: refresh immediately only when data is stale. */
export function shouldRefreshOnForeground(args: {
  lastFetchAt: number | null;
  now: number;
  staleThresholdMs: number;
}): boolean {
  if (args.lastFetchAt === null) return true;
  return args.now - args.lastFetchAt >= args.staleThresholdMs;
}

/**
 * Cursor merge decision for the sync response: advance the client
 * cursor only when the payload's cursor is NEWER than what we hold
 * (push-key comparisons — never regress under a slow response
 * arriving after a faster newer one).
 */
export function shouldAdvanceCursor(incoming: string | null, current: string | null): boolean {
  if (!incoming) return false;
  if (!current) return true;
  return incoming > current;
}
