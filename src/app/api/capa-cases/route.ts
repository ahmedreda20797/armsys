import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, getEmployeeMap, invalidateCache } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { createSmartNotification } from '@/lib/rules-engine';
import type { CAPACase } from '@/types';

const SLA_DAYS: Record<string, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
};

// ══════════════════════════════════════════════════════════════
//  GET /api/capa-cases — Fetch with server-side filtering
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const priority = searchParams.get('priority');
    const department = searchParams.get('department');
    const assignedTo = searchParams.get('assignedTo');
    const issueCategory = searchParams.get('issueCategory');
    const employeeId = searchParams.get('employeeId');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let records = await getAll<CAPACase>('capaCases');

    // Server-side filters
    if (status) records = records.filter((r) => r.status === status);
    if (priority) records = records.filter((r) => r.priority === priority);
    if (department) records = records.filter((r) => r.department === department);
    if (assignedTo) records = records.filter((r) => r.assignedTo === assignedTo);
    if (issueCategory) records = records.filter((r) => r.issueCategory === issueCategory);
    if (employeeId) records = records.filter((r) => r.employeeId === employeeId);
    if (search) {
      const lowerSearch = search.toLowerCase();
      records = records.filter(
        (r) =>
          r.title.toLowerCase().includes(lowerSearch) ||
          r.capaId.toLowerCase().includes(lowerSearch) ||
          r.problemDescription.toLowerCase().includes(lowerSearch)
      );
    }

    // Sort by createdAt descending
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Calculate overdue and SLA info
    const now = Date.now();
    const enriched = records.map((r) => {
      const dueDate = r.correctiveDueDate || r.createdAt;
      const slaDays = r.slaDays || SLA_DAYS[r.priority] || 7;
      const dueMs = new Date(dueDate).getTime() + slaDays * 86400000;
      const overdueDays = r.status === 'closed' ? 0 : Math.max(0, Math.floor((now - dueMs) / 86400000));
      const daysRemaining = r.status === 'closed' ? 0 : Math.max(0, Math.ceil((dueMs - now) / 86400000));
      const isOverdue = r.status !== 'closed' && r.status !== 'rejected' && now > dueMs;
      return { ...r, overdueDays, daysRemaining, isOverdue, slaDays };
    });

    // Pagination
    const paginated = enriched.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      total: enriched.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[GET /api/capa-cases] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/capa-cases — Create new CAPA case
// ══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'capa', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    // Validate employee exists if provided (optional field)
    if (body.employeeId) {
      const { validateEmployeeId } = await import('@/lib/validate-employee');
      const empValidation = await validateEmployeeId(body.employeeId, false);
      if (!empValidation.valid) {
        return NextResponse.json({ error: empValidation.error }, { status: 400 });
      }
    }

    // Auto-generate CAPA ID
    const allCases = await getAll<CAPACase>('capaCases');
    const year = new Date().getFullYear();
    const existingThisYear = allCases.filter((c) => c.capaId?.includes(`CAPA-${year}`));
    const nextNum = existingThisYear.length + 1;
    const capaId = `CAPA-${year}-${String(nextNum).padStart(3, '0')}`;

    const slaDays = SLA_DAYS[body.priority] || 7;

    const validStatuses = ['open', 'investigation', 'root_cause_analysis', 'corrective_action', 'preventive_action', 'verification', 'closed', 'rejected', 'reopened'];
    const validPriorities = ['low', 'medium', 'high', 'critical'];

    const empMap = await getEmployeeMap();

    const assignedToName = body.assignedTo ? empMap.get(body.assignedTo)?.name : null;
    const employeeName = body.employeeId ? empMap.get(body.employeeId)?.name : null;
    const correctiveName = body.correctiveAssignedTo ? empMap.get(body.correctiveAssignedTo)?.name : null;
    const preventiveName = body.preventiveAssignedTo ? empMap.get(body.preventiveAssignedTo)?.name : null;

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: 'تم إنشاء حالة كابا',
        performedBy: body.createdBy || 'system',
        performedByName: body.createdByName || 'النظام',
        timestamp: new Date().toISOString(),
      },
    ];

    const capaCase = await createRecord<CAPACase>('capaCases', {
      capaId,
      title: body.title,
      department: body.department || '',
      employeeId: body.employeeId || null,
      employeeName,
      relatedFollowUpId: body.relatedFollowUpId || null,
      relatedRiskId: body.relatedRiskId || null,
      relatedComplaintId: body.relatedComplaintId || null,
      relatedQualityDeductionId: body.relatedQualityDeductionId || null,
      relatedHrDeductionId: body.relatedHrDeductionId || null,
      createdBy: body.createdBy || 'system',
      createdByName: body.createdByName || 'النظام',
      issueCategory: body.issueCategory || 'other',
      problemDescription: body.problemDescription || '',
      impactLevel: validPriorities.includes(body.impactLevel) ? body.impactLevel : 'medium',
      impactDescription: body.impactDescription || '',
      rootCauseCategory: body.rootCauseCategory || '',
      rootCauseDescription: body.rootCauseDescription || '',
      rootCauseVerification: body.rootCauseVerification || '',
      correctiveAction: body.correctiveAction || '',
      correctiveAssignedTo: body.correctiveAssignedTo || '',
      correctiveAssignedToName: correctiveName || null,
      correctiveDueDate: body.correctiveDueDate || '',
      correctiveStatus: body.correctiveStatus || 'not_started',
      correctiveEvidence: body.correctiveEvidence || '',
      preventiveAction: body.preventiveAction || '',
      preventiveAssignedTo: body.preventiveAssignedTo || '',
      preventiveAssignedToName: preventiveName || null,
      preventiveDueDate: body.preventiveDueDate || '',
      preventiveStatus: body.preventiveStatus || 'not_started',
      preventiveVerificationMethod: body.preventiveVerificationMethod || '',
      verificationDate: '',
      verifiedBy: '',
      verifiedByName: null,
      verificationResult: '',
      verificationNotes: '',
      status: validStatuses.includes(body.status) ? body.status : 'open',
      priority: validPriorities.includes(body.priority) ? body.priority : 'medium',
      assignedTo: body.assignedTo || '',
      assignedToName,
      closureDate: '',
      closedBy: '',
      closedByName: null,
      finalComments: '',
      relatedEmployeeIds: body.relatedEmployeeIds || [],
      source: body.source || 'manual',
      timeline: initialTimeline,
      attachments: [],
      lessonsLearned: '',
      slaDays,
      overdueDays: 0,
      closedAt: null,
    });

    invalidateCache('capaCases');

    // ── Task 3: CAPA Created Notification ──
    try {
      await createSmartNotification({
        title: `تم إنشاء حالة كابا: ${capaCase.title}`,
        description: `تم إنشاء حالة كابا جديدة (${capaCase.capaId}) بأولوية ${capaCase.priority} في قسم ${capaCase.department || 'غير محدد'}. المهلة: ${slaDays} يوم.`,
        priority: capaCase.priority === 'critical' ? 'critical' : capaCase.priority === 'high' ? 'high' : 'medium',
        category: 'capa',
        sourceModule: 'capa',
        sourceRecordId: capaCase.id,
        employeeId: capaCase.employeeId || null,
        employeeName: capaCase.employeeName || null,
        assignedTo: capaCase.assignedTo || null,
        assignedToName: capaCase.assignedToName || null,
        actionUrl: `capa:${capaCase.id}`,
      });
    } catch (notifErr) {
      console.error('[POST /api/capa-cases] Notification error (non-blocking):', notifErr);
    }

    // ── Task 3: CAPA Assigned Notification (if assigned during creation) ──
    if (capaCase.assignedTo) {
      try {
        await createSmartNotification({
          title: `تم تعيينك لحالة كابا: ${capaCase.title}`,
          description: `تم تعيينك لحالة كابا (${capaCase.capaId}) بأولوية ${capaCase.priority}. يرجى البدء بالمعالجة خلال المهلة المحددة (${slaDays} يوم).`,
          priority: 'medium',
          category: 'capa',
          sourceModule: 'capa',
          sourceRecordId: capaCase.id,
          employeeId: capaCase.assignedTo,
          employeeName: capaCase.assignedToName || null,
          assignedTo: capaCase.assignedTo,
          assignedToName: capaCase.assignedToName || null,
          actionUrl: `capa:${capaCase.id}`,
        });
      } catch (notifErr) {
        console.error('[POST /api/capa-cases] Assignment notification error (non-blocking):', notifErr);
      }
    }

    return NextResponse.json(capaCase, { status: 201 });
  } catch (error) {
    console.error('[POST /api/capa-cases] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
