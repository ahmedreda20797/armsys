import { NextRequest, NextResponse } from 'next/server';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'complaints', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      customerName,
      customerContact,
      dealId,
      employeeId,
      complaintType,
      description,
      severity,
      status,
      resolution,
      responsiblePerson,
      compensationProvided,
      resolvedAt,
      relatedCapaIds,
    } = body;

    const { updateRecord } = await import('@/lib/db');
    const complaint = await updateRecord('complaints', id, {
      ...(customerName !== undefined && { customerName }),
      ...(customerContact !== undefined && { customerContact }),
      ...(dealId !== undefined && { dealId }),
      ...(employeeId !== undefined && { employeeId }),
      ...(complaintType !== undefined && { complaintType }),
      ...(description !== undefined && { description }),
      ...(severity !== undefined && { severity }),
      ...(status !== undefined && { status }),
      ...(resolution !== undefined && { resolution }),
      ...(responsiblePerson !== undefined && { responsiblePerson }),
      ...(compensationProvided !== undefined && { compensationProvided }),
      ...(resolvedAt !== undefined && { resolvedAt }),
      ...(relatedCapaIds !== undefined && { relatedCapaIds }),
    });

    return NextResponse.json(complaint);
  } catch (error) {
    console.error('Update complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'complaints', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const { deleteRecord } = await import('@/lib/db');
    await deleteRecord('complaints', id);
    return NextResponse.json({ message: 'Complaint deleted successfully' });
  } catch (error) {
    console.error('Delete complaint error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
