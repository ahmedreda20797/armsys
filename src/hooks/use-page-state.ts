'use client';

// ══════════════════════════════════════════════════════════════
//  usePageState — the React binding for Page State Persistence
//  (Phase 6.3, spec §4/§8/§9/§43)
//
//  A drop-in replacement for the per-page filter `useState`:
//
//    const [filters, setFilters, resetFilters] = usePageState({
//      page: 'observations',
//      version: 1,
//      initial: () => ({ month: navMonth ?? CURRENT_MONTH }),
//      validate: isObservationFilters,   // optional shape guard (§43)
//    });
//
//  Behavior:
//    • RESTORE-ON-MOUNT — an effect (pre-paint, before any data
//      query can resolve) adopts persisted state when it exists, is
//      the right version, and passes `validate`; otherwise the page
//      default stays (invalid/stale state fails safe, §44 — never a
//      crash, never an extra render flash that matters: pages render
//      skeletons while their data loads anyway).
//    • ISOLATION — the authenticated user id scopes the storage key,
//      so state can never leak across users (§6). Without a resolved
//      identity nothing is read or written.
//    • DEBOUNCED WRITES — state changes persist after a short
//      debounce (§47 lightweight persistence); the component updates
//      instantly. Pending writes flush on unmount.
//    • reset() = RESET TO PAGE DEFAULT (§9): removes the persisted
//      record AND returns to `initial` — "مسح الفلاتر" never
//      resurrects old state.
//
//  Transient UI state (dropdown open / hover / focus) must NOT go
//  through this hook (§8).
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  readPageState,
  removePageState,
  writePageState,
  type PageStateStorage,
} from '@/lib/page-state/persistence';

export interface UsePageStateOptions<T> {
  /** The PageRouter page key — the persistence namespace. */
  page: string;
  /**
   * Optional slot within the page (filters / view / report …). Pages
   * with more than one persisted state MUST use distinct slots.
   */
  slot?: string;
  /** Page state schema version (§7). Bump to orphan old shapes. */
  version?: number;
  /** 'session' (default) or 'local' (report snapshots, §5). */
  storage?: PageStateStorage;
  /** Page-default value (value or lazy initializer). */
  initial: T | (() => T);
  /**
   * Optional restore guard (§43): receives the decoded persisted
   * value; return the validated value, or null/undefined to REJECT
   * (persisted value is discarded and the page default is kept).
   */
  validate?: (raw: T) => T | null | undefined;
  /** Write debounce ms (default 250). */
  debounceMs?: number;
  /**
   * When true AT MOUNT, restoration is skipped for this mount — used
   * when an explicit navigation intent (e.g. a search result seeding
   * the month, §27) takes priority over the remembered state. The
   * seeded value then becomes the state and persists normally.
   */
    skipRestore?: boolean;
}

const WRITE_DEBOUNCE_MS = 250;

export function usePageState<T>(options: UsePageStateOptions<T>) {
  const { page, slot = 'main', version = 1, storage = 'session', initial, validate, debounceMs = WRITE_DEBOUNCE_MS } = options;
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Captured ONCE per mount via the lazy initializer (mount-time
  // semantics without a render-phase ref write): navigation seeds are
  // set BEFORE the page mounts and never change during it.
  const [skipRestore] = useState(() => options.skipRestore ?? false);

  const [state, setState] = useState<T>(() =>
    typeof initial === 'function' ? (initial as () => T)() : initial,
  );

  const restoredRef = useRef(false);
  const touchedRef = useRef(false); // user interacted before auth resolved
  useEffect(() => {
    if (restoredRef.current) return; // restore exactly once per mount
    if (!userId) return; // no identity yet → nothing to restore (§6)
    if (skipRestore) {
      restoredRef.current = true;
      return; // explicit navigation intent wins (§27) — state persists via set()
    }
    restoredRef.current = true;
    if (touchedRef.current) return; // late auth: never clobber live edits
    const envelope = readPageState<T>({ userId, page: slot ? `${page}:${slot}` : page, version, storage });
    if (!envelope) return;
    const restoredValue = validate ? validate(envelope.state) : envelope.state;
    if (restoredValue === null || restoredValue === undefined) return; // fail safe (§44)
    // Deferred one frame (react-hooks/set-state-in-effect doctrine —
    // same pattern as the deep-link auto-expands): restore is a
    // one-shot hydration, not a render-phase adjustment.
    const raf = requestAnimationFrame(() => setState(restoredValue));
    return () => cancelAnimationFrame(raf);
  }, [userId, page, slot, version, storage]);

  // ── Debounced persistence ──
  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef<T | null>(null);

  const persistNow = useCallback(() => {
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    const value = pendingState.current;
    pendingState.current = null;
    if (!userId || value === null || value === undefined) return;
    writePageState({ userId, page: slot ? `${page}:${slot}` : page, version, storage }, value);
  }, [userId, page, slot, version, storage]);

  const set = useCallback(
    (updater: T | ((prev: T) => T)) => {
      touchedRef.current = true;
      setState((prev) => {
        const next = typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
        pendingState.current = next;
        if (writeTimer.current) clearTimeout(writeTimer.current);
        writeTimer.current = setTimeout(persistNow, debounceMs);
        return next;
      });
    },
    [persistNow, debounceMs],
  );

  // ── Clear semantics (§9): remove the record + reset to default ──
  const reset = useCallback(() => {
    touchedRef.current = true;
    if (writeTimer.current) {
      clearTimeout(writeTimer.current);
      writeTimer.current = null;
    }
    pendingState.current = null;
    if (userId) removePageState({ userId, page: slot ? `${page}:${slot}` : page, version, storage });
    setState(
      typeof initial === 'function' ? (initial as () => T)() : initial,
    );
  }, [userId, page, slot, version, storage, initial]);

  // Flush pending writes on unmount so a fast filter→navigate never
  // loses the last change.
  useEffect(() => {
    return () => {
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
      const value = pendingState.current;
      pendingState.current = null;
      if (userId && value !== null && value !== undefined) {
        writePageState({ userId, page: slot ? `${page}:${slot}` : page, version, storage }, value);
      }
    };
  }, [userId, page, slot, version, storage]);

  return [state, set, reset] as const;
}
