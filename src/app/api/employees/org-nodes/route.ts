// ══════════════════════════════════════════════════════════════
//  /api/employees/org-nodes — assignment-selector data source
//
//  A MINIMAL org-node list for the employee create/edit form's
//  department/team pickers. This is NOT the organization management
//  API: no manager chain, no user list, no membership details — only
//  the node identity fields the selector needs to build the
//  department → dependent-team structure client-side (pure graph
//  helpers in lib/organization/assignment).
//
//  GATING: any viewer of the employees page may read it — assigning
//  an employee to an org node is part of the employee workflow the
//  'employees' permission already governs. The organization page's
//  admin-only management surface (/api/organization) is unchanged.
//
//  PERFORMANCE: one batched read of orgNodes — never one read per
//  node (§18).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const permCheck = await verifyPermission(request, 'employees', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const nodes = await getAll<OrgNode>(ORG_NODES_TABLE);
    return NextResponse.json({
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        type: n.type,
        parentId: n.parentId,
        status: n.status,
        order: n.order,
      })),
    });
  } catch (error) {
    console.error('Fetch org nodes error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
