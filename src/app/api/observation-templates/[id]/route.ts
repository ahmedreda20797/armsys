// ══════════════════════════════════════════════════════════════
//  /api/observation-templates/[id]
//
//  PUT    — update a template (quality update)
//  DELETE — delete a template (quality delete)
//  PATCH  — toggle favorite / increment usage (requireAuth, per-user)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, deleteRecord, getAll, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, notFoundError, validationError, internalError, logServerFailure,
} from '@/lib/api-error';
import { validateForeignKeys } from '@/lib/db-validation';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { ObservationTemplate, Severity } from '@/types/quality-kpi';
import { TEMPLATES_TABLE } from '../route';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observationTemplates', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<ObservationTemplate>(TEMPLATES_TABLE, id);
    if (!existing) return notFoundError('القالب غير موجود');

    const body = await request.json();
    const patch: Record<string, unknown> = {};
    const allowed = ['title', 'categoryId', 'categoryName', 'defaultPoints', 'isBonus', 'defaultNotes', 'correctiveAction', 'severity'];
    for (const f of allowed) {
      if (body[f] !== undefined) patch[f] = body[f];
    }
    if (patch.defaultPoints !== undefined) patch.defaultPoints = Number(patch.defaultPoints);
    if (patch.severity !== undefined) patch.severity = patch.severity as Severity;

    // When categoryId is supplied, validate the FK and resolve the
    // authoritative categoryName server-side. The client may never
    // store a mismatched (categoryId=A, categoryName=B) pair.
    if (patch.categoryId !== undefined) {
      const fkValidation = await validateForeignKeys([
        { table: 'observationCategories', id: String(patch.categoryId), label: 'التصنيف' },
      ]);
      if (!fkValidation.valid) return validationError(fkValidation.error!);

      const categories = await getAll<{ id: string; name: string }>('observationCategories', TTL.STATIC);
      const category = categories.find((c) => c.id === patch.categoryId);
      if (!category) return validationError('التصنيف غير موجود');
      patch.categoryName = category.name;
    }

    const updated = await updateRecord(TEMPLATES_TABLE, id, patch);
    if (!updated) return notFoundError('القالب غير موجود');

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'template',
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      after: { ...updated } as Record<string, unknown>,
      details: `تعديل قالب: ${existing.title}`,
    });

    return Response.json(updated);
  } catch (error) {
    logServerFailure('observation-templates/[id]', 'PUT', error);
    return internalError();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return forbiddenError();

    const { id } = await params;
    const existing = await getById<ObservationTemplate>(TEMPLATES_TABLE, id);
    if (!existing) return notFoundError('القالب غير موجود');

    const body = await request.json();
    const action: string = body.action; // 'toggle_favorite' | 'increment_usage'
    const userId = auth.userId;

    if (action === 'toggle_favorite') {
      const favorites = existing.favoriteUserIds || [];
      const newFavorites = favorites.includes(userId)
        ? favorites.filter((u) => u !== userId)
        : [...favorites, userId];
      const updated = await updateRecord(TEMPLATES_TABLE, id, { favoriteUserIds: newFavorites });
      return Response.json(updated);
    }

    if (action === 'increment_usage') {
      const updated = await updateRecord(TEMPLATES_TABLE, id, {
        usageCount: (existing.usageCount || 0) + 1,
      });
      return Response.json(updated);
    }

    return Response.json(existing);
  } catch (error) {
    logServerFailure('observation-templates/[id]', 'PATCH', error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'observationTemplates', 'delete');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const existing = await getById<ObservationTemplate>(TEMPLATES_TABLE, id);
    if (!existing) return notFoundError('القالب غير موجود');

    await deleteRecord(TEMPLATES_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'template',
      entityId: id,
      monthKey: null,
      before: { ...existing } as Record<string, unknown>,
      details: `حذف قالب: ${existing.title}`,
    });

    return Response.json({ message: 'تم حذف القالب بنجاح' });
  } catch (error) {
    logServerFailure('observation-templates/[id]', 'DELETE', error);
    return internalError();
  }
}
