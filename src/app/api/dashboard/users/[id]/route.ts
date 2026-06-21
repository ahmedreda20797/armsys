import { getById, countWhere, deleteRecord, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import { hashPassword } from '@/lib/auth';

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

    await updateRecord('users', id, updates);

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
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete user error:', error);
    return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 });
  }
}
