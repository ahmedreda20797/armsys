// src/lib/store.ts
import { create } from 'zustand';

interface AppState {
  currentPage: string;
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  highlightId: string | null;
  navParams: Record<string, string>;
  setCurrentPage: (page: string) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapse: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setHighlightId: (id: string | null) => void;
  navigateTo: (page: string, highlightId?: string, params?: Record<string, string>) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'home',
  sidebarOpen: false,
  sidebarCollapsed: false,
  highlightId: null,
  navParams: {},
  setCurrentPage: (page) => set({ currentPage: page, highlightId: null, navParams: {} }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebarCollapse: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setHighlightId: (id) => set({ highlightId: id }),
  navigateTo: (page, highlightId, params) =>
    set({
      currentPage: page,
      sidebarOpen: false,
      highlightId: highlightId || null,
      navParams: params || {},
    }),
}));
