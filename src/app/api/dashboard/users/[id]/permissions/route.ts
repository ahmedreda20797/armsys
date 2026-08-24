import { getById, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import { diffPermissionMaps, type PermissionsMap } from '@/config/permissions';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';

function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Server-side permission check: only admin can change permissions
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

    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // The stored map is the OVERRIDE tier of the single resolver —
    // it may carry level/actions AND the Milestone 10 extensions
    // (scope, sections); all ride through verbatim.
    const before = safeParsePerms(user.permissions) as PermissionsMap;
    await updateRecord('users', id, {
      permissions: JSON.stringify(permissions),
    });

    // Configuration audit + change preview data: security-sensitive
    // permission changes are recorded with an exact diff (Milestone
    // 10 — Permission Change Preview foundation).
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
      details: `تعديل صلاحيات المستخدم ${user.name ?? id} — ${diff.length} تغيير${diff.length > 0 ? `: ${diff.slice(0, 10).map((d) => `${d.pageKey} ${d.before}→${d.after}`).join('، ')}` : ''}`,
    });

    return NextResponse.json({ success: true, changed: diff.length, diff });
  } catch (error) {
    console.error('Update permissions error:', error);
    return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 });
  }
}
