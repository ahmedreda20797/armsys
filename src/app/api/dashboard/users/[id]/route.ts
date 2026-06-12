import { getById, countWhere, deleteRecord, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    if (body.password !== undefined) updates.password = body.password;
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
