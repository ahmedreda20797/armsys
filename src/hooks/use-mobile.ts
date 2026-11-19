'use client';

import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

function subscribe(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

function getServerSnapshot(): boolean {
  // Always false on the server (SSR-safe) — client updates after hydration
  return false;
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// §SIDEBAR-TABLET — desktop = the pinned in-layout sidebar is allowed
// (≥1024px, matching the sidebar's `lg:` classes). 768–1023px was a
// DEAD ZONE: too wide for the mobile drawer branch, too narrow for the
// `lg:flex` pinned aside — no sidebar and no hamburger. Desktop-mode
// consumers (Header hamburger visibility, Sidebar layout branch) use
// this so tablets always get the overlay drawer.
const DESKTOP_BREAKPOINT = 1024;

function subscribeDesktop(callback: () => void) {
  const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getDesktopSnapshot(): boolean {
  return window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`).matches;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, getDesktopSnapshot, getServerSnapshot);
}

// Kept for backward compat — same SSR-safe behaviour
export function useIsMobileSync(): boolean {
  return useIsMobile();
}

// §CONNECT-RESPONSIVE — viewport-width hook driven by BOTH the resize
// event and the matchMedia change event. Some embedded rendering
// contexts (automation webviews) fire `resize` on viewport changes
// but not the matchMedia `change` — subscribing to both makes the
// floating overlay's mobile branch reliable everywhere. Snapshot reads
// window.innerWidth directly (no cached query object to go stale).
function subscribeViewport(callback: () => void): () => void {
  const mq = window.matchMedia('(max-width: 767px)');
  window.addEventListener('resize', callback);
  mq.addEventListener('change', callback);
  return () => {
    window.removeEventListener('resize', callback);
    mq.removeEventListener('change', callback);
  };
}

function getMobileWidthSnapshot(): boolean {
  return window.innerWidth < 768;
}

export function useIsMobileViewport(): boolean {
  return useSyncExternalStore(subscribeViewport, getMobileWidthSnapshot, getServerSnapshot);
}
