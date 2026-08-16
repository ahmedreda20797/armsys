// ══════════════════════════════════════════════════════════════
//  /api/quality-observations/[id]
//
//  GET    — fetch a single observation
//  PUT    — update an observation (blocked if approved or month closed)
//  DELETE — delete an observation (blocked if approved or month closed)
//
//  Permission: quality update/delete for mutations; requireAuth for GET.
//  Guards preserve historical immutability and approval integrity.
//
//  Admin override (Phase 1 hardening): an Admin may edit/delete an
//  APPROVED observation while its month is OPEN. A KPI-affecting edit
//  invalidates the approval (status → 'pending', append-only history
//  event records the admin modification) so the observation stops
//  counting toward KPI until re-approved. The closed-month lock remains
//  ABSOLUTE — no role may mutate observations of a closed month.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError, notFoundError,
  lockedError, internalError, logServerFailure,
} from '@/lib/api-error';
import { isMonthClosed } from '@/lib/month-lock';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { notifyObservationAwaitingApproval } from '@/lib/notifications/quality-events';
import {
  canModifyApprovedObservation,
  applyAdminEditPolicy,
} from '@/lib/quality-observations/admin-approved-override';
import { getEmployeeMap, TTL, invalidateCache } from '@/lib/db';
import { validateEmployeeActive } from '@/lib/db-validation';
import type { QualityObservation } from '@/types/quality-kpi';
import { OBSERVATIONS_TABLE, deriveMonth } from '../route';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { id } = await params;
    const record = await getById<QualityObservation>(OBSERVATIONS_TABLE, id);
    if (!record) return notFoundError('الملاحظة غير موجودة');

    return Response.json(record);
  } catch (error) {
    logServerFailure('quality-observations/[id]', 'GET', error);
    return internalError();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observations', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<QualityObservation>(OBSERVATIONS_TABLE, id);
    if (!existing) return notFoundError('الملاحظة غير موجودة');

    const isApproved = existing.approvalStatus === 'approved';
    // Guard: approved observations cannot be edited (preserve approval
    // integrity) — EXCEPT the explicit Admin override, allowed only while
    // the month is OPEN (checked below, absolute).
    const adminOverride = canModifyApprovedObservation(permCheck.user?.role);
    if (isApproved && !adminOverride) {
      return lockedError('لا يمكن تعديل ملاحظة معتمدة');
    }

    // Guard: closed month is immutable — ABSOLUTE, even for Admin.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن تعديل ملاحظاته`);
    }

    const body = await request.json();
    const actor = await resolveActor(permCheck.user?.id);

    // Guard: moving the observation into a DIFFERENT closed month is
    // prohibited — data may never enter a frozen month.
    if (body.observationDate !== undefined) {
      const newMonth = deriveMonth(String(body.observationDate));
      if (newMonth !== existing.month && (await isMonthClosed(newMonth))) {
        return lockedError(`الشهر ${newMonth} مغلق ولا يمكن نقل الملاحظة إليه`);
      }
    }

    // Resolve employee fields server-side if employeeId changed.
    let employeeName = existing.employeeName;
    let department = existing.department;
    let positionSnapshot = existing.positionSnapshot;
    if (body.employeeId && body.employeeId !== existing.employeeId) {
      // Validate the new employee exists AND is active before reassigning.
      const empActive = await validateEmployeeActive(body.employeeId);
      if (!empActive.valid) return validationError(empActive.error!);

      const empMap = await getEmployeeMap();
      const emp = empMap.get(body.employeeId);
      if (!emp) return validationError('الموظف غير موجود');
      employeeName = emp.name;
      department = emp.department || 'غير محدد';
      positionSnapshot = emp.position || '';
    }

    // Resolve category fields server-side if categoryId changed.
    let categoryName = existing.categoryName;
    let categoryWeight = existing.categoryWeight;
    if (body.categoryId && body.categoryId !== existing.categoryId) {
      const { getAll } = await import('@/lib/db');
      const categories = await getAll<{ id: string; name: string; weight: number }>('observationCategories', TTL.STATIC);
      const cat = categories.find((c) => c.id === body.categoryId);
      if (!cat) return validationError('التصنيف غير موجود');
      categoryName = cat.name;
      categoryWeight = cat.weight;
    }

    // Build the update patch (only allow safe fields).
    const patch: Record<string, unknown> = {};
    const allowedFields = [
      'employeeId', 'observationDate', 'type', 'severity', 'categoryId',
      'notes', 'evidence', 'status', 'relatedCapaId', 'correctiveAction',
      'dueDate', 'resolvedDate', 'applyPointDeduction', 'points', 'isBonus',
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        patch[field] = body[field];
      }
    }
    // Apply server-resolved fields (override any client-supplied values).
    if (body.employeeId !== undefined) {
      patch.employeeId = body.employeeId;
      patch.employeeName = employeeName;
      patch.department = department;
      patch.positionSnapshot = positionSnapshot;
    }
    if (body.categoryId !== undefined) {
      patch.categoryId = body.categoryId;
      patch.categoryName = categoryName;
      patch.categoryWeight = categoryWeight;
    }
    // Re-derive month if date changed.
    if (body.observationDate !== undefined) {
      const parts = String(body.observationDate).split('/');
      if (parts.length === 3) {
        patch.month = `${parts[2]}-${parts[1].padStart(2, '0')}`;
      }
    }
    // Numeric coercion for points.
    if (patch.points !== undefined) patch.points = Number(patch.points);

    // ── Admin override policy on an APPROVED observation ──
    // KPI-affecting edits invalidate the approval: the previous events stay
    // in the append-only history, a 'reopen' event records the admin
    // modification, and the projected status resets to 'pending' so the
    // canonical KPI engine stops counting the observation until a fresh
    // approval. Non-KPI edits keep the approval intact.
    let adminChangeSummary = '';
    if (isApproved) {
      const policy = applyAdminEditPolicy(existing, patch, { id: actor.id, name: actor.name });
      if (policy.kpiReset) {
        patch.approvalStatus = policy.approvalStatus; // 'pending'
        patch.approvalHistory = policy.approvalHistory;
        adminChangeSummary = policy.changeSummary;
      }
    }

    // Append audit event.
    const auditEvent = makeAuditEvent({
      action: isApproved ? 'admin_update' : 'update',
      actorId: actor.id,
      actorName: actor.name,
      details: isApproved
        ? adminChangeSummary
          ? `تعديل مدير النظام لملاحظة معتمدة — قيم مؤثرة على المؤشر (${adminChangeSummary})، الاعتماد مُبطل ويتطلب اعتماداً جديداً`
          : 'تعديل مدير النظام لملاحظة معتمدة (حقول غير مؤثرة على المؤشر)'
        : 'تعديل ملاحظة الجودة',
    });
    patch.auditLog = [...(existing.auditLog || []), auditEvent];

    const updated = await updateRecord(OBSERVATIONS_TABLE, id, patch);
    if (!updated) return notFoundError('الملاحظة غير موجودة');

    // Audit trail (fire-and-forget).
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: isApproved ? 'admin_update' : 'update',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: isApproved
        ? adminChangeSummary
          ? `تعديل مدير النظام لملاحظة معتمدة للموظف ${employeeName} — ${adminChangeSummary}`
          : `تعديل مدير النظام لملاحظة معتمدة للموظف ${employeeName} (غير مؤثر على المؤشر)`
        : `تعديل ملاحظة جودة للموظف ${employeeName}`,
    });

    // A KPI reset re-enters the approval workflow — notify it (existing
    // notification infrastructure, deduplicated per observation).
    if (isApproved && adminChangeSummary) {
      await notifyObservationAwaitingApproval(existing.employeeName, actor.name, id);
    }

    // Invalidate observation cache so subsequent GETs reflect the update.
    invalidateCache(OBSERVATIONS_TABLE);

    return Response.json(updated);
  } catch (error) {
    logServerFailure('quality-observations/[id]', 'PUT', error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observations', 'delete');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<QualityObservation>(OBSERVATIONS_TABLE, id);
    if (!existing) return notFoundError('الملاحظة غير موجودة');

    const isApproved = existing.approvalStatus === 'approved';
    // Guard: approved observations cannot be deleted (audit integrity) —
    // EXCEPT the explicit Admin override, allowed only while the month is
    // OPEN (closed-month guard below is absolute).
    if (isApproved && !canModifyApprovedObservation(permCheck.user?.role)) {
      return lockedError('لا يمكن حذف ملاحظة معتمدة');
    }

    // Guard: closed month is immutable — ABSOLUTE, even for Admin.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن حذف ملاحظاته`);
    }

    await deleteRecord(OBSERVATIONS_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: isApproved ? 'admin_delete' : 'delete',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      details: isApproved
        ? `حذف ملاحظة معتمدة بواسطة مدير النظام للموظف ${existing.employeeName} (الشهر ${existing.month} مفتوح)`
        : `حذف ملاحظة جودة للموظف ${existing.employeeName}`,
    });

    // Invalidate observation cache so subsequent GETs reflect the deletion.
    invalidateCache(OBSERVATIONS_TABLE);

    return Response.json({ message: 'تم حذف الملاحظة بنجاح' });
  } catch (error) {
    logServerFailure('quality-observations/[id]', 'DELETE', error);
    return internalError();
  }
}
