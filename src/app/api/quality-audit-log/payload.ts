// ══════════════════════════════════════════════════════════════
//  GET /api/quality-audit-log — response payload contract
//
//  The route answers with the documented pagination envelope
//  { data, total, limit, offset } (see route.ts — stable since the
//  endpoint was introduced). The ONLY consumer is the
//  useQualityAuditLog hook (src/hooks/use-kpi-queries.ts).
//
//  This module is the single, testable definition of "turn the wire
//  payload into QualityAuditLogEntry[]". It exists because the
//  original consumer applied an Array.isArray(payload) guard to the
//  ENVELOPE — an object is never an array, so the page rendered an
//  always-empty list while perfectly valid records sat in the
//  qualityAuditLog collection. Normalizing at the data layer (not
//  the route, not the page) keeps the documented API contract and
//  the presentation code untouched.
//
//  Pure functions only — no I/O, safe for client bundles and tests.
// ══════════════════════════════════════════════════════════════

import type { QualityAuditLogEntry } from '@/types/quality-kpi';

/** Documented GET /api/quality-audit-log response envelope. */
export interface QualityAuditLogEnvelope {
  data: QualityAuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

/** Structural guard for the documented envelope shape. */
export function isQualityAuditLogEnvelope(value: unknown): value is QualityAuditLogEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { data?: unknown }).data)
  );
}

/**
 * Normalize the audit-log wire payload into the entries array.
 *
 * - Envelope `{ data: [...] }` → the entries array (the documented contract).
 * - Plain array → passed through unchanged (defensive: keeps the parser
 *   honest if the route ever switches to the codebase's other list
 *   endpoints' plain-array convention).
 * - Anything else (null, undefined, error objects, HTML error pages
 *   parsed as text) → [] — the page's own empty-state handles display.
 *
 * Never mutates or fabricates entries; unknown payloads never throw.
 */
export function parseAuditLogPayload(payload: unknown): QualityAuditLogEntry[] {
  if (Array.isArray(payload)) return payload as QualityAuditLogEntry[];
  if (isQualityAuditLogEnvelope(payload)) return payload.data;
  return [];
}
