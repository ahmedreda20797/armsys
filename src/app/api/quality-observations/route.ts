// ══════════════════════════════════════════════════════════════
//  /api/quality-observations
//
//  GET  — list observations (filtered by month/status/dept/employee/category)
//  POST — create a new quality observation (idempotent via clientRequestId)
//
//  Permission: quality observations view for GET; quality create for
//  POST. All sensitive values (employeeName, department) are resolved
//  server-side — the client can never submit them as trusted values.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { createId } from '@paralleldrive/cuid2';
import { getAll, findWhere, createRecordWithId, sortByDateField, getEmployeeMap, invalidateCache, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { shapeAuditIdentityForViewer } from '@/lib/audit/audit-identity';
import { validationError, unauthorizedError, forbiddenError, internalError, conflictError, lockedError, logServerFailure } from '@/lib/api-error';
import { isValidPoints } from '@/lib/metrics/kpiMetrics';
import { dedupByClientRequest } from '@/lib/idempotency';
import { validateEmployeeActive, validateForeignKeys } from '@/lib/db-validation';
import { isMonthClosed } from '@/lib/month-lock';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { ensureObservationCategoryMasterData } from '@/lib/observation-categories';
import { notifyObservationAwaitingApproval } from '@/lib/notifications/quality-events';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import {
  assertAttachableEvidenceImages,
  evidenceImageItems,
  projectLegacyEvidenceFields,
  sanitizeEvidenceItems,
  stampEvidenceItems,
} from '@/lib/evidence-items';
import { deleteEvidenceObjects, promoteEvidenceImages } from '@/lib/evidence-storage';
import { FirebaseConfigError } from '@/lib/firebase-server';
import type { QualityObservation, ApprovalEvent } from '@/types/quality-kpi';
import type { EvidenceItem } from '@/types';

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

    // M0.2.1: gated by the existing 'observations' view permission —
    // the same key the POST gate and the observations page use.
    const permCheck = await verifyPermission(request, 'observations', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month');
    const status = searchParams.get('status');
    const approvalStatus = searchParams.get('approvalStatus');
    const department = searchParams.get('department');
    const employeeId = searchParams.get('employeeId');
    const categoryId = searchParams.get('categoryId');
    const isBonusParam = searchParams.get('isBonus');

    let records = await getAll<QualityObservation>(OBSERVATIONS_TABLE, TTL.MEDIUM);

    // ── READ SCOPE (M0.5) ──
    // Observations are employee-mandatory records: intersect the
    // authorized employee scope BEFORE month/status/department/employee
    // filters so every downstream filter, count and sort operates only
    // on authorized rows (AUTHORIZED_SCOPE ∩ FILTER, never filter-then-scope).
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx) as typeof records;

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

    // ── §AUDIT-PRIVACY (§2) — WHO registered an observation and WHO
    // decided on it is audit metadata, gated SERVER-SIDE by the
    // canonical 'qualityAuditLog' permission (shared with the
    // discounts route via src/lib/audit/audit-identity.ts). Legacy
    // rows without identity fields pass through untouched.
    const payload = shapeAuditIdentityForViewer(
      records as unknown as Array<Record<string, unknown>>,
      auth.role,
      auth.permissions,
    );
    return Response.json(payload);
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
      evidenceItems,
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

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Observations are employee-linked Quality records: the target
    // employee must be inside the caller's employee scope BEFORE any
    // validation or create. The observation workflow, evidence,
    // points and category logic are unchanged — authorization only.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) return forbiddenError('صلاحية غير كافية');

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

    // Master Data ensure runs before category resolution so a fresh
    // install can never fail FK validation for lack of vocabulary
    // (idempotent — zero writes once converged).
    await ensureObservationCategoryMasterData();

    // Resolve category details (server-side, so weight is authoritative).
    const categories = await getAll<{ id: string; name: string; weight: number; isBonusDefault: boolean; isActive?: boolean }>('observationCategories', TTL.STATIC);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return validationError('التصنيف غير موجود');
    // §MASTER-DATA — deactivated categories disappear from NEW
    // observations (fail-closed server-side; historical records and
    // edits of existing observations are unaffected).
    if (category.isActive === false) {
      return validationError('هذا التصنيف معطّل ولا يمكن استخدامه في ملاحظات جديدة');
    }
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

    // ── §EVIDENCE-ITEMS — normalized multi-item evidence ──
    // Authoritative sanitize; image items must be freshly staged
    // (pending). The legacy single string is PROJECTED from the items
    // so every existing reader stays correct (§17).
    let savedEvidenceItems: EvidenceItem[] | null = null;
    if (evidenceItems !== undefined) {
      const parsedEvidence = sanitizeEvidenceItems(evidenceItems);
      if (!parsedEvidence.ok) return validationError(parsedEvidence.error);
      const attachError = assertAttachableEvidenceImages(parsedEvidence.items, null);
      if (attachError) return validationError(attachError);
      savedEvidenceItems = stampEvidenceItems(parsedEvidence.items, new Date().toISOString(), observerId);
    }
    const legacyEvidence = savedEvidenceItems
      ? (projectLegacyEvidenceFields(savedEvidenceItems, 'required-string').evidence as string)
      : evidence || '';

    // §21 — promote staged images to their final parent-bound paths
    // BEFORE the record write; if the write then fails, the promoted
    // objects are deleted so no orphan survives.
    const recordId = createId();
    let promotedItems = savedEvidenceItems;
    if (savedEvidenceItems && evidenceImageItems(savedEvidenceItems).length > 0) {
      try {
        promotedItems = await promoteEvidenceImages(OBSERVATIONS_TABLE, recordId, savedEvidenceItems);
      } catch (error) {
        if (error instanceof FirebaseConfigError) {
          return Response.json({ error: error.message, errorKey: 'FIREBASE_CONFIG' }, { status: 503 });
        }
        logServerFailure('quality-observations', 'POST', error);
        return Response.json({ error: 'فشل حفظ أدلة الصورة — حاول مرة أخرى' }, { status: 500 });
      }
    }

    let observation: QualityObservation;
    try {
      observation = await createRecordWithId<QualityObservation>(OBSERVATIONS_TABLE, recordId, {
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
        evidence: legacyEvidence,
        evidenceItems: promotedItems ?? null,
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
    } catch (error) {
      if (promotedItems) {
        void deleteEvidenceObjects(evidenceImageItems(promotedItems).map((i) => i.image!.storagePath));
      }
      throw error;
    }

    // ── Audit + notification + automation (fire-and-forget, never block) ──
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

    // §13: record_created event — active quality-module rules with this
    // trigger now actually execute (engine handles throttle + logs).
    void dispatchAutomationEvent('record_created', 'quality', {
      employeeId,
      employeeName,
      department,
      status: approvalStatus,
      severity: severity || 'medium',
      category: categoryName,
      sourceRecordId: observation.id,
      extra: { points: effectivePoints, isBonus: effectiveIsBonus },
    });

    // Invalidate observation cache so subsequent GETs reflect the new record.
    invalidateCache(OBSERVATIONS_TABLE);

    return Response.json(observation, { status: 201 });
  } catch (error) {
    logServerFailure('quality-observations', 'POST', error);
    return internalError();
  }
}
