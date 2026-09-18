// ══════════════════════════════════════════════════════════════
//  /api/profile — §USER-PROFILE self-service endpoint
//
//  GET  — the AUTHENTICATED user's own profile, assembled from the
//         authoritative chains (never duplicated):
//           • user record        (name/email/role/rank/photo/job…)
//           • position template  (positionTitle)
//           • LINKED EMPLOYEE    (code/hireDate/status + org-resolved
//                                 department/team — the org tree is
//                                 the single source of truth)
//           • MANAGED TEAMS      (org nodes whose managerUserId is
//                                 this user) + their members from
//                                 the node subtrees
//  PUT  — self display-name update (the only self-editable field;
//         everything else is admin/org-authoritative).
//
//  Authorization: requireAuth ONLY — the route can never leak another
//  user's data because every read is scoped to the caller's id.
// ══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { getAll, getById, updateRecord } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import {
  ORG_NODES_TABLE,
  POSITIONS_TABLE,
  ORG_NODE_TYPE_LABELS_AR,
  buildResponsibleTeamViewModel,
  type OrgNode,
  type Position,
} from '@/lib/organization';
import {
  buildEmployeeOrgIndex,
  resolveEmployeeOrgLabels,
} from '@/lib/reports/employee-org';
import type { Employee } from '@/types';

/** Hard safety bound on the returned directory (profile is a bounded
 *  view, not a roster export). Applied to the canonical collection
 *  AFTER dedup/grouping/sorting — every count below derives from this
 *  exact final array, so numbers can never disagree with the rows. */
const MAX_TEAM_MEMBERS = 500;

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await getById('users', auth.userId);
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }

    const [positions, employees, orgNodes] = await Promise.all([
      getAll<Position>(POSITIONS_TABLE),
      getAll<Employee>('employees'),
      getAll<OrgNode>(ORG_NODES_TABLE),
    ]);

    const position = user.positionId
      ? positions.find((p) => p.id === user.positionId) ?? null
      : null;
    const employeeById = new Map(employees.map((e) => [e.id, e]));
    const linked = user.linkedEmployeeId
      ? employeeById.get(user.linkedEmployeeId) ?? null
      : null;

    // Org identity — the org tree is authoritative (labels resolve
    // through the linked employee's node chain).
    const orgIndex = buildEmployeeOrgIndex(orgNodes);
    const orgLabels = linked
      ? resolveEmployeeOrgLabels(orgIndex, linked)
      : null;
    const orgNodeName = linked?.orgNodeId
      ? orgNodes.find((n) => n.id === linked.orgNodeId)?.name ?? null
      : null;

    // ── Managed teams — org nodes this USER operates (§PROFILE-TEAM) ──
    // The canonical dedup/group/sort/count pipeline lives in
    // lib/organization/responsible-team (pure + unit-tested): ONE
    // authoritative collection, every count derived from it — the
    // headline, the group badges and the rendered rows can never
    // disagree. This route only loads the two batched arrays and
    // shapes the payload.
    const managedNodes = orgNodes.filter(
      (n) => n.managerUserId === auth.userId && n.status === 'active',
    );
    const responsible = buildResponsibleTeamViewModel(
      orgIndex,
      managedNodes,
      employees,
      MAX_TEAM_MEMBERS,
    );

    const teamMembers = responsible.members.map(({ ref: e, nodeId, isDirect }) => {
      const labels = resolveEmployeeOrgLabels(orgIndex, e);
      return {
        id: e.id,
        name: e.name,
        code: e.code ?? null,
        position: e.position ?? null,
        department: labels.department,
        team: labels.team,
        nodeId,
        isDirect,
      };
    });

    // Group metadata derives from the same canonical collection —
    // Σ memberCount === teamMembers.length by construction.
    const managedTeams = responsible.groups.map(({ node, memberCount, directCount }) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      typeLabel: ORG_NODE_TYPE_LABELS_AR[node.type] ?? node.type,
      directCount,
      memberCount,
    }));

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name ?? '',
        email: user.email ?? '',
        role: user.role ?? 'user',
        rank: user.rank ?? null,
        photoURL: user.photoURL ?? null,
        jobTitle: user.jobTitle ?? null,
        mobile: user.mobile ?? null,
        responsibilities: user.responsibilities ?? null,
        positionTitle: position?.title ?? null,
        linkedEmployeeId: user.linkedEmployeeId ?? null,
        createdAt: user.createdAt ?? null,
      },
      employee: linked
        ? {
            id: linked.id,
            name: linked.name,
            code: linked.code ?? null,
            department: orgLabels?.department ?? linked.department ?? null,
            team: orgLabels?.team ?? null,
            position: linked.position ?? null,
            mobile: linked.mobile ?? null,
            hireDate: linked.hireDate ?? null,
            status: linked.status ?? 'active',
            orgNodeName,
          }
        : null,
      managedTeams,
      teamMembers,
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    return NextResponse.json({ error: 'تعذر تحميل الملف الشخصي' }, { status: 500 });
  }
}

/** PUT — self display-name update (validated like the admin route). */
export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'الاسم مطلوب', field: 'name' }, { status: 400 });
    }
    if (name.length > 80) {
      return NextResponse.json(
        { error: 'الاسم طويل جداً (الحد 80 حرفاً)', field: 'name' },
        { status: 400 },
      );
    }

    const user = await getById('users', auth.userId);
    if (!user) {
      return NextResponse.json({ error: 'المستخدم غير موجود' }, { status: 404 });
    }
    await updateRecord('users', auth.userId, { name });
    return NextResponse.json({ success: true, name });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json({ error: 'تعذر حفظ التعديلات' }, { status: 500 });
  }
}
