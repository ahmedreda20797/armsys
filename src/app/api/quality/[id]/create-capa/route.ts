import { NextRequest, NextResponse } from 'next/server';
import { getById, createRecord, getAll, getEmployeeMap, updateRecord, invalidateCache } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';

// ══════════════════════════════════════════════════════════════
//  POST /api/quality/[id]/create-capa
//  Creates a CAPA case from a Quality Deduction with bidirectional linking
// ══════════════════════════════════════════════════════════════

const SLA_DAYS_MAP: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'quality', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const qualityRecord = await getById('qualityDeductions', id);
    if (!qualityRecord) {
      return NextResponse.json({ error: 'Quality deduction not found' }, { status: 404 });
    }

    // Check if already linked to a CAPA
    if ((qualityRecord as any).relatedCapaId) {
      return NextResponse.json(
        { error: 'This quality deduction is already linked to a CAPA case' },
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
    const empName = (qualityRecord as any).employeeName || empMap.get((qualityRecord as any).employeeId)?.name || '';
    const createdBy = permCheck.user?.id || 'system';
    const createdByName = permCheck.user ? (empMap.get(permCheck.user.id)?.name || 'النظام') : 'النظام';

    const deductionDetails = [
      `النوع: ${(qualityRecord as any).type}`,
      `الأيام: ${(qualityRecord as any).deductionDays || 0}`,
      `المبلغ: ${(qualityRecord as any).deductionAmount || 0}`,
      `الشهر: ${(qualityRecord as any).month}`,
    ].join(' | ');

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: `تم إنشاء حالة كابا من خصم جودة (${(qualityRecord as any).type})`,
        performedBy: createdBy,
        performedByName: createdByName,
        timestamp: new Date().toISOString(),
      },
    ];

    const capaCase = await createRecord('capaCases', {
      capaId,
      title: `كابا من خصم جودة: ${(qualityRecord as any).type}`,
      department: (qualityRecord as any).department || '',
      employeeId: (qualityRecord as any).employeeId || null,
      employeeName: empName,
      relatedFollowUpId: null,
      relatedRiskId: null,
      relatedComplaintId: null,
      relatedQualityDeductionId: id,
      relatedHrDeductionId: null,
      createdBy,
      createdByName,
      issueCategory: 'quality_issue',
      problemDescription: deductionDetails + '\n' + ((qualityRecord as any).description || ''),
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

    // Link quality deduction to CAPA (bidirectional)
    await updateRecord('qualityDeductions', id, { relatedCapaId: capaCase.id });
    invalidateCache('qualityDeductions');
    invalidateCache('capaCases');

    // Generate notification
    try {
      await createSmartNotification({
        title: `تم إنشاء كابا من خصم جودة: ${(qualityRecord as any).type}`,
        description: `تم إنشاء حالة كابا (${capaId}) من خصم جودة للموظف ${empName}.`,
        priority: priority as any,
        category: 'capa',
        sourceModule: 'quality',
        sourceRecordId: id,
        employeeId: (qualityRecord as any).employeeId || null,
        employeeName: empName,
        actionUrl: `capa:${capaCase.id}`,
      });
    } catch (notifErr) {
      console.error('[quality-create-capa] Notification error (non-blocking):', notifErr);
    }

    return NextResponse.json({ capaCase, qualityDeductionId: id }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/quality/:id/create-capa] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
