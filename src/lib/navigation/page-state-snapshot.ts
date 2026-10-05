// ══════════════════════════════════════════════════════════════
//  Page-State Snapshots — per-navigation-entry page continuity
//  (SPA Navigation History, §12 "page INSTANCE vs page NAME")
//
//  `usePageState` persists ONE record per (user, page, slot) — the
//  page's LATEST state. That is exactly right for "come back to
//  this page later", but WRONG for history restoration:
//
//    Smart Report / Employee A / September   (history entry 1)
//    Smart Report / Employee B / August      (history entry 2)
//
//  Navigating from entry 1 to entry 2 overwrites the shared record,
//  so a naive "Back to entry 1" would restore Employee B — the two
//  contexts must not clobber each other (§12).
//
//  This layer fixes that WITHOUT touching usePageState: when a
//  navigation LEAVES an entry, the page's full persisted state
//  (every slot, both storages, raw envelopes) is captured under the
//  entry's id; when history RETURNS to that entry, the captured
//  records are written back BEFORE the page remounts — so the
//  page's own standard restore-on-mount picks up exactly the state
//  it had when the user left it.
//
//  RAW envelope strings are stored verbatim (no decode/encode
//  round-trip: versions, savedAt stamps and validation all stay
//  exactly as they were). Snapshots live IN MEMORY ONLY — they are
//  session navigation continuity, not persistence (§16: reload
//  restores only what the existing persistence layer designed).
//  A bounded LRU (§23) keeps memory flat.
// ══════════════════════════════════════════════════════════════

import { pageStateKeyPrefix } from '@/lib/page-state/persistence';
import { flushPageStateWriters } from '@/lib/page-state/flush-registry';

/** Minimal storage surface needed (both session and local satisfy it). */
export interface SnapshotStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** The storages a snapshot captures — injectable for tests. */
export interface SnapshotStorageEnv {
  session: SnapshotStorage | null;
  local: SnapshotStorage | null;
}

/** Everything needed to rebuild one navigation entry's page state. */
export interface EntryStateSnapshot {
  /** Raw page-state records: full storage key → raw envelope JSON. */
  pageState: Record<string, string>;
  /** Window scroll offset captured when the entry was left (§17). */
  scrollY: number;
  /** ISO timestamp (diagnostics). */
  capturedAt: string;
}

/** Bounded in-session snapshot store keyed by navigation entry id. */
export class EntrySnapshotStore {
  private readonly entries = new Map<string, EntryStateSnapshot>();

  constructor(private readonly maxEntries = 50) {}

  set(entryId: string, snapshot: EntryStateSnapshot): void {
    // LRU bound (§23): re-insert to refresh order, then evict oldest.
    this.entries.delete(entryId);
    this.entries.set(entryId, snapshot);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  get(entryId: string): EntryStateSnapshot | undefined {
    return this.entries.get(entryId);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

function enumeratePrefix(storage: SnapshotStorage, prefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key === null || !key.startsWith(prefix)) continue;
    const raw = storage.getItem(key);
    if (raw !== null) out[key] = raw;
  }
  return out;
}

/**
 * Capture a page's FULL persisted state (every slot + version, both
 * session and local storages). Pending usePageState writes are
 * flushed FIRST so the capture matches what the user last saw —
 * never a 250 ms-old debounce remainder.
 */
export function capturePageStateSnapshot(
  env: SnapshotStorageEnv,
  userId: string,
  page: string,
): Record<string, string> {
  flushPageStateWriters(page);
  const captured: Record<string, string> = {};
  if (env.session) {
    Object.assign(captured, enumeratePrefix(env.session, pageStateKeyPrefix(userId, page, 'session')));
  }
  if (env.local) {
    Object.assign(captured, enumeratePrefix(env.local, pageStateKeyPrefix(userId, page, 'local')));
  }
  return captured;
}

/** Write a captured snapshot back so the remounting page restores it. */
export function applyPageStateSnapshot(
  env: SnapshotStorageEnv,
  captured: Record<string, string>,
): void {
  for (const [key, raw] of Object.entries(captured)) {
    // Local-marker keys go to localStorage, everything else to
    // sessionStorage — the capture recorded the exact target key.
    const isLocal = key.includes(':l:');
    const storage = isLocal ? env.local : env.session;
    try {
      storage?.setItem(key, raw);
    } catch {
      // Storage unavailable/quota — restoration is best-effort.
    }
  }
}
