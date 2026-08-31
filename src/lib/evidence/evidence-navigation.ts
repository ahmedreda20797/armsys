// ══════════════════════════════════════════════════════════════
//  Evidence → source navigation (Phase 5.2, spec §33-§36)
//
//  Pure builder over the EXISTING SPA navigation primitives — the
//  zustand store's navigateTo(page, highlightId?, navParams?).
//  NO second router, NO URL-query router (spec §34): the store IS
//  the application's PageRouter equivalent and already powers
//  notification deep-links (Header.tsx) the same way.
//
//  Strategies (§36): 'highlight'/'detailParam' produce EXACT record
//  navigation; 'generic' falls back to the source page — the UI
//  labels these two cases differently.
// ══════════════════════════════════════════════════════════════

import {
  EVIDENCE_COLLECTIONS,
  type EvidenceCollection,
} from './evidence-collections';

export interface EvidenceNavigationIntent {
  page: string;
  highlightId: string | null;
  navParams: Record<string, string>;
  /** true = exact-record navigation; false = generic page fallback. */
  exact: boolean;
}

export function buildEvidenceNavigation(
  collection: EvidenceCollection,
  recordId: string,
): EvidenceNavigationIntent {
  const descriptor = EVIDENCE_COLLECTIONS[collection];
  if (descriptor.navStrategy === 'generic') {
    return { page: descriptor.page, highlightId: null, navParams: {}, exact: false };
  }
  if (descriptor.navStrategy === 'detailParam') {
    return {
      page: descriptor.page,
      highlightId: recordId,
      navParams: { [descriptor.navParam ?? 'id']: recordId },
      exact: true,
    };
  }
  return { page: descriptor.page, highlightId: recordId, navParams: {}, exact: true };
}
