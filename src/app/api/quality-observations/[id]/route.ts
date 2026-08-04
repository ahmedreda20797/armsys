// ══════════════════════════════════════════════════════════════
//  /api/quality-observations/[id]
//
//  GET    — fetch a single observation
//  PUT    — update an observation (blocked if approved or month closed)
//  DELETE — delete an observation (blocked if approved or month closed)
//
//  Permission: quality update/delete for mutations; requireAuth for GET.
//  Guards preserve historical immutability and approval integrity.
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
import { makeRecordAuditEvent, writeQualityAudit } from '@/lib/audit/server-audit-logger';
import { getEmployeeMap, TTL } from '@/lib/db';
import type { QualityObservation } from '@/types/quality-kpi';
import { OBSERVATIONS_TABLE } from '../route';

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

    // Guard: approved observations cannot be edited (preserve approval integrity).
    if (existing.approvalStatus === 'approved') {
      return lockedError('لا يمكن تعديل ملاحظة معتمدة');
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن تعديل ملاحظاته`);
    }

    const body = await request.json();
    const actor = await resolveActor(permCheck.user?.id);

    // Resolve employee fields server-side if employeeId changed.
    let employeeName = existing.employeeName;
    let department = existing.department;
    let positionSnapshot = existing.positionSnapshot;
    if (body.employeeId && body.employeeId !== existing.employeeId) {
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

    // Append audit event.
    const auditEvent = makeRecordAuditEvent({
      action: 'update',
      actorId: actor.id,
      actorName: actor.name,
      details: 'تعديل ملاحظة الجودة',
    });
    patch.auditLog = [...(existing.auditLog || []), auditEvent];

    const updated = await updateRecord(OBSERVATIONS_TABLE, id, patch);
    if (!updated) return notFoundError('الملاحظة غير موجودة');

    // Audit trail (fire-and-forget).
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: `تعديل ملاحظة جودة للموظف ${employeeName}`,
    });

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

    // Guard: approved observations cannot be deleted (audit integrity).
    if (existing.approvalStatus === 'approved') {
      return lockedError('لا يمكن حذف ملاحظة معتمدة');
    }

    // Guard: closed month is immutable.
    if (await isMonthClosed(existing.month)) {
      return lockedError(`الشهر ${existing.month} مغلق ولا يمكن حذف ملاحظاته`);
    }

    await deleteRecord(OBSERVATIONS_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'observation',
      entityId: id,
      monthKey: existing.month,
      before: { ...existing } as Record<string, unknown>,
      details: `حذف ملاحظة جودة للموظف ${existing.employeeName}`,
    });

    return Response.json({ message: 'تم حذف الملاحظة بنجاح' });
  } catch (error) {
    logServerFailure('quality-observations/[id]', 'DELETE', error);
    return internalError();
  }
}
