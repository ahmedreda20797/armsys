// ══════════════════════════════════════════════════════════════
//  POST /api/search — Global Search API (Phase 6.1, spec §14)
//
//  The ONLY path from the browser to searchable data:
//
//    Browser → Search UI → THIS ROUTE → requireAuth (JWT Bearer)
//      → per-domain permission (canonical permissionKey)
//      → employee scope (canonical scope engine, resolved once)
//      → cached server-side readers → lightweight sanitized
//      projections → Browser
//
//  • POST (contract will grow — spec §14 preference).
//  • The client may send ONLY { query, domain?, limit? } — there is
//    no client-controllable permission bypass or employee scope;
//    every authorization decision is computed server-side.
//  • A domain the caller cannot view is not queried at all — no
//    counts, no ids, no existence hints (anti-enumeration, §12).
//  • Responses carry lightweight display projections only — raw
//    database records never leave the server (§6/§10).
//  • READ-ONLY: no write operation exists on this path.
// ══════════════════════════════════════════════════════════════

import { requireAuth } from '@/lib/verify-permission';
import {
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { parseSearchRequestBody } from '@/lib/search/search-request';
import { runGlobalSearch } from '@/lib/search/search-service';

export async function POST(request: Request) {
  try {
    // ── Authentication (JWT Bearer — existing doctrine) ──
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError('جسم الطلب غير صالح');
    }
    const parsed = parseSearchRequestBody(body);
    if (!parsed.ok) return validationError(parsed.error);

    // ── Server-side authorization + scoped search + projection ──
    const response = await runGlobalSearch(auth, parsed.value);
    return Response.json(response);
  } catch (error) {
    logServerFailure('global-search', 'POST', error);
    return internalError();
  }
}
