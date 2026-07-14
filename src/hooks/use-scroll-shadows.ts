'use client';

import { useState, useEffect, useRef, useCallback, RefObject } from 'react';

export interface ScrollShadowState {
  hasTopShadow: boolean;
  hasBottomShadow: boolean;
  isScrollable: boolean;
}

const THRESHOLD = 4; // px — avoids shadow flicker at sub-pixel boundaries

/**
 * useScrollShadows
 *
 * Attaches a passive scroll listener and a ResizeObserver to the target element.
 * Returns live shadow state that reflects the exact scroll position:
 *
 *   not scrollable  → { false, false, false }
 *   at top          → { false, true,  true  }
 *   in middle       → { true,  true,  true  }
 *   at bottom       → { true,  false, true  }
 *
 * Uses requestAnimationFrame to batch DOM reads and avoid layout thrashing.
 * Cleans up all listeners on unmount.
 */
export function useScrollShadows(
  ref: RefObject<HTMLElement | null>
): ScrollShadowState {
  const [state, setState] = useState<ScrollShadowState>({
    hasTopShadow: false,
    hasBottomShadow: false,
    isScrollable: false,
  });

  const rafId = useRef<number | null>(null);

  const calculate = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const { scrollTop, scrollHeight, clientHeight } = el;
    const scrollable = scrollHeight > clientHeight + THRESHOLD;
    const atTop = scrollTop <= THRESHOLD;
    const atBottom = scrollTop + clientHeight >= scrollHeight - THRESHOLD;

    setState((prev) => {
      const next: ScrollShadowState = {
        isScrollable: scrollable,
        hasTopShadow: scrollable && !atTop,
        hasBottomShadow: scrollable && !atBottom,
      };
      // Bail out if nothing changed — avoids re-render
      if (
        prev.isScrollable === next.isScrollable &&
        prev.hasTopShadow === next.hasTopShadow &&
        prev.hasBottomShadow === next.hasBottomShadow
      ) {
        return prev;
      }
      return next;
    });
  }, [ref]);

  const scheduleCalculate = useCallback(() => {
    if (rafId.current !== null) return; // already scheduled
    rafId.current = requestAnimationFrame(() => {
      rafId.current = null;
      calculate();
    });
  }, [calculate]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Initial calculation
    scheduleCalculate();

    // Passive scroll listener — zero jank
    el.addEventListener('scroll', scheduleCalculate, { passive: true });

    // ResizeObserver covers: content changes, filtering, realtime updates, layout shifts
    const ro = new ResizeObserver(scheduleCalculate);
    ro.observe(el);
    // Also observe direct children so content height changes are caught
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }

    return () => {
      el.removeEventListener('scroll', scheduleCalculate);
      ro.disconnect();
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };
  }, [ref, scheduleCalculate]);

  return state;
}
