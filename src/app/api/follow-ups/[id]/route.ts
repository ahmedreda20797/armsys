import { NextRequest, NextResponse } from 'next/server';

const SCORE_MAP: Record<string, number> = { low: 1, medium: 3, high: 5, critical: 10 };

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'followUps', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    // Re-calculate score if priority changed
    const updateData: Record<string, any> = {};
    const fields = [
      'employeeId', 'date', 'followUpType', 'subject', 'detailedDescription',
      'positiveNotes', 'negativeNotes', 'rootCause', 'actionTaken',
      'department', 'position', 'responsiblePerson', 'nextFollowUpDate',
      'followUpRequired', 'status', 'attachments', 'relatedDeductionId',
    ] as const;

    for (const field of fields) {
      if (body[field] !== undefined) updateData[field] = body[field];
    }

    if (body.priorityLevel !== undefined) {
      updateData.priorityLevel = body.priorityLevel;
      updateData.score = SCORE_MAP[body.priorityLevel] || 3;
    }

    const { updateRecord } = await import('@/lib/db');
    const followUp = await updateRecord('followUps', id, updateData);

    return NextResponse.json(followUp);
  } catch (error) {
    console.error('Update follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'followUps', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const { deleteRecord } = await import('@/lib/db');
    await deleteRecord('followUps', id);
    return NextResponse.json({ message: 'Follow-up deleted successfully' });
  } catch (error) {
    console.error('Delete follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}