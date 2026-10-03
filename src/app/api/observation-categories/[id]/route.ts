// ══════════════════════════════════════════════════════════════
//  /api/observation-categories/[id]  — Master Data mutations
//
//  PUT    — update a category (observationCategories update).
//           Supports the Master Data fields nameEn / isActive /
//           sortOrder / impact alongside the legacy fields.
//           isActive=false = deactivate: the category disappears from
//           NEW-observation selectors only; historical observations
//           and reports are untouched.
//  DELETE — delete a category (observationCategories delete).
//           §NO-HARD-DELETE: a category referenced by historical
//           observations or templates is REJECTED with its usage
//           count — the safe path is deactivation. Only unreferenced
//           records may be hard-deleted.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, deleteRecord, getAll } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, validationError, internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import {
  CATEGORY_IMPACT_VALUES,
  type CategoryImpact,
  type ObservationCategory,
  type Priority,
} from '@/types/quality-kpi';
import { OBSERVATION_CATEGORIES_TABLE } from '@/lib/observation-categories';

/** Transactional tables that reference a category (referential guard). */
const OBSERVATIONS_TABLE = 'qualityObservations';
const TEMPLATES_TABLE = 'observationTemplates';

/** Stable internal code: 2-64 chars of lowercase latin, digits, underscore or dash. */
const KEY_PATTERN = /^[a-z0-9_-]{2,64}$/;

/**
 * True when value is a finite number and >= 0. Rejects NaN, Infinity,
 * -Infinity, non-numeric inputs, and negatives.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Resolve the canonical impact / isBonusDefault pair (impact wins; kept in sync). */
function resolveImpact(
  impactInput: unknown,
  isBonusInput: unknown,
): { impact?: CategoryImpact; isBonusDefault?: boolean; error?: string } {
  if (impactInput !== undefined && !CATEGORY_IMPACT_VALUES.includes(impactInput as CategoryImpact)) {
    return { error: 'قيمة التأثير غير صالحة (POSITIVE أو NEGATIVE أو NEUTRAL)' };
  }
  if (impactInput !== undefined) {
    const impact = impactInput as CategoryImpact;
    return { impact, isBonusDefault: impact === 'POSITIVE' };
  }
  if (isBonusInput !== undefined) {
    return { isBonusDefault: Boolean(isBonusInput) };
  }
  return {};
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observationCategories', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, id);
    if (!existing) return notFoundError('التصنيف غير موجود');

    const body = await request.json();
    const actor = await resolveActor(permCheck.user?.id);

    const patch: Record<string, unknown> = {};
    const allowed = [
      'key', 'name', 'nameEn', 'defaultPointValue', 'weight', 'color',
      'priority', 'isActive', 'sortOrder',
    ];
    for (const f of allowed) {
      if (body[f] !== undefined) patch[f] = body[f];
    }

    // ── Validation ──
    if (patch.key !== undefined) {
      const key = String(patch.key).trim().toLowerCase().replace(/\s+/g, '_');
      if (!KEY_PATTERN.test(key)) {
        return validationError('المعرّف البرمجي يجب أن يكون بأحرف لاتينية صغيرة وأرقام فقط (2-64)');
      }
      if (key !== existing.key) {
        const all = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
        if (all.some((c) => c.key === key && c.id !== id)) {
          return validationError('التصنيف غير صالح: المعرّف البرمجي مستخدم بالفعل');
        }
      }
      patch.key = key;
    }
    if (patch.name !== undefined && !String(patch.name).trim()) {
      return validationError('الاسم مطلوب');
    }
    if (patch.nameEn !== undefined) {
      const nameEn = String(patch.nameEn).trim();
      if (!nameEn) return validationError('الاسم الإنجليزي مطلوب');
      patch.nameEn = nameEn;
    }
    if (patch.isActive !== undefined && typeof patch.isActive !== 'boolean') {
      return validationError('قيمة التفعيل غير صالحة');
    }
    if (patch.sortOrder !== undefined) {
      const sortOrder = Number(patch.sortOrder);
      if (!Number.isInteger(sortOrder) || sortOrder < 0) {
        return validationError('ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب');
      }
      patch.sortOrder = sortOrder;
    }
    if (patch.defaultPointValue !== undefined) {
      patch.defaultPointValue = Number(patch.defaultPointValue);
      if (!isFiniteNonNegative(patch.defaultPointValue)) {
        return validationError('قيمة النقاط الافتراضية يجب أن تكون رقماً موجباً أو صفراً');
      }
    }
    if (patch.weight !== undefined) {
      patch.weight = Number(patch.weight);
      if (!isFiniteNonNegative(patch.weight)) {
        return validationError('الوزن يجب أن يكون رقماً موجباً أو صفراً');
      }
    }
    if (patch.priority !== undefined) patch.priority = patch.priority as Priority;

    // ── Impact / isBonusDefault canonical pair ──
    const impact = resolveImpact(body.impact, body.isBonusDefault);
    if (impact.error) return validationError(impact.error);
    if (impact.impact !== undefined) patch.impact = impact.impact;
    if (impact.isBonusDefault !== undefined) patch.isBonusDefault = impact.isBonusDefault;

    // Uniqueness of the Arabic name among OTHER ACTIVE records.
    if (patch.name !== undefined) {
      const nameTrimmed = String(patch.name).trim();
      const willBeActive = patch.isActive !== undefined ? patch.isActive : existing.isActive !== false;
      if (willBeActive) {
        const all = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
        if (all.some((c) => c.id !== id && c.name.trim() === nameTrimmed && c.isActive !== false)) {
          return validationError('يوجد تصنيف نشط بنفس الاسم العربي');
        }
      }
      patch.name = nameTrimmed;
    }

    const updated = await updateRecord(OBSERVATION_CATEGORIES_TABLE, id, patch);
    if (!updated) return notFoundError('التصنيف غير موجود');

    // ── Audit — deactivation / reactivation get explicit actions ──
    const deactivated = patch.isActive === false && existing.isActive !== false;
    const reactivated = patch.isActive === true && existing.isActive === false;
    const action = deactivated ? 'deactivate' : reactivated ? 'reactivate' : 'update';
    const actionDetails = deactivated
      ? `تعطيل تصنيف: ${existing.name} — يمنع الاستخدام في الملاحظات الجديدة فقط`
      : reactivated
        ? `إعادة تفعيل تصنيف: ${existing.name}`
        : `تعديل تصنيف: ${existing.name}`;

    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action,
      entityType: 'category',
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: actionDetails,
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('observation-categories/[id]', 'PUT', error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observationCategories', 'delete');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, id);
    if (!existing) return notFoundError('التصنيف غير موجود');

    // §NO-HARD-DELETE — referential guard over the canonical records.
    // A referenced category must be deactivated, never destroyed.
    const observations = await getAll<{ categoryId?: string }>(OBSERVATIONS_TABLE);
    const usageCount = observations.filter((o) => o.categoryId === id).length;
    if (usageCount > 0) {
      return validationError(
        `لا يمكن حذف هذا التصنيف: مستخدم في ${usageCount} ملاحظة. استخدم التعطيل بدلاً من الحذف — التعطيل يمنع الاستخدام الجديد فقط ولا يؤثر على السجلات التاريخية.`,
      );
    }
    const templates = await getAll<{ categoryId?: string }>(TEMPLATES_TABLE);
    const templateCount = templates.filter((t) => t.categoryId === id).length;
    if (templateCount > 0) {
      return validationError(
        `لا يمكن حذف هذا التصنيف: ${templateCount} قالب ملاحظات يستخدمه. استخدم التعطيل بدلاً من الحذف.`,
      );
    }

    await deleteRecord(OBSERVATION_CATEGORIES_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'category',
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      details: `حذف تصنيف: ${existing.name}`,
    });

    return Response.json({ message: 'تم حذف التصنيف بنجاح' });
  } catch (error) {
    logServerFailure('observation-categories/[id]', 'DELETE', error);
    return internalError();
  }
}
