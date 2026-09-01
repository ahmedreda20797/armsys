// ══════════════════════════════════════════════════════════════
//  Global Search — core contract types (Phase 6.1, spec §6)
//
//  The SearchResult is a LIGHTWEIGHT, server-projected display
//  object — the raw database record NEVER crosses the API boundary
//  (spec §10/§18). Every field is display-ready or a navigation
//  input; nothing else.
// ══════════════════════════════════════════════════════════════

/**
 * Searchable data domains — discovered from the SYSTEM INVENTORY of
 * the actual codebase (canonical RTDB tables + permission keys).
 * A domain exists here ONLY if its collection and source page exist.
 */
export type SearchDomain =
  | 'employees'
  | 'qualityObservations'
  | 'qualityDeductions'
  | 'hrDeductions'
  | 'complaints'
  | 'capaCases'
  | 'followUps'
  | 'travelDeals'
  | 'attendance'
  | 'requests'
  | 'knowledgeBase'
  | 'monthSnapshots'
  | 'orgNodes'
  | 'users';

/**
 * Unified lightweight search result (spec §6). Contains ONLY the
 * fields necessary for display + navigation — never the full record.
 */
export interface SearchResult {
  /** Canonical RTDB record id — also the exact-navigation highlight id. */
  recordId: string;
  domain: SearchDomain;
  /** Arabic singular record type, e.g. «ملاحظة جودة». */
  recordType: string;
  /** Primary display text (human meaning first, raw id secondary). */
  title: string;
  subtitle?: string;
  /** Small display-only facts, e.g. ['القسم: العمليات']. */
  metadata?: string[];
  /** Arabic labels of the fields that matched the query. */
  matchedFields: string[];
  /** Display date (DD/MM/YYYY) when the record carries one. */
  date?: string;
  /** Arabic-labelled status for display. */
  status?: string;
  /** Raw status value — navigation-layer input only (e.g. employees
   *  statusFilter seeding for archived employees). */
  statusValue?: string;
  /** Record month 'YYYY-MM' when the target page is month-filterable. */
  month?: string;
}

/** One domain section of the response (spec §7). */
export interface SearchResultGroup {
  domain: SearchDomain;
  /** Arabic group label, e.g. «الموظفون». */
  label: string;
  results: SearchResult[];
  /** Number of matches the SERVER found inside the authorized scope
   *  (never leaks anything for unauthorized domains — they are not
   *  queried at all, spec §11/§12). */
  total: number;
  /** true when total exceeds the returned slice. */
  truncated: boolean;
}

/** POST /api/search response body. */
export interface SearchApiResponse {
  query: string;
  groups: SearchResultGroup[];
  /** Structural timing metadata only (spec §37 — no record contents). */
  tookMs?: number;
}
