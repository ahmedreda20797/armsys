// src/lib/store.ts
import { create } from 'zustand';

interface AppState {
  currentPage: string;
  previousPage: string;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
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
  setHighlightId: (id: string | null) => void;
  navigateTo: (page: string, highlightId?: string, params?: Record<string, string>) => void;
  goBack: () => void;
  openEmployee360: (employeeId: string) => void;
  closeEmployee360: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentPage: 'home',
  previousPage: 'home',
  sidebarOpen: false,
  sidebarCollapsed: false,
  highlightId: null,
  navParams: {},
  employee360Open: false,
  employee360Id: null,
  setCurrentPage: (page) => set({ currentPage: page, highlightId: null, navParams: {} }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
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
