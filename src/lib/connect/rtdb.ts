// src/lib/connect/rtdb.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — SERVER-SIDE RTDB ACCESS PRIMITIVE
//
//  §SERVER-ONLY BOUNDARY — the ONLY file in lib/connect that touches
//  the Firebase ADMIN SDK (via lib/firebase-server). Every service
//  imports these helpers, never the SDK directly, so:
//    • Database access stays isolated behind one boundary (swap point
//      for a future SQL-backed store — the services above this file
//      speak domain terms, not Firebase terms).
//    • The test harness replaces this module's behavior through the
//      firebase-server stub WITHOUT patching five services.
//
//  Connect deliberately does NOT go through lib/db's table helpers:
//  the messaging domain needs push-key allocation, key-ordered range
//  queries, child-ordered queries and transactions, none of which the
//  table CRUD layer exposes. Everything here is still keyed under
//  arm_erp/connect/* and documented in the delivery report.
// ══════════════════════════════════════════════════════════════

import 'server-only';
import { getAdminDb } from '@/lib/firebase-server';

/** A raw RTDB reference (escape hatch — use sparingly). */
export function connectRef(path: string) {
  return getAdminDb().ref(path);
}

/** Read one value. Resolves null when the path does not exist. */
export async function connectGet<T = unknown>(path: string): Promise<T | null> {
  const snapshot = await getAdminDb().ref(path).get();
  return snapshot.exists() ? (snapshot.val() as T) : null;
}

/** Overwrite one value (creates parents). */
export async function connectSet(path: string, value: unknown): Promise<void> {
  await getAdminDb().ref(path).set(value);
}

/**
 * Atomic multi-path update. The map is a flat { path: value } where
 * paths are RELATIVE TO `basePath` (empty string = the base itself),
 * mirroring db.ts §RTDB-PATCH-SEMANTICS: RTDB update() is shallow per
 * path, so field patches address `child/field` explicitly. A `null`
 * value deletes the target path. The whole map commits atomically or
 * not at all.
 */
export async function connectUpdate(basePath: string, relativeMap: Record<string, unknown>): Promise<void> {
  await getAdminDb().ref(basePath).update(relativeMap);
}

/** Delete one path. */
export async function connectRemove(path: string): Promise<void> {
  await getAdminDb().ref(path).remove();
}

/**
 * Allocate a NEW push key WITHOUT writing (Admin SDK generates keys
 * client-side). Push keys are lexicographically ordered by creation
 * time — the verified concurrency-safe, sortable message identity
 * (§ORDERING in the delivery report).
 */
export function connectNewPushKey(path: string): string {
  const ref = getAdminDb().ref(path);
  return ref.push().key as string;
}

export interface ConnectTransactionResult<T> {
  committed: boolean;
  value: T | null;
}

/**
 * Run a transaction at one path. `fn` receives the current value and
 * returns the new value, or undefined to abort. RTDB transactions are
 * atomic per path (serialized against concurrent transactions and
 * guarded against intervening writes) — this is the primitive behind
 * clientKey idempotency claims and monotonic cursor updates.
 */
export async function connectTransaction<T>(
  path: string,
  fn: (current: T | null) => T | undefined | null,
): Promise<ConnectTransactionResult<T>> {
  const result = await getAdminDb().ref(path).transaction((current) => fn((current ?? null) as T | null));
  return {
    committed: result.committed,
    value: (result.snapshot?.exists() ? (result.snapshot.val() as T) : null),
  };
}

// ─── Unindexed-query detection (§INDEX-FALLBACK) ───────────────

/**
 * RTDB rejects child-ordered queries whose `.indexOn` is not declared
 * in the rules — "Index not defined, add \".indexOn\": …" — even for
 * the Admin SDK (the index requirement is server-side, not a security
 * rule). Callers fall back to bounded plain reads so Connect keeps
 * working until the owner publishes the documented indexes.
 */
export function isUnindexedQueryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Index not defined/i.test(message) && /\.indexOn/i.test(message);
}

let warnedUnindexed = false;
/** One concise warn per server process (never per request). */
export function warnUnindexedOnce(surface: string): void {
  if (warnedUnindexed) return;
  warnedUnindexed = true;
  console.warn(
    `connect/${surface}: .indexOn not published — using plain-read fallback. Publish the connect indexes from database.rules.json to restore indexed queries.`,
  );
}

// ─── Ordered range query ───────────────────────────────────────

export interface ConnectQueryOptions {
  /** Order by key (native order — no index needed) or a child field. */
  orderBy: 'key' | { child: string };
  /** INCLUSIVE lower bound (a key/value or null for none). */
  startAt?: string | number | null;
  /** INCLUSIVE upper bound. */
  endAt?: string | number | null;
  /** Fetch the FIRST n of the window (ascending). */
  limitToFirst?: number;
  /** Fetch the LAST n of the window (still returned ascending). */
  limitToLast?: number;
}

/**
 * One bounded range query, materialized to an ordered record map.
 * For orderBy:'key' no index declaration is required; child-field
 * ordering requires a `.indexOn` declaration (see the delivery
 * report — indexes are documented, NEVER published by this module).
 */
export async function connectQuery<T = unknown>(
  path: string,
  options: ConnectQueryOptions,
): Promise<{ key: string; value: T }[]> {
  // `any` at the query-builder seam: the chained builder's type is
  // firebase-admin-internal (Query) and the chain is always terminated
  // by .get() below — no untyped value escapes this function.
  let query: any = getAdminDb().ref(path);
  if (options.orderBy === 'key') {
    query = query.orderByKey();
  } else {
    query = query.orderByChild(options.orderBy.child);
  }
  if (options.startAt !== undefined && options.startAt !== null) query = query.startAt(options.startAt);
  if (options.endAt !== undefined && options.endAt !== null) query = query.endAt(options.endAt);
  if (options.limitToFirst !== undefined) query = query.limitToFirst(options.limitToFirst);
  if (options.limitToLast !== undefined) query = query.limitToLast(options.limitToLast);

  const snapshot = await query.get();
  const out: { key: string; value: T }[] = [];
  snapshot.forEach((child: { key: string; val: () => T }) => {
    out.push({ key: child.key, value: child.val() });
  });
  return out;
}
