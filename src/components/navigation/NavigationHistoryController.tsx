'use client';

// ══════════════════════════════════════════════════════════════
//  NavigationHistoryController — React binding for the Qnalys
//  browser-history integration (SPA Navigation History fix).
//
//  Mounts ONCE next to QueryCacheIdentityGate (on BOTH sides of the
//  login transition so logout is observable) and owns:
//
//    • the scroll restorer (window surface + TanStack QueryCache
//      readiness source + §17 DOM-target check);
//    • the canonical history controller (pushState/popstate model);
//    • the store→controller bridge registration;
//    • the auth-identity boundary subscription (§15).
//
//  It renders nothing. All controller state lives in effects (never
//  read or written during render).
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/lib/store';
import { setNavigationBridge } from '@/lib/navigation/navigation-bridge';
import { createQnalysHistoryController } from '@/lib/navigation/qnalys-history';
import { createScrollRestorer } from '@/lib/navigation/scroll-restore';
import type { QnalysHistoryController } from '@/lib/navigation/qnalys-history';
import type { SnapshotStorageEnv } from '@/lib/navigation/page-state-snapshot';

function storageEnv(): SnapshotStorageEnv {
  const pick = (kind: 'sessionStorage' | 'localStorage'): Storage | null => {
    if (typeof window === 'undefined') return null;
    try {
      return window[kind] ?? null;
    } catch {
      return null; // storage disabled (privacy mode)
    }
  };
  return { session: pick('sessionStorage'), local: pick('localStorage') };
}

function newEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function NavigationHistoryController(): null {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userIdRef = useRef<string | null>(null);
  const controllerRef = useRef<QnalysHistoryController | null>(null);

  // Synchronous user-id getter state — read at EVENT time only
  // (navigation handlers / popstate), never during render.
  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user?.id]);

  // Mount: build the scroll restorer + controller, register the
  // bridge, establish the history boundary. Unmount (HMR / strict
  // double cycle): dispose fully so nothing leaks.
  useEffect(() => {
    if (controllerRef.current) return;

    const scroll = createScrollRestorer({
      surface: {
        get scrollY() {
          return window.scrollY;
        },
        scrollTo({ top }) {
          // x/y form — instant by definition (no smooth animation).
          window.scrollTo(0, top);
        },
        maxScrollY() {
          return Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
          );
        },
      },
      queries: {
        subscribe(callback) {
          return queryClient.getQueryCache().subscribe(callback);
        },
        allActiveSettled() {
          return queryClient
            .getQueryCache()
            .getAll()
            .every((query) => {
              const isActive = query.getObserversCount() > 0;
              return !isActive || query.state.fetchStatus !== 'fetching';
            });
        },
      },
      requestFrame(callback) {
        const id = requestAnimationFrame(callback);
        return () => cancelAnimationFrame(id);
      },
      setTimer(callback, ms) {
        const id = setTimeout(callback, ms);
        return () => clearTimeout(id);
      },
      // §17 DOM-target check: the restored page's content is in the
      // document (AppLayout stamps the active page on its wrapper).
      isPageReady: (page) =>
        document.querySelector(`[data-active-page="${page}"]`) !== null,
    });

    const controller = createQnalysHistoryController({
      history: window.history,
      onPopState(handler) {
        const listener = (event: PopStateEvent) => handler({ state: event.state });
        window.addEventListener('popstate', listener);
        return () => window.removeEventListener('popstate', listener);
      },
      storage: storageEnv(),
      scroll,
      getScrollY: () => window.scrollY,
      getUserId: () => userIdRef.current,
      applyEntry: (entry) => {
        useAppStore.getState().applyHistoryEntry({
          page: entry.page,
          overlay: entry.overlay,
          contextId: entry.contextId,
          highlightId: entry.highlightId,
          // §SETTINGS-SECTIONS — the store scopes this to the settings
          // page (entry identity there; transient everywhere else).
          navParams: entry.navParams,
        });
      },
      resetNavigation: () => useAppStore.getState().resetNavigationToHome(),
      newId: newEntryId,
      now: () => Date.now(),
    });

    controllerRef.current = controller;
    setNavigationBridge(controller);
    controller.initialize();
    // First identity resolution runs here (the identity effect below
    // covers every later change; its mount-time call is a no-op via
    // the controller's same-id guard).
    controller.onUserIdChanged(userIdRef.current);

    return () => {
      setNavigationBridge(null);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  // §15 identity boundary: every authenticated-user change flows
  // through the controller (reload adoption + logout sanitization).
  useEffect(() => {
    controllerRef.current?.onUserIdChanged(user?.id ?? null);
  }, [user?.id]);

  return null;
}
