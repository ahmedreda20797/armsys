import { NextRequest, NextResponse } from 'next/server';
import { getAll, withEmployee, sortByDateField, createRecord, getById } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { computeRisk, isOverdueFollowUp } from '@/lib/metrics';
import { createSmartNotification } from '@/lib/rules-engine';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';

const SCORE_MAP: Record<string, number> = { low: 1, medium: 3, high: 5, critical: 10 };
const ACTIVE_FOLLOWUP_STATUSES = ['open', 'under_review', 'under_follow_up'] as const;

async function getUsernameById(userId: string): Promise<string> {
  const user = await getById('users', userId);
  return user?.name || 'النظام';
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const priority = searchParams.get('priority');
    const responsiblePerson = searchParams.get('responsiblePerson');
    const department = searchParams.get('department');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const followedBy = searchParams.get('followedBy');

    let records = await getAll('followUps');

    // ── READ SCOPE (M0.5) ──
    // Follow-ups are employee-linked through their STORED employeeId
    // — the authoritative relationship. Scope runs BEFORE all filters
    // (employeeId/status/date/department/…), so no filter, deal id
    // or date window can widen visibility. The per-employee risk
    // aggregate below then derives from the authorized dataset only.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    if (employeeId) records = records.filter((r: any) => r.employeeId === employeeId);
    if (status) records = records.filter((r: any) => r.status === status);
    if (type) records = records.filter((r: any) => r.followUpType === type);
    if (priority) records = records.filter((r: any) => r.priorityLevel === priority);
    if (responsiblePerson) records = records.filter((r: any) => r.responsiblePerson === responsiblePerson);
    if (department) records = records.filter((r: any) => r.department === department);
    if (startDate) records = records.filter((r: any) => r.date >= startDate);
    if (endDate) records = records.filter((r: any) => r.date <= endDate);
    if (followedBy) records = records.filter((r: any) => r.createdById === followedBy);

    records = sortByDateField(records, 'date', 'desc');

    const recordsWithEmployee = await withEmployee(
      records.filter((r: any) => r.employeeId) as any[]
    );

    const enrichedMap = new Map(recordsWithEmployee.map((r: any) => [r.id, r]));
    const merged = records.map((r: any) => enrichedMap.get(r.id) || r);

    // Calculate risk scores for employee summary — canonical computeRisk()
    const empFollowUpMap = new Map<string, any[]>();
    for (const r of merged) {
      const eid = (r as any).employeeId;
      if (!eid) continue;
      if (!empFollowUpMap.has(eid)) empFollowUpMap.set(eid, []);
      empFollowUpMap.get(eid)!.push(r);
    }
    const empRiskMap = new Map<string, number>();
    for (const [eid, fuList] of empFollowUpMap) {
      const open = fuList.filter((f: any) => ACTIVE_FOLLOWUP_STATUSES.includes(f.status));
      const high = fuList.filter((f: any) => f.priorityLevel === 'high' && ACTIVE_FOLLOWUP_STATUSES.includes(f.status));
      const critical = fuList.filter((f: any) => f.priorityLevel === 'critical' && ACTIVE_FOLLOWUP_STATUSES.includes(f.status));
      const risk = computeRisk({
        delayCount: 0, absenceCount: 0, qualityCount: 0, hrCount: 0,
        openFollowUpCount: open.length,
        highPriorityFollowUpCount: high.length,
        criticalFollowUpCount: critical.length,
        openComplaintCount: 0,
        repeatedIssueCount: 0,
        openCapaCount: 0, overdueCapaCount: 0, criticalCapaCount: 0, reopenedCapaCount: 0,
      });
      empRiskMap.set(eid, risk.score);
    }

    return NextResponse.json({ data: merged, employeeRiskScores: Object.fromEntries(empRiskMap) });
  } catch (error) {
    console.error('Fetch follow-ups error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { verifyPermission } = await import('@/lib/verify-permission');
    const permCheck = await verifyPermission(request, 'followUps', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const {
      employeeId,
      date,
      followUpType,
      subject,
      detailedDescription,
      positiveNotes,
      negativeNotes,
      rootCause,
      actionTaken,
      department,
      position,
      priorityLevel,
      responsiblePerson,
      nextFollowUpDate,
      followUpRequired,
      status,
      attachments,
      evidence,
      relatedDeductionId,
      relatedCapaId,
    } = body;

    if (!employeeId || !date || !followUpType || !subject) {
      return NextResponse.json(
        { error: 'Employee, date, type, and subject are required' },
        { status: 400 }
      );
    }

    // ── TARGET-EMPLOYEE SCOPE (M0.4) ──
    // Follow-ups are employee-linked records: the target employee
    // (body.employeeId) must be inside the caller's employee scope
    // BEFORE validation and create; out-of-scope is denied without
    // revealing existence.
    const inScope = await employeeInScope(
      asScopeViewer(permCheck.user!),
      permCheck.user!.permissions,
      employeeId,
    );
    if (!inScope) {
      return NextResponse.json({ error: 'صلاحية غير كافية' }, { status: 403 });
    }

    // Validate employee exists and is active
    const { validateEmployeeId } = await import('@/lib/validate-employee');
    const empValidation = await validateEmployeeId(employeeId, true);
    if (!empValidation.valid) {
      return NextResponse.json(
        { error: empValidation.error },
        { status: 400 }
      );
    }

    // Auto-calculate score
    const score = SCORE_MAP[priorityLevel] || 3;

    // Get creator info from JWT-verified auth
    const userId = permCheck.user?.id || 'system';
    const userName = permCheck.user ? await getUsernameById(permCheck.user.id) : 'النظام';

    // Get employee info for department/position
    const employees = await getAll('employees');
    const empRecord = employees.find((e: any) => e.id === employeeId);
    const autoDept = department || empRecord?.department || '';
    const autoPos = position || empRecord?.position || '';
    const empName = empRecord?.name || '';

    const followUp = await createRecord('followUps', {
      employeeId,
      employeeName: empName,
      date,
      followUpType,
      subject: subject || '',
      detailedDescription: detailedDescription || '',
      positiveNotes: positiveNotes || '',
      negativeNotes: negativeNotes || '',
      rootCause: rootCause || '',
      actionTaken: actionTaken || '',
      department: autoDept,
      position: autoPos,
      priorityLevel: priorityLevel || 'medium',
      responsiblePerson: responsiblePerson || '',
      nextFollowUpDate: nextFollowUpDate || null,
      followUpRequired: followUpRequired !== false,
      status: status || 'open',
      score,
      attachments: attachments || [],
      // §EVIDENCE — dedicated evidence/link field (URL, Drive link,
      // document link). Never scraped from the description text.
      evidence: typeof evidence === 'string' && evidence.trim() !== '' ? evidence.trim() : null,
      createdById: userId,
      createdByName: userName,
      relatedDeductionId: relatedDeductionId || null,
      relatedCapaId: relatedCapaId || null,
    });

    // ═══ Create notifications (using AppNotification schema) ═══
    // §13: automation event — active followUps-module rules fire here.
    void dispatchAutomationEvent('record_created', 'followUps', {
      employeeId,
      employeeName: empName,
      department: autoDept,
      status: status || 'open',
      priority: priorityLevel || 'medium',
      sourceRecordId: (followUp as any).id,
      extra: { followUpType, subject: subject || null },
    });
    try {
      const respRecord = employees.find((e: any) => e.id === responsiblePerson);
      const respName = respRecord?.name || 'مسؤول';

      await createSmartNotification({
        title: 'متابعة جديدة مُسندة إليك',
        description: `تم تعيين متابعة جديدة للموظف "${empName}" - الموضوع: ${subject || 'بدون موضوع'}. تاريخ المتابعة القادمة: ${nextFollowUpDate || 'غير محدد'}.`,
        priority: priorityLevel === 'critical' ? 'critical' : priorityLevel === 'high' ? 'high' : 'medium',
        category: 'followUp',
        sourceModule: 'followUps',
        sourceRecordId: (followUp as any).id,
        targetPage: 'followUps',
        employeeId: employeeId,
        employeeName: empName,
        assignedTo: responsiblePerson,
        assignedToName: respName,
        sourceType: 'manual',
      });

      // Critical case notification to admin
      if (priorityLevel === 'critical') {
        await createSmartNotification({
          title: 'حالة حرجة - متابعة جديدة',
          description: `تم إنشاء حالة حرجة للموظف "${empName}" - الموضوع: ${subject}. الأولوية: حرجة.`,
          priority: 'critical',
          category: 'risk',
          sourceModule: 'followUps',
          sourceRecordId: (followUp as any).id,
          targetPage: 'followUps',
          employeeId: employeeId,
          employeeName: empName,
          sourceType: 'manual',
        });
      }

      // Check if employee has 3+ cases in last 30 days
      const allFollowUps = await getAll('followUps');
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];
      const recentCases = allFollowUps.filter(
        (f: any) => f.employeeId === employeeId && f.date >= thirtyDaysAgoStr && f.id !== (followUp as any).id
      );
      if (recentCases.length >= 2) { // 2 existing + 1 new = 3
        await createSmartNotification({
          title: 'تنبيه مخاطر - 3 حالات للموظف',
          description: `الموظف "${empName}" لديه ${recentCases.length + 1} حالات متابعة خلال آخر 30 يوم. يرجى المراجعة.`,
          priority: 'high',
          category: 'risk',
          sourceModule: 'riskCenter',
          sourceRecordId: employeeId,
          targetPage: 'riskCenter',
          employeeId: employeeId,
          employeeName: empName,
          sourceType: 'manual',
        });
      }
    } catch (notifError) {
      console.error('Failed to create notifications:', notifError);
    }

    return NextResponse.json(followUp, { status: 201 });
  } catch (error) {
    console.error('Create follow-up error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}