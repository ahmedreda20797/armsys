// ══════════════════════════════════════════════════════════════
//  Page State Persistence — Phase 6.3 (PURE core)
//
//  ONE storage abstraction for every page's restorable work state
//  (filters / period / sort / selected subject) — spec §4-§9:
//
//    • page identifier           — the PageRouter page key
//    • user-safe scope           — the authenticated user id is part
//                                  of the key, so one user can never
//                                  read another user's state (§6)
//    • state version             — `v{version}` in the key + stored
//                                  envelope; a version mismatch is
//                                  treated as absent state (§7)
//    • serializable state        — JSON envelope with a savedAt stamp
//    • restore / clear / reset   — load returns `null` for absent,
//                                  corrupt, or foreign state; clear
//                                  removes the record entirely
//
//  STORAGE DOCTRINE (§5): `session` (sessionStorage) is the default —
//  the work context of the current session, surviving navigation and
//  refresh but dying with the tab. `local` (localStorage) is reserved
//  for generated REPORT SNAPSHOTS (§13-§15) — a user's work product
//  worth keeping across sessions. NOTHING sensitive is ever stored
//  here (§5): filters, period keys and ids only.
//
//  CLIENT-SAFE + SSR-SAFE: every access is guarded; the pure key
//  builder and envelope codecs are unit-testable without a browser.
// ══════════════════════════════════════════════════════════════

/** Which browser store a page's state lives in. */
export type PageStateStorage = 'session' | 'local';

const KEY_PREFIX = 'arm-erp:page-state';
/** Current envelope format — bump when the envelope itself changes. */
export const PAGE_STATE_ENVELOPE_VERSION = 1;

/** The stored envelope. `v` is the SCHEMA version supplied by the caller. */
export interface PersistedPageState<T> {
  /** Caller schema version (page contract version, e.g. 1). */
  v: number;
  /** Envelope format version (defensive — validated on load). */
  env: number;
  /** ISO timestamp of the last save (stale-state policies, §19). */
  savedAt: string;
  state: T;
}

export interface PageStateKeyInput {
  userId: string;
  page: string;
  version: number;
  storage: PageStateStorage;
}

/**
 * Build the storage key. The user id is IN the key — cross-user
 * isolation is structural (§6), not a load-time check.
 */
export function pageStateStorageKey(input: PageStateKeyInput): string {
  return `${KEY_PREFIX}:${input.storage[0]}:${input.userId}:${input.page}:v${input.version}`;
}

/** Serialize an envelope (pure — injectable clock for tests). */
export function encodePageState<T>(state: T, version: number, now?: Date): string {
  const envelope: PersistedPageState<T> = {
    v: version,
    env: PAGE_STATE_ENVELOPE_VERSION,
    savedAt: (now ?? new Date()).toISOString(),
    state,
  };
  return JSON.stringify(envelope);
}

/**
 * Decode a stored envelope. Returns `null` (absent state) for ANY of:
 * unparsable JSON, wrong envelope format, version mismatch, or a
 * shape that is not an object. Old-version state must never break a
 * page (§7) — it is ignored, not migrated (migrate/reset is a
 * per-page decision made by supplying a different version).
 */
export function decodePageState<T>(
  raw: string | null | undefined,
  version: number,
): PersistedPageState<T> | null {
  if (!raw || typeof raw !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const candidate = parsed as Partial<PersistedPageState<T>>;
    if (candidate.env !== PAGE_STATE_ENVELOPE_VERSION) return null;
    if (candidate.v !== version) return null;
    if (typeof candidate.savedAt !== 'string') return null;
    if (!('state' in candidate)) return null;
    return candidate as PersistedPageState<T>;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
//  Browser access (SSR-safe; every error is swallowed — storage
//  must never break a page, §44 fail-safe)
// ─────────────────────────────────────────────────────────────

function storageOf(storage: PageStateStorage): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return storage === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null; // storage disabled (privacy mode) — state simply resets
  }
}

/** Persist state (overwrite semantics). Silent no-op when unavailable. */
export function writePageState<T>(
  input: PageStateKeyInput,
  state: T,
  now?: Date,
): void {
  const store = storageOf(input.storage);
  if (!store) return;
  try {
    store.setItem(pageStateStorageKey(input), encodePageState(state, input.version, now));
  } catch {
    // Quota exceeded / disabled storage — persistence is best-effort.
  }
}

/** Read + validate. Returns the full envelope or null. */
export function readPageState<T>(
  input: PageStateKeyInput,
): PersistedPageState<T> | null {
  const store = storageOf(input.storage);
  if (!store) return null;
  try {
    return decodePageState<T>(store.getItem(pageStateStorageKey(input)), input.version);
  } catch {
    return null;
  }
}

/** Remove the state record entirely (Clear Filters semantics, §9). */
export function removePageState(input: PageStateKeyInput): void {
  const store = storageOf(input.storage);
  if (!store) return;
  try {
    store.removeItem(pageStateStorageKey(input));
  } catch {
    /* best-effort */
  }
}
