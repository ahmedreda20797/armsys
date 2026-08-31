// ══════════════════════════════════════════════════════════════
//  POST /api/evidence/preview — Evidence Preview API (Phase 5.2)
//
//  On-demand loading of the ACTUAL source record behind an
//  analytics/PI evidence reference (spec §30/§31/§38):
//    • The Smart Quality Report loads NOTHING upfront — the client
//      calls this endpoint when a group is expanded / a preview is
//      opened, with the specific record ids. One batched request
//      per expansion (never one request per record — §38 "avoid
//      N+1"), capped at 50 ids per call.
//    • Reads the CANONICAL RTDB tables by their real names via the
//      existing db layer — NO shadow/evidence/cache collections and
//      no copies (spec §39). Read-only.
//    • PERMISSIONS (spec §37): source-page permission is verified
//      per collection, and the viewer's employee scope is applied
//      to every employee-linked record. A viewer without source
//      permission receives access:"forbidden" and NO record
//      contents. Out-of-scope resolves as "not_found" — the same
//      anti-enumeration doctrine as every detail route.
//    • Responses carry the DISPLAY PROJECTION only (Arabic labeled
//      fields); the raw record never leaves the server.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import {
  asScopeViewer,
  linkedRecordInScope,
  resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import {
  EVIDENCE_COLLECTIONS,
  evidenceTableOf,
} from '@/lib/evidence/evidence-collections';
import { projectEvidenceRecord, type ProjectedRecord } from '@/lib/evidence/record-projection';
import { EVIDENCE_FORBIDDEN_MESSAGE } from '@/lib/evidence/evidence-summaries';
import {
  parseEvidencePreviewBody,
  scopeOptionsFor,
} from '@/lib/evidence/preview-request';

export type EvidencePreviewAccess = 'granted' | 'forbidden' | 'not_found';

export interface EvidencePreviewRecord {
  recordId: string;
  access: EvidencePreviewAccess;
  /** Display projection only — present ONLY when access === 'granted'. */
  record?: ProjectedRecord;
}

export async function POST(request: NextRequest) {
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
    const parsed = parseEvidencePreviewBody(body);
    if (!parsed.ok) return validationError(parsed.error);

    const { collection, recordIds } = parsed.value;
    const descriptor = EVIDENCE_COLLECTIONS[collection];

    // ── SOURCE permission (spec §37) — the KPI Reports permission
    // that surfaced the evidence does NOT grant source-record access.
    const permCheck = await verifyPermission(request, descriptor.permissionKey, 'view');
    if (!permCheck.allowed || !permCheck.user) {
      // Explicit, per-record denial — NO record contents are returned.
      return Response.json({
        collection,
        message: EVIDENCE_FORBIDDEN_MESSAGE,
        records: recordIds.map((recordId) => ({
          recordId,
          access: 'forbidden' as const,
        })),
      });
    }

    // ── Employee scope (resolved ONCE, applied per record) ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user), undefined, permCheck.user.permissions,
    );
    const scopeOptions = scopeOptionsFor(collection);

    // ── On-demand canonical reads (spec §38/§39) ──
    const table = evidenceTableOf(collection);
    const records: EvidencePreviewRecord[] = [];
    for (const recordId of recordIds) {
      const raw = await getById<Record<string, unknown>>(table, recordId);
      if (!raw) {
        records.push({ recordId, access: 'not_found' });
        continue;
      }
      // Out-of-scope == not found (anti-enumeration, same as every
      // source detail route). No contents, no existence leak.
      if (!linkedRecordInScope(
        raw as { employeeId?: string | null; [key: string]: unknown },
        scopeCtx,
        scopeOptions,
      )) {
        records.push({ recordId, access: 'not_found' });
        continue;
      }
      const projected = projectEvidenceRecord(collection, raw);
      if (!projected) {
        records.push({ recordId, access: 'not_found' });
        continue;
      }
      records.push({ recordId, access: 'granted', record: projected });
    }

    return Response.json({ collection, records });
  } catch (error) {
    logServerFailure('evidence-preview', 'POST', error);
    return internalError();
  }
}
