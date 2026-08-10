// ══════════════════════════════════════════════════════════════
//  /api/observation-categories
//
//  GET  — list all categories (requireAuth)
//  POST — create a category (manager create)
//
//  Categories carry both defaultPointValue AND weight.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, sortByField } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { seedCategoriesIfEmpty, OBSERVATION_CATEGORIES_TABLE } from '@/lib/observation-categories';
export { OBSERVATION_CATEGORIES_TABLE };
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { ObservationCategory, Priority } from '@/types/quality-kpi';

/**
 * True when value is a finite number and >= 0. Rejects NaN, Infinity,
 * -Infinity, non-numeric inputs, and negatives.
 */
function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // Seed defaults on first read (idempotent).
    await seedCategoriesIfEmpty();

    const categories = await getAll<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE);
    const sorted = sortByField(categories, 'name', 'asc');
    return Response.json(sorted);
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
    const { key, name, defaultPointValue, weight, color, priority, isBonusDefault } = body;

    if (!key || !name) {
      return validationError('المفتاح والاسم مطلوبان');
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

    const actor = await resolveActor(permCheck.user?.id);

    const category = await createRecord<ObservationCategory>(OBSERVATION_CATEGORIES_TABLE, {
      schemaVersion: 1,
      key,
      name,
      defaultPointValue: pointValueNum,
      weight: weightNum,
      color: color || 'slate',
      priority: (priority || 'medium') as Priority,
      isBonusDefault: Boolean(isBonusDefault),
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
      details: `إنشاء تصنيف ملاحظات: ${name}`,
    });

    return Response.json(category, { status: 201 });
  } catch (error) {
    logServerFailure('observation-categories', 'POST', error);
    return internalError();
  }
}
