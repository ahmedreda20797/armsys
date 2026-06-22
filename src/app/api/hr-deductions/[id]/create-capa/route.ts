import { NextRequest, NextResponse } from 'next/server';
import { getById, createRecord, getAll, getEmployeeMap, updateRecord, invalidateCache } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';

// ══════════════════════════════════════════════════════════════
//  POST /api/hr-deductions/[id]/create-capa
//  Creates a CAPA case from an HR Violation/Deduction with bidirectional linking
// ══════════════════════════════════════════════════════════════

const SLA_DAYS_MAP: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'hrDeductions', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const hrDeduction = await getById('hrDeductions', id);
    if (!hrDeduction) {
      return NextResponse.json({ error: 'HR deduction not found' }, { status: 404 });
    }

    // Check if already linked to a CAPA
    if ((hrDeduction as any).relatedCapaId) {
      return NextResponse.json(
        { error: 'This HR deduction is already linked to a CAPA case' },
        { status: 409 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const priority = body.priority || 'high';
    const slaDays = SLA_DAYS_MAP[priority] || 3;

    // Auto-generate CAPA ID
    const allCases = await getAll('capaCases');
    const year = new Date().getFullYear();
    const existingThisYear = allCases.filter((c: any) => c.capaId?.includes(`CAPA-${year}`));
    const nextNum = existingThisYear.length + 1;
    const capaId = `CAPA-${year}-${String(nextNum).padStart(3, '0')}`;

    const empMap = await getEmployeeMap();
    const empName = (hrDeduction as any).employeeName || empMap.get((hrDeduction as any).employeeId)?.name || '';
    const createdBy = permCheck.user?.id || 'system';
    const createdByName = permCheck.user ? (empMap.get(permCheck.user.id)?.name || 'النظام') : 'النظام';

    const violationDetails = [
      `النوع: ${(hrDeduction as any).type}`,
      `المبلغ: ${(hrDeduction as any).amount} ${(hrDeduction as any).unit}`,
      `الشهر: ${(hrDeduction as any).month}`,
    ].join(' | ');

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: `تم إنشاء حالة كابا من مخالفة HR (${(hrDeduction as any).type})`,
        performedBy: createdBy,
        performedByName: createdByName,
        timestamp: new Date().toISOString(),
      },
    ];

    const capaCase = await createRecord('capaCases', {
      capaId,
      title: `كابا من مخالفة HR: ${(hrDeduction as any).type}`,
      department: (hrDeduction as any).department || '',
      employeeId: (hrDeduction as any).employeeId || null,
      employeeName: empName,
      relatedFollowUpId: null,
      relatedRiskId: null,
      relatedComplaintId: null,
      relatedQualityDeductionId: null,
      relatedHrDeductionId: id,
      createdBy,
      createdByName,
      issueCategory: 'behavior_issue',
      problemDescription: violationDetails + '\n' + ((hrDeduction as any).reason || ''),
      impactLevel: priority,
      impactDescription: '',
      rootCauseCategory: '',
      rootCauseDescription: '',
      rootCauseVerification: '',
      correctiveAction: '',
      correctiveAssignedTo: '',
      correctiveAssignedToName: null,
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
      assignedTo: '',
      assignedToName: null,
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
    });

    // Link HR deduction to CAPA (bidirectional)
    await updateRecord('hrDeductions', id, { relatedCapaId: capaCase.id });
    invalidateCache('hrDeductions');
    invalidateCache('capaCases');

    // Generate notification
    try {
      await createSmartNotification({
        title: `تم إنشاء كابا من مخالفة HR: ${(hrDeduction as any).type}`,
        description: `تم إنشاء حالة كابا (${capaId}) من مخالفة HR للموظف ${empName}.`,
        priority: priority as any,
        category: 'capa',
        sourceModule: 'hrDeductions',
        sourceRecordId: id,
        employeeId: (hrDeduction as any).employeeId || null,
        employeeName: empName,
        actionUrl: `capa:${capaCase.id}`,
      });
    } catch (notifErr) {
      console.error('[hr-create-capa] Notification error (non-blocking):', notifErr);
    }

    return NextResponse.json({ capaCase, hrDeductionId: id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/hr-deductions/:id/create-capa] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}