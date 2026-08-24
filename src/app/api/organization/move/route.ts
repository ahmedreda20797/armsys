// ══════════════════════════════════════════════════════════════
//  /api/organization/move — restructure the tree safely
//
//  POST { nodeId, newParentId }:
//    1. cycle + depth + status validation (validateMoveNode)
//    2. impact preview recorded in the audit entry
//    3. single-field patch (parentId) — historical data untouched
//    4. managers inside the moved subtree are NOTIFIED through the
//       central router (organization-aware notifications)
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, getById, updateRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, notFoundError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import { fireRoutedNotification } from '@/lib/notifications/routing';
import {
  ORG_NODES_TABLE,
  buildOrgIndex,
  groupEmployeesByNode,
  previewOrgImpact,
  validateMoveNode,
  type OrgNode,
} from '@/lib/organization';

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { nodeId, newParentId } = body ?? {};
    if (!nodeId || typeof nodeId !== 'string') {
      return validationError('معرّف العقدة مطلوب');
    }
    if (newParentId !== null && (typeof newParentId !== 'string')) {
      return validationError('معرّف العقدة الأصل غير صالح');
    }

    const [nodes, employees] = await Promise.all([
      getAll<OrgNode>(ORG_NODES_TABLE),
      getAll<{ id: string; orgNodeId?: string | null }>('employees'),
    ]);
    const index = buildOrgIndex(nodes);
    const byNode = groupEmployeesByNode(employees);

    const node = index.byId.get(nodeId);
    if (!node) return notFoundError('العقدة غير موجودة');

    const validation = validateMoveNode(index, nodeId, newParentId ?? null);
    if (!validation.ok) return validationError(validation.reason);

    const impact = previewOrgImpact(index, nodeId, byNode);

    await updateRecord(ORG_NODES_TABLE, nodeId, { parentId: newParentId ?? null });

    const actor = await resolveActor(permCheck.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'move',
      entityType: 'orgNode',
      entityId: nodeId,
      monthKey: null,
      before: { parentId: node.parentId },
      after: { parentId: newParentId ?? null },
      details: `نقل عقدة "${node.name}"${impact ? ` — التأثير: ${impact.employeeCount} موظف، ${impact.subtreeNodeCount} عقدة` : ''}`,
    });

    // Organization-aware notification: managers affected by the move
    // (inside the subtree + up the old chain) are notified through
    // the central router, never a hardcoded recipient list.
    if (impact && impact.managerUserIds.length > 0) {
      await fireRoutedNotification({
        title: `تغيير هيكلي: نقل "${node.name}"`,
        description: `تم نقل "${node.name}" إلى عقدة أخرى — ${impact.employeeCount} موظفاً ضمن نطاق جديد.`,
        priority: 'medium',
        sourceRecordId: nodeId,
        route: { directUserIds: impact.managerUserIds },
      });
    }

    return Response.json({ success: true, impact });
  } catch (error) {
    logServerFailure('organization/move', 'POST', error);
    return internalError();
  }
}
