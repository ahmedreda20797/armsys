'use client';

// ══════════════════════════════════════════════════════════════
//  useRecordHighlight — exact-record deep-link receiver (Phase 5.3)
//
//  The target-page side of evidence navigation (spec §24-§28):
//  when the app store carries a highlightId (set by navigateTo from
//  the Evidence Preview), this hook:
//    1. WAITS FOR THE RECORD TO EXIST — it polls the DOM for the
//       element instead of a single fixed-delay probe. The Phase 5.2
//       one-shot 250ms probe routinely fired BEFORE async data
//       rendered (React Query / Promise.allSettled), then destroyed
//       the highlight intent on a miss — the exact-record navigation
//       bug this phase fixes (spec §22/§25).
//    2. locates the record element via [data-record-id="…"],
//    3. scrolls it into view,
//    4. applies the temporary `evidence-highlight` style,
//    5. clears the highlight state a few seconds later (spec §27-8).
//
//  `options.ready` lets a page declare when its data can render the
//  target (e.g. !isLoading); while not ready the hook keeps the
//  intent and retries. A bounded overall timeout guarantees the
//  intent is always eventually cleared (no stale highlights).
//
//  If the element never appears (record filtered out, beyond the
//  loaded page, or the page does not render ids) the hook clears
//  QUIETLY — the page navigation already succeeded and nothing
//  wrong is ever highlighted (§30 honest fallback).
//
//  Pages opt in by calling `useRecordHighlight()` once and marking
//  their record rows/cards with `data-record-id={record.id}`.
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const POLL_INTERVAL_MS = 200;   // retry cadence while the record renders
const LOCATE_TIMEOUT_MS = 15_000; // bounded give-up (slow networks included)
const HIGHLIGHT_VISIBLE_MS = 4_000; // spec §27-8: clear after a few seconds

export interface RecordHighlightOptions {
  /**
   * When false the hook WAITS (keeps the highlight intent) — use the
   * moment the page's records can render, e.g. `!isLoading`. Defaults
   * to true (pages that render synchronously).
   */
  ready?: boolean;
}

function findRecordElement(recordId: string): Element | null {
  try {
    return document.querySelector(`[data-record-id="${CSS.escape(recordId)}"]`);
  } catch {
    return null;
  }
}

export function useRecordHighlight(options?: RecordHighlightOptions): void {
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);
  const ready = options?.ready !== false;

  useEffect(() => {
    if (!highlightId || !ready) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
    let highlightedEl: Element | null = null;

    const finish = () => {
      // Clear the intent once the highlight window is over.
      if (!cancelled) setHighlightId(null);
    };

    const attempt = () => {
      if (cancelled) return;
      const el = findRecordElement(highlightId);
      if (!el) {
        // Record not rendered YET — keep the intent and retry until
        // the bounded timeout (never destroy it on an early miss).
        if (Date.now() < deadline) {
          pollTimer = setTimeout(attempt, POLL_INTERVAL_MS);
        } else {
          setHighlightId(null); // quiet give-up (§30 honest fallback)
        }
        return;
      }
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        /* scrollIntoView is best-effort */
      }
      el.classList.add('evidence-highlight');
      highlightedEl = el;
      cleanupTimer = setTimeout(() => {
        try {
          highlightedEl?.classList.remove('evidence-highlight');
        } catch {
          /* element may have unmounted — nothing to clean */
        }
        finish();
      }, HIGHLIGHT_VISIBLE_MS);
    };

    const startedAt = Date.now();
    const deadline = startedAt + LOCATE_TIMEOUT_MS;
    pollTimer = setTimeout(attempt, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      try {
        highlightedEl?.classList.remove('evidence-highlight');
      } catch {
        /* element may have unmounted */
      }
    };
  }, [highlightId, ready, setHighlightId]);
}
