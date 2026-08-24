// ══════════════════════════════════════════════════════════════
//  /api/organization
//
//  GET  — the organization tree + membership (view permission)
//  POST — create a node (create permission)
//
//  The organization page is admin-only by default (safe default);
//  grants flow through the regular permission editor.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, createRecord, countWhere } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  validationError, unauthorizedError, forbiddenError,
  internalError, logServerFailure, conflictError,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import {
  ORG_NODES_TABLE,
  POSITIONS_TABLE,
  MAX_ORG_DEPTH,
  buildOrgIndex,
  buildOrgTree,
  groupEmployeesByNode,
  type OrgNode,
  type OrgNodeType,
  type OrgNodeStatus,
  type Position,
} from '@/lib/organization';

const NODE_TYPES: ReadonlySet<string> = new Set(['company', 'department', 'team', 'subteam']);
const NODE_STATUSES: ReadonlySet<string> = new Set(['active', 'archived']);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'organization', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const [nodes, employees, users, positions] = await Promise.all([
      getAll<OrgNode>(ORG_NODES_TABLE),
      getAll<{ id: string; name: string | null; code: string | null; orgNodeId?: string | null }>('employees'),
      getAll<{ id: string; name: string; role: string; positionId?: string | null; linkedEmployeeId?: string | null }>('users'),
      getAll<Position>(POSITIONS_TABLE),
    ]);

    const index = buildOrgIndex(nodes);
    const byNode = groupEmployeesByNode(employees);

    return Response.json({
      tree: buildOrgTree(index, byNode),
      nodes: index.orderedIds.map((id) => index.byId.get(id)!),
      employees: employees.map((e) => ({
        id: e.id,
        name: e.name,
        code: e.code ?? null,
        orgNodeId: e.orgNodeId ?? null,
      })),
      unassignedEmployeeCount: employees.filter((e) => !e.orgNodeId).length,
      // Minimal user list for the manager picker + the User Access
      // tab (position assignment / employee linking). Includes each
      // user's current access links so the tab renders truthfully.
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role,
        positionId: u.positionId ?? null,
        positionTitle: positions.find((pos) => pos.id === u.positionId)?.title ?? null,
        linkedEmployeeId: u.linkedEmployeeId ?? null,
      })),
    });
  } catch (error) {
    logServerFailure('organization', 'GET', error);
    return internalError();
  }
}

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'create');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { name, type, parentId, managerUserId, order, description } = body ?? {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      return validationError('اسم العقدة مطلوب');
    }
    if (!NODE_TYPES.has(type)) {
      return validationError('نوع العقدة يجب أن يكون: شركة / قسم / فريق / فريق فرعي');
    }

    const nodes = await getAll<OrgNode>(ORG_NODES_TABLE);
    const index = buildOrgIndex(nodes);

    // Exactly one company node may exist — it is the tree root.
    if (type === 'company') {
      const companyCount = await countWhere(ORG_NODES_TABLE, { type: 'company' });
      if (companyCount > 0) {
        return conflictError('توجد عقدة شركة بالفعل — الهيكل له جذر واحد');
      }
    }

    let parentNode: OrgNode | null = null;
    if (parentId) {
      parentNode = index.byId.get(parentId) ?? null;
      if (!parentNode) return validationError('العقدة الأصل غير موجودة');
      if (parentNode.status === 'archived') {
        return validationError('لا يمكن الإضافة تحت عقدة مؤرشفة');
      }
      const parentDepth = index.depthOf.get(parentNode.id) ?? 0;
      if (parentDepth + 1 > MAX_ORG_DEPTH) {
        return validationError(`العمق الأقصى للهيكل هو ${MAX_ORG_DEPTH} مستويات`);
      }
    } else if (type !== 'company') {
      return validationError('القسم يجب أن يتبع عقدة أصل (الشركة)');
    }

    let managerUserName: string | null = null;
    if (managerUserId) {
      const manager = (await getAll<{ id: string; name: string }>('users'))
        .find((u) => u.id === managerUserId) ?? null;
      if (!manager) return validationError('المدير المحدد غير موجود');
      managerUserName = manager.name;
    }

    const actor = await resolveActor(permCheck.user?.id);
    const node = await createRecord<OrgNode>(ORG_NODES_TABLE, {
      schemaVersion: 1,
      name: name.trim(),
      type: type as OrgNodeType,
      parentId: parentNode?.id ?? null,
      managerUserId: managerUserId || null,
      managerUserName,
      status: 'active' as OrgNodeStatus,
      order: typeof order === 'number' && Number.isFinite(order) ? order : 0,
      description: typeof description === 'string' && description.trim() ? description.trim() : null,
    });

    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'create',
      entityType: 'orgNode',
      entityId: node.id,
      monthKey: null,
      after: { name: node.name, type: node.type, parentId: node.parentId, managerUserId: node.managerUserId },
      details: `إنشاء عقدة تنظيمية: ${node.name}`,
    });

    return Response.json(node, { status: 201 });
  } catch (error) {
    logServerFailure('organization', 'POST', error);
    return internalError();
  }
}
