import { NextRequest, NextResponse } from 'next/server';
import { getAll, getById } from '@/lib/db';
import { authorize, authorizeRequest } from '@/lib/verify-permission';
import { resolveEmployee360SectionGate } from '@/lib/permissions/employee360-access';
import { resolveSectionAccess, resolveFieldAccess, resolvePageScope } from '@/config/permissions';
import { loadScopeAssignments } from '@/lib/scope/server';
import { isEffectiveDeduction } from '@/lib/quality-deductions/domain';
import { resolveEmployeeOrgLabels, buildEmployeeOrgIndex } from '@/lib/reports/employee-org';
import { ancestorIds, resolveManagerChain } from '@/lib/organization/graph';
import { resolveEmployeeScope } from '@/lib/scope';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';
import { getKpiSettings } from '@/lib/kpi-settings';
import { aggregateHrMonth } from '@/lib/employee-performance';
import type { EmployeeHrDeductionRecord } from '@/lib/employee-performance';
import { normalizeEmployeeStatus } from '@/lib/organization/employee-status';
import {
  getEmployeePerformanceDataset,
  defaultPerformanceIntelligenceLoaders,
} from '@/lib/performance-intelligence';
import { getHrEmployeeDecisionReport } from '@/lib/hr-decision';
import { monthKeyOfDisplayDate, monthKeyOfIso } from '@/lib/performance-intelligence/month-attribution';
import type { Employee } from '@/types';
import {
  assembleEmployee360Profile,
  tenureYearsOf,
} from '@/lib/employee-360/view-model';
import type {
  Employee360Identity,
  Employee360Organization,
  Employee360HrBlock,
  Employee360RequestsBlock,
  Employee360RawRecord,
} from '@/lib/employee-360/view-model';

// ══════════════════════════════════════════════════════════════
//  Employee 360 Profile API (rebuild)
//
//  ONE canonical dataset (lib/performance-intelligence) + ONE
//  decision-support projection over it (lib/hr-decision) + the org
//  tree + the stored employee record, composed by the PURE view-model
//  assembler (lib/employee-360). The route performs authorization,
//  scope, section gating, field redaction and batched reads ONLY —
//  every business number arrives from its canonical service.
//
//  Authorization chain (unchanged):
//    • authorizeRequest('employees', view) — carries the record scope
//    • authorize('employee360')            — the overlay's page gate
//    • resolveEmployee360SectionGate       — per-section enforcement
//    • resolveEmployeeScope (M0.3)         — IDOR guard, fail-closed 404
// ══════════════════════════════════════════════════════════════

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ═══ AUTHORIZATION (canonical decision path) ═══
    const { caller, decision } = await authorizeRequest(request, { page: 'employees', action: 'view' });
    if (!decision.allowed || !caller) {
      return NextResponse.json({ error: 'ليس لديك صلاحية' }, { status: 403 });
    }
    const pageDecision = authorize(caller, { page: 'employee360' });
    if (!pageDecision.allowed) {
      return NextResponse.json({ error: pageDecision.reason }, { status: 403 });
    }

    // SECTION-LEVEL ENFORCEMENT (server-side, canonical resolver):
    // a denied section's block is withheld below — never serialized.
    const sectionGate = resolveEmployee360SectionGate(caller.permissions);
    const timelineVisible = resolveSectionAccess(caller.permissions, 'employee360', 'timeline') !== 'none';

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
          assignments: scope === 'assigned' ? await loadScopeAssignments() : undefined,
        },
      );
      if (!scopeContext.includes(employeeId)) {
        return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
      }
    }

    // ═══ SELECTED REPORTING PERIOD — strict YYYY-MM; every
    //     period-sensitive section answers for THIS month. ═══
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const requestedMonth = request.nextUrl.searchParams.get('month')?.trim() || '';
    const selectedMonth = /^\d{4}-\d{2}$/.test(requestedMonth) ? requestedMonth : currentMonth;

    // ═══ ONE canonical dataset + the HR-decision projection over it ═══
    // (batched, cached reads inside the loaders; the decision service
    // consumes the SAME dataset instance — no second engine run).
    const [dataset, kpiSettings] = await Promise.all([
      getEmployeePerformanceDataset({
        employeeId,
        monthKey: selectedMonth,
        windowMonths: 6,
        now,
        loaders: defaultPerformanceIntelligenceLoaders,
      }),
      getKpiSettings().catch(() => null),
    ]);

    const decisionReport = await getHrEmployeeDecisionReport({
      employeeId,
      monthKey: selectedMonth,
      now,
      dataset: dataset ?? undefined,
    });

    // ═══ Batched reads for timeline + attention + period stats ═══
    // Promise.allSettled (M0.3-pinned resilience): a collection that
    // does not exist yet degrades to empty — the profile never fails
    // because one optional table is missing. ONE cached read per
    // collection, filtered in memory (no N+1).
    const settled = await Promise.allSettled([
      getAll('qualityDeductions').then((rs) => rs.filter(isEffectiveDeduction)),
      getAll('hrDeductions'),
      getAll('requests'),
      getAll('users'),
      defaultPerformanceIntelligenceLoaders.loadFollowUps(employeeId),
      defaultPerformanceIntelligenceLoaders.loadComplaints(employeeId),
      defaultPerformanceIntelligenceLoaders.loadCapaCases(employeeId),
      defaultPerformanceIntelligenceLoaders.loadTravelDeals(employeeId),
    ]);
    const fulfilled = <T>(i: number, fallback: T): T =>
      settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : fallback;
    const qualityDeductions = fulfilled(0, [] as never[]);
    const hrDeductions = fulfilled(1, [] as never[]);
    const requests = fulfilled(2, [] as never[]);
    const users = fulfilled(3, [] as never[]);
    const empFollowUps = fulfilled(4, [] as never[]);
    const empComplaints = fulfilled(5, [] as never[]);
    const capaSplit = fulfilled(6, { primary: [], indirect: [] });
    const empDeals = fulfilled(7, [] as never[]);

    const empQualityDeductions = (qualityDeductions as Employee360RawRecord[]).filter((r) => r.employeeId === employeeId);
    const empHrDeductions = (hrDeductions as Employee360RawRecord[]).filter((r) => r.employeeId === employeeId);
    const empRequests = (requests as Employee360RawRecord[]).filter((r) => r.employeeId === employeeId);
    const empCapa = capaSplit.primary;

    // ═══ Period-scoped aggregates (canonical attribution helpers) ═══
    // HR deductions: the established aggregateHrMonth projection over
    // the selected month's stored records (all statuses, days/amount
    // kept separate — parity with the employee-performance service).
    const hrRecordsOfMonth = empHrDeductions.filter((r) => r.month === selectedMonth);
    const hrMonth: Employee360HrBlock | null = hrRecordsOfMonth.length
      ? aggregateHrMonth(selectedMonth, hrRecordsOfMonth as unknown as EmployeeHrDeductionRecord[])
      : null;

    // Requests: attribution through the canonical month helpers (the
    // stored `date` follows the DD/MM/YYYY display contract; ISO
    // timestamps fall back to the ISO month key).
    const monthOfRequest = (r: Employee360RawRecord): string | null => {
      const date = typeof r.date === 'string' ? r.date : null;
      if (!date) return null;
      return date.includes('/') ? monthKeyOfDisplayDate(date) : monthKeyOfIso(date);
    };
    const requestsOfMonth = empRequests.filter((r) => monthOfRequest(r) === selectedMonth);
    const requestsBlock: Employee360RequestsBlock = {
      total: requestsOfMonth.length,
      pending: requestsOfMonth.filter((r) => r.status === 'pending').length,
      approved: requestsOfMonth.filter((r) => r.status === 'approved').length,
      rejected: requestsOfMonth.filter((r) => r.status === 'rejected').length,
    };

    // ═══ Identity (field-level redaction — Part J rule preserved) ═══
    const mobileHidden = resolveFieldAccess(viewer.permissions, 'employees', 'mobile') === 'hidden';
    const identity: Employee360Identity = {
      id: employee.id,
      name: employee.name,
      code: employee.code || null,
      department: employee.department || null,
      position: employee.position || null,
      status: normalizeEmployeeStatus(employee.status),
      eligibleForPeriod: dataset?.employee.eligibleForPeriod ?? false,
      archivedButEligible: dataset?.employee.archivedButEligible ?? false,
      archivedAt: (employee as { archivedAt?: string }).archivedAt || null,
      restoredAt: dataset?.employee.restoredAt ?? null,
      hireDate: employee.hireDate || null,
      tenureYears: tenureYearsOf(employee.hireDate || null, now),
      shiftStart: employee.shiftStart || null,
      shiftEnd: employee.shiftEnd || null,
      mobile: mobileHidden ? null : employee.mobile || null,
      residence: mobileHidden ? null : employee.residence || null,
      orgNodeId: employee.orgNodeId || null,
    };

    // ═══ ORGANIZATION CONTEXT — the tree is the only authority ═══
    const orgNodes = await getAll<OrgNode>(ORG_NODES_TABLE);
    const index = buildEmployeeOrgIndex(orgNodes);
    const labels = resolveEmployeeOrgLabels(index, employee as unknown as Employee);
    const nodeId = employee.orgNodeId || null;
    const chain: Employee360Organization['chain'] = nodeId
      ? [
          ...ancestorIds(index, nodeId)
            .map((aid) => {
              const n = index.byId.get(aid);
              return n ? { id: n.id, name: n.name, type: String(n.type) } : null;
            })
            .filter((n): n is Employee360Organization['chain'][number] => n !== null),
          {
            id: nodeId,
            name: index.byId.get(nodeId)?.name ?? '',
            type: String(index.byId.get(nodeId)?.type ?? 'custom'),
          },
        ]
      : [];
    const managerUserIds = nodeId ? resolveManagerChain(index, nodeId) : [];
    const userById = new Map((users as Array<{ id: string; name?: string }>).map((u) => [u.id, u]));
    const reportingLine = managerUserIds
      .map((uid) => ({ id: uid, name: userById.get(uid)?.name ?? uid }))
      .slice(0, 3);
    const organization: Employee360Organization = {
      chain,
      department: labels.department,
      team: labels.team,
      manager: reportingLine[0] ?? null,
      reportingLine,
    };

    const view = assembleEmployee360Profile({
      selectedMonth,
      now,
      gate: sectionGate,
      timelineVisible,
      employee: sectionGate.basicInfo ? identity : null,
      organization,
      dataset,
      decision: decisionReport,
      targetScore: kpiSettings?.defaultScore ?? null,
      hrMonth,
      requestsOfMonth: requestsBlock,
      followUpRows: empFollowUps as unknown as Employee360RawRecord[],
      complaintRows: empComplaints as unknown as Employee360RawRecord[],
      capaRows: empCapa as unknown as Employee360RawRecord[],
      qualityDeductionRows: empQualityDeductions,
      hrDeductionRows: empHrDeductions,
      requestRows: empRequests,
      dealRows: empDeals as unknown as Employee360RawRecord[],
    });

    return NextResponse.json(view);
  } catch (error) {
    console.error('Employee 360 error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
