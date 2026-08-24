// ══════════════════════════════════════════════════════════════
//  /api/organization/impact — Organization Impact Preview
//
//  POST { nodeId, newParentId? }
//
//  Read-only: computes what a move WOULD affect ("N employees will
//  inherit a different scope") and validates it — BEFORE any
//  mutation. This is the distinctive ARM confirmation-before-
//  reorganization feature; dangerous auto-mutations require it.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  validationError, forbiddenError, notFoundError,
  internalError, logServerFailure,
} from '@/lib/api-error';
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
    const permCheck = await verifyPermission(request, 'organization', 'view');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const body = await request.json();
    const { nodeId, newParentId } = body ?? {};
    if (!nodeId || typeof nodeId !== 'string') {
      return validationError('معرّف العقدة مطلوب');
    }

    const [nodes, employees] = await Promise.all([
      getAll<OrgNode>(ORG_NODES_TABLE),
      getAll<{ id: string; orgNodeId?: string | null }>('employees'),
    ]);
    const index = buildOrgIndex(nodes);
    if (!index.byId.has(nodeId)) return notFoundError('العقدة غير موجودة');

    const impact = previewOrgImpact(index, nodeId, groupEmployeesByNode(employees));
    if (!impact) return notFoundError('العقدة غير موجودة');

    const validation =
      newParentId !== undefined
        ? validateMoveNode(index, nodeId, typeof newParentId === 'string' ? newParentId : null)
        : null;

    return Response.json({
      impact,
      moveValidation: validation ? { ok: validation.ok, reason: 'reason' in validation ? validation.reason : null } : null,
    });
  } catch (error) {
    logServerFailure('organization/impact', 'POST', error);
    return internalError();
  }
}
