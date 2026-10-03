// ══════════════════════════════════════════════════════════════
//  /api/observation-categories  — Master Data: Quality Observation
//  Categories (the SINGLE canonical API for this domain)
//
//  GET   — list categories (observationCategories view).
//          ?withUsage=1 attaches usageCount (observations referencing
//          the category) for the management UI.
//          Default sort: sortOrder, then Arabic name (sortCategories).
//  POST  — create a category (observationCategories create)
//  PUT   — reorder categories (observationCategories update):
//          body { reorder: [id, …] } assigns sortOrder = position+1.
//
//  Categories carry both defaultPointValue AND weight, plus the
//  Master Data fields nameEn / isActive / sortOrder / impact.
//  `isBonusDefault` stays synchronized with impact (POSITIVE ⇔ true)
//  so the existing scoring engine is untouched.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, updateRecords } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import {
  ensureObservationCategoryMasterData, sortCategories,
  OBSERVATION_CATEGORIES_TABLE,
} from '@/lib/observation-categories';
export { OBSERVATION_CATEGORIES_TABLE };
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import {
  CATEGORY_IMPACT_VALUES,
  type CategoryImpact,
  type ObservationCategory,
  type Priority,
} from '@/types/quality-kpi';

/** The transactional table usage counts are computed from. */
const OBSERVATIONS_TABLE = 'qualityObservations';

/** Stable internal code: 2-64 chars of lowercase latin, digits, underscore or dash. */
const KEY_PATTERN = /^[a-z0-9_-]{2,64}$/;

/**
 * True when value is a finite number and >= 0. Rejects NaN, Infinity,
 * -Infinity, non-numeric inputs, and negatives.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** True when value is a finite integer >= 0 (sort order). */
function isFiniteNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Normalize the impact / isBonusDefault pair. impact is canonical;
 * isBonusDefault is kept in sync for the scoring engine. Returns a
 * validation message when impact is out of vocabulary.
 */
function resolveImpact(
  impactInput: unknown,
  isBonusInput: unknown,
): { impact: CategoryImpact; isBonusDefault: boolean; error?: string } {
  if (impactInput !== undefined && !CATEGORY_IMPACT_VALUES.includes(impactInput as CategoryImpact)) {
    return { impact: 'NEGATIVE', isBonusDefault: false, error: 'قيمة التأثير غير صالحة (POSITIVE أو NEGATIVE أو NEUTRAL)' };
  }
  const impact = (impactInput as CategoryImpact | undefined)
    ?? ((isBonusInput === true) ? 'POSITIVE' as CategoryImpact : 'NEGATIVE' as CategoryImpact);
  const isBonusDefault = impactInput !== undefined
    ? impact === 'POSITIVE'
    : Boolean(isBonusInput);
  return { impact, isBonusDefault };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // Gated by the existing 'observationCategories' view permission —
    // the same key the mutations and the Settings → Master Data
    // workspace use.
    const permCheck = await verifyPermission(request, 'observationCategories', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    // Idempotent master-data ensure (bootstrap / additive migration).
    await ensureObservationCategoryMasterData();

    const categories = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);

    // Management UI usage counts — one grouped read of the canonical
    // transactional table, never per-row reads.
    const withUsage = new URL(request.url).searchParams.get('withUsage') === '1';
    let enriched: (ObservationCategory & { usageCount?: number })[] = categories;
    if (withUsage) {
      const observations = await getAll<{ categoryId?: string }>(OBSERVATIONS_TABLE);
      const usage = new Map<string, number>();
      for (const obs of observations) {
        if (obs.categoryId) usage.set(obs.categoryId, (usage.get(obs.categoryId) ?? 0) + 1);
      }
      enriched = categories.map((c) => ({ ...c, usageCount: usage.get(c.id) ?? 0 }));
    }

    return Response.json(sortCategories(enriched));
  } catch (error) {
    logServerFailure('observation-categories', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'observationCategories', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { name, nameEn, defaultPointValue, weight, color, priority, sortOrder } = body;
    const key = typeof body.key === 'string' ? body.key.trim().toLowerCase().replace(/\s+/g, '_') : '';

    if (!key || !name) {
      return validationError('المفتاح والاسم مطلوبان');
    }
    if (!KEY_PATTERN.test(key)) {
      return validationError('المعرّف البرمجي يجب أن يكون بأحرف لاتينية صغيرة وأرقام فقط (2-64)');
    }
    const nameEnTrimmed = typeof nameEn === 'string' ? nameEn.trim() : '';
    if (!nameEnTrimmed) {
      return validationError('الاسم الإنجليزي مطلوب');
    }

    // Validate numeric fields: must be finite and non-negative.
    const pointValueNum = Number(defaultPointValue);
    const weightNum = Number(weight);
    if (!isFiniteNonNegative(pointValueNum)) {
      return validationError('قيمة النقاط الافتراضية يجب أن تكون رقماً موجباً أو صفراً');
    }
    if (!isFiniteNonNegative(weightNum)) {
      return validationError('الوزن يجب أن يكون رقماً موجباً أو صفراً');
    }

    const impact = resolveImpact(body.impact, body.isBonusDefault);
    if (impact.error) return validationError(impact.error);

    // §DUPLICATE-PREVENTION — canonical business identity:
    //  (1) the stable key is unique across ALL records;
    //  (2) no second ACTIVE record may carry the same Arabic name.
    const existing = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
    if (existing.some((c) => c.key === key)) {
      return validationError('التصنيف غير صالح: المعرّف البرمجي مستخدم بالفعل');
    }
    const nameTrimmed = String(name).trim();
    if (existing.some((c) => c.name.trim() === nameTrimmed && c.isActive !== false)) {
      return validationError('يوجد تصنيف نشط بنفس الاسم العربي');
    }

    let effectiveSortOrder: number;
    if (sortOrder !== undefined) {
      if (!isFiniteNonNegativeInt(Number(sortOrder))) {
        return validationError('ترتيب العرض يجب أن يكون رقماً صحيحاً غير سالب');
      }
      effectiveSortOrder = Number(sortOrder);
    } else {
      effectiveSortOrder = existing.reduce((max, c) => Math.max(max, Number(c.sortOrder ?? 0)), 0) + 1;
    }

    const actor = await resolveActor(permCheck.user?.id);

    const category = await createRecord<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, {
      schemaVersion: 1,
      key,
      name: nameTrimmed,
      nameEn: nameEnTrimmed,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder: effectiveSortOrder,
      impact: impact.impact,
      defaultPointValue: pointValueNum,
      weight: weightNum,
      color: color || 'slate',
      priority: (priority || 'medium') as Priority,
      isBonusDefault: impact.isBonusDefault,
    });

    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: 'category',
      entityId: category.id,
      monthKey: null,
      after: { ...category } as Record<string, unknown>,
      details: `إنشاء تصنيف ملاحظات: ${category.name}`,
    });

    return Response.json(category, { status: 201 });
  } catch (error) {
    logServerFailure('observation-categories', 'POST', error);
    return internalError();
  }
}

/**
 * PUT — reorder. Body: { reorder: [id, …] } — the FULL ordered list of
 * category ids. Each position becomes sortOrder = index + 1. Audited
 * as a single "reorder" mutation.
 */
export async function PUT(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'observationCategories', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const reorder: unknown = body?.reorder;
    if (!Array.isArray(reorder) || reorder.some((id) => typeof id !== 'string')) {
      return validationError('صيغة الترتيب غير صالحة');
    }

    const categories = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
    const knownIds = new Set(categories.map((c) => c.id));
    const requestedIds = reorder as string[];
    if (requestedIds.length !== categories.length || requestedIds.some((id) => !knownIds.has(id))) {
      return validationError('قائمة الترتيب يجب أن تحتوي على جميع التصنيفات دون تكرار');
    }

    const updatesById: Record<string, Record<string, unknown>> = {};
    requestedIds.forEach((id, index) => {
      updatesById[id] = { sortOrder: index + 1 };
    });
    await updateRecords(OBSERVATION_CATEGORIES_TABLE, updatesById);

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'reorder',
      entityType: 'category',
      entityId: 'collection',
      monthKey: null,
      after: { order: requestedIds },
      details: 'إعادة ترتيب تصنيفات الملاحظات',
    });

    return Response.json({ message: 'تم تحديث الترتيب' });
  } catch (error) {
    logServerFailure('observation-categories', 'PUT', error);
    return internalError();
  }
}
