// ══════════════════════════════════════════════════════════════
//  Scroll Restoration — readiness-driven, never timer-driven
//  (SPA Navigation History, §17)
//
//  The pipeline for a history (Back/Forward) return is:
//
//    popstate applies the entry → page remounts
//      → wait page-swap frames (rAF chain; the page tree mounts
//        and registers its query observers)
//      → wait until every ACTIVE query has settled (success or
//        error) — driven by query-cache events, not timers
//      → one more frame for layout → scrollTo(target)
//      → stability re-applies: if a later query settle grows the
//        document (and the user has not meaningfully scrolled),
//        re-apply at most twice
//
//  There is NO arbitrary "restore after N ms" timer: the only
//  timer is a bounded GIVE-UP (like useRecordHighlight's 15 s) —
//  if readiness never arrives, restoration is skipped, never
//  guessed. `history.scrollRestoration` is set to 'manual' by the
//  controller so the browser never fights this pipeline.
//
//  Respects §17 constraints: instant scrolling only (reduced
//  motion trivially respected — no smooth animation at all),
//  vertical window scroll (RTL-agnostic), and inner scroll
//  regions keep their own existing mechanisms (ScrollContainer's
//  in-memory scrollMemory) untouched. Fresh PUSH navigations
//  explicitly scroll to top — an old offset is never "restored"
//  onto a fresh page instance.
// ══════════════════════════════════════════════════════════════

/** The scrollable surface being restored (window in the app). */
export interface ScrollSurface {
  readonly scrollY: number;
  scrollTo(options: { top: number; behavior: 'instant' }): void;
  /** Max reachable offset (document height − viewport). */
  maxScrollY(): number;
}

/**
 * Query-cache readiness source. The real adapter wraps TanStack's
 * QueryCache: `subscribe` to its events, `allActiveSettled` checks
 * that no ACTIVE query is still pending.
 */
export interface QueryReadinessSource {
  subscribe(callback: () => void): () => void;
  allActiveSettled(): boolean;
}

export interface ScrollRestorerDeps {
  surface: ScrollSurface;
  queries: QueryReadinessSource;
  requestFrame(callback: () => void): () => void;
  setTimer(callback: () => void, ms: number): () => void;
  /** Bounded give-up (default 15 s). */
  giveUpMs?: number;
  /**
   * Optional §17 DOM-target check: has the restored page actually
   * mounted (its content is in the document)? When provided, the
   * restore waits for it per-frame (bounded by giveUpMs) before
   * query settling — dynamic page chunks may need longer than any
   * fixed frame count. Frame polling, never an arbitrary timer.
   */
  isPageReady?: (page: string) => boolean;
}

const TOLERANCE_PX = 32;
const MAX_REAPPLIES = 2;

export interface ScrollRestorer {
  /** Begin a readiness-driven restore for a history return. */
  requestRestore(entryId: string, top: number, page?: string): void;
  /** Cancel any pending restore (e.g. a new navigation started). */
  cancelPending(): void;
  /** Fresh navigation: cancel pending restores and go to top. */
  scrollToTopNow(): void;
}

/** Run `done` once `ready` is true (per-frame poll, cancellable). */
function frameWaitUntil(
  ready: () => boolean,
  requestFrame: (cb: () => void) => () => void,
  done: () => void,
): () => void {
  let cancel: (() => void) | null = null;
  const step = (): void => {
    if (ready()) {
      done();
      return;
    }
    cancel = requestFrame(step);
  };
  if (ready()) {
    done();
    return () => {};
  }
  cancel = requestFrame(step);
  return () => cancel?.();
}

export function createScrollRestorer(deps: ScrollRestorerDeps): ScrollRestorer {
  const { surface, queries, requestFrame, setTimer, isPageReady } = deps;
  const giveUpMs = deps.giveUpMs ?? 15_000;

  let pending: {
    cancelFrame: (() => void) | null;
    unsubscribeQueries: (() => void) | null;
    cancelGiveUp: (() => void) | null;
  } | null = null;
  let appliedFor: { entryId: string; top: number; reapplies: number } | null = null;
  let unsubscribeStability: (() => void) | null = null;

  function clearPending(): void {
    if (!pending) return;
    pending.cancelFrame?.();
    pending.unsubscribeQueries?.();
    pending.cancelGiveUp?.();
    pending = null;
  }

  function clearStability(): void {
    unsubscribeStability?.();
    unsubscribeStability = null;
    appliedFor = null;
  }

  function apply(entryId: string, top: number, reapplyIndex: number): void {
    surface.scrollTo({ top, behavior: 'instant' });
    appliedFor = { entryId, top, reapplies: reapplyIndex };
  }

  /** The user has not meaningfully scrolled since our last apply. */
  function userHasNotScrolled(top: number): boolean {
    if (Math.abs(surface.scrollY - top) <= TOLERANCE_PX) return true;
    // Position clamped by a short document (user could not scroll).
    return surface.scrollY >= surface.maxScrollY() - 4 && surface.scrollY < top;
  }

  function onStabilityEvent(): void {
    if (!appliedFor) return;
    if (appliedFor.reapplies >= MAX_REAPPLIES) {
      clearStability();
      return;
    }
    if (!userHasNotScrolled(appliedFor.top)) {
      // The user took over the scroll position — stop touching it.
      clearStability();
      return;
    }
    const target = appliedFor;
    requestFrame(() => {
      if (!appliedFor || appliedFor.entryId !== target.entryId) return;
      apply(appliedFor.entryId, appliedFor.top, appliedFor.reapplies + 1);
    });
  }

  return {
    requestRestore(entryId: string, top: number, page?: string): void {
      clearPending();
      clearStability();

      const state: {
        cancelFrame: (() => void) | null;
        unsubscribeQueries: (() => void) | null;
        cancelGiveUp: (() => void) | null;
      } = { cancelFrame: null, unsubscribeQueries: null, cancelGiveUp: null };
      pending = state;

      // Bounded give-up: readiness that never arrives is skipped,
      // never guessed (§17 — no arbitrary restore timers).
      state.cancelGiveUp = setTimer(() => {
        if (pending === state) clearPending();
      }, giveUpMs);

      const checkQueries = (): void => {
        if (pending !== state) return;
        if (!queries.allActiveSettled()) return; // keep waiting (event-driven)
        state.unsubscribeQueries?.();
        state.unsubscribeQueries = null;
        state.cancelFrame = requestFrame(() => {
          if (pending !== state) return;
          clearPending();
          apply(entryId, top, 0);
          // Watch late data arrivals for a bounded number of
          // re-applies, then stop.
          unsubscribeStability?.();
          unsubscribeStability = queries.subscribe(() => onStabilityEvent());
        });
      };

      // 1) Wait for the restored page to actually mount (§17 DOM
      //    target available) — dynamic page chunks may take longer
      //    than any fixed frame count; per-frame poll, bounded by
      //    the give-up timer above.
      state.cancelFrame = frameWaitUntil(
        () => !page || !isPageReady || isPageReady(page),
        requestFrame,
        () => {
          if (pending !== state) return;
          // 2) Wait for all ACTIVE queries to settle, event-driven.
          state.unsubscribeQueries = queries.subscribe(checkQueries);
          checkQueries();
        },
      );
    },

    cancelPending(): void {
      clearPending();
    },

    scrollToTopNow(): void {
      clearPending();
      clearStability();
      surface.scrollTo({ top: 0, behavior: 'instant' });
    },
  };
}
