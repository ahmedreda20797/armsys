// ══════════════════════════════════════════════════════════════
//  /api/observation-templates
//
//  GET  — list templates (requireAuth; includes favorites + recently used)
//  POST — create a template (quality create)
//
//  Templates pre-fill observation forms. They only seed the form;
//  the created observation stores its own values.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, sortByField, sortByDateField, TTL } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { validateForeignKeys } from '@/lib/db-validation';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { ObservationTemplate, Severity } from '@/types/quality-kpi';

export const TEMPLATES_TABLE = 'observationTemplates';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { searchParams } = new URL(request.url);
    const sort = searchParams.get('sort'); // 'recent' | 'favorites' | undefined

    let templates = await getAll<ObservationTemplate>(TEMPLATES_TABLE, TTL.STATIC);

    if (sort === 'recent') {
      templates = sortByField(templates, 'usageCount', 'desc');
    } else if (sort === 'favorites') {
      const userId = auth.userId;
      templates = templates.filter((t) => t.favoriteUserIds?.includes(userId));
    } else {
      templates = sortByDateField(templates, 'createdAt', 'desc');
    }

    return Response.json(templates);
  } catch (error) {
    logServerFailure('observation-templates', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'observationTemplates', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { title, categoryId, defaultPoints, isBonus, defaultNotes, correctiveAction, severity } = body;

    if (!title || !categoryId) {
      return validationError('العنوان والتصنيف مطلوبان');
    }

    // Validate category FK.
    const fkValidation = await validateForeignKeys([
      { table: 'observationCategories', id: categoryId, label: 'التصنيف' },
    ]);
    if (!fkValidation.valid) return validationError(fkValidation.error!);

    // Resolve category name server-side.
    const categories = await getAll<{ id: string; name: string }>('observationCategories', TTL.STATIC);
    const category = categories.find((c) => c.id === categoryId);
    if (!category) return validationError('التصنيف غير موجود');

    const actor = await resolveActor(permCheck.user?.id);

    const template = await createRecord<ObservationTemplate>(TEMPLATES_TABLE, {
      schemaVersion: 1,
      title,
      categoryId,
      categoryName: category.name,
      defaultPoints: Number(defaultPoints) || 0,
      isBonus: Boolean(isBonus),
      defaultNotes: defaultNotes || '',
      correctiveAction: correctiveAction || '',
      severity: (severity || 'medium') as Severity,
      favoriteUserIds: [],
      usageCount: 0,
      createdById: actor.id,
      createdByName: actor.name,
    });

    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: 'template',
      entityId: template.id,
      monthKey: null,
      after: { ...template } as Record<string, unknown>,
      details: `إنشاء قالب ملاحظة: ${title}`,
    });

    return Response.json(template, { status: 201 });
  } catch (error) {
    logServerFailure('observation-templates', 'POST', error);
    return internalError();
  }
}
