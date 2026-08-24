// ══════════════════════════════════════════════════════════════
//  /api/positions — reusable job-title permission templates
//
//  GET  — list positions (organization view permission)
//  POST — create a position (create permission)
//
//  A Position is NOT a User and NOT an Employee: it is a template
//  a user may hold (users.positionId) whose permission map is
//  overlaid by the single resolver (role < position < stored).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  POSITIONS_TABLE,
  findInvalidTemplateKeys,
  type Position, type PositionStatus,
} from '@/lib/organization';

const POSITION_STATUSES: ReadonlySet<string> = new Set(['active', 'archived']);
const NODE_TYPES: ReadonlySet<string> = new Set(['company', 'department', 'team', 'subteam']);

export async function GET(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const positions = await getAll<Position>(POSITIONS_TABLE);
    positions.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ar'));
    return Response.json(positions);
  } catch (error) {
    logServerFailure('positions', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { title, description, permissions, orgTypeHint, status } = body ?? {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return validationError('اسم الوظيفة مطلوب');
    }
    if (status !== undefined && !POSITION_STATUSES.has(status)) {
      return validationError('حالة غير صالحة');
    }
    if (orgTypeHint !== undefined && orgTypeHint !== null && !NODE_TYPES.has(orgTypeHint)) {
      return validationError('نوع عقدة غير صالح');
    }

    let templateJson: string | null = null;
    if (permissions !== undefined && permissions !== null) {
      if (typeof permissions !== 'object' || Array.isArray(permissions)) {
        return validationError('قالب الصلاحيات غير صالح');
      }
      const invalid = findInvalidTemplateKeys(permissions as Record<string, unknown>);
      if (invalid.length > 0) {
        return validationError(`مفاتيح صلاحيات غير صالحة في القالب: ${invalid.join('، ')}`);
      }
      templateJson = JSON.stringify(permissions);
    }

    const actor = await resolveActor(permCheck.user?.id);
    const position = await createRecord<Position>(POSITIONS_TABLE, {
      schemaVersion: 1,
      title: title.trim(),
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
      permissions: templateJson,
      orgTypeHint: orgTypeHint ?? null,
      status: (status || 'active') as PositionStatus,
    });

    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: 'position',
      entityId: position.id,
      monthKey: null,
      after: { title: position.title, permissions: templateJson ? JSON.parse(templateJson) : null },
      details: `إنشاء وظيفة: ${position.title}`,
    });

    return Response.json(position, { status: 201 });
  } catch (error) {
    logServerFailure('positions', 'POST', error);
    return internalError();
  }
}
