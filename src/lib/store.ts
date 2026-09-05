// src/lib/store.ts
import { create } from 'zustand';

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

interface AppState {
  currentPage: string;
  previousPage: string;
  sidebarOpen: boolean;
  /** User-PINNED collapsed state (persisted via preferences sidebar.pinOpen). */
  sidebarCollapsed: boolean;
  headerCreateAction: HeaderCreateAction | null;
  highlightId: string | null;
  navParams: Record<string, string>;
  // Employee 360 overlay
  employee360Open: boolean;
  employee360Id: string | null;
  setCurrentPage: (page: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapse: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setHeaderCreateAction: (action: HeaderCreateAction | null) => void;
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
  // §3: the sidebar is COLLAPSED by default; hover expands it and a
  // manual toggle pins the chosen state (persisted preference).
  sidebarCollapsed: true,
  headerCreateAction: null,
  highlightId: null,
  navParams: {},
  employee360Open: false,
  employee360Id: null,
  setCurrentPage: (page) => set({ currentPage: page, highlightId: null, navParams: {} }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setHeaderCreateAction: (action) =>
    set((s) => {
      // Identity-stable update: registering the same label is a no-op so
      // IntersectionObserver churn never re-renders the Header.
      if (s.headerCreateAction?.label === action?.label && !!s.headerCreateAction === !!action) {
        return s;
      }
      return { headerCreateAction: action };
    }),
  setHighlightId: (id) => set({ highlightId: id }),
  navigateTo: (page, highlightId, params) =>
    set((s) => ({
      previousPage: s.currentPage,
      currentPage: page,
      sidebarOpen: false,
      highlightId: highlightId || null,
      navParams: params || {},
    })),
  goBack: () => set((s) => ({
    currentPage: s.previousPage,
    navParams: {},
    highlightId: null,
  })),
  openEmployee360: (employeeId) => set({ employee360Open: true, employee360Id: employeeId }),
  closeEmployee360: () => set({ employee360Open: false, employee360Id: null }),
}));
