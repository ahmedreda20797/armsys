import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, sortByDateField, getEmployeeMap, getById, invalidateCache } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { createSmartNotification } from '@/lib/rules-engine';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import { isOverdueCAPA, capaOverdueDays, capaDueDateMs, isClosedCAPA, CAPA_SLA_DAYS } from '@/lib/metrics';
import type { CAPACase } from '@/types';

const SLA_DAYS = CAPA_SLA_DAYS;

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

    // ── READ SCOPE (M0.5, optional-link rule) ──
    // CAPA cases are OPTIONALLY employee-linked: an unlinked case is
    // organizational and stays visible; a linked one requires the
    // STORED employeeId — AND every relatedEmployeeIds entry —
    // inside the caller's scope (mirrors the M0.4 write rule).
    // Scope runs BEFORE filters/sort/search and BEFORE pagination:
    // the total count and every page derive from the authorized set.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(
      records as Array<{ employeeId?: string | null; relatedEmployeeIds?: string[] }>,
      scopeCtx,
      { optionalLink: true, relatedEmployeeIdsField: 'relatedEmployeeIds' },
    ) as typeof records;

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
          (r.problemDescription || '').toLowerCase().includes(lowerSearch)
      );
    }

    // Sort by createdAt descending
    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Calculate overdue and SLA info — canonical capaMetrics
    const nowDate = new Date();
    const enriched = records.map((r) => {
      const overdue = isOverdueCAPA(r, nowDate);
      const overdueDays = capaOverdueDays(r, nowDate);
      // daysRemaining only meaningful for active cases
      const dueMs = capaDueDateMs(r);
      const daysRemaining = isClosedCAPA(r)
        ? 0
        : dueMs !== null
          ? Math.max(0, Math.ceil((dueMs - nowDate.getTime()) / 86400000))
          : 0;
      return { ...r, overdueDays, daysRemaining, isOverdue: overdue, slaDays: r.slaDays || SLA_DAYS[r.priority] || 7 };
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
    // M0.2.1: creation actor identity comes from the authenticated
    // caller, never from body-supplied createdBy/createdByName (same
    // rule the M0.1 PUT fix established for timeline actors).
    const actorUser = permCheck.user ? await getById('users', permCheck.user.id) : null;
    const actorId = permCheck.user?.id || 'system';
    const actorName = actorUser?.name || actorUser?.email || 'النظام';

    const body = await request.json();

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // The CAPA employee link is optional, but when present the
    // referenced employee(s) — primary employeeId AND every
    // relatedEmployeeIds entry — must be inside the caller's employee
    // scope, checked before any existence validation. The CAPA
    // workflow itself is unchanged.
    {
      const viewer = asScopeViewer(permCheck.user!);
      const targets: string[] = [];
      if (typeof body.employeeId === 'string' && body.employeeId) targets.push(body.employeeId);
      if (Array.isArray(body.relatedEmployeeIds)) {
        for (const rid of body.relatedEmployeeIds) {
          if (typeof rid === 'string' && rid) targets.push(rid);
        }
      }
      for (const target of targets) {
        if (!(await employeeInScope(viewer, permCheck.user!.permissions, target))) {
          return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
        }
      }
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

    // ── ASSIGNEE NAME RESOLUTION (CASE: user id, employee fallback) ──
    // The CAPA UIs (quick create + detail page assignment) select
    // assignees via UserSearchInput: assignedTo / correctiveAssignedTo
    // / preventiveAssignedTo carry USER ids. Legacy records (complaint
    // escalation) may still carry employee ids, so the employee map
    // remains the fallback. An id found in neither directory resolves
    // to null — the same "unresolved" value the PUT route stores —
    // never undefined (Firebase .set() rejects it) and never a
    // fabricated name.
    const resolveAssigneeName = async (id: unknown): Promise<string | null> => {
      if (typeof id !== 'string' || !id) return null;
      const user = await getById('users', id);
      if (user) return user.name || user.email || null;
      return empMap.get(id)?.name ?? null;
    };

    const assignedToName = await resolveAssigneeName(body.assignedTo);
    // employeeId is existence-validated above via a direct read; the
    // employee map can still be a stale cache snapshot, so a miss
    // normalizes to null — never undefined.
    const employeeName = body.employeeId ? empMap.get(body.employeeId)?.name ?? null : null;
    const correctiveName = await resolveAssigneeName(body.correctiveAssignedTo);
    const preventiveName = await resolveAssigneeName(body.preventiveAssignedTo);

    const initialTimeline = [
      {
        id: `tl-${Date.now()}`,
        action: 'case_created',
        description: 'تم إنشاء حالة كابا',
        performedBy: actorId,
        performedByName: actorName,
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
      createdBy: actorId,
      createdByName: actorName,
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

    // §13: automation event — active capa-module rules fire here.
    void dispatchAutomationEvent('record_created', 'capa', {
      employeeId: body.employeeId || null,
      employeeName,
      department: body.department || null,
      status: capaCase.status,
      priority: capaCase.priority,
      category: capaCase.issueCategory,
      sourceRecordId: capaCase.id,
      extra: { capaId: capaCase.capaId, slaDays },
    });

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
