// ══════════════════════════════════════════════════════════════
//  /api/organization/[id]
//
//  PUT    — rename / retype / assign manager / reorder / archive
//  DELETE — remove an EMPTY node (children or members block it)
//
//  Structural moves are NOT handled here — they go through
//  /api/organization/move (validation + impact preview + audit).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, notFoundError,
  internalError, logServerFailure, conflictError,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  ORG_NODES_TABLE,
  buildOrgIndex,
  groupEmployeesByNode,
  type OrgNode,
  type OrgNodeType,
  type OrgNodeStatus,
} from '@/lib/organization';

const NODE_TYPES: ReadonlySet<string> = new Set(['company', 'department', 'team', 'subteam']);
const NODE_STATUSES: ReadonlySet<string> = new Set(['active', 'archived']);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id } = await params;
    const node = await getById<OrgNode>(ORG_NODES_TABLE, id);
    if (!node) return notFoundError('العقدة غير موجودة');

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return validationError('اسم العقدة مطلوب');
      }
      if (body.name.trim() !== node.name) { before.name = node.name; updates.name = body.name.trim(); }
    }
    if (body.type !== undefined && body.type !== node.type) {
      if (!NODE_TYPES.has(body.type)) {
        return validationError('نوع عقدة غير صالح');
      }
      before.type = node.type; updates.type = body.type as OrgNodeType;
    }
    if (body.status !== undefined && body.status !== node.status) {
      if (!NODE_STATUSES.has(body.status)) {
        return validationError('حالة عقدة غير صالح');
      }
      before.status = node.status; updates.status = body.status as OrgNodeStatus;
    }
    if (body.description !== undefined && body.description !== node.description) {
      before.description = node.description;
      updates.description = typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null;
    }
    if (body.order !== undefined && body.order !== node.order) {
      if (typeof body.order !== 'number' || !Number.isFinite(body.order)) {
        return validationError('الترتيب يجب أن يكون رقماً');
      }
      before.order = node.order; updates.order = body.order;
    }
    if (body.managerUserId !== undefined) {
      const nextManagerId = body.managerUserId || null;
      if (nextManagerId !== node.managerUserId) {
        let managerUserName: string | null = null;
        if (nextManagerId) {
          const manager = await getById<{ id: string; name: string }>('users', nextManagerId);
          if (!manager) return validationError('المدير المحدد غير موجود');
          managerUserName = manager.name;
        }
        before.managerUserId = node.managerUserId;
        updates.managerUserId = nextManagerId;
        updates.managerUserName = managerUserName;
      }
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ success: true, unchanged: true });
    }

    await updateRecord(ORG_NODES_TABLE, id, updates);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'orgNode',
      entityId: id,
      monthKey: null,
      before,
      after: updates,
      details: `تعديل عقدة تنظيمية: ${updates.name ?? node.name}`,
    });

    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('organization/[id]', 'PUT', error);
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
    const node = await getById<OrgNode>(ORG_NODES_TABLE, id);
    if (!node) return notFoundError('العقدة غير موجودة');

    const [nodes, employees] = await Promise.all([
      getAll<OrgNode>(ORG_NODES_TABLE),
      getAll<{ id: string; orgNodeId?: string | null }>('employees'),
    ]);
    const index = buildOrgIndex(nodes);
    const byNode = groupEmployeesByNode(employees);

    const children = index.childrenOf.get(id) ?? [];
    if (children.length > 0) {
      return conflictError('لا يمكن حذف عقدة لها عقد فرعية — انقل أو احذف الفروع أولاً');
    }
    if ((byNode.get(id) ?? []).length > 0) {
      return conflictError('لا يمكن حذف عقدة بها موظفون — انقل الموظفين أولاً');
    }

    await deleteRecord(ORG_NODES_TABLE, id);

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'orgNode',
      entityId: id,
      monthKey: null,
      before: { name: node.name, type: node.type, parentId: node.parentId },
      details: `حذف عقدة تنظيمية: ${node.name}`,
    });

    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('organization/[id]', 'DELETE', error);
    return internalError();
  }
}
