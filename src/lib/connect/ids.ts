// src/lib/connect/ids.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — IDENTIFIERS
//
//  • Conversation ids: cuid2 (same generator as lib/db createRecord).
//  • Message ids: RTDB push keys allocated via the Admin SDK
//    (lexicographically ordered by creation time — the verified
//    concurrency-safe sortable identity; see connectNewPushKey).
//  • Direct-conversation dedup key: sorted "uidA|uidB" — makes
//    "create or retrieve the existing direct conversation" a pure
//    computation (§DIRECT-DEDUP).
// ══════════════════════════════════════════════════════════════

import { createId } from '@paralleldrive/cuid2';

/** New conversation id (cuid2 — collision-safe, index-friendly). */
export function newConversationId(): string {
  return createId();
}

/** Stable dedup key for a pair of direct-conversation participants. */
export function directKeyFor(userA: string, userB: string): string {
  return [userA, userB].sort().join('|');
}

/** Parse a directKey back into its two user ids. */
export function usersOfDirectKey(key: string): [string, string] | null {
  const parts = key.split('|');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

/**
 * Push-key ordering utilities. RTDB push keys are time-ordered:
 * a key created later ALWAYS sorts lexicographically after an earlier
 * one. Cursor comparisons use this instead of timestamps (§ORDERING —
 * "do not use timestamps alone as unique identifiers").
 */

/** true when `candidate` is strictly newer than `cursor`. */
export function isNewerPushKey(candidate: string, cursor: string | null | undefined): boolean {
  if (!cursor) return true;
  return candidate > cursor;
}

/** The newer of two push keys (null-safe). */
export function newerPushKey(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** User-supplied id shape guard (route inputs — fail closed on junk). */
export function isValidEntityId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && /^[A-Za-z0-9_-]+$/.test(id);
}
