// ══════════════════════════════════════════════════════════════
//  Generic idempotency guard (Data Integrity rule)
//
//  Prevents duplicate records caused by retries, refreshes, or
//  double-clicks. The client sends a `clientRequestId` with each
//  POST; the server checks for an existing record with the same ID
//  in the same collection. If found, returns the original.
//
//  Any module with user-facing POST endpoints can reuse this.
// ══════════════════════════════════════════════════════════════

import { findWhere, TTL } from '@/lib/db';

/** Result when no duplicate was found — safe to proceed. */
export interface IdempotencyClear {
  /** No duplicate found. */
  isDuplicate: false;
  existing: null;
}

/** Result when a duplicate was found — return the existing record. */
export interface IdempotencyDuplicate<T = Record<string, unknown>> {
  /** Duplicate found. */
  isDuplicate: true;
  existing: T;
}

/** Result of an idempotency check. */
export type IdempotencyCheckResult<T = Record<string, unknown>> =
  | IdempotencyClear
  | IdempotencyDuplicate<T>;

/**
 * Check whether a record with the given clientRequestId already exists
 * in the specified collection.
 *
 * Uses the cached getAll (TTL-cached) for cheap repeated calls.
 * Returns the existing record if a duplicate is found, so the caller
 * can return it to the client (transparent idempotency).
 *
 * @param collection - RTDB collection name.
 * @param clientRequestId - The idempotency key from the client.
 */
export async function checkForDuplicate<T = Record<string, unknown>>(
  collection: string,
  clientRequestId: string,
): Promise<IdempotencyCheckResult<T>> {
  if (!clientRequestId) {
    return { isDuplicate: false, existing: null };
  }

  const existing = await findWhere<T & { clientRequestId?: string }>(
    collection,
    { clientRequestId },
  );

  if (existing.length > 0) {
    // Return the first match (should be exactly one by design).
    return { isDuplicate: true, existing: existing[0] as T };
  }

  return { isDuplicate: false, existing: null };
}
