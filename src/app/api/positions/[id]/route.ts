// ══════════════════════════════════════════════════════════════
//  /api/positions/[id]
//
//  PUT    — update title / description / template / status
//  DELETE — remove a position NO user holds (referenced positions
//           block deletion — no silent permission changes for the
//           users holding them)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord, deleteRecord, findWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, notFoundError,
  internalError, logServerFailure, conflictError,
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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const position = await getById<Position>(POSITIONS_TABLE, id);
    if (!position) return notFoundError('الوظيفة غير موجودة');

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    if (body.title !== undefined && body.title !== position.title) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return validationError('اسم الوظيفة مطلوب');
      }
      before.title = position.title; updates.title = body.title.trim();
    }
    if (body.description !== undefined && body.description !== position.description) {
      before.description = position.description;
      updates.description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
    }
    if (body.status !== undefined && body.status !== position.status) {
      if (!POSITION_STATUSES.has(body.status)) return validationError('حالة غير صالحة');
      before.status = position.status; updates.status = body.status as PositionStatus;
    }
    if (body.orgTypeHint !== undefined && body.orgTypeHint !== position.orgTypeHint) {
      if (body.orgTypeHint !== null && !NODE_TYPES.has(body.orgTypeHint)) {
        return validationError('نوع عقدة غير صالح');
      }
      before.orgTypeHint = position.orgTypeHint; updates.orgTypeHint = body.orgTypeHint ?? null;
    }
    if (body.permissions !== undefined) {
      if (body.permissions === null) {
        before.permissions = position.permissions;
        updates.permissions = null;
      } else {
        if (typeof body.permissions !== 'object' || Array.isArray(body.permissions)) {
          return validationError('قالب الصلاحيات غير صالح');
        }
        const invalid = findInvalidTemplateKeys(body.permissions as Record<string, unknown>);
        if (invalid.length > 0) {
          return validationError(`مفاتيح صلاحيات غير صالحة في القالب: ${invalid.join('، ')}`);
        }
        before.permissions = position.permissions;
        updates.permissions = JSON.stringify(body.permissions);
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, unchanged: true });
    }

    await updateRecord(POSITIONS_TABLE, id, updates);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'position',
      entityId: id,
      monthKey: null,
      before,
      after: updates,
      details: `تعديل وظيفة: ${updates.title ?? position.title}`,
    });

    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('positions/[id]', 'PUT', error);
    return internalError();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'delete');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const position = await getById<Position>(POSITIONS_TABLE, id);
    if (!position) return notFoundError('الوظيفة غير موجودة');

    const holders = await findWhere<{ id: string }>('users', { positionId: id });
    if (holders.length > 0) {
      return conflictError(`${holders.length} مستخدم يشغل هذه الوظيفة — أفرغها أولاً`);
    }

    await deleteRecord(POSITIONS_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'position',
      entityId: id,
      monthKey: null,
      before: { title: position.title },
      details: `حذف وظيفة: ${position.title}`,
    });

    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('positions/[id]', 'DELETE', error);
    return internalError();
  }
}
