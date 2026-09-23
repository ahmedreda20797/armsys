'use client';

// ══════════════════════════════════════════════════════════════
//  useRecordHighlight — THE canonical Qnalys deep-link receiver
//  (one highlight system for the whole app).
//
//  The app store carries the navigation intent: `highlightId` is
//  the CANONICAL record id (never a display name), set by
//  navigateTo(page, highlightId, navParams) from Global Search,
//  dashboards, reports, AOCC decisions and the Evidence Preview.
//  This hook resolves that intent against the rendered page:
//
//    NAVIGATE → WAIT FOR TARGET → RESOLVE EXACT RECORD
//    → SCROLL (only when needed) → REVEAL → PULSE → SETTLE
//    → CLEAR / EXPIRE
//
//  • WAIT — a rAF-throttled bounded retry (no setTimeout chains,
//    no MutationObserver) keeps polling while the target renders
//    (React Query / async data / filtering / pagination). A page
//    can gate it with `options.ready` (e.g. `!isLoading`); while
//    not ready the intent is kept.
//  • RESOLVE — exact match on [data-record-id="…"], optionally
//    narrowed by [data-record-field="…"]. NO first-match fallback:
//    if the exact target never appears, the intent is cleared
//    QUIETLY — nothing wrong is ever highlighted.
//  • SCROLL — only when the record is not already comfortably
//    visible; smooth normally, instant under reduced motion.
//    Vertical placement + `scroll-margin-block` (CSS) keep the
//    sticky header clear. RTL/LTR never affects the geometry.
//  • REVEAL — the Qnalys layered highlight (crimson/burgundy on
//    charcoal) is applied as a data ATTRIBUTE (`data-qn-highlight`
//    = variant), which React never manages — re-renders cannot
//    wipe it mid-window. One active navigation highlight at a
//    time: applying clears any stale carrier first. User
//    selection state on the page is untouched.
//  • CLEAR — the highlight expires after a few seconds and the
//    intent is released.
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const POLL_INTERVAL_MS = 150;      // bounded retry cadence while the record renders
const LOCATE_TIMEOUT_MS = 15_000;  // bounded give-up (slow networks included)
const HIGHLIGHT_VISIBLE_MS = 4_000; // clear after a few seconds
const COMFORT_MARGIN_PX = 96;      // "already visible" padding around the viewport

export type QnalysHighlightVariant = 'record' | 'row' | 'card' | 'section' | 'field';

export interface RecordHighlightOptions {
  /**
   * When false the hook WAITS (keeps the highlight intent) — use the
   * moment the page's records can render, e.g. `!isLoading`. Defaults
   * to true (pages that render synchronously).
   */
  ready?: boolean;
}

function findRecordElement(recordId: string, fieldId?: string | null): Element | null {
  try {
    const base = `[data-record-id="${CSS.escape(recordId)}"]`;
    if (fieldId) {
      const narrow = document.querySelector(`${base}[data-record-field="${CSS.escape(fieldId)}"]`);
      if (narrow) return narrow;
    }
    return document.querySelector(base);
  } catch {
    return null;
  }
}

/** Stable variant for the shared visual language (component-aware shape). */
function resolveVariant(el: Element): QnalysHighlightVariant {
  const declared = el.getAttribute('data-record-variant');
  if (declared === 'row' || declared === 'card' || declared === 'section'
    || declared === 'field' || declared === 'record') return declared;
  const tag = el.tagName;
  if (tag === 'TR') return 'row';
  if (tag === 'TD' || tag === 'TH' || tag === 'DT' || tag === 'DD') return 'field';
  return 'card';
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Is the element comfortably inside the viewport (no scroll needed)? */
function comfortablyVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0 && rect.width <= 0) return false;
  return rect.top >= COMFORT_MARGIN_PX
    && rect.left >= 0
    && rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    && rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) - COMFORT_MARGIN_PX;
}

/** Exactly one navigation highlight may be alive at any moment. */
function clearStaleCarriers(): void {
  try {
    document.querySelectorAll('[data-qn-highlight]').forEach((el) => {
      el.removeAttribute('data-qn-highlight');
    });
  } catch {
    /* detached document — nothing to clear */
  }
}

export function useRecordHighlight(options?: RecordHighlightOptions): void {
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);
  const ready = options?.ready !== false;

  useEffect(() => {
    if (!highlightId || !ready) return;
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let raf = 0;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightedEl: Element | null = null;
    const deadline = Date.now() + LOCATE_TIMEOUT_MS;
    const reducedMotion = prefersReducedMotion();

    const release = () => {
      if (!cancelled) setHighlightId(null);
    };

    const expire = () => {
      try {
        highlightedEl?.removeAttribute('data-qn-highlight');
      } catch {
        /* element may have unmounted — nothing to clean */
      }
      highlightedEl = null;
      release();
    };

    const reveal = (el: Element) => {
      // One active navigation highlight: stale carriers go first
      // (page-local selection state is untouched — different concept).
      clearStaleCarriers();
      const variant = resolveVariant(el);
      try {
        el.setAttribute('data-qn-highlight', variant);
      } catch {
        /* detached — give up quietly */
        release();
        return;
      }
      highlightedEl = el;
      // Scroll only when needed; smooth unless reduced motion. CSS
      // `scroll-margin-block` keeps the sticky header clear.
      if (!comfortablyVisible(el)) {
        try {
          el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
        } catch {
          /* scrollIntoView is best-effort */
        }
      }
      cleanupTimer = setTimeout(expire, HIGHLIGHT_VISIBLE_MS);
    };

    const attempt = () => {
      if (cancelled) return;
      const el = findRecordElement(highlightId);
      if (!el) {
        // Record not rendered YET — keep the intent and retry until the
        // bounded timeout (never destroy it on an early miss, never
        // fall back to a first-row guess).
        if (Date.now() < deadline) {
          raf = window.setTimeout(attempt, POLL_INTERVAL_MS);
        } else {
          setHighlightId(null); // quiet give-up (honest fallback)
        }
        return;
      }
      reveal(el);
    };

    raf = window.setTimeout(attempt, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (raf) clearTimeout(raf);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      try {
        highlightedEl?.removeAttribute('data-qn-highlight');
      } catch {
        /* element may have unmounted */
      }
      highlightedEl = null;
    };
  }, [highlightId, ready, setHighlightId]);
}
