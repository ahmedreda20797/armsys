// ══════════════════════════════════════════════════════════════
//  Audit log reader primitives (pure functions)
//
//  Shared by the /api/quality-audit-log route and the client hook so
//  both sides of the reader agree on one implementation:
//    - unwrapAuditLogPayload — accepts the wire payload (bare array
//      or the paginated { data, total, limit, offset } envelope) and
//      always yields a flat entry array.
//    - filterAuditRecords — the canonical query filters (entityType,
//      entityId, monthKey, action, actorId). Empty/absent filters are
//      no-ops; there is deliberately NO status filter (the audit log
//      records every review activity: create/approve/reject/…) and
//      NO implicit date window — visibility never depends on Month
//      Close or approval status.
// ══════════════════════════════════════════════════════════════

import type { QualityAuditLogEntry } from '@/types/quality-kpi';

/** Filter parameters accepted by the audit-log reader. */
export interface AuditLogQueryParams {
  entityType?: string | null;
  entityId?: string | null;
  monthKey?: string | null;
  action?: string | null;
  actorId?: string | null;
}

/**
 * Unwrap an audit-log reader payload into a flat entry array.
 *
 * Accepts:
 *   - a bare QualityAuditLogEntry[] (direct DB reads, legacy callers)
 *   - the paginated envelope { data: QualityAuditLogEntry[], total, limit, offset }
 *     returned by GET /api/quality-audit-log
 *
 * Anything else (null, undefined, malformed objects) yields [] — the
 * caller renders an empty trail instead of crashing.
 */
export function unwrapAuditLogPayload(payload: unknown): QualityAuditLogEntry[] {
  if (Array.isArray(payload)) return payload as QualityAuditLogEntry[];
  if (
    payload !== null &&
    typeof payload === 'object' &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: QualityAuditLogEntry[] }).data;
  }
  return [];
}

/**
 * Apply the canonical audit-log query filters in one linear pass.
 * Mirrors the original inline route filters exactly — same semantics,
 * single testable implementation.
 */
export function filterAuditRecords<T extends QualityAuditLogEntry>(
  records: T[],
  params: AuditLogQueryParams,
): T[] {
  let out = records;
  if (params.entityType) out = out.filter((r) => r.entityType === params.entityType);
  if (params.entityId) out = out.filter((r) => r.entityId === params.entityId);
  if (params.monthKey) out = out.filter((r) => r.monthKey === params.monthKey);
  if (params.action) out = out.filter((r) => r.action === params.action);
  if (params.actorId) out = out.filter((r) => r.actorId === params.actorId);
  return out;
}
