'use client';

import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  // Always start with false (SSR-safe) — client updates after hydration
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    // Set correct value after hydration
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

// Kept for backward compat — same SSR-safe behaviour
export function useIsMobileSync(): boolean {
  return useIsMobile();
}
