// ══════════════════════════════════════════════════════════════
//  /api/organization/employees/move — assign an employee to a node
//
//  POST { employeeId, orgNodeId }  (orgNodeId null = unassign)
//
//  HISTORICAL INTEGRITY: the patch touches ONLY Employee.orgNodeId
//  (buildEmployeeMovePatch). The employee's free-text department /
//  position strings, month snapshots and every historical record
//  stay exactly as they were — the organization relationship
//  affects FUTURE scope resolution only.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getById, updateRecord } from '@/lib/db';
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
  MEMBERSHIP_EVENTS_TABLE,
  buildEmployeeMovePatch,
  buildMembershipEvent,
  type OrgNode,
} from '@/lib/organization';
import { createRecordWithId } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'organization', 'update');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { employeeId, orgNodeId } = body ?? {};
    if (!employeeId || typeof employeeId !== 'string') {
      return validationError('معرّف الموظف مطلوب');
    }
    if (orgNodeId !== null && typeof orgNodeId !== 'string') {
      return validationError('معرّف العقدة غير صالح');
    }

    const employee = await getById<{ id: string; name: string | null; orgNodeId?: string | null }>('employees', employeeId);
    if (!employee) return notFoundError('الموظف غير موجود');

    const previousNodeId = employee.orgNodeId ?? null;
    let targetNode: OrgNode | null = null;
    if (orgNodeId) {
      targetNode = await getById<OrgNode>(ORG_NODES_TABLE, orgNodeId);
      if (!targetNode) return notFoundError('العقدة غير موجودة');
      if (targetNode.status === 'archived') {
        return validationError('لا يمكن إسناد موظف إلى عقدة مؤرشفة');
      }
    }

    if (previousNodeId === (orgNodeId ?? null)) {
      return Response.json({ success: true, unchanged: true });
    }

    // ONLY the relationship pointer — see the file header.
    await updateRecord('employees', employeeId, buildEmployeeMovePatch(orgNodeId ?? null));

    const actor = await resolveActor(permCheck.user?.id);

    // ── M0.6-A APPEND-ONLY MEMBERSHIP LEDGER ──
    // One immutable event per ACTUAL assignment change (joined /
    // transferred / unassigned). This is historical bookkeeping ONLY:
    // nothing in scope, permissions or reports reads it in M0.6-A,
    // and a ledger failure must never undo the committed move.
    try {
      const event = buildMembershipEvent({
        employeeId,
        employeeName: employee.name ?? null,
        previousNodeId,
        nextNodeId: orgNodeId ?? null,
        actorUserId: actor.id,
      });
      await createRecordWithId(MEMBERSHIP_EVENTS_TABLE, event.id, event);
    } catch (ledgerError) {
      console.error('membershipEvents append failed:', ledgerError);
    }
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'move',
      entityType: 'employeeOrgAssignment',
      entityId: employeeId,
      monthKey: null,
      before: { orgNodeId: previousNodeId },
      after: { orgNodeId: orgNodeId ?? null },
      details: `نقل الموظف ${employee.name ?? employeeId} إلى ${targetNode ? `"${targetNode.name}"` : 'بدون عقدة'}`,
    });

    // Notify the OLD and NEW nodes' managers through the central
    // router (bounded audience, permission-filtered at the read side).
    const notifyNodeIds = [previousNodeId, orgNodeId ?? null].filter(Boolean) as string[];
    if (notifyNodeIds.length > 0) {
      await fireRoutedNotification({
        title: `نقل موظف: ${employee.name ?? employeeId}`,
        description: targetNode
          ? `تم نقل الموظف إلى "${targetNode.name}".`
          : 'تم إلغاء إسناد الموظف إلى أي عقدة تنظيمية.',
        priority: 'low',
        employeeId,
        employeeName: employee.name ?? null,
        sourceRecordId: employeeId,
        route: { orgNodeIds: notifyNodeIds },
      });
    }

    return Response.json({ success: true });
  } catch (error) {
    logServerFailure('organization/employees/move', 'POST', error);
    return internalError();
  }
}
