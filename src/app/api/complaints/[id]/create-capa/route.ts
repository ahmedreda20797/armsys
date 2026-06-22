import { NextRequest, NextResponse } from 'next/server';
import { getById, createRecord, getAll, getEmployeeMap, updateRecord, invalidateCache } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';

// ══════════════════════════════════════════════════════════════
//  POST /api/complaints/[id]/create-capa
//  Creates a linked CAPA case from a Complaint (supports multiple CAPAs per complaint)
// ══════════════════════════════════════════════════════════════

const SLA_DAYS_MAP: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const permCheck = await verifyPermission(request, 'complaints', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const complaint = await getById('complaints', id);
    if (!complaint) {
      return NextResponse.json({ error: 'Complaint not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const priority = body.priority || (complaint as any).severity || 'high';
    const slaDays = SLA_DAYS_MAP[priority] || 3;

    // Auto-generate CAPA ID
    const allCases = await getAll('capaCases');
    const year = new Date().getFullYear();
    const existingThisYear = allCases.filter((c: any) => c.capaId?.includes(`CAPA-${year}`));
    const nextNum = existingThisYear.length + 1;
    const capaId = `CAPA-${year}-${String(nextNum).padStart(3, '0')}`;

    const empMap = await getEmployeeMap();
    const createdBy = permCheck.user?.id || 'system';
    const createdByName = permCheck.user ? (empMap.get(permCheck.user.id)?.name || 'النظام') : 'النظام';

    const complaintDetails = [
      `العميل: ${(complaint as any).customerName}`,
      `نوع الشكوى: ${(complaint as any).complaintType}`,
      `الشدة: ${(complaint as any).severity}`,
      `الموظف: ${(complaint as any).employeeName || 'غير محدد'}`,
    ].join(' | ');

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: `تم إنشاء حالة كابا من شكوى عميل (${(complaint as any).complaintType})`,
        performedBy: createdBy,
        performedByName: createdByName,
        timestamp: new Date().toISOString(),
      },
    ];

    const capaCase = await createRecord('capaCases', {
      capaId,
      title: `كابا من شكوى: ${(complaint as any).customerName} — ${(complaint as any).complaintType}`,
      department: (complaint as any).department || '',
      employeeId: (complaint as any).employeeId || null,
      employeeName: (complaint as any).employeeName || null,
      relatedFollowUpId: null,
      relatedRiskId: null,
      relatedComplaintId: id,
      relatedQualityDeductionId: null,
      relatedHrDeductionId: null,
      createdBy,
      createdByName,
      issueCategory: 'customer_complaint',
      problemDescription: complaintDetails + '\n\n' + ((complaint as any).description || ''),
      impactLevel: priority,
      impactDescription: '',
      rootCauseCategory: '',
      rootCauseDescription: '',
      rootCauseVerification: '',
      correctiveAction: '',
      correctiveAssignedTo: (complaint as any).responsiblePerson || '',
      correctiveAssignedToName: (complaint as any).responsiblePerson
        ? (empMap.get((complaint as any).responsiblePerson)?.name || null)
        : null,
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
      assignedTo: (complaint as any).responsiblePerson || '',
      assignedToName: null,
      closureDate: '',
      closedBy: '',
      closedByName: null,
      finalComments: '',
      relatedEmployeeIds: [],
      source: 'complaint',
      timeline: initialTimeline,
      attachments: [],
      lessonsLearned: '',
      slaDays,
      overdueDays: 0,
      closedAt: null,
    });

    // Link complaint to CAPA (add to relatedCapaIds array — supports multiple CAPAs)
    const existingCapaIds: string[] = (complaint as any).relatedCapaIds || [];
    const updatedCapaIds = [...existingCapaIds, capaCase.id];
    await updateRecord('complaints', id, { relatedCapaIds: updatedCapaIds });
    invalidateCache('complaints');
    invalidateCache('capaCases');

    // Generate notification
    try {
      await createSmartNotification({
        title: `تم إنشاء كابا من شكوى: ${(complaint as any).customerName}`,
        description: `تم إنشاء حالة كابا (${capaId}) من شكوى العميل "${(complaint as any).customerName}".`,
        priority: priority as any,
        category: 'capa',
        sourceModule: 'complaints',
        sourceRecordId: id,
        employeeId: (complaint as any).employeeId || null,
        employeeName: (complaint as any).employeeName || null,
        assignedTo: (complaint as any).responsiblePerson || null,
        actionUrl: `capa:${capaCase.id}`,
      });
    } catch (notifErr) {
      console.error('[complaint-create-capa] Notification error (non-blocking):', notifErr);
    }

    return NextResponse.json({ capaCase, complaintId: id, totalLinkedCapas: updatedCapaIds.length }, { status: 201 });
  } catch (error) {
    console.error('[POST /api/complaints/:id/create-capa] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
