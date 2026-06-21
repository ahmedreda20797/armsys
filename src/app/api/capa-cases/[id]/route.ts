import { NextRequest, NextResponse } from 'next/server';
import { updateRecord, deleteRecord, getById, getEmployeeMap, invalidateCache } from '@/lib/db';
import type { CAPACase } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/capa-cases/[id] — Fetch single CAPA case
// ══════════════════════════════════════════════════════════════
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const capaCase = await getById<CAPACase>('capaCases', id);
    if (!capaCase) {
      return NextResponse.json({ error: 'CAPA case not found' }, { status: 404 });
    }
    return NextResponse.json(capaCase);
  } catch (error) {
    console.error('[GET /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
//  PUT /api/capa-cases/[id] — Update CAPA case
// ══════════════════════════════════════════════════════════════
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'capa', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getById<CAPACase>('capaCases', id);
    if (!existing) {
      return NextResponse.json({ error: 'CAPA case not found' }, { status: 404 });
    }

    // Build update data
    const updateData: Record<string, any> = {};
    const allowedFields = [
      'title', 'department', 'employeeId', 'relatedFollowUpId', 'relatedRiskId',
      'relatedComplaintId', 'issueCategory', 'problemDescription', 'impactLevel',
      'impactDescription', 'rootCauseCategory', 'rootCauseDescription',
      'rootCauseVerification', 'correctiveAction', 'correctiveAssignedTo',
      'correctiveDueDate', 'correctiveStatus', 'correctiveEvidence',
      'preventiveAction', 'preventiveAssignedTo', 'preventiveDueDate',
      'preventiveStatus', 'preventiveVerificationMethod', 'verificationDate',
      'verifiedBy', 'verificationResult', 'verificationNotes', 'status',
      'priority', 'assignedTo', 'finalComments', 'relatedEmployeeIds',
      'source', 'lessonsLearned', 'attachments',
    ] as const;

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Auto-set closure fields
    if (body.status === 'closed' && existing.status !== 'closed') {
      updateData.closedAt = new Date().toISOString();
      updateData.closureDate = new Date().toISOString().split('T')[0];
    }

    // Enrich names
    const empMap = await getEmployeeMap();
    if (updateData.assignedTo) {
      updateData.assignedToName = empMap.get(updateData.assignedTo)?.name || null;
    }
    if (updateData.correctiveAssignedTo) {
      updateData.correctiveAssignedToName = empMap.get(updateData.correctiveAssignedTo)?.name || null;
    }
    if (updateData.preventiveAssignedTo) {
      updateData.preventiveAssignedToName = empMap.get(updateData.preventiveAssignedTo)?.name || null;
    }
    if (updateData.verifiedBy) {
      updateData.verifiedByName = empMap.get(updateData.verifiedBy)?.name || null;
    }

    // Add timeline event for status change
    if (body.status && body.status !== existing.status) {
      const existingTimeline = existing.timeline || [];
      const newEvent = {
        id: `tl-${Date.now()}`,
        action: 'status_changed',
        description: `تم تغيير الحالة من "${existing.status}" إلى "${body.status}"`,
        performedBy: body.updatedBy || 'system',
        performedByName: body.updatedByName || 'النظام',
        timestamp: new Date().toISOString(),
      };
      updateData.timeline = [...existingTimeline, newEvent];
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await updateRecord('capaCases', id, updateData);
    invalidateCache('capaCases');

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[PUT /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
//  DELETE /api/capa-cases/[id] — Delete CAPA case
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'capa', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    await deleteRecord('capaCases', id);
    invalidateCache('capaCases');
    return NextResponse.json({ message: 'CAPA case deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/capa-cases/:id] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
