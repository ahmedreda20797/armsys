// ══════════════════════════════════════════════════════════════
//  Global Search — navigation contract (Phase 6.1, spec §8/§9)
//
//  The single abstraction that turns a SearchResult into a
//  navigation intent. REUSES the Phase 5.2/5.3 evidence machinery —
//  no parallel highlight system:
//    • domains already registered as evidence collections inherit
//      buildEvidenceNavigation (highlight / detailParam / generic),
//    • month-filtered target pages receive the record's own month
//      (the Phase 5.3 month-seeding doctrine),
//    • search-only domains map to their page's EXISTING deep-link
//      contract — never an invented one. Pages without any exact
//      contract degrade to `exact:false` (honest "الانتقال إلى
//      الصفحة" label, spec §28).
//
//  Client-safe: pure data + the client-safe evidence registry.
// ══════════════════════════════════════════════════════════════

import {
  isEvidenceCollection,
  type EvidenceCollection,
} from '@/lib/evidence/evidence-collections';
import { buildEvidenceNavigation } from '@/lib/evidence/evidence-navigation';
import { SEARCH_DOMAINS } from './search-domains';
import type { SearchResult } from './types';

export interface SearchNavigationIntent {
  page: string;
  highlightId: string | null;
  navParams: Record<string, string>;
  /** true = exact-record navigation («فتح السجل»);
   *  false = generic page fallback («الانتقال إلى الصفحة»). */
  exact: boolean;
}

/** Target pages that seed the month filter from the record's month. */
const MONTH_SEEDED_DOMAINS: ReadonlySet<SearchResult['domain']> = new Set([
  'qualityObservations',
  'travelDeals',
]);

/**
 * Build the navigation intent for a search result. The caller still
 * gates on page visibility (usePermissions.canViewPage) before
 * navigating — server filtering remains the source of truth.
 */
export function buildSearchNavigation(
  result: Pick<SearchResult, 'domain' | 'recordId' | 'month' | 'statusValue'>,
): SearchNavigationIntent {
  const descriptor = SEARCH_DOMAINS[result.domain];

  // Domains shared with the evidence registry reuse its proven contract.
  if (isEvidenceCollection(result.domain)) {
    const collection = result.domain as EvidenceCollection;
    const intent = buildEvidenceNavigation(collection, result.recordId);
    if (intent.exact && result.month && MONTH_SEEDED_DOMAINS.has(result.domain)) {
      return { ...intent, navParams: { ...intent.navParams, month: result.month } };
    }
    return intent;
  }

  switch (result.domain) {
    case 'employees': {
      // Archived/inactive employees are hidden by the page's default
      // status filter — the result carries the raw status so the page
      // seeds its filter and the exact row becomes reachable.
      const status = result.statusValue;
      const seedStatus = status === 'archived' || status === 'inactive' ? status : null;
      return {
        page: descriptor.page,
        highlightId: result.recordId,
        navParams: seedStatus ? { status: seedStatus } : {},
        exact: true,
      };
    }
    case 'hrDeductions':
    case 'attendance':
    case 'requests':
      // Exact row highlight via the shared hook (data-record-id) or the
      // page's own highlightId row mechanic (requests).
      return { page: descriptor.page, highlightId: result.recordId, navParams: {}, exact: true };
    default:
      // knowledgeBase / monthSnapshots / orgNodes / users — the target
      // pages have no exact-record contract today (honest fallback).
      return { page: descriptor.page, highlightId: null, navParams: {}, exact: false };
  }
}
