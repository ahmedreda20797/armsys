// ══════════════════════════════════════════════════════════════
//  Navigation Bridge — the store → history-controller link
//  (SPA Navigation History, §6 "one canonical navigation boundary")
//
//  The Zustand store (`lib/store.ts`) is the single place every
//  internal navigation passes through (`navigateTo` /
//  `setCurrentPage` / overlay openers / `goBack`). The browser
//  history controller must observe those navigations to maintain
//  real History API entries — but it ALSO writes back into the
//  store when the user presses browser Back/Forward, so a direct
//  import would be circular.
//
//  This module has ZERO imports: the store depends on it at module
//  load, and the controller registers its implementation once it
//  mounts (client-only). Without a registered bridge (tests, SSR)
//  every notification is a silent no-op and the store behaves
//  exactly as before — navigation history is strictly additive.
// ══════════════════════════════════════════════════════════════

/** Navigations the store reports to the history controller. */
export type NavigationBridgeEvent =
  | {
      /** A routed page navigation (push or in-place replace). */
      type: 'page';
      page: string;
      highlightId: string | null;
      navParams: Record<string, string>;
    }
  | {
      /** A meaningful page-level overlay opened (§19). */
      type: 'overlay-open';
      overlay: 'employee360' | 'departmentHealth';
      /** Employee id / department name the overlay is scoped to. */
      contextId: string;
    };

export interface NavigationBridge {
  /**
   * The store reports a navigation BEFORE applying it, so the
   * controller can capture the outgoing entry's page state and
   * scroll position while the old page instance is still mounted.
   */
  notify(event: NavigationBridgeEvent): void;
  /**
   * `goBack` asks the controller to drive browser history back.
   * Returns true when the controller dispatched `history.back()`
   * (restoration will arrive via popstate); false when there is no
   * controller / no in-app entry to go back to, so the caller falls
   * back to the legacy previousPage swap.
   */
  requestBack(): boolean;
}

let bridge: NavigationBridge | null = null;

/** Controller-side registration (idempotent, last one wins). */
export function setNavigationBridge(next: NavigationBridge | null): void {
  bridge = next;
}

/** Store-side emission. No-op until the controller has registered. */
export function notifyNavigation(event: NavigationBridgeEvent): void {
  bridge?.notify(event);
}

/** Store-side back request. False when no controller handled it. */
export function requestNavigationBack(): boolean {
  return bridge ? bridge.requestBack() : false;
}
