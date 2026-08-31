'use client';

// ══════════════════════════════════════════════════════════════
//  useRecordHighlight — exact-record deep-link receiver (Phase 5.2)
//
//  The target-page side of evidence navigation (spec §33/§35/§36):
//  when the app store carries a highlightId (set by navigateTo from
//  the Evidence Preview), this hook:
//    1. waits briefly for the page's React Query data to render,
//    2. locates the record element via [data-record-id="…"],
//    3. scrolls it into view,
//    4. applies the temporary `evidence-highlight` style,
//    5. clears the highlight state after a short window.
//
//  If the element is not present (record filtered out, on another
//  page, or the page does not render ids), the hook clears silently
//  — the generic navigation already succeeded, so nothing breaks
//  (§36 fallback stays intact).
//
//  Pages opt in by calling `useRecordHighlight()` once and marking
//  their record rows/cards with `data-record-id={record.id}`.
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

const LOCATE_DELAY_MS = 250; // let React Query data render first
const HIGHLIGHT_VISIBLE_MS = 4_000;

export function useRecordHighlight(): void {
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);

  useEffect(() => {
    if (!highlightId) return;
    let cancelled = false;
    let pendingCleanup: ReturnType<typeof setTimeout> | null = null;

    const locateTimer = setTimeout(() => {
      if (cancelled) return;
      let el: Element | null = null;
      try {
        el = document.querySelector(`[data-record-id="${CSS.escape(highlightId)}"]`);
      } catch {
        el = null;
      }
      if (!el) {
        // Record not rendered in this view — clear quietly (§36).
        setHighlightId(null);
        return;
      }
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch {
        /* scrollIntoView is best-effort */
      }
      el.classList.add('evidence-highlight');
      pendingCleanup = setTimeout(() => {
        el?.classList.remove('evidence-highlight');
        setHighlightId(null);
      }, HIGHLIGHT_VISIBLE_MS);
    }, LOCATE_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(locateTimer);
      if (pendingCleanup) clearTimeout(pendingCleanup);
    };
  }, [highlightId, setHighlightId]);
}
