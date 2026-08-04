// ══════════════════════════════════════════════════════════════
//  /api/observation-categories/[id]
//
//  PUT   — update a category (manager edit)
//  DELETE — delete a category (manager delete)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeQualityAudit } from '@/lib/audit/server-audit-logger';
import type { ObservationCategory, Priority } from '@/types/quality-kpi';
import { OBSERVATION_CATEGORIES_TABLE } from '@/lib/observation-categories';

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
    const allowed = ['key', 'name', 'defaultPointValue', 'weight', 'color', 'priority', 'isBonusDefault'];
    for (const f of allowed) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    if (patch.defaultPointValue !== undefined) patch.defaultPointValue = Number(patch.defaultPointValue);
    if (patch.weight !== undefined) patch.weight = Number(patch.weight);
    if (patch.priority !== undefined) patch.priority = patch.priority as Priority;

    const updated = await updateRecord(OBSERVATION_CATEGORIES_TABLE, id, patch);
    if (!updated) return notFoundError('التصنيف غير موجود');

    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'category',
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: `تعديل تصنيف: ${existing.name}`,
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

    await deleteRecord(OBSERVATION_CATEGORIES_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeQualityAudit({
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
