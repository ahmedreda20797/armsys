// ══════════════════════════════════════════════════════════════
//  Qnalys Navigation History — the canonical browser-history model
//  (SPA Navigation History fix)
//
//  The app is a single-route SPA: the Zustand store IS the router
//  (currentPage + highlightId + navParams), so every internal
//  navigation OVERWRITES the previous page — browser Back exits
//  the application instead of returning to the previous Qnalys
//  page, and nothing reconstructs the navigation sequence.
//
//  This controller maps the existing navigation model onto the
//  browser History API WITHOUT introducing a second router:
//
//    • Every `navigateTo` (the existing single navigation boundary)
//      becomes `history.pushState` — the URL never changes, only
//      the history entry's state object does.
//    • The entry state stays SMALL (§5): page + highlight + params
//      + identity — never report datasets or query responses. Page
//      content is rebuilt by the EXISTING layers (TanStack Query
//      cache, usePageState, report snapshots); the per-entry
//      page-state snapshot store (page-state-snapshot.ts) restores
//      the exact per-INSTANCE state (§12) at popstate time.
//    • One global `popstate` handler restores the entry — and NEVER
//      pushes while applying (§8: explicit "popstate" navigation
//      mode → no history loop). Store updates during popstate go
//      through `applyHistoryEntry`, which does not notify the
//      bridge at all.
//    • The initial load establishes a known Qnalys boundary with
//      `history.replaceState` (§7). A reload adopts the current
//      entry (page + highlight restored; transient navParams are
//      deliberately NOT re-fired — their effect already lives in
//      the persisted page state).
//    • USER CHANGE / LOGOUT stays a hard boundary (§15): entries
//      carry the user id they belong to; a popped entry from
//      another (or no) authenticated context is sanitized to a
//      fresh home entry and never restored.
//    • Meaningful page-level overlays (Employee360, department
//      health — §19) get real entries so Back closes/returns them;
//      ephemeral dialogs (popovers, menus, print host) never touch
//      history.
//    • Same-destination navigations never create entries (§20);
//      same-page context shifts update the current entry in place.
//      Distinct contexts across DIFFERENT pages always push (§21).
// ══════════════════════════════════════════════════════════════

import {
  applyPageStateSnapshot,
  capturePageStateSnapshot,
  EntrySnapshotStore,
  type SnapshotStorageEnv,
} from './page-state-snapshot';
import type { NavigationBridgeEvent } from './navigation-bridge';
import type { ScrollRestorer } from './scroll-restore';

/** The browser history.state payload for one Qnalys entry. */
export interface QnalysHistoryEntryState {
  /** Marker distinguishing Qnalys entries from foreign/pre-app entries. */
  qnalys: true;
  /** Unique entry identity (drives per-entry state snapshots). */
  entryId: string;
  /** The authenticated user this entry belongs to (§15 boundary). */
  userId: string | null;
  /** Monotonic sequence within this controller instance (diagnostics). */
  seq: number;
  /** PageRouter page key (for overlay entries: the underlying page). */
  page: string;
  /** Meaningful page-level overlay opened on this entry (§19). */
  overlay: 'employee360' | 'departmentHealth' | null;
  /** Overlay context (Employee360 employee id / department name). */
  contextId: string | null;
  highlightId: string | null;
  /**
   * Navigation intent params captured at push time. Kept for
   * diagnostics only — popstate does NOT re-fire them: their
   * effect is already folded into the persisted page state, and
   * re-firing would discard the user's later edits (skipRestore).
   */
  navParams: Record<string, string> | null;
  createdAt: number;
}

/** History surface the controller needs (window.history satisfies it). */
export interface HistorySurface {
  readonly state: unknown;
  pushState(data: unknown, unused: string, url?: string | null): void;
  replaceState(data: unknown, unused: string, url?: string | null): void;
  back(): void;
  scrollRestoration: 'auto' | 'manual';
}

export interface QnalysHistoryEnvironment {
  history: HistorySurface;
  /** Subscribe to popstate; return unsubscribe. */
  onPopState(handler: (event: { state: unknown }) => void): () => void;
  storage: SnapshotStorageEnv;
  scroll: ScrollRestorer;
  getScrollY(): number;
  /** Currently authenticated user id, or null while logged out. */
  getUserId(): string | null;
  /** Apply a restored entry to the app store (popstate path only). */
  applyEntry(entry: QnalysHistoryEntryState): void;
  /** Hard-reset the app navigation surface (identity boundary). */
  resetNavigation(): void;
  newId(): string;
  now(): number;
  /** Mirror bound (§23) — application-side restoration metadata only. */
  maxMirrorEntries?: number;
}

export interface QnalysHistoryController {
  /** Establish the Qnalys history boundary / adopt a reloaded entry. */
  initialize(): void;
  /** Store-side navigation notification (bridge `notify`). */
  notify(event: NavigationBridgeEvent): void;
  /** Store-side back request (bridge `requestBack`). */
  requestBack(): boolean;
  /** Auth user changes (binding subscribes; includes first resolution). */
  onUserIdChanged(userId: string | null): void;
  /** Popstate entry point (also the env subscription target). */
  handlePopState(event: { state: unknown }): void;
  /** Tear down listeners (controller instance is discarded after). */
  dispose(): void;
}

const OVERLAYS: ReadonlySet<string> = new Set(['employee360', 'departmentHealth']);

/** Parse + validate a history.state payload; null when foreign. */
export function parseQnalysEntry(state: unknown): QnalysHistoryEntryState | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Partial<QnalysHistoryEntryState> & { qnalys?: unknown };
  if (s.qnalys !== true) return null;
  if (typeof s.entryId !== 'string' || s.entryId.length === 0) return null;
  if (typeof s.page !== 'string' || s.page.length === 0) return null;
  if (s.userId !== null && typeof s.userId !== 'string') return null;
  if (s.overlay !== null && !OVERLAYS.has(String(s.overlay))) return null;
  if (typeof s.seq !== 'number' || !Number.isFinite(s.seq)) return null;
  if (typeof s.createdAt !== 'number') return null;
  const highlightId = s.highlightId ?? null;
  if (highlightId !== null && typeof highlightId !== 'string') return null;
  const navParams = s.navParams ?? null;
  if (navParams !== null && (typeof navParams !== 'object' || Array.isArray(navParams))) return null;
  return {
    qnalys: true,
    entryId: s.entryId,
    userId: s.userId ?? null,
    seq: s.seq,
    page: s.page,
    overlay: (s.overlay as QnalysHistoryEntryState['overlay']) ?? null,
    contextId: s.contextId ?? null,
    highlightId,
    navParams: navParams as Record<string, string> | null,
    createdAt: s.createdAt,
  };
}

/** Deterministic param normalization (§12 — stable state keys). */
export function normalizeNavParams(params: Record<string, string> | null | undefined): string {
  if (!params) return '{}';
  const keys = Object.keys(params).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${key}=${params[key]}`);
  }
  return `{${parts.join('|')}}`;
}

function samePageDestination(
  current: QnalysHistoryEntryState,
  page: string,
  highlightId: string | null,
  navParams: Record<string, string>,
): boolean {
  return (
    current.page === page
    && current.overlay === null
    && (current.highlightId ?? null) === highlightId
    && normalizeNavParams(current.navParams) === normalizeNavParams(navParams)
  );
}

/**
 * §SETTINGS-SECTIONS — the Settings workspace's internal sections are
 * real sub-destinations, not filter state: switching sections must
 * stay inside Settings AND be reachable with browser Back/Forward
 * (Settings / Master Data → Settings / Control Center → Back returns
 * to Settings / Master Data). A `section` param shift on the settings
 * page therefore PUSHES an entry; every other same-page param shift
 * stays an in-place replace (§21 — filters are page STATE).
 */
function isSettingsSectionShift(
  current: QnalysHistoryEntryState,
  navParams: Record<string, string>,
): boolean {
  return (
    current.page === 'settings'
    && typeof navParams.section === 'string'
    && navParams.section !== ''
    && navParams.section !== (current.navParams?.section ?? '')
  );
}

export function createQnalysHistoryController(env: QnalysHistoryEnvironment): QnalysHistoryController {
  const { history, storage, scroll } = env;
  const maxMirror = env.maxMirrorEntries ?? 64;
  const snapshots = new EntrySnapshotStore(50);

  let initialized = false;
  let disposed = false;
  let unsubscribePop: (() => void) | null = null;
  let currentEntry: QnalysHistoryEntryState | null = null;
  let prevUserId: string | null | undefined = undefined;
  /** In-session ordered mirror of entry ids (cursor = current). */
  let mirror: string[] = [];
  let cursor = 0;
  let seqCounter = 0;

  function nextSeq(): number {
    seqCounter += 1;
    return seqCounter;
  }

  function makeEntry(base: Omit<QnalysHistoryEntryState, 'qnalys' | 'entryId' | 'seq' | 'createdAt'>): QnalysHistoryEntryState {
    return { qnalys: true, entryId: env.newId(), seq: nextSeq(), createdAt: env.now(), ...base };
  }

  function pushMirror(entryId: string): void {
    mirror = mirror.slice(0, cursor + 1);
    mirror.push(entryId);
    while (mirror.length > maxMirror) {
      mirror.shift();
    }
    cursor = mirror.length - 1;
  }

  function freshHomeEntry(userId: string | null): QnalysHistoryEntryState {
    return makeEntry({
      userId,
      page: 'home',
      overlay: null,
      contextId: null,
      highlightId: null,
      navParams: null,
    });
  }

  /**
   * Capture the CURRENT entry's restorable state right before the
   * navigation leaves it: flush pending usePageState writes, copy
   * the page's full persisted state, and record the scroll offset.
   */
  function captureCurrentEntryState(): void {
    if (!currentEntry) return;
    if (currentEntry.userId === null) return; // no user-scoped state exists
    const pageState = capturePageStateSnapshot(storage, currentEntry.userId, currentEntry.page);
    snapshots.set(currentEntry.entryId, {
      pageState,
      scrollY: env.getScrollY(),
      capturedAt: new Date(env.now()).toISOString(),
    });
  }

  function replaceCurrentEntry(next: QnalysHistoryEntryState): void {
    currentEntry = next;
    history.replaceState(next, '');
  }

  function sanitizeBoundary(userId: string | null): void {
    // Hard identity reset (§15): no cross-user restoration data,
    // no overlay intent, and the current history position becomes
    // a clean home entry for the CURRENT authenticated context.
    snapshots.clear();
    scroll.cancelPending();
    const home = freshHomeEntry(userId);
    mirror = [home.entryId];
    cursor = 0;
    replaceCurrentEntry(home);
    env.resetNavigation();
  }

  const controller: QnalysHistoryController = {
    initialize(): void {
      if (initialized || disposed) return;
      initialized = true;

      // §17: the app owns scroll restoration; the browser's async
      // restore would fight the readiness-driven pipeline.
      try {
        history.scrollRestoration = 'manual';
      } catch {
        /* older browsers — pipeline still works, best effort */
      }

      const existing = parseQnalysEntry(history.state);
      if (existing) {
        // Reload / restored tab: ADOPT the current entry. The page
        // is applied once the authenticated user resolves (see
        // onUserIdChanged) — never before the §15 boundary check.
        currentEntry = existing;
        mirror = [existing.entryId];
        cursor = 0;
      } else {
        // §7: establish the known Qnalys history boundary in place.
        currentEntry = freshHomeEntry(env.getUserId());
        mirror = [currentEntry.entryId];
        cursor = 0;
        history.replaceState(currentEntry, '');
      }

      unsubscribePop = env.onPopState((event) => controller.handlePopState(event));
    },

    notify(event: NavigationBridgeEvent): void {
      if (!initialized || disposed || !currentEntry) return;

      if (event.type === 'overlay-open') {
        // §19: meaningful page-level overlays are navigable states.
        if (
          currentEntry.overlay === event.overlay
          && currentEntry.contextId === event.contextId
        ) {
          return; // identical overlay destination — no entry (§20)
        }
        captureCurrentEntryState();
        const entry = makeEntry({
          userId: env.getUserId(),
          page: currentEntry.page, // overlay rides on the underlying page
          overlay: event.overlay,
          contextId: event.contextId,
          highlightId: null,
          navParams: null,
        });
        currentEntry = entry;
        history.pushState(entry, '');
        pushMirror(entry.entryId);
        return; // overlays open over the page — no scroll change
      }

      // Page navigation.
      const targetPage = event.page;
      const targetHighlight = event.highlightId ?? null;

      if (currentEntry.page === targetPage && currentEntry.overlay === null) {
        // Same page: never push (§20/§21 — filters are page STATE,
        // not navigations). An identical destination is a full
        // no-op; a context shift (highlight/intent) updates the
        // current entry in place.
        if (samePageDestination(currentEntry, targetPage, targetHighlight, event.navParams)) {
          return;
        }
        // §SETTINGS-SECTIONS — EXCEPT the Settings workspace's own
        // internal sections, which are sub-destinations (see the
        // helper above): they get real entries so Back/Forward move
        // between sections while the Settings shell stays mounted.
        if (isSettingsSectionShift(currentEntry, event.navParams)) {
          captureCurrentEntryState();
          const entry = makeEntry({
            userId: env.getUserId(),
            page: targetPage,
            overlay: null,
            contextId: null,
            highlightId: targetHighlight,
            navParams: event.navParams,
          });
          currentEntry = entry;
          history.pushState(entry, '');
          pushMirror(entry.entryId);
          // The shell persists but the content area swaps — start the
          // new section at the top like any fresh destination (§17).
          scroll.scrollToTopNow();
          return;
        }
        replaceCurrentEntry({
          ...currentEntry,
          userId: env.getUserId(),
          highlightId: targetHighlight,
          navParams: event.navParams,
          createdAt: env.now(),
        });
        return;
      }

      captureCurrentEntryState();
      const entry = makeEntry({
        userId: env.getUserId(),
        page: targetPage,
        overlay: null,
        contextId: null,
        highlightId: targetHighlight,
        navParams: event.navParams,
      });
      currentEntry = entry;
      history.pushState(entry, '');
      pushMirror(entry.entryId);
      // Fresh page instance: start at the top — an old offset must
      // never survive onto a fresh destination (§17).
      scroll.scrollToTopNow();
    },

    requestBack(): boolean {
      if (!initialized || disposed) return false;
      if (cursor <= 0) return false; // at our first in-app entry — nothing before it
      history.back();
      return true;
    },

    onUserIdChanged(userId: string | null): void {
      if (disposed) return;
      const previous = prevUserId;
      prevUserId = userId;
      if (previous === userId) return;

      // The current history entry already belongs to the INCOMING
      // identity. This is the RELOAD-ADOPTION path (same tab, same
      // session): restore its page. It can never be a foreign
      // identity's data (the id matches), and a fresh login always
      // arrives with a sanitized home entry (logout resets first),
      // so this branch is unreachable for cross-user scenarios.
      if (currentEntry && userId !== null && currentEntry.userId === userId) {
        if (currentEntry.page !== 'home') {
          env.applyEntry(currentEntry);
        }
        return;
      }

      // First resolution while still unauthenticated (hydration
      // phase): no authenticated surface is rendered yet and the
      // adopted entry must survive until the real user resolves.
      if (previous === undefined && userId === null) return;

      // Identity change after resolution (logout, user switch) or a
      // first login over a foreign/unowned entry — hard boundary
      // (§15): no state from another identity survives, Back cannot
      // reach it.
      sanitizeBoundary(userId);
    },

    handlePopState(event: { state: unknown }): void {
      if (!initialized || disposed) return;
      const target = parseQnalysEntry(event.state);
      const userId = env.getUserId();

      if (userId === null) {
        // Logged out: authenticated surfaces are never restored;
        // the position becomes a clean unauthenticated home entry.
        sanitizeBoundary(null);
        return;
      }

      if (!target) {
        // Pop past the Qnalys segment's first entry (pre-app or
        // foreign document state): the browser legitimately shows
        // whatever preceded the application — do nothing. Coming
        // Forward again lands on a valid entry and restores it.
        return;
      }

      if (target.userId !== userId) {
        // Another authenticated context's entry (Scenario I):
        // sanitize in place — never restore foreign state.
        sanitizeBoundary(userId);
        return;
      }

      // Capture what we are leaving BEFORE any restoration.
      captureCurrentEntryState();

      // Cursor bookkeeping (application-side mirror, §23-bounded).
      const idx = mirror.indexOf(target.entryId);
      if (idx >= 0) {
        cursor = idx;
      } else {
        // Entry outside the mirror (post-reload edge): degrade to a
        // single-entry mirror — browser Back/Forward still work.
        mirror = [target.entryId];
        cursor = 0;
      }

      // Restore the per-entry page state BEFORE the page remounts,
      // so the remounting usePageState instances read exactly the
      // state this entry had when the user left it (§12).
      const snapshot = snapshots.get(target.entryId);
      if (snapshot) {
        applyPageStateSnapshot(storage, snapshot.pageState);
      }

      currentEntry = target;
      // §8: apply WITHOUT pushing — applyEntry writes the store's
      // navigation surface directly (explicit popstate mode; no
      // history loop is possible).
      env.applyEntry(target);
      // §17: readiness-driven scroll restore (falls back to top
      // when no captured snapshot exists, e.g. after a reload).
      scroll.requestRestore(target.entryId, snapshot?.scrollY ?? 0);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribePop?.();
      unsubscribePop = null;
      scroll.cancelPending();
    },
  };

  return controller;
}
