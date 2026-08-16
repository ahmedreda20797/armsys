// ══════════════════════════════════════════════════════════════
//  /api/quality-observations
//
//  GET  — list observations (filtered by month/status/dept/employee/category)
//  POST — create a new quality observation (idempotent via clientRequestId)
//
//  Permission: quality create for POST; requireAuth for GET.
//  All sensitive values (employeeName, department) are resolved
//  server-side — the client can never submit them as trusted values.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, findWhere, createRecord, sortByDateField, getEmployeeMap, invalidateCache, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { validationError, unauthorizedError, forbiddenError, internalError, conflictError, lockedError, logServerFailure } from '@/lib/api-error';
import { isValidPoints } from '@/lib/metrics/kpiMetrics';
import { dedupByClientRequest } from '@/lib/idempotency';
import { validateEmployeeActive, validateForeignKeys } from '@/lib/db-validation';
import { isMonthClosed } from '@/lib/month-lock';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { notifyObservationAwaitingApproval } from '@/lib/notifications/quality-events';
import type { QualityObservation, ApprovalEvent } from '@/types/quality-kpi';

export const OBSERVATIONS_TABLE = 'qualityObservations';

/** Derive a YYYY-MM month key from a DD/MM/YYYY date string. */
export function deriveMonth(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}`;
  }
  // Fallback: try ISO or YYYY-MM
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const status = searchParams.get('status');
    const approvalStatus = searchParams.get('approvalStatus');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');
    const categoryId = searchParams.get('categoryId');
    const isBonusParam = searchParams.get('isBonus');

    let records = await getAll<QualityObservation>(OBSERVATIONS_TABLE, TTL.MEDIUM);

    // Apply filters (server-side, linear pass per filter — combined where possible).
    if (month) records = records.filter((r) => r.month === month);
    if (status) records = records.filter((r) => r.status === status);
    if (approvalStatus) records = records.filter((r) => r.approvalStatus === approvalStatus);
    if (department) records = records.filter((r) => r.department === department);
    if (employeeId) records = records.filter((r) => r.employeeId === employeeId);
    if (categoryId) records = records.filter((r) => r.categoryId === categoryId);
    if (isBonusParam === 'true') records = records.filter((r) => r.isBonus === true);
    if (isBonusParam === 'false') records = records.filter((r) => r.isBonus === false);

    records = sortByDateField(records, 'createdAt', 'desc');
    return Response.json(records);
  } catch (error) {
    logServerFailure('quality-observations', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'observations', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const {
      employeeId,
      observationDate,
      type,
      severity,
      categoryId,
      notes,
      evidence,
      status,
      relatedCapaId,
      correctiveAction,
      dueDate,
      resolvedDate,
      applyPointDeduction,
      points,
      isBonus,
      clientRequestId,
    } = body;

    // ── Validate required fields ──
    if (!employeeId || !observationDate || !type || !categoryId) {
      return validationError('الموظف والتاريخ والنوع والتصنيف مطلوبة');
    }

    // ── Guard: cannot create observations in a closed month (Milestone 5 §10) ──
    // Reuses the existing month-lock mechanism from Milestone 4.
    const month = deriveMonth(observationDate);
    if (await isMonthClosed(month)) {
      return lockedError(`الشهر ${month} مغلق ولا يمكن إضافة ملاحظات عليه`);
    }

    // ── Idempotency check (prevents duplicate from retries/double-clicks) ──
    if (clientRequestId) {
      const dupCheck = await dedupByClientRequest<QualityObservation>(OBSERVATIONS_TABLE, clientRequestId);
      if (dupCheck.isDuplicate) {
        // Return the original record transparently (idempotent).
        return Response.json(dupCheck.existing, { status: 200 });
      }
    }

    // ── Validate employee is active ──
    const empValidation = await validateEmployeeActive(employeeId);
    if (!empValidation.valid) return validationError(empValidation.error!);

    // ── Validate foreign keys (category, optional CAPA) ──
    const fkRefs: Array<{ table: string; id: string; label: string }> = [
      { table: 'observationCategories', id: categoryId, label: 'التصنيف' },
    ];
    if (relatedCapaId) {
      fkRefs.push({ table: 'capaCases', id: relatedCapaId, label: 'حالة الكابا' });
    }
    const fkValidation = await validateForeignKeys(fkRefs);
    if (!fkValidation.valid) return validationError(fkValidation.error!);

    // ── Resolve all sensitive values SERVER-SIDE (never trust client) ──
    const empMap = await getEmployeeMap();
    const emp = empMap.get(employeeId);
    const employeeName = emp?.name || 'غير معروف';
    const department = emp?.department || 'غير محدد';
    const positionSnapshot = emp?.position || '';

    // Resolve category details (server-side, so weight is authoritative).
    const categories = await getAll<{ id: string; name: string; weight: number; isBonusDefault: boolean }>('observationCategories', TTL.STATIC);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return validationError('التصنيف غير موجود');
    const categoryName = category.name;
    const categoryWeight = category.weight;

    // Resolve observer (actor) server-side.
    const actor = await resolveActor(permCheck.user?.id);
    const observerId = actor.id;
    const observerName = actor.name;

    // ── Determine point eligibility ──
    const wantsPoints = applyPointDeduction === true;
    // Default isBonus from category if not explicitly provided.
    const effectiveIsBonus = isBonus !== undefined ? Boolean(isBonus) : Boolean(category.isBonusDefault);
    // Points default: when applying deduction and no explicit points, use category default.
    const categoriesWithDefaults = await getAll<{ id: string; defaultPointValue: number }>('observationCategories', TTL.STATIC);
    const catDefault = categoriesWithDefaults.find((c) => c.id === categoryId);
    const effectivePoints = wantsPoints ? Number(points ?? catDefault?.defaultPointValue ?? 0) : 0;

    // ── Validate points: must be finite and non-negative ──
    if (wantsPoints && !isValidPoints(effectivePoints)) {
      return validationError('قيمة النقاط غير صالحة (يجب أن تكون رقم موجب أو صفر)');
    }

    // ── Build approval history (append-only) ──
    let approvalHistory: ApprovalEvent[] = [];
    let approvalStatus: QualityObservation['approvalStatus'] = 'pending';
    if (wantsPoints) {
      const submitEvent = makeApprovalEvent({
        action: 'submit',
        actorId: observerId,
        actorName: observerName,
        notes: 'إرسال للاعتماد',
      });
      approvalHistory = appendApprovalEvent(approvalHistory, submitEvent);
      approvalStatus = projectLatestApprovalStatus(approvalHistory);
    }

    // ── Build audit log ──
    const auditEvent = makeAuditEvent({
      action: 'create',
      actorId: observerId,
      actorName: observerName,
      details: 'إنشاء ملاحظة جودة',
    });

    const observation = await createRecord<QualityObservation>(OBSERVATIONS_TABLE, {
      schemaVersion: 1,
      employeeId,
      employeeName,
      department,
      positionSnapshot,
      observerId,
      observerName,
      observationDate,
      month,
      type,
      severity: severity || 'medium',
      categoryId,
      categoryName,
      categoryWeight,
      notes: notes || '',
      evidence: evidence || '',
      status: status || 'open',
      relatedCapaId: relatedCapaId || null,
      correctiveAction: correctiveAction || '',
      dueDate: dueDate || null,
      resolvedDate: resolvedDate || null,
      applyPointDeduction: wantsPoints,
      points: effectivePoints,
      isBonus: effectiveIsBonus,
      approvalStatus,
      approvalHistory,
      auditLog: [auditEvent],
      createdById: observerId,
      createdByName: observerName,
      clientRequestId: clientRequestId || null,
    });

    // ── Audit + notification (fire-and-forget, never block) ──
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: observerId,
      actorName: observerName,
      action: 'create',
      entityType: 'observation',
      entityId: observation.id,
      monthKey: month,
      after: { ...observation } as Record<string, unknown>,
      details: `إنشاء ملاحظة جودة للموظف ${employeeName}`,
    });

    if (wantsPoints) {
      await notifyObservationAwaitingApproval(employeeName, observerName, observation.id);
    }

    // Invalidate observation cache so subsequent GETs reflect the new record.
    invalidateCache(OBSERVATIONS_TABLE);

    return Response.json(observation, { status: 201 });
  } catch (error) {
    logServerFailure('quality-observations', 'POST', error);
    return internalError();
  }
}
