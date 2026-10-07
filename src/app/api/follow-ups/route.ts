import { NextRequest, NextResponse } from 'next/server';
import { getAll, withEmployee, sortByDateField, createRecord, getById } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { asScopeViewer, employeeInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { computeRisk, isOverdueFollowUp, isDueToday } from '@/lib/metrics';
import { createSmartNotification } from '@/lib/rules-engine';
import { dispatchAutomationEvent } from '@/lib/automation/event-bridge';
import { assertSimpleValueIsActive } from '@/lib/master-data/simple-lists';
import { monthBounds, resolveFollowUpsMonth } from '@/lib/followups-period';

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

    // §28 SECURITY — explicit page-permission gate on GET (the employee
    // scope filter below stays the DATA boundary; server-side).
    const viewCheck = await verifyPermission(request, 'followUps', 'view');
    if (!viewCheck.allowed) {
      return NextResponse.json({ error: viewCheck.error }, { status: 403 });
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
    // §PERF-FOLLOWUPS — the PERIOD dimension, server-side. The selected
    // month ("YYYY-MM", project-wide convention) bounds the RESPONSE:
    // the client never receives history outside the requested period.
    // An explicit startDate/endDate range (custom window) overrides the
    // month when present; with NEITHER, the period defaults to the
    // CURRENT calendar month — an unparameterized request can never
    // return the full historical dataset again. The RTDB read itself
    // stays the proven full-node .get() behind the shared table cache:
    // indexed orderByChild range queries hang on this network (see the
    // user-lookup breaker in lib/db), so the safe bound is applied
    // here, post-scope, pre-serialization.
    const hasExplicitRange = Boolean(startDate || endDate);
    const month = hasExplicitRange ? null : resolveFollowUpsMonth(searchParams.get('month'));

    const t0 = performance.now();

    let records = await getAll('followUps');

    // ── READ SCOPE (M0.5) ──
    // Follow-ups are employee-linked through their STORED employeeId
    // — the authoritative relationship. Scope runs BEFORE all filters
    // (employeeId/status/date/department/…), so no filter, deal id
    // or date window can widen visibility. The per-employee risk
    // aggregate below then derives from the authorized dataset only.
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    records = filterRowsByEmployeeScope(records as Array<{ employeeId?: string | null }>, scopeCtx);

    // The authorized population — the attention set below is derived
    // from it (no month window), the period-bounded list from
    // `records` after the restriction.
    const scopedRecords = records;

    // ── PERIOD RESTRICTION (after scope, before any other filter) ──
    // Membership uses the canonical record `date` (YYYY-MM-DD day key
    // → pure string comparison against the month bounds; no UTC
    // arithmetic). Due/overdue logic is NOT part of this window —
    // nextFollowUpDate drives the attention set below, untouched.
    if (hasExplicitRange) {
      if (startDate) records = records.filter((r: any) => r.date >= startDate);
      if (endDate) records = records.filter((r: any) => r.date <= endDate);
    } else {
      const { start, endExclusive } = monthBounds(month!);
      records = records.filter((r: any) => r.date >= start && r.date < endExclusive);
    }

    // ── ATTENTION SET (§PERF-FOLLOWUPS) ──
    // The AttentionPanel must keep showing the REAL overdue / due-today
    // population across ALL months (Home's cards count this same set),
    // so it is computed over the SAME authorized (scope-filtered)
    // dataset with the CANONICAL predicates — one request, one data
    // source, no second fetch, no month window.
    const attentionOverdue = sortByDateField(
      scopedRecords.filter((r: any) => isOverdueFollowUp(r)),
      'nextFollowUpDate',
      'asc',
    );
    const attentionDueToday = scopedRecords.filter((r: any) => isDueToday(r));

    if (employeeId) records = records.filter((r: any) => r.employeeId === employeeId);
    if (status) records = records.filter((r: any) => r.status === status);
    if (type) records = records.filter((r: any) => r.followUpType === type);
    if (priority) records = records.filter((r: any) => r.priorityLevel === priority);
    if (responsiblePerson) records = records.filter((r: any) => r.responsiblePerson === responsiblePerson);
    if (department) records = records.filter((r: any) => r.department === department);
    if (followedBy) records = records.filter((r: any) => r.createdById === followedBy);

    records = sortByDateField(records, 'date', 'desc');

    const recordsWithEmployee = await withEmployee(
      records.filter((r: any) => r.employeeId) as any[]
    );

    const enrichedMap = new Map(recordsWithEmployee.map((r: any) => [r.id, r]));
    const merged = records.map((r: any) => enrichedMap.get(r.id) || r);

    // Calculate risk scores for employee summary — canonical computeRisk()
    // (derived from the PERIOD-BOUNDED dataset — the grouped view these
    // scores feed shows exactly that period).
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

    // §PERF-FOLLOWUPS diagnostics — prove the bound (records considered
    // post-scope vs returned) in DEV only; no verbose production logging.
    const durationMs = Math.round(performance.now() - t0);
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        `[follow-ups] period=${hasExplicitRange ? `${startDate ?? ''}..${endDate ?? ''}` : month} `
        + `scoped=${scopedRecords.length} returned=${merged.length} `
        + `attention(overdue=${attentionOverdue.length},dueToday=${attentionDueToday.length}) ${durationMs}ms`,
      );
    }

    return NextResponse.json({
      data: merged,
      employeeRiskScores: Object.fromEntries(empRiskMap),
      attention: { overdue: attentionOverdue, dueToday: attentionDueToday },
      meta: { month: hasExplicitRange ? null : month, count: merged.length },
    });
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

    // ── §MASTER-DATA deactivation guard — a type deactivated in the
    // Settings Center cannot be selected for NEW records (unknown /
    // legacy values stay accepted; deactivation guard, not a whitelist).
    const masterDataGuard = await assertSimpleValueIsActive('followUpTypes', followUpType);
    if (masterDataGuard) {
      return NextResponse.json({ error: masterDataGuard }, { status: 400 });
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
        // §NOTIFICATIONS-DEEPLINK — the risk alert carries its real
        // case count (never a hardcoded "3") plus the structured
        // context the Risk Center consumes: WHO (employeeId), WHICH
        // period (the current risk month), WHY (case count).
        const riskCaseCount = recentCases.length + 1;
        const nowForMonth = new Date();
        const riskMonth = `${nowForMonth.getFullYear()}-${String(nowForMonth.getMonth() + 1).padStart(2, '0')}`;
        await createSmartNotification({
          title: `تنبيه مخاطر - ${riskCaseCount} حالات للموظف`,
          description: `الموظف "${empName}" لديه ${riskCaseCount} حالات متابعة خلال آخر 30 يوم. يرجى المراجعة.`,
          priority: 'high',
          category: 'risk',
          sourceModule: 'riskCenter',
          sourceRecordId: employeeId,
          targetPage: 'riskCenter',
          employeeId: employeeId,
          employeeName: empName,
          sourceType: 'manual',
          navParams: {
            employeeId,
            employeeName: empName,
            month: riskMonth,
            caseCount: String(riskCaseCount),
            source: 'followUps',
          },
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