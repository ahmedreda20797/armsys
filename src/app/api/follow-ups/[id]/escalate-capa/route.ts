import { NextRequest, NextResponse } from 'next/server';
import { getById, createRecord, getAll, getEmployeeMap, updateRecord, invalidateCache } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';

// ══════════════════════════════════════════════════════════════
//  POST /api/follow-ups/[id]/escalate-capa
//  Creates a CAPA case from a Follow-Up with bidirectional linking
// ══════════════════════════════════════════════════════════════

const SLA_DAYS_MAP: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'followUps', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const followUp = await getById('followUps', id);
    if (!followUp) {
      return NextResponse.json({ error: 'Follow-up not found' }, { status: 404 });
    }

    // Check if already linked to a CAPA
    if ((followUp as any).relatedCapaId) {
      return NextResponse.json(
        { error: 'This follow-up is already linked to a CAPA case' },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const priority = body.priority || (followUp as any).priorityLevel || 'medium';
    const slaDays = SLA_DAYS_MAP[priority] || 7;

    // Auto-generate CAPA ID
    const allCases = await getAll('capaCases');
    const year = new Date().getFullYear();
    const existingThisYear = allCases.filter((c: any) => c.capaId?.includes(`CAPA-${year}`));
    const nextNum = existingThisYear.length + 1;
    const capaId = `CAPA-${year}-${String(nextNum).padStart(3, '0')}`;

    const empMap = await getEmployeeMap();
    const assignedToName = (followUp as any).responsiblePerson
      ? empMap.get((followUp as any).responsiblePerson)?.name || null
      : null;
    const createdBy = permCheck.user?.id || 'system';
    const createdByName = permCheck.user ? (empMap.get(permCheck.user.id)?.name || 'النظام') : 'النظام';

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: `تم إنشاء حالة كابا من متابعة (${(followUp as any).followUpType}) — الموضوع: ${(followUp as any).subject}`,
        performedBy: createdBy,
        performedByName: createdByName,
        timestamp: new Date().toISOString(),
      },
    ];

    // Create CAPA case
    const capaCase = await createRecord('capaCases', {
      capaId,
      title: `كابا من متابعة: ${(followUp as any).subject}`,
      department: (followUp as any).department || '',
      employeeId: (followUp as any).employeeId || null,
      employeeName: (followUp as any).employeeName || null,
      relatedFollowUpId: id,
      createdBy,
      createdByName,
      issueCategory: 'behavior_issue',
      problemDescription: (followUp as any).detailedDescription || (followUp as any).subject || '',
      impactLevel: priority,
      impactDescription: '',
      rootCauseCategory: '',
      rootCauseDescription: '',
      rootCauseVerification: '',
      correctiveAction: '',
      correctiveAssignedTo: (followUp as any).responsiblePerson || '',
      correctiveAssignedToName: assignedToName,
      correctiveDueDate: '',
      correctiveStatus: 'not_started',
      correctiveEvidence: '',
      preventiveAction: '',
      preventiveAssignedTo: '',
      preventiveAssignedToName: null,
      preventiveDueDate: '',
      preventiveStatus: 'not_started',
      preventiveVerificationMethod: '',
      verificationDate: '',
      verifiedBy: '',
      verifiedByName: null,
      verificationResult: '',
      verificationNotes: '',
      status: 'open',
      priority,
      assignedTo: (followUp as any).responsiblePerson || '',
      assignedToName,
      closureDate: '',
      closedBy: '',
      closedByName: null,
      finalComments: '',
      relatedEmployeeIds: [],
      source: 'automation',
      timeline: initialTimeline,
      attachments: [],
      lessonsLearned: '',
      slaDays,
      overdueDays: 0,
      closedAt: null,
      relatedQualityDeductionId: null,
      relatedHrDeductionId: null,
    });

    // Link follow-up to CAPA (bidirectional)
    await updateRecord('followUps', id, { relatedCapaId: capaCase.id });
    invalidateCache('followUps');
    invalidateCache('capaCases');

    // Generate notification
    try {
      await createSmartNotification({
        title: `تم تصعيد متابعة إلى كابا: ${(followUp as any).subject}`,
        description: `تم إنشاء حالة كابا (${capaId}) من متابعة "${(followUp as any).subject}" للموظف ${(followUp as any).employeeName || 'غير محدد'}.`,
        priority: priority as any,
        category: 'capa',
        sourceModule: 'followUps',
        sourceRecordId: id,
        employeeId: (followUp as any).employeeId || null,
        employeeName: (followUp as any).employeeName || null,
        assignedTo: (followUp as any).responsiblePerson || null,
        assignedToName,
        actionUrl: `capa:${capaCase.id}`,
      });
    } catch (notifErr) {
      console.error('[escalate-capa] Notification error (non-blocking):', notifErr);
    }

    return NextResponse.json({ capaCase, followUpId: id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/follow-ups/:id/escalate-capa] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
