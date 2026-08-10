// ══════════════════════════════════════════════════════════════
//  /api/quality-audit-log
//
//  GET — queryable global audit trail (manager view).
//  Supports filtering by entityType, entityId, monthKey, action, actor.
//  Pagination via limit/offset.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, sortByDateField, TTL } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  unauthorizedError, forbiddenError, internalError, logServerFailure,
} from '@/lib/api-error';
import type { QualityAuditLogEntry } from '@/types/quality-kpi';

export const AUDIT_LOG_TABLE = 'qualityAuditLog';

export async function GET(request: NextRequest) {
  try {
    // Manager/admin only — audit log is sensitive. Enforced via the
    // existing permission contract ('qualityAuditLog' page) rather than a
    // hardcoded role check.
    const permCheck = await verifyPermission(request, 'qualityAuditLog', 'view');
    if (!permCheck.allowed) {
      // Distinguish unauthenticated (no valid JWT) from forbidden.
      return permCheck.user ? forbiddenError(permCheck.error) : unauthorizedError(permCheck.error);
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType');
    const entityId = searchParams.get('entityId');
    const monthKey = searchParams.get('monthKey');
    const action = searchParams.get('action');
    const actorId = searchParams.get('actorId');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let records = await getAll<QualityAuditLogEntry>(AUDIT_LOG_TABLE, TTL.DEFAULT);

    if (entityType) records = records.filter((r) => r.entityType === entityType);
    if (entityId) records = records.filter((r) => r.entityId === entityId);
    if (monthKey) records = records.filter((r) => r.monthKey === monthKey);
    if (action) records = records.filter((r) => r.action === action);
    if (actorId) records = records.filter((r) => r.actorId === actorId);

    records = sortByDateField(records, 'timestamp', 'desc');

    const total = records.length;
    const paginated = records.slice(offset, offset + limit);

    return Response.json({ data: paginated, total, limit, offset });
  } catch (error) {
    logServerFailure('quality-audit-log', 'GET', error);
    return internalError();
  }
}
