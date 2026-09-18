import { NextRequest, NextResponse } from 'next/server';
import { getAll, getById, findWhere, findWhereContains } from '@/lib/db';
import { authorize, authorizeRequest } from '@/lib/verify-permission';
import { resolveEmployee360SectionGate, filterTimelineByGate } from '@/lib/permissions/employee360-access';
import { loadScopeAssignments } from '@/lib/scope/server';
import { resolveFieldAccess, resolvePageScope } from '@/config/permissions';
import { isEffectiveDeduction } from '@/lib/quality-deductions/domain';
import { resolveEmployeeOrgLabels, buildEmployeeOrgIndex } from '@/lib/reports/employee-org';
import { resolveManagerChain } from '@/lib/organization/graph';
import { resolveEmployeeScope } from '@/lib/scope';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';
import type { Employee } from '@/types';
// Canonical metric layer — single source of truth for risk + CAPA overdue.
import {
  computeRisk,
  isOverdueCAPA,
  isClosedCAPA,
  isTerminalCAPA,
  calcCAPAEffectiveness,
  type RiskBreakdown,
} from '@/lib/metrics';

// ══════════════════════════════════════════════════════════════
//  Safe fetch helper — never throws, returns empty array on failure
// ══════════════════════════════════════════════════════════════
async function safe<T>(promise: Promise<T>): Promise<T | []> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[employee-360] safe fetch failed:', (err as Error).message);
    return [];
  }
}

// ══════════════════════════════════════════════════════════════
//  Employee 360 Profile API
//  Aggregates data from ALL modules for a single employee
//  Uses Promise.allSettled so missing Firebase tables don't crash
// ══════════════════════════════════════════════════════════════

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ═══ AUTHORIZATION (canonical decision path) ═══
    // ONE authentication (authorizeRequest), TWO page decisions:
    //   • 'employees' — carries the record DATA SCOPE for this route
    //   • 'employee360' — the PAGE permission of the overlay itself
    // Both resolve through the single authorizer; the caller keeps
    // its raw permission tiers so no second DB read is needed.
    const { caller, decision } = await authorizeRequest(request, { page: 'employees', action: 'view' });
    if (!decision.allowed || !caller) {
      return NextResponse.json({ error: 'ليس لديك صلاحية' }, { status: 403 });
    }
    const pageDecision = authorize(caller, { page: 'employee360' });
    if (!pageDecision.allowed) {
      return NextResponse.json({ error: pageDecision.reason }, { status: 403 });
    }

    // SECTION-LEVEL ENFORCEMENT (server-side, canonical resolver):
    // a denied section's data is withheld below — never serialized.
    // Resolved once from the already-loaded effective map (no extra reads).
    const sectionGate = resolveEmployee360SectionGate(caller.permissions);

    const { id: employeeId } = await params;

    if (!employeeId) {
      return NextResponse.json({ error: 'معرف الموظف مطلوب' }, { status: 400 });
    }

    // ═══ Fetch employee base data ═══
    const employee = await getById('employees', employeeId);
    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // ═══ DATA SCOPE (M0.3 — employee detail IDOR guard) ═══
    // This route is gated by the 'employees' page permission, so the
    // SAME entry's scope governs the detail view. The canonical
    // engine (resolveEmployeeScope) decides; an out-of-scope id
    // resolves as NOT FOUND — identical body to the missing-employee
    // path above, so enumeration learns nothing. The check runs
    // BEFORE any aggregation; the org graph is only loaded when the
    // viewer's scope is not already 'all' (admin/HR/quality fast
    // path).
    const viewer = {
      id: caller.userId,
      role: caller.role,
      permissions: caller.permissions,
      linkedEmployeeId: caller.linkedEmployeeId ?? null,
    };
    const scope = resolvePageScope(viewer.permissions, 'employees', viewer.role);
    if (scope !== 'all') {
      const [orgNodes, employees] = await Promise.all([
        getAll<OrgNode>(ORG_NODES_TABLE),
        getAll<{ id: string; orgNodeId?: string | null }>('employees'),
      ]);
      const scopeContext = resolveEmployeeScope(
        {
          userId: viewer.id,
          role: viewer.role,
          linkedEmployeeId: viewer.linkedEmployeeId ?? null,
        },
        'employees',
        viewer.permissions,
        {
          orgNodes,
          employees,
          // §ASSIGNED — canonical assignment pairs, lazily loaded only
          // for the assigned scope.
          assignments: scope === 'assigned' ? await loadScopeAssignments() : undefined,
        },
      );
      if (!scopeContext.includes(employeeId)) {
        return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
      }
    }

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const datePattern = `/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    // ═══ Parallel fetch from ALL data sources — using Promise.allSettled ═══
    // Each table that doesn't exist in Firebase will be caught gracefully
    const results = await Promise.allSettled([
      findWhereContains('attendance', 'date', datePattern),
      findWhereContains('biometrics', 'date', datePattern),
      findWhereContains('requests', 'date', datePattern),
      // §WORKFLOW — only APPROVED discounts affect the employee profile.
      findWhere('qualityDeductions', { month: currentMonth }).then((rs) => rs.filter(isEffectiveDeduction)),
      findWhere('hrDeductions', { month: currentMonth }),
      getAll('followUps'),
      getAll('travelDeals'),
      getAll('complaints'),
      getAll('capaCases'),
      // §2 — quality observations + org identity sources.
      getAll('qualityObservations'),
      getAll<OrgNode>('orgNodes'),
      getAll('users'),
    ]);

    // Extract fulfilled results or fall back to empty array
    const allAttendance   = results[0].status === 'fulfilled' ? results[0].value : [];
    const allBiometrics   = results[1].status === 'fulfilled' ? results[1].value : [];
    const allRequests     = results[2].status === 'fulfilled' ? results[2].value : [];
    const allQualityDeductions = results[3].status === 'fulfilled' ? results[3].value : [];
    const allHrDeductions = results[4].status === 'fulfilled' ? results[4].value : [];
    const allFollowUps    = results[5].status === 'fulfilled' ? results[5].value : [];
    const allTravelDeals  = results[6].status === 'fulfilled' ? results[6].value : [];
    const allComplaints   = results[7].status === 'fulfilled' ? results[7].value : [];
    const allCapaCases    = results[8].status === 'fulfilled' ? results[8].value : [];
    const allObservations = results[9].status === 'fulfilled' ? results[9].value : [];
    const allOrgNodes     = results[10].status === 'fulfilled' ? results[10].value : [];
    const allUsers        = results[11].status === 'fulfilled' ? results[11].value : [];

    // ═══ Filter by employee ═══
    const empAttendance = (allAttendance as any[]).filter((r) => r.employeeId === employeeId);
    const empBiometrics = (allBiometrics as any[]).filter((r) => r.employeeId === employeeId);
    const empRequests = (allRequests as any[]).filter((r) => r.employeeId === employeeId);
    const empQuality = (allQualityDeductions as any[]).filter((r) => r.employeeId === employeeId);
    const empHrDeductions = (allHrDeductions as any[]).filter((r) => r.employeeId === employeeId);
    const empFollowUps = (allFollowUps as any[]).filter((r) => r.employeeId === employeeId);
    const empTravel = (allTravelDeals as any[]).filter((r) => r.employeeId === employeeId);
    const empComplaints = (allComplaints as any[]).filter((r) => r.employeeId === employeeId);
    // §2 — CAPA links via employeeId OR relatedEmployeeIds (the SAME
    // rule the risk-center uses — the two views can never disagree).
    const empCapa = (allCapaCases as any[]).filter((r) =>
      r.employeeId === employeeId || (r.relatedEmployeeIds || []).includes(employeeId)
    );

    // §2 — quality observations for this employee.
    const empObservations = (allObservations as any[]).filter((r) => r.employeeId === employeeId);

    // §2 — repeated issues: same follow-up TYPE more than once within
    // 30 days (canonical repeated-issue semantics from the risk engine).
    const thirtyDaysAgoStr = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const repeatedIssueCount = empFollowUps.filter((f) =>
      empFollowUps.some((other) =>
        other.id !== f.id
        && other.employeeId === f.employeeId
        && other.followUpType === f.followUpType
        && other.date >= thirtyDaysAgoStr),
    ).length > 0 ? 1 : 0;

    // ═══ Attendance stats ═══
    const totalPresent = empAttendance.filter((a) => a.status === 'present').length;
    const totalLate = empAttendance.filter((a) => a.status === 'late').length;
    const totalAbsent = empAttendance.filter((a) => a.status === 'absent').length;
    const totalExempt = empAttendance.filter((a) => a.status === 'approved').length;
    const totalMinutesLate = empAttendance.reduce((s: number, a: any) => s + (a.minutesLate || 0), 0);

    // ═══ Quality stats ═══
    const qualityDeductionDays = empQuality.reduce((s: number, q: any) => s + (q.deductionDays || 0), 0);
    const qualityDeductionAmount = empQuality.reduce((s: number, q: any) => s + (q.deductionAmount || 0), 0);

    // ═══ HR Deductions stats ═══
    const hrDeductionTotal = empHrDeductions.reduce((s: number, h: any) => {
      return s + (h.unit === 'days' ? 0 : (h.amount || 0));
    }, 0);
    const hrDeductionDays = empHrDeductions.reduce((s: number, h: any) => {
      return s + (h.unit === 'days' ? (h.amount || 0) : 0);
    }, 0);

    // ═══ Follow-ups stats ═══
    const openFollowUps = empFollowUps.filter((f: any) =>
      ['open', 'under_review', 'under_follow_up'].includes(f.status)
    );
    const criticalFollowUps = empFollowUps.filter((f: any) => f.priorityLevel === 'critical' && f.status !== 'closed' && f.status !== 'cancelled');

    // ═══ Requests stats ═══
    const pendingRequests = empRequests.filter((r) => r.status === 'pending');
    const approvedRequests = empRequests.filter((r) => r.status === 'approved');
    const rejectedRequests = empRequests.filter((r) => r.status === 'rejected');

    // ═══ Travel stats ═══
    const activeTrips = empTravel.filter((t) => ['upcoming', 'in_progress'].includes(t.status));
    const completedTrips = empTravel.filter((t) => t.status === 'completed');

    // ═══ Complaints stats ═══
    const openComplaints = empComplaints.filter((c: any) =>
      ['open', 'under_investigation', 'pending_resolution'].includes(c.status)
    );

    // ═══ CAPA stats — overdue + effectiveness via canonical capaMetrics ═══
    const openCapa = empCapa.filter((c: any) =>
      ['open', 'investigation', 'root_cause_analysis', 'corrective_action', 'preventive_action', 'verification', 'reopened'].includes(c.status)
    );
    const closedCapa = empCapa.filter((c: any) => isClosedCAPA(c));
    const overdueCapa = empCapa.filter((c: any) => isOverdueCAPA(c, now));
    const criticalCapa = empCapa.filter((c: any) => c.priority === 'critical' && !isTerminalCAPA(c));
    const reopenedCapa = empCapa.filter((c: any) => c.status === 'reopened');
    const capaEffectiveness = calcCAPAEffectiveness(empCapa as any[]);

    // ═══ Risk Score — canonical computeRisk() (single source of truth) ═══
    // Factors not relevant to this employee are passed as 0.
    const highPriorityFollowUps = empFollowUps.filter(
      (f: any) => f.priorityLevel === 'high' && !['closed', 'cancelled', 'resolved'].includes(f.status)
    );
    const risk = computeRisk({
      delayCount: totalLate,
      absenceCount: totalAbsent,
      qualityCount: empQuality.length,
      hrCount: empHrDeductions.length,
      openFollowUpCount: openFollowUps.length,
      highPriorityFollowUpCount: highPriorityFollowUps.length,
      criticalFollowUpCount: criticalFollowUps.length,
      openComplaintCount: openComplaints.length,
      repeatedIssueCount, // §2 — computed above (same-type within 30 days)
      openCapaCount: openCapa.length,
      overdueCapaCount: overdueCapa.length,
      criticalCapaCount: criticalCapa.length,
      reopenedCapaCount: reopenedCapa.length,
    });
    const riskScore = risk.score;
    const riskLevel = risk.level;
    const riskBreakdown: RiskBreakdown = risk.breakdown;

    // ═══ Health Score (inverse of risk) ═══
    const healthScore = Math.max(100 - riskScore, 0);

    // ═══ Build chronological timeline ═══
    const timeline: any[] = [];

    for (const a of empAttendance) {
      timeline.push({
        type: 'attendance',
        date: a.date,
        title: a.status === 'present' ? 'حضور' : a.status === 'late' ? 'تأخير' : a.status === 'absent' ? 'غياب' : 'معفي',
        description: a.status === 'late' ? `متأخر ${a.minutesLate || 0} دقيقة` : '',
        status: a.status,
        timestamp: a.createdAt,
      });
    }

    for (const q of empQuality) {
      timeline.push({
        type: 'quality',
        date: q.date,
        title: `خصم جودة: ${q.type}`,
        description: q.description,
        status: 'deduction',
        timestamp: q.createdAt,
      });
    }

    for (const h of empHrDeductions) {
      timeline.push({
        type: 'hrDeduction',
        date: h.deductionDate || h.createdAt,
        title: `خصم HR: ${h.type}`,
        description: h.reason,
        status: h.status,
        timestamp: h.createdAt,
      });
    }

    for (const r of empRequests) {
      timeline.push({
        type: 'request',
        date: r.date,
        title: `طلب: ${r.type}`,
        description: r.reason,
        status: r.status,
        timestamp: r.createdAt,
      });
    }

    for (const f of empFollowUps) {
      timeline.push({
        type: 'followUp',
        date: f.date,
        title: `متابعة: ${f.followUpType}`,
        description: f.subject,
        status: f.status,
        priority: f.priorityLevel,
        timestamp: f.createdAt,
      });
    }

    for (const c of empComplaints) {
      timeline.push({
        type: 'complaint',
        date: c.createdAt?.split('T')[0] || '',
        title: `شكوى: ${c.complaintType}`,
        description: c.description,
        status: c.status,
        severity: c.severity,
        timestamp: c.createdAt,
      });
    }

    for (const t of empTravel) {
      timeline.push({
        type: 'travel',
        date: t.departureDate,
        title: `سفر: ${t.destination}`,
        description: '',
        status: t.status,
        timestamp: t.createdAt,
      });
    }

    // ═══ CAPA timeline events (Task 2) ═══
    for (const capa of empCapa) {
      // Creation event
      timeline.push({
        type: 'capa',
        date: capa.createdAt?.split('T')[0] || '',
        title: `CAPA: ${capa.capaId || capa.title}`,
        description: `تم إنشاء حالة ${capa.title} - الأولوية: ${capa.priority}`,
        status: 'created',
        priority: capa.priority,
        timestamp: capa.createdAt,
        capaId: capa.id,
      });

      // Add timeline events from CAPA case
      if (Array.isArray(capa.timeline)) {
        for (const evt of capa.timeline) {
          timeline.push({
            type: 'capa',
            date: evt.timestamp?.split('T')[0] || '',
            title: `CAPA ${capa.capaId || ''}: ${evt.action}`,
            description: evt.description,
            status: evt.action?.toLowerCase() || 'updated',
            user: evt.performedByName || evt.performedBy || '',
            timestamp: evt.timestamp,
            capaId: capa.id,
          });
        }
      }
    }

    // Sort by date descending
    timeline.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    // ═══ Smart Recommendations ═══
    // Derived ONLY from sections the viewer may see — a denied
    // section must not leak its signals through advice text either.
    const recommendations: string[] = [];
    if (sectionGate.attendance && totalAbsent > 6) recommendations.push('معدل الغياب مرتفع - يجب عمل خطة تحسين حضور');
    if (sectionGate.attendance && totalLate > 5) recommendations.push('تأخير متكرر - يحتاج متابعة دورية');
    if (sectionGate.quality && qualityDeductionDays > 3) recommendations.push('خصومات جودة مرتفعة - يحتاج تدريب إضافي');
    if (sectionGate.followUps && openFollowUps.length > 3) recommendations.push('عدد كبير من المتابعات المفتوحة - يجب تسريع الإغلاق');
    if (sectionGate.followUps && criticalFollowUps.length > 0) recommendations.push('يوجد حالات حرجة تحتاج تدخل فوري');
    if (sectionGate.complaints && openComplaints.length > 0) recommendations.push('شكاوى عملاء مفتوحة - يجب المعالجة بسرعة');
    if (sectionGate.capa && openCapa.length > 0) recommendations.push(`يوجد ${openCapa.length} حالات CAPA مفتوحة - يجب المتابعة`);
    if (sectionGate.capa && overdueCapa.length > 0) recommendations.push(`يوجد ${overdueCapa.length} حالات CAPA متأخرة - يجب التسريع`);
    if (sectionGate.capa && reopenedCapa.length > 0) recommendations.push(`يوجد ${reopenedCapa.length} حالات CAPA معاد فتحها - يجب مراجعة فعالية الحلول`);
    if (sectionGate.risk && healthScore < 40) recommendations.push('مستوى الأداء منخفض جداً - يحتاج خطة تحسين شاملة');

    // §2 — ORG IDENTITY from the tree (single source of truth) +
    // reporting line resolved to user names.
    const orgIndex = buildEmployeeOrgIndex(allOrgNodes as OrgNode[]);
    const orgLabels = resolveEmployeeOrgLabels(orgIndex, employee as unknown as Employee);
    const node = employee.orgNodeId ? (allOrgNodes as OrgNode[]).find((n) => n.id === employee.orgNodeId) ?? null : null;
    const managerUserIds = employee.orgNodeId ? resolveManagerChain(orgIndex, employee.orgNodeId) : [];
    const userById = new Map((allUsers as any[]).map((u) => [u.id, u]));
    const reportingLine = managerUserIds
      .map((uid) => ({ id: uid, name: userById.get(uid)?.name ?? uid }))
      .slice(0, 3);

    // §2 — ACTIVITY summary: last-90-day writes per domain + the
    // newest real timestamp per domain (derived from loaded data —
    // no invented metrics).
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const recentOf = (rows: any[], field = 'createdAt') => {
      const recent = rows.filter((r) => (r[field] || '') >= ninetyDaysAgo);
      const latest = rows.reduce((acc, r) => ((r[field] || '') > acc ? (r[field] || '') : acc), '');
      return { last90Days: recent.length, lastEventAt: latest || null };
    };
    const activity = {
      attendance: recentOf(empAttendance, 'date'),
      qualityDeductions: recentOf(empQuality),
      hrDeductions: recentOf(empHrDeductions),
      followUps: recentOf(empFollowUps),
      complaints: recentOf(empComplaints),
      capa: recentOf(empCapa),
      requests: recentOf(empRequests),
      travel: recentOf(empTravel),
    };

    // ═══ SECTION-GATED SERIALIZATION ═══
    // A denied section's block is withheld entirely (null) and the
    // timeline keeps only events whose owning section is visible.
    // Unrestricted maps (no section overrides) serialize exactly as
    // before — legacy users see no difference.
    const gatedTimeline = filterTimelineByGate(timeline, sectionGate, viewer.permissions);

    return NextResponse.json({
      employee: sectionGate.basicInfo
        ? {
            id: employee.id,
            name: employee.name,
            code: employee.code || null,
            department: employee.department || null,
            position: employee.position || null,
            shiftStart: employee.shiftStart || null,
            shiftEnd: employee.shiftEnd || null,
            hireDate: employee.hireDate || null,
            // §2 — full identity: lifecycle + residence + org node.
            status: employee.status || 'active',
            residence:
              resolveFieldAccess(viewer.permissions, 'employees', 'mobile') === 'hidden'
                ? null
                : employee.residence || null,
            orgNodeId: employee.orgNodeId || null,
            archivedAt: (employee as any).archivedAt || null,
            archiveReason: (employee as any).archiveReason || null,
            // Field-level access (Part J): sensitive personal data is
            // omitted server-side for viewers without edit access.
            mobile:
              resolveFieldAccess(viewer.permissions, 'employees', 'mobile') === 'hidden'
                ? null
                : employee.mobile || null,
            createdById: employee.createdById || null,
          }
        : null,
      // §2 — Organization section: real tree labels + reporting line.
      organization: sectionGate.basicInfo
        ? {
            node: node ? { id: node.id, name: node.name, type: node.type } : null,
            department: orgLabels.department,
            team: orgLabels.team,
            reportingLine,
          }
        : null,
      // §2 — Quality observations block (deductions already covered).
      observations: sectionGate.observations
        ? {
            total: empObservations.length,
            currentMonth: empObservations.filter((o) => typeof o.date === 'string' && o.date.startsWith(currentMonth)).length,
            byStatus: empObservations.reduce<Record<string, number>>((acc, o) => {
              const key = o.status || 'approved';
              acc[key] = (acc[key] || 0) + 1;
              return acc;
            }, {}),
          }
        : null,
      stats: {
        attendance: sectionGate.attendance
          ? {
              totalPresent,
              totalLate,
              totalAbsent,
              totalExempt,
              totalMinutesLate,
            }
          : null,
        quality: sectionGate.quality
          ? {
              totalDeductions: empQuality.length,
              deductionDays: qualityDeductionDays,
              deductionAmount: qualityDeductionAmount,
            }
          : null,
        hrDeductions: sectionGate.hrDeductions
          ? {
              totalDeductions: empHrDeductions.length,
              deductionDays: hrDeductionDays,
              deductionAmount: hrDeductionTotal,
            }
          : null,
        requests: sectionGate.requests
          ? {
              total: empRequests.length,
              pending: pendingRequests.length,
              approved: approvedRequests.length,
              rejected: rejectedRequests.length,
            }
          : null,
        followUps: sectionGate.followUps
          ? {
              total: empFollowUps.length,
              open: openFollowUps.length,
              critical: criticalFollowUps.length,
            }
          : null,
        travel: sectionGate.travel
          ? {
              total: empTravel.length,
              active: activeTrips.length,
              completed: completedTrips.length,
            }
          : null,
        complaints: sectionGate.complaints
          ? {
              total: empComplaints.length,
              open: openComplaints.length,
            }
          : null,
        capa: sectionGate.capa
          ? {
              total: empCapa.length,
              open: openCapa.length,
              closed: closedCapa.length,
              overdue: overdueCapa.length,
              critical: criticalCapa.length,
              reopened: reopenedCapa.length,
              effectiveness: capaEffectiveness,
            }
          : null,
      },
      // Risk/health derive from every section — withheld when the
      // risk section itself is denied (its breakdown leaks factor
      // counts from denied sections otherwise).
      risk: sectionGate.risk
        ? {
            score: riskScore,
            level: riskLevel,
            breakdown: riskBreakdown,
          }
        : null,
      healthScore: sectionGate.risk ? healthScore : null,
      timeline: gatedTimeline,
      recommendations,
    });
  } catch (error) {
    console.error('Employee 360 error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}