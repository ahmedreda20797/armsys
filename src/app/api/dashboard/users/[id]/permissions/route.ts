// ══════════════════════════════════════════════════════════════
//  /api/dashboard/users/[id]/permissions — Permission Manager API
//
//  GET — the authorization PROFILE of one user, in ONE structured
//  response (no N+1): identity, the three permission tiers (role
//  baseline / position template / direct override), the effective
//  result, and the canonical per-page explanation
//  (explainAuthorization — the SAME resolver the enforcement path
//  uses; the UI never recomputes precedence).
//
//  PUT — saves DIRECT USER OVERRIDES (existing endpoint): validates
//  every entry through the single vocabulary validator, stores the
//  override tier verbatim (deny-beats-grant is the resolver's
//  documented behavior), and writes the configuration audit entry
//  with an exact diff.
//
//  Both gates: controlPanel edit — the same authorization the
//  Control Center already requires. The response NEVER contains
//  credentials or secrets.
// ══════════════════════════════════════════════════════════════

import { getById, getAll, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  APP_PAGES,
  PAGE_SECTIONS,
  SENSITIVE_FIELDS,
  diffPermissionMaps,
  explainAuthorization,
  getPermissionsForRole,
  resolveEffectivePermissions,
  validatePermissionEntry,
  type AuthorizationExplanation,
  type PermissionsMap,
} from '@/config/permissions';
import { parsePositionTemplate, POSITIONS_TABLE, ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';
import { buildEmployeeOrgIndex, resolveEmployeeOrgLabels } from '@/lib/reports/employee-org';
import type { Employee } from '@/types';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';

function safeParsePerms(permissions: unknown): Record<string, unknown> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions as Record<string, unknown>;
  try { return JSON.parse(String(permissions)); } catch { return {}; }
}

// ── GET: the canonical authorization profile ───────────────────

interface ProfilePage {
  pageKey: string;
  pageIds: string[];
  title: string;
  titleEn: string | null;
  groupId: string;
  availableActions: string[];
  sections: ReadonlyArray<{ id: string; title: string }>;
  sensitiveFields: string[];
  explanation: AuthorizationExplanation;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 1+2. Authenticate + authorize the ADMINISTRATOR (not the target).
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    // 3. Resolve the TARGET user server-side — the id in the path is
    //    the only input; nothing about the profile is client-supplied.
    const { id } = await params;
    const user = await getById<{
      id: string; name?: string | null; email?: string | null; role: string; rank?: string | null;
      isSuspended?: boolean; suspendedAt?: string | null; photoURL?: string | null;
      permissions?: unknown; positionId?: string | null; linkedEmployeeId?: string | null;
    }>('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 4+5. The three tiers + the canonical effective resolver.
    const storedOverrides = safeParsePerms(user.permissions) as PermissionsMap;
    let positionTemplate: PermissionsMap | null = null;
    let positionTitle: string | null = null;
    if (user.positionId) {
      const position = await getById<{ title: string; permissions: unknown }>(POSITIONS_TABLE, user.positionId);
      if (position) {
        positionTemplate = parsePositionTemplate(position.permissions);
        positionTitle = position.title;
      }
    }
    const roleBaseline = getPermissionsForRole(user.role);
    const effective = resolveEffectivePermissions(user.role, storedOverrides, positionTemplate ?? undefined);

    // 6. Canonical per-page explanations (same function the server
    //    authorizer reports through — no frontend precedence logic).
    const pagesByKey = new Map<string, { pageIds: string[]; config: (typeof APP_PAGES)[number] }>();
    for (const page of APP_PAGES) {
      const existing = pagesByKey.get(page.permissionKey);
      if (existing) existing.pageIds.push(page.id);
      else pagesByKey.set(page.permissionKey, { pageIds: [page.id], config: page });
    }
    const pages: ProfilePage[] = [];
    for (const [pageKey, { pageIds, config }] of pagesByKey) {
      pages.push({
        pageKey,
        pageIds,
        title: config.title,
        titleEn: config.titleEn ?? null,
        groupId: config.groupId,
        availableActions: config.availableActions,
        sections: PAGE_SECTIONS[pageKey] ?? [],
        sensitiveFields: Object.keys(SENSITIVE_FIELDS[pageKey] ?? {}),
        explanation: explainAuthorization(user.role, storedOverrides, pageKey, positionTemplate ?? undefined),
      });
    }

    // Organization context — REAL tree data only (never typed ids):
    // the linked employee's placement and the branches the user
    // manages. These are the facts the scope engine resolves against.
    const [employees, orgNodes] = await Promise.all([
      getAll<Employee>('employees'),
      getAll<OrgNode>(ORG_NODES_TABLE),
    ]);
    const linkedEmployee = user.linkedEmployeeId
      ? employees.find((e) => e.id === user.linkedEmployeeId) ?? null
      : null;
    const orgIndex = buildEmployeeOrgIndex(orgNodes);
    const orgLabels = linkedEmployee ? resolveEmployeeOrgLabels(orgIndex, linkedEmployee) : null;
    const managedBranches = orgNodes
      .filter((n) => n.managerUserId === user.id)
      .map((n) => ({ id: n.id, name: n.name, type: n.type }));
    const ownNode = linkedEmployee?.orgNodeId
      ? orgNodes.find((n) => n.id === linkedEmployee.orgNodeId) ?? null
      : null;

    return NextResponse.json({
      identity: {
        id: user.id,
        name: user.name ?? null,
        email: user.email ?? null,
        role: user.role,
        rank: user.rank ?? null,
        isSuspended: user.isSuspended ?? false,
        suspendedAt: user.suspendedAt ?? null,
        photoURL: user.photoURL ?? null,
        positionId: user.positionId ?? null,
        positionTitle,
        linkedEmployeeId: user.linkedEmployeeId ?? null,
        linkedEmployeeName: linkedEmployee?.name ?? null,
        linkedEmployeeCode: linkedEmployee?.code ?? null,
      },
      authorization: {
        roleBaseline,
        positionTemplate,
        storedOverrides,
        effective,
        hasOverrides: Object.keys(storedOverrides).length > 0,
        pages,
      },
      organization: {
        ownNode: ownNode ? { id: ownNode.id, name: ownNode.name, type: ownNode.type } : null,
        department: orgLabels?.department ?? null,
        team: orgLabels?.team ?? null,
        managedBranches,
        // Scope context facts the UI surfaces honestly: a people
        // scope without a node placement or managed branches cannot
        // resolve — shown as restricted, never faked as ALL.
        resolvable: Boolean(ownNode || managedBranches.length > 0),
      },
    });
  } catch (error) {
    console.error('Permission profile error:', error);
    return NextResponse.json({ error: 'Failed to load permission profile' }, { status: 500 });
  }
}

// ── PUT: save direct user overrides (validated + audited) ──────

const KNOWN_PERMISSION_KEYS = new Set(APP_PAGES.map((p) => p.permissionKey));

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // The same authorization gate as before — unchanged behavior for
    // the Control Center save path.
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { permissions } = body;

    if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) {
      return NextResponse.json({ error: 'Invalid permissions payload' }, { status: 400 });
    }

    // Resolve the TARGET user before validation: legacy-key tolerance
    // is decided against the user's CURRENT stored map (below).
    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const before = safeParsePerms(user.permissions) as PermissionsMap;

    // Server-side validation through the single vocabulary validator —
    // a corrupt NEW/CHANGED entry can never enter the resolver chain.
    //
    // §LEGACY-TOLERANCE: stored override maps written before the
    // current page registry may carry keys of pages that no longer
    // exist (e.g. the removed 'firebase'/'dashboard' pages). The
    // resolver ignores unknown keys, so a PRE-EXISTING entry the
    // administrator did not touch passes through VERBATIM — rejecting
    // it would make every legacy map permanently unsavable (the
    // System Owner could not save ANY change for such users). The
    // canonical-key + shape rule applies in full to anything the
    // administrator adds or changes.
    const problems: string[] = [];
    for (const [key, value] of Object.entries(permissions as Record<string, unknown>)) {
      const untouchedLegacy =
        Object.prototype.hasOwnProperty.call(before, key) &&
        JSON.stringify(before[key]) === JSON.stringify(value);
      if (untouchedLegacy) continue;
      if (!KNOWN_PERMISSION_KEYS.has(key)) {
        problems.push(`${key}: مفتاح صفحة غير معروف`);
        continue;
      }
      const entryProblems = validatePermissionEntry(value);
      for (const p of entryProblems) problems.push(`${key}: ${p}`);
    }
    if (problems.length > 0) {
      return NextResponse.json(
        { error: `قالب صلاحيات غير صالح — ${problems.slice(0, 5).join('، ')}${problems.length > 5 ? ' …' : ''}` },
        { status: 400 },
      );
    }

    // System Owner protection: the LAST administrator's map cannot be
    // emptied into a lockout — deny the write entirely.
    if (user.role === 'admin') {
      const admins = await getAll<{ id: string; role: string; isSuspended?: boolean }>('users');
      const adminCount = admins.filter((u) => u.role === 'admin' && !u.isSuspended).length;
      const removesOwnAccess = (permissions as PermissionsMap).controlPanel !== undefined;
      if (adminCount <= 1 && removesOwnAccess) {
        return NextResponse.json(
          { error: 'لا يمكن تقييد وصول مالك النظام الأخير' },
          { status: 400 },
        );
      }
    }

    await updateRecord('users', id, {
      permissions: JSON.stringify(permissions),
    });

    // Configuration audit with the exact diff (existing mechanism —
    // no second audit system).
    const diff = diffPermissionMaps(before, permissions as PermissionsMap);
    const actor = await resolveActor(check.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update',
      entityType: 'userPermissions',
      entityId: id,
      monthKey: null,
      before,
      after: permissions as PermissionsMap,
      details: `تعديل صلاحيات المستخدم ${user.name ?? id} (تجاوز مباشر) — ${diff.length} تغيير${diff.length > 0 ? `: ${diff.slice(0, 10).map((d) => `${d.pageKey} ${d.before}→${d.after}`).join('، ')}` : ''}`,
    });

    return NextResponse.json({ success: true, changed: diff.length, diff });
  } catch (error) {
    console.error('Update permissions error:', error);
    return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 });
  }
}
