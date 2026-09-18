import { getById, countWhere, deleteRecord, updateRecord, findWhere } from '@/lib/db';
import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import { hashPassword } from '@/lib/auth';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeConfigAudit } from '@/lib/audit/config-audit';
import { POSITIONS_TABLE } from '@/lib/organization';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Server-side permission check: only admin can edit users
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};

    // Allowed fields to update
    if (body.name !== undefined) updates.name = body.name;
    if (body.email !== undefined) updates.email = body.email;
    if (body.role !== undefined) updates.role = body.role;
    if (body.rank !== undefined) updates.rank = body.rank;
    // §USER-PROFILE — operational identity fields. photoURL accepts
    // https URLs or data: image URLs (256px resized by the upload
    // endpoint) — never arbitrary content.
    if (body.jobTitle !== undefined) updates.jobTitle = typeof body.jobTitle === 'string' && body.jobTitle.trim() ? body.jobTitle.trim() : null;
    if (body.mobile !== undefined) updates.mobile = typeof body.mobile === 'string' && body.mobile.trim() ? body.mobile.trim() : null;
    if (body.responsibilities !== undefined) updates.responsibilities = typeof body.responsibilities === 'string' && body.responsibilities.trim() ? body.responsibilities.trim() : null;
    if (body.photoURL !== undefined) {
      updates.photoURL =
        typeof body.photoURL === 'string' &&
        (/^https:\/\//.test(body.photoURL) || body.photoURL.startsWith('data:image/'))
          ? body.photoURL
          : null;
    }
    if (body.password !== undefined) {
      if (body.password.length < 8) {
        return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
      }
      updates.password = await hashPassword(body.password);
    }
    if (body.isSuspended !== undefined) {
      // Prevent suspending the last admin
      if (body.isSuspended && user.role === 'admin') {
        const adminCount = await countWhere('users', { role: 'admin' });
        if (adminCount <= 1) {
          return NextResponse.json({ error: 'Cannot suspend the last admin' }, { status: 400 });
        }
      }
      updates.isSuspended = body.isSuspended;
      updates.suspendedAt = body.isSuspended ? new Date().toISOString() : null;
    }

    // ── Milestone 10: Position assignment (permission template tier).
    // Security-relevant → validated + audited.
    if (body.positionId !== undefined && body.positionId !== (user.positionId || null)) {
      if (body.positionId === null || body.positionId === '') {
        updates.positionId = null;
      } else {
        const position = await getById(POSITIONS_TABLE, body.positionId);
        if (!position) {
          return NextResponse.json({ error: 'الوظيفة غير موجودة' }, { status: 400 });
        }
        updates.positionId = body.positionId;
      }
    }

    // ── Milestone 10: optional user ↔ employee LINKAGE.
    // Links an EXISTING user to an EXISTING employee record — no
    // accounts are created. One employee may be linked to at most
    // one user (uniqueness enforced). Security-relevant → audited.
    if (body.linkedEmployeeId !== undefined && body.linkedEmployeeId !== (user.linkedEmployeeId || null)) {
      if (body.linkedEmployeeId === null || body.linkedEmployeeId === '') {
        updates.linkedEmployeeId = null;
      } else {
        const employee = await getById('employees', body.linkedEmployeeId);
        if (!employee) {
          return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 400 });
        }
        const otherHolder = await findWhere('users', { linkedEmployeeId: body.linkedEmployeeId });
        if (otherHolder.some((u: any) => u.id !== id)) {
          return NextResponse.json(
            { error: 'هذا الموظف مرتبط بمستخدم آخر بالفعل' },
            { status: 409 }
          );
        }
        updates.linkedEmployeeId = body.linkedEmployeeId;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, unchanged: true });
    }

    await updateRecord('users', id, updates);

    // Audit the security-relevant slices only (access-affecting
    // changes; name/email changes stay in the activity log as
    // before). Role changes, suspension and password changes alter
    // authorization surface — recorded with before/after; the
    // password itself is NEVER logged, only the change indicator.
    const securitySlices =
      updates.positionId !== undefined ||
      updates.linkedEmployeeId !== undefined ||
      updates.role !== undefined ||
      updates.isSuspended !== undefined ||
      updates.password !== undefined;
    if (securitySlices) {
      const actor = await resolveActor(check.user?.id);
      const beforeSlices: Record<string, unknown> = {};
      const afterSlices: Record<string, unknown> = {};
      if (updates.positionId !== undefined) {
        beforeSlices.positionId = user.positionId || null;
        afterSlices.positionId = updates.positionId;
      }
      if (updates.linkedEmployeeId !== undefined) {
        beforeSlices.linkedEmployeeId = user.linkedEmployeeId || null;
        afterSlices.linkedEmployeeId = updates.linkedEmployeeId;
      }
      if (updates.role !== undefined) {
        beforeSlices.role = user.role;
        afterSlices.role = updates.role;
      }
      if (updates.isSuspended !== undefined) {
        beforeSlices.isSuspended = user.isSuspended || false;
        afterSlices.isSuspended = updates.isSuspended;
      }
      if (updates.password !== undefined) {
        afterSlices.passwordChanged = true; // indicator only — never the secret
      }
      const changes: string[] = [];
      if (updates.role !== undefined) changes.push(`الدور: ${user.role} → ${updates.role}`);
      if (updates.positionId !== undefined) changes.push('الوظيفة');
      if (updates.linkedEmployeeId !== undefined) changes.push('ربط الموظف');
      if (updates.isSuspended !== undefined) changes.push(updates.isSuspended ? 'تعليق الحساب' : 'إلغاء التعليق');
      if (updates.password !== undefined) changes.push('تغيير كلمة المرور');
      await writeConfigAudit({
        actorId: actor.id,
        actorName: actor.name,
        action: 'update',
        entityType: 'userAccess',
        entityId: id,
        monthKey: null,
        before: beforeSlices,
        after: afterSlices,
        details: `تعديل بيانات وصول المستخدم ${user.name ?? id}${changes.length ? ` — ${changes.join('، ')}` : ''}`,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update user error:', error);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Server-side permission check: only admin can delete users
    const check = await verifyPermission(request, 'controlPanel', 'edit');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const { id } = await params;

    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.role === 'admin') {
      const adminCount = await countWhere('users', { role: 'admin' });
      if (adminCount <= 1) {
        return NextResponse.json({ error: 'Cannot delete the last admin' }, { status: 400 });
      }
    }

    await deleteRecord('users', id);

    // User deletion is security-relevant: the account (and its
    // access surface) disappears — recorded with a snapshot of the
    // role/configured access, never credentials.
    const actor = await resolveActor(check.user?.id);
    await writeConfigAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'delete',
      entityType: 'userAccess',
      entityId: id,
      monthKey: null,
      before: {
        name: user.name ?? null,
        role: user.role,
        positionId: user.positionId ?? null,
        hadStoredPermissions: Boolean(user.permissions),
      },
      details: `حذف حساب المستخدم ${user.name ?? id} (الدور: ${user.role})`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
