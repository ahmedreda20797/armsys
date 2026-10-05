// src/lib/store.ts
import { create } from 'zustand';
import type { ReactNode } from 'react';
import {
  notifyNavigation,
  requestNavigationBack,
} from '@/lib/navigation/navigation-bridge';

/**
 * The page's PRIMARY create action, registered by PageHeaderBar while
 * the page header is visible on screen and surfaced inside the global
 * Header once the user scrolls past it (Milestone 7 §25/§7 — one
 * effective primary create action, never duplicated).
 * Session-only, non-serializable (holds the onClick closure).
 */
export interface HeaderCreateAction {
  label: string;
  onClick: () => void;
}

// ══════════════════════════════════════════════════════════════
//  §HEADER-V3 — page-owned header registrations
//
//  The global Header is the app's identity + control bar. Pages feed
//  it through these two session-only registrations (both scoped to
//  the registering page id, so a stale registration can never leak
//  into another page):
//    • IDENTITY   — the page's own title/description/icon (falls back
//      to the APP_PAGES registry title when a page registers nothing).
//    • ACTIONS    — the page's contextual header actions (quick
//      actions, refresh, customize...). Permission-filtered by the
//      PAGE before registration; the Header renders whatever the
//      current page exposed — nothing global is hardcoded.
//  Registrations hold closures/nodes → session-only, non-serializable.
// ══════════════════════════════════════════════════════════════

/** A contextual action a page exposes to the global Header. */
export interface HeaderContextualAction {
  /** Stable id within the page (drives the identity-stable updates). */
  id: string;
  /** Accessible label + tooltip (Arabic), e.g. "إضافة موظف". */
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /**
   * 'icon' = standalone compact header button (high-priority utility
   * actions like refresh/customize); 'menu' = collapsed into the
   * compact quick-actions menu. Defaults to 'menu'.
   */
  display?: 'icon' | 'menu';
  /** Toggle-style highlight (e.g. refreshing spinner, active mode). */
  active?: boolean;
  disabled?: boolean;
}

/** Page identity shown in the Header's PAGE-IDENTITY zone. */
export interface PageHeaderIdentity {
  title?: string;
  description?: ReactNode;
  icon?: ReactNode;
}

interface PageScoped<T> {
  pageId: string;
  value: T;
}

// ══════════════════════════════════════════════════════════════
//  §SIDEBAR-V2 — TWO INDEPENDENT AXES (§2 of the nav refactor)
//
//    PINNED  ⇄ UNPINNED   — layout relationship:
//      pinned   = the sidebar is PART of the layout (sticky column);
//                 main content always responds to its width and the
//                 header can never overlap it.
//      unpinned = the sidebar consumes NO layout width; it opens as
//                 an overlay drawer above the page content.
//
//    EXPANDED ⇄ COLLAPSED — visual width while pinned:
//      expanded = full surface (288px, page names visible)
//      collapsed = icon rail (72px, Q + icons)
//
//  PERSISTENCE (existing user-specific architecture): the PIN axis
//  maps onto the existing `sidebar.pinOpen` preference —
//    pinOpen === false  → unpinned (legacy V2 explicit unpin; drawer mode)
//    pinOpen === true / undefined → pinned (the §SIDEBAR-V3 default)
//  The expanded/collapsed width choice is SESSION state (part of the
//  same store) so collapsing to the rail is instant and never fights
//  the persisted pin choice. It is deliberately NEVER written into
//  pinOpen: presentation must not corrupt the persisted pin axis
//  (collapse-once → reload-as-drawer was the §10 leak, now removed).
// ══════════════════════════════════════════════════════════════

/**
 * Pure mapping from the persisted `sidebar.pinOpen` preference to the
 * initial two-axis sidebar state. Exported for the hydration effect
 * and the regression tests (one canonical rule, no second resolver).
 *
 * §SIDEBAR-V3 DEFAULT: sidebar is PINNED in layout but COLLAPSED to
 * the 72px rail (icons only). The Q-logo in the sidebar header is the
 * SINGLE control: click toggles expanded/collapsed; hover 1.5s
 * auto-expands. No separate pin/close/expand buttons.
 */
export function resolveInitialSidebarState(pinOpen: boolean | undefined | null): {
  pinned: boolean;
  expanded: boolean;
} {
  // Default: pinned in layout, collapsed to rail (icons only)
  // pinOpen === false → legacy V2 explicit unpin (drawer mode)
  // pinOpen === true / undefined (default) → pinned + collapsed rail
  // (the expanded/collapsed width choice is SESSION state — never
  // persisted, so it can never corrupt the pin axis).
  if (pinOpen === false) return { pinned: false, expanded: false };
  return { pinned: true, expanded: false };
}

interface AppState {
  currentPage: string;
  previousPage: string;
  /** §SIDEBAR-V2 overlay drawer open (unpinned desktop + ALL mobile). */
  sidebarOpen: boolean;
  /** §SIDEBAR-V2 axis 1 — pinned = in-layout column (persisted pinOpen). */
  sidebarPinned: boolean;
  /** §SIDEBAR-V2 axis 2 — expanded full surface vs icon rail (session). */
  sidebarExpanded: boolean;
  /** §SIDEBAR-V3 — temporary hover expansion (overlay, doesn't change layout). */
  sidebarHoverExpand: boolean;
  headerCreateAction: HeaderCreateAction | null;
  /** §HEADER-V3 — current page's identity registration (page-scoped). */
  pageIdentity: PageScoped<PageHeaderIdentity> | null;
  /** §HEADER-V3 — current page's contextual header actions (page-scoped). */
  pageHeaderActions: PageScoped<HeaderContextualAction[]> | null;
  /**
   * §NOTIFICATIONS-V2 — cross-cutting open request for the Header's
   * notification panel. Legacy call sites that used to navigate to the
   * removed Notification Center page now set this flag instead (the
   * store's navigateTo intercepts 'notifications'); the popover
   * consumes and clears it. Session-only.
   */
  notificationPanelOpen: boolean;
  highlightId: string | null;
  navParams: Record<string, string>;
  // Employee 360 overlay
  employee360Open: boolean;
  employee360Id: string | null;
  /**
   * §AOCC-ROUTING — Department Health overlay intent (mirrors the
   * employee360 pattern). ANY AOCC element that represents a DEPARTMENT
   * context (health card rows, decline alerts, coaching opportunities,
   * executive priorities) routes here instead of a generic page; the
   * Operations Center resolves the name against its computed analyses
   * and opens the in-place details dialog. `navigateTo` intercepts the
   * 'departmentHealth' pseudo-page so every legacy caller is fixed at
   * the routing layer.
   */
  departmentHealthName: string | null;
  openDepartmentHealth: (departmentName: string) => void;
  closeDepartmentHealth: () => void;
  setCurrentPage: (page: string) => void;
  /**
   * §NAVIGATION-HISTORY — applies an entry restored by the browser
   * history controller (Back/Forward). This is the ONLY navigation
   * mutation that does NOT notify the navigation bridge: it is the
   * explicit "popstate" navigation mode (§8) — pushing here would
   * create a history loop.
   */
  applyHistoryEntry: (entry: {
    page: string;
    overlay: 'employee360' | 'departmentHealth' | null;
    contextId: string | null;
    highlightId: string | null;
    /**
     * §SETTINGS-SECTIONS — the Settings workspace's active section
     * (`navParams.section`) is part of the entry identity, so
     * popstate / reload adoption restores it (Back/Forward/refresh
     * land on the same section). Deliberately scoped: other pages'
     * transient navParams stay non-restored (their effects already
     * live in the persisted page state — §13 history doctrine).
     */
    navParams?: Record<string, string> | null;
  }) => void;
  /**
   * §NAVIGATION-HISTORY — hard identity-boundary reset (logout /
   * user change, §15): the whole navigation surface returns to a
   * clean home state. No previous-identity page, overlay intent or
   * highlight survives.
   */
  resetNavigationToHome: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarPin: () => void;
  setSidebarPinned: (pinned: boolean) => void;
  toggleSidebarExpand: () => void;
  setSidebarExpanded: (expanded: boolean) => void;
  setSidebarHoverExpand: (hoverExpand: boolean) => void;
  setHeaderCreateAction: (action: HeaderCreateAction | null) => void;
  setPageIdentity: (identity: PageScoped<PageHeaderIdentity> | null) => void;
  setPageHeaderActions: (actions: PageScoped<HeaderContextualAction[]> | null) => void;
  setNotificationPanelOpen: (open: boolean) => void;
  setHighlightId: (id: string | null) => void;
  navigateTo: (page: string, highlightId?: string, params?: Record<string, string>) => void;
  goBack: () => void;
  openEmployee360: (employeeId: string) => void;
  closeEmployee360: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'home',
  previousPage: 'home',
  sidebarOpen: false,
  // §SIDEBAR-V3 DEFAULT — pinned in layout, COLLAPSED to 72px rail.
  // The Q-logo is the single toggle; hover 1.5s auto-expands.
  // Matches resolveInitialSidebarState(undefined).
  sidebarPinned: true,
  sidebarExpanded: false,
  sidebarHoverExpand: false,
  headerCreateAction: null,
  pageIdentity: null,
  pageHeaderActions: null,
  notificationPanelOpen: false,
  highlightId: null,
  navParams: {},
  employee360Open: false,
  employee360Id: null,
  departmentHealthName: null,
  setCurrentPage: (page) => {
    // §NAVIGATION-HISTORY — sidebar navigation is a real navigation
    // (§26 Step 1: one canonical boundary), so it goes through the
    // same notify path as navigateTo. The bridge is a silent no-op
    // until the history controller registers.
    notifyNavigation({
      type: 'page',
      page,
      highlightId: null,
      navParams: {},
    });
    set({ currentPage: page, highlightId: null, navParams: {} });
  },
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarPin: () => set((s) => ({ sidebarPinned: !s.sidebarPinned })),
  setSidebarPinned: (pinned) => set({ sidebarPinned: pinned }),
  toggleSidebarExpand: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
  setSidebarExpanded: (expanded) => set({ sidebarExpanded: expanded }),
  setSidebarHoverExpand: (hoverExpand) => set({ sidebarHoverExpand: hoverExpand }),
  setHeaderCreateAction: (action) =>
    set((s) => {
      // Identity-stable update: registering the same label is a no-op so
      // IntersectionObserver churn never re-renders the Header.
      if (s.headerCreateAction?.label === action?.label && !!s.headerCreateAction === !!action) {
        return s;
      }
      return { headerCreateAction: action };
    }),
  // §HEADER-V3 — page-scoped registrations. The Header only consumes
  // the registration whose pageId equals the CURRENT page, so even a
  // stale registration (page exiting while the next one mounts) can
  // never render the wrong page's identity or actions.
  setPageIdentity: (identity) =>
    set((s) => {
      if (s.pageIdentity === identity) return s;
      return { pageIdentity: identity };
    }),
  setPageHeaderActions: (actions) =>
    set((s) => {
      if (s.pageHeaderActions === actions) return s;
      return { pageHeaderActions: actions };
    }),
  setNotificationPanelOpen: (open) => set({ notificationPanelOpen: open }),
  setHighlightId: (id) => set({ highlightId: id }),
  navigateTo: (page, highlightId, params) => {
    // §NAVIGATION-HISTORY — notify the history controller BEFORE the
    // state change so the outgoing entry's page state + scroll are
    // captured while the old page is still mounted. No-op until the
    // controller registers (tests, SSR).
    if (page === 'notifications') {
      // §NOTIFICATIONS-V2 — an ephemeral popover (§19), never a
      // history entry.
      set({ notificationPanelOpen: true });
      return;
    }
    if (page === 'employee360' || page === 'departmentHealth') {
      if (highlightId) {
        notifyNavigation({ type: 'overlay-open', overlay: page, contextId: highlightId });
      }
    } else {
      notifyNavigation({
        type: 'page',
        page,
        highlightId: highlightId ?? null,
        navParams: params ?? {},
      });
    }
    set((s) => {
      // Employee 360 is an OVERLAY, never a routed page: a navigation
      // carrying the employee id (highlightId) opens the overlay.
      if (page === 'employee360') {
        return highlightId
          ? { employee360Open: true, employee360Id: highlightId, sidebarOpen: false }
          : {};
      }
      // §AOCC-ROUTING — 'departmentHealth' is a Department CONTEXT
      // intent (highlightId = the department NAME): opens the in-place
      // Operations Center health dialog. Never a page change.
      if (page === 'departmentHealth') {
        return highlightId
          ? { departmentHealthName: highlightId, sidebarOpen: false }
          : {};
      }
      return {
        previousPage: s.currentPage,
        currentPage: page,
        // Unpinned drawers and mobile overlays close on navigation;
        // pinned columns are untouched (they are layout, not a mode).
        sidebarOpen: false,
        highlightId: highlightId || null,
        navParams: params || {},
      };
    });
  },
  applyHistoryEntry: (entry) => {
    // §NAVIGATION-HISTORY — popstate restoration path (§8): the
    // controller applies the restored entry DIRECTLY. This action
    // never notifies the bridge (no pushState here — that would
    // loop), and never creates a new page instance intent: the
    // restored page remounts and rehydrates from the existing
    // persistence layers (page state + per-entry snapshot).
    set((s) => {
      if (entry.overlay === 'employee360') {
        return {
          currentPage: entry.page,
          employee360Open: true,
          employee360Id: entry.contextId,
          highlightId: entry.highlightId,
          navParams: {},
        };
      }
      if (entry.overlay === 'departmentHealth') {
        return {
          currentPage: entry.page,
          departmentHealthName: entry.contextId,
          highlightId: entry.highlightId,
          navParams: {},
        };
      }
      return {
        previousPage: s.currentPage,
        currentPage: entry.page,
        employee360Open: false,
        employee360Id: null,
        departmentHealthName: null,
        sidebarOpen: false,
        highlightId: entry.highlightId,
        // §SETTINGS-SECTIONS — the settings section is entry identity
        // (sub-destination); every other page's navParams stay
        // transient and are NOT re-fired on restoration.
        navParams: entry.page === 'settings' ? (entry.navParams ?? {}) : {},
      };
    });
  },
  resetNavigationToHome: () =>
    set({
      currentPage: 'home',
      previousPage: 'home',
      sidebarOpen: false,
      highlightId: null,
      navParams: {},
      employee360Open: false,
      employee360Id: null,
      departmentHealthName: null,
    }),
  goBack: () => {
    // §NAVIGATION-HISTORY — browser history is the canonical back.
    // The controller drives history.back() and restoration arrives
    // via popstate (applyHistoryEntry). When no in-app entry exists
    // before the current one, fall back to the legacy previousPage
    // swap so in-app Back buttons keep working at the boundary.
    if (requestNavigationBack()) return;
    set((s) => ({
      currentPage: s.previousPage,
      navParams: {},
      highlightId: null,
    }));
  },
  openEmployee360: (employeeId) => {
    // Direct overlay openers (§19 page-level destinations) also join
    // the navigation history so Back returns the user to their spot.
    notifyNavigation({ type: 'overlay-open', overlay: 'employee360', contextId: employeeId });
    set({ employee360Open: true, employee360Id: employeeId });
  },
  closeEmployee360: () => {
    // §NAVIGATION-HISTORY — the overlay has a history entry; closing
    // it is a navigation BACK to the underlying page entry (standard
    // overlay-as-destination semantics). Restoration arrives via
    // popstate → applyHistoryEntry. When the controller is absent /
    // at the first entry, close directly (legacy behavior).
    if (requestNavigationBack()) return;
    set({ employee360Open: false, employee360Id: null });
  },
  closeDepartmentHealth: () => {
    if (requestNavigationBack()) return;
    set({ departmentHealthName: null });
  },
  openDepartmentHealth: (departmentName) => {
    notifyNavigation({ type: 'overlay-open', overlay: 'departmentHealth', contextId: departmentName });
    set({ departmentHealthName: departmentName });
  },
}));
