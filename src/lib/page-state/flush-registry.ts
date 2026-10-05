// ══════════════════════════════════════════════════════════════
//  Page-State Flush Registry — pending-write flush coordination
//  (SPA Navigation History, §11/§13 "leaving a page captures the
//  state the user actually sees")
//
//  `usePageState` debounces writes (250 ms) and flushes pending
//  writes on unmount — but when the navigation layer snapshots a
//  page's state at LEAVE time (inside navigateTo, before React
//  unmounts the old page), those pending writes must be flushed
//  SYNCHRONOUSLY or the captured snapshot would be up to 250 ms
//  (plus the AnimatePresence exit) behind what the user last saw.
//
//  Each mounted usePageState instance registers a flusher for its
//  page id; the navigation layer calls `flushPageStateWriters(page)`
//  right before capturing the page's persisted state. Zero-import,
//  client-safe, and inert in tests until someone registers.
// ══════════════════════════════════════════════════════════════

const flushersByPage = new Map<string, Set<() => void>>();

/** Register a mounted usePageState instance's flush callback. */
export function registerPageStateFlusher(page: string, flush: () => void): () => void {
  let set = flushersByPage.get(page);
  if (!set) {
    set = new Set();
    flushersByPage.set(page, set);
  }
  set.add(flush);
  return () => {
    const current = flushersByPage.get(page);
    if (!current) return;
    current.delete(flush);
    if (current.size === 0) flushersByPage.delete(page);
  };
}

/**
 * Synchronously flush every pending usePageState write for a page.
 * Called by the navigation layer before capturing the page's state.
 */
export function flushPageStateWriters(page: string): void {
  const set = flushersByPage.get(page);
  if (!set) return;
  for (const flush of [...set]) {
    try {
      flush();
    } catch {
      // A failing flusher must never break navigation.
    }
  }
}
