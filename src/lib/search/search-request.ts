// ══════════════════════════════════════════════════════════════
//  Global Search — request parsing & validation (Phase 6.1, §14)
//
//  Pure, server-safe helper extracted from the route (same doctrine
//  as evidence/preview-request.ts). The client may send ONLY:
//    { query, domain?, limit? }
//  There is NO client-controllable permission bypass, employee
//  scope, or pagination cursor — all authorization is computed
//  server-side from the authenticated caller.
// ══════════════════════════════════════════════════════════════

import { isSearchDomain } from './search-domains';
import { MIN_QUERY_LENGTH } from './search-normalize';
import type { SearchDomain } from './types';

export const MAX_QUERY_LENGTH = 100;
/** Hard cap for a domain-scoped "view all" query. */
export const MAX_LIMIT = 50;
/** Per-group slice for the default all-domain search. */
export const DEFAULT_GROUP_LIMIT = 5;

export interface ParsedSearchRequest {
  query: string;
  /** Omitted = search every domain the caller is authorized for. */
  domain?: SearchDomain;
  /** Max results PER DOMAIN (server-capped, never client-trusted). */
  limit?: number;
}

export function parseSearchRequestBody(
  body: unknown,
): { ok: true; value: ParsedSearchRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'جسم الطلب مطلوب' };
  }
  const { query, domain, limit } = body as Record<string, unknown>;

  if (typeof query !== 'string') {
    return { ok: false, error: 'نص البحث مطلوب' };
  }
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: 'نص البحث مطلوب' };
  }
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { ok: false, error: `الحد الأدنى لنص البحث ${MIN_QUERY_LENGTH} أحرف` };
  }
  if (trimmed.length > MAX_QUERY_LENGTH) {
    return { ok: false, error: `الحد الأقصى لنص البحث ${MAX_QUERY_LENGTH} حرفاً` };
  }

  if (domain !== undefined && domain !== null) {
    if (!isSearchDomain(domain)) {
      return { ok: false, error: 'نطاق بحث غير معروف' };
    }
  }

  if (limit !== undefined && limit !== null) {
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return { ok: false, error: `يجب أن يكون الحد بين 1 و ${MAX_LIMIT}` };
    }
  }

  return {
    ok: true,
    value: {
      query: trimmed,
      domain: domain == null ? undefined : (domain as SearchDomain),
      limit: limit == null ? undefined : limit,
    },
  };
}
