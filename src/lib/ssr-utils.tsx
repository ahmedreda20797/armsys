'use client';

import { useState, useEffect, type ReactNode } from 'react';

/**
 * ClientOnly — renders children only after hydration.
 * Use for any component that depends on browser APIs.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted ? <>{children}</> : <>{fallback}</>;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Produces identical sequences on server and client for the same seed.
 */
export function seededRandom(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a deterministic array of objects using a seeded RNG.
 * Safe to call at module scope — produces identical output on SSR and client.
 */
export function deterministicArray<T>(
  count: number,
  seed: number,
  factory: (rand: () => number, index: number) => T
): T[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, (_, i) => factory(rand, i));
}
