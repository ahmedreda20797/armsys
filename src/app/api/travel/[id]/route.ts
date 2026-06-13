import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'update' permission
    const permCheck = await verifyPermission(request, 'travel', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const trip = await updateRecord('travelDeals', id, body);

    return NextResponse.json(trip);
  } catch (error) {
    console.error('Update travel error:', error);
    return NextResponse.json({ error: 'فشل في تعديل الرحلة' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Check 'delete' permission
    const permCheck = await verifyPermission(_request, 'travel', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    await deleteRecord('travelDeals', id);
    return NextResponse.json({ message: 'تم حذف الرحلة بنجاح' });
  } catch (error) {
    console.error('Delete travel error:', error);
    return NextResponse.json({ error: 'فشل في حذف الرحلة' }, { status: 500 });
  }
}
