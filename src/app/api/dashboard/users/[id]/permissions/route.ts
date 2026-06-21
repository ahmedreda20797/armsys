import { getById, updateRecord } from '@/lib/db';
import { NextResponse } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';

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

    const user = await getById('users', id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    await updateRecord('users', id, {
      permissions: JSON.stringify(permissions || {}),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update permissions error:', error);
    return NextResponse.json({ error: 'Failed to update permissions' }, { status: 500 });
  }
}
