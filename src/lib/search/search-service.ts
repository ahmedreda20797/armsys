// ══════════════════════════════════════════════════════════════
//  Global Search — server-side service (Phase 6.1, spec §10/§11/§17)
//
//  THE data-access boundary for search:
//
//    Browser → Search UI → POST /api/search → Authentication
//      → per-domain Permission → Employee Scope → Search
//      → Sanitized lightweight projection → Browser
//
//  • A domain the caller cannot view is NOT queried at all — no
//    names, no counts, no existence indication (spec §11/§12).
//  • Employee scope is resolved ONCE per request through the
//    canonical scope engine and applied before matching (same
//    doctrine as every list route).
//  • Reads go through the existing cached db readers (getAll /
//    getEmployeeMap) — no client-side database dumps, no N+1, no
//    separate index (spec §17).
//  • Out-of-scope rows simply do not exist for the caller — the
//    anti-enumeration doctrine (spec §12).
//  • READ-ONLY: this module contains zero write operations.
// ══════════════════════════════════════════════════════════════

import { getAll, getEmployeeMap } from '@/lib/db';
import {
  authScopeViewer,
  filterEmployeesInScope,
  filterRowsByEmployeeScope,
  resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import type { EmployeeScopeContext } from '@/lib/scope';
import { migratePermission, type PermissionsMap } from '@/config/permissions';
import { logServerFailure } from '@/lib/api-error';

import { normalizeForSearch, splitQueryTerms } from './search-normalize';
import { SEARCH_DOMAINS, SEARCH_DOMAIN_ORDER } from './search-domains';
import { SEARCH_ADAPTERS, type AdapterContext } from './adapters';
import {
  isRecordIdMatch,
  matchRecord,
  RECORD_ID_MATCH_SCORE,
  type RecordMatch,
} from './record-matcher';
import { DEFAULT_GROUP_LIMIT, type ParsedSearchRequest } from './search-request';
import type { SearchApiResponse, SearchDomain, SearchResult, SearchResultGroup } from './types';

type Rec = Record<string, unknown>;

/** Structural slice of the authenticated caller (AuthenticatedCaller). */
export interface SearchCaller {
  userId: string;
  role: string;
  permissions: PermissionsMap;
  linkedEmployeeId?: string | null;
}

/**
 * Mirror of verifyPermission's `view` semantics — evaluated against
 * the ALREADY-RESOLVED effective permissions of the caller (no
 * re-authentication per domain). Admin bypasses; otherwise the
 * canonical permission entry must not be 'none'.
 */
export function canViewDomain(
  permissions: PermissionsMap,
  role: string,
  permissionKey: string,
): boolean {
  if (role === 'admin') return true;
  const perm = migratePermission(permissions[permissionKey]);
  return perm.level !== 'none';
}

/** Injectable IO — tests stub this instead of Firebase. */
export interface SearchDeps {
  getAll: (table: string) => Promise<Rec[]>;
  getEmployeeMap: () => Promise<Map<string, { name?: string }>>;
  resolveScope: () => Promise<EmployeeScopeContext>;
}

export function defaultSearchDeps(caller: SearchCaller): SearchDeps {
  return {
    getAll: (table) => getAll<Rec>(table),
    getEmployeeMap: () => getEmployeeMap(),
    resolveScope: () =>
      resolveEmployeeScopeFromDb(authScopeViewer(caller), undefined, caller.permissions),
  };
}

interface InternalMatch {
  record: Rec;
  recordId: string;
  match: RecordMatch;
}

/** Secondary sort — newest record first when createdAt is comparable. */
function newestFirst(a: Rec, b: Rec): number {
  const ta = typeof a.createdAt === 'string' ? a.createdAt : '';
  const tb = typeof b.createdAt === 'string' ? b.createdAt : '';
  if (!ta && !tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return tb.localeCompare(ta);
}

/** Apply the domain's scope doctrine to raw rows. */
function applyScope(
  rows: Rec[],
  scopeKind: 'rows' | 'employees' | 'linked' | 'none',
  scopeOptions: { optionalLink: boolean; relatedEmployeeIdsField?: string },
  scopeCtx: EmployeeScopeContext | null,
): Rec[] {
  if (scopeKind === 'none' || !scopeCtx) return rows;
  if (scopeKind === 'employees') return filterEmployeesInScope(rows as Array<{ id: string }>, scopeCtx);
  return filterRowsByEmployeeScope(rows, scopeCtx, scopeOptions);
}

/** Build the STRICT contract object — nothing but the listed fields. */
function toSearchResult(
  domain: SearchDomain,
  recordType: string,
  recordId: string,
  projection: ReturnType<(typeof SEARCH_ADAPTERS)[SearchDomain]['project']>,
  match: RecordMatch,
): SearchResult {
  const result: SearchResult = {
    recordId,
    domain,
    recordType,
    title: projection.title,
    matchedFields: match.matchedFields,
  };
  if (projection.subtitle) result.subtitle = projection.subtitle;
  if (projection.metadata && projection.metadata.length > 0) {
    result.metadata = projection.metadata;
  }
  if (projection.date) result.date = projection.date;
  if (projection.status) result.status = projection.status;
  if (projection.statusValue) result.statusValue = projection.statusValue;
  if (projection.month) result.month = projection.month;
  return result;
}

/**
 * Run the global search for an authenticated caller. Never throws —
 * a failing domain degrades to a skipped group; the response stays
 * structurally valid (spec §29: no raw server errors to the client).
 */
export async function runGlobalSearch(
  caller: SearchCaller,
  parsed: ParsedSearchRequest,
  deps: SearchDeps = defaultSearchDeps(caller),
): Promise<SearchApiResponse> {
  const startedAt = Date.now();
  const normalizedQuery = normalizeForSearch(parsed.query);
  const terms = splitQueryTerms(normalizedQuery);
  const empty: SearchApiResponse = { query: parsed.query, groups: [] };
  if (normalizedQuery.length === 0 || terms.length === 0) return empty;

  // ── Permission gate: unauthorized domains are NOT queried ──
  const domains = SEARCH_DOMAIN_ORDER.filter((domain) => {
    if (parsed.domain && domain !== parsed.domain) return false;
    return canViewDomain(caller.permissions, caller.role, SEARCH_DOMAINS[domain].permissionKey);
  });
  if (domains.length === 0) return empty;

  // ── Shared per-request resources (lazy, at most one DB touch each) ──
  const needsScope = domains.some((d) => SEARCH_DOMAINS[d].scopeKind !== 'none');
  const needsEmployeeMap = domains.some((d) => SEARCH_DOMAINS[d].usesEmployeeMap);
  const [scopeCtx, employeeMap] = await Promise.all([
    needsScope ? deps.resolveScope() : Promise.resolve(null),
    needsEmployeeMap
      ? deps.getEmployeeMap().catch(() => new Map<string, { name?: string }>())
      : Promise.resolve(new Map<string, { name?: string }>()),
  ]);

  const ctx: AdapterContext = {
    employeeNameOf: (employeeId) => {
      if (!employeeId) return null;
      return employeeMap.get(employeeId)?.name ?? null;
    },
  };

  const perDomainLimit = parsed.limit ?? DEFAULT_GROUP_LIMIT;
  const built: Array<{ group: SearchResultGroup; bestScore: number }> = [];

  for (const domain of domains) {
    const descriptor = SEARCH_DOMAINS[domain];
    const adapter = SEARCH_ADAPTERS[domain];
    try {
      const rows = await deps.getAll(descriptor.table);
      const scoped = applyScope(rows, descriptor.scopeKind, descriptor.scopeOptions, scopeCtx);

      const matches: InternalMatch[] = [];
      for (const record of scoped) {
        const recordId = typeof record.id === 'string' ? record.id : '';
        if (!recordId) continue;
        // Priority 1 — the whole query is the exact unique id.
        if (isRecordIdMatch(recordId, normalizedQuery)) {
          matches.push({
            record,
            recordId,
            match: { score: RECORD_ID_MATCH_SCORE, matchedFields: ['المعرف'], bestKind: 'exact-id' },
          });
          continue;
        }
        const fields = adapter.searchableFields(record, ctx);
        const match = matchRecord(fields, terms);
        if (match) matches.push({ record, recordId, match });
      }

      if (matches.length === 0) continue;

      matches.sort((a, b) => b.match.score - a.match.score || newestFirst(a.record, b.record));

      const results = matches
        .slice(0, perDomainLimit)
        .map(({ record, recordId, match }) =>
          toSearchResult(domain, descriptor.recordType, recordId, adapter.project(record, ctx), match),
        );

      built.push({
        group: {
          domain,
          label: descriptor.label,
          results,
          total: matches.length,
          truncated: matches.length > results.length,
        },
        bestScore: matches[0].match.score,
      });
    } catch (error) {
      // Structural metadata only — never record contents (spec §37).
      logServerFailure('search-service', 'search-domain', error, { domain });
    }
  }

  // ── Group ordering: strongest match first (spec §7) ──
  built.sort((a, b) => b.bestScore - a.bestScore);

  return {
    query: parsed.query,
    groups: built.map((entry) => entry.group),
    tookMs: Date.now() - startedAt,
  };
}
