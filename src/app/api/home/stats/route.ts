import { NextRequest, NextResponse } from 'next/server';
import {
  getAll, getAllBatch, count, countWhere,
  findWhere, findWhereIn, groupByCount, sortByField,
  sortByDateField, getEmployeeMap,
} from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import { isOverdueFollowUp } from '@/lib/metrics';
import { isEffectiveDeduction, deductionTypeLabel } from '@/lib/quality-deductions/domain';
import { isActiveFollowUp, isTerminalFollowUp } from '@/lib/metrics/followUpMetrics';
import { filterEmployeesInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { getDealBusinessDate, getDealMonthKey, isCompletedDeal, countClosedDealsForMonth } from '@/lib/deal-dates';
import { migratePermission } from '@/config/permissions';

function getTodayStr(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

function parseDateToSortable(dateStr: string): number {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return 0;
  const year = parseInt(parts[2], 10) || 0;
  const month = parseInt(parts[1], 10) || 0;
  const day = parseInt(parts[0], 10) || 0;
  return year * 10000 + month * 100 + day;
}

function getMonthDateRange(monthsAgo: number): { startStr: string; endStr: string; monthLabel: string; monthKey: string } {
  const now = new Date();
  const targetMonth = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  const year = targetMonth.getFullYear();
  const month = targetMonth.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();

  const monthNames = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  const monthLabel = `${monthNames[month - 1]} ${year}`;
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const startStr = `01/${String(month).padStart(2, '0')}/${year}`;
  const endStr = `${String(daysInMonth).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;

  return { startStr, endStr, monthLabel, monthKey };
}

interface EmployeePerformanceItem {
  employeeId: string;
  employeeName: string;
  department: string;
  delayCount: number;
  totalDelayMinutes: number;
  deductionAmount: number;
  deductionDays: number;
  presentDays: number;
  absentDays: number;
}

interface DepartmentPerformanceSummary {
  departmentName: string;
  employeeCount: number;
  totalDelays: number;
  totalDelayMinutes: number;
  totalDeductionAmount: number;
  totalDeductionDays: number;
  presentDays: number;
  absentDays: number;
  employees: EmployeePerformanceItem[];
}

interface MonthlyPerformance {
  monthLabel: string;
  monthKey: string;
  totalDelays: number;
  totalDelayMinutes: number;
  totalDeductionAmount: number;
  totalDeductionDays: number;
  totalPresent: number;
  totalAbsent: number;
  totalWorkingDays: number;
  departments: DepartmentPerformanceSummary[];
}

interface DepartmentStat {
  name: string;
  employeeCount: number;
  presentToday: number;
  lateToday: number;
  absentToday: number;
}

interface RequestTypeSummary {
  type: string;
  label: string;
  pending: number;
  approved: number;
  rejected: number;
}

interface TopOffender {
  employeeId: string;
  employeeName: string;
  department: string;
  delayCount: number;
  totalDelayMinutes: number;
  deductionAmount: number;
}

/* ═══════════════════════════════════════════════════════════════════
   NEW — Home Command Center extended data types (§Home-CC)
   ═══════════════════════════════════════════════════════════════════ */

interface ClosedDealSummary {
  /** Completed deals whose CLOSED date falls in the current month. */
  closedThisMonth: number;
  /** Completed deals whose CLOSED date is unknown (no closedAt). */
  closedUnknown: number;
  /** Total value/amount if available (placeholder for future). */
  totalValue: number;
  /** Period label (YYYY-MM) */
  monthKey: string;
  /** Freshness: when the last closedAt was observed (ISO) */
  lastUpdated: string | null;
}

interface TimelineEvent {
  id: string;
  type: 'deal_completed' | 'quality_observation' | 'followup_completed' | 'approval' | 'complaint' | 'capa_update' | 'travel_milestone';
  title: string;
  description?: string;
  entityType: 'travelDeal' | 'qualityDeduction' | 'followUp' | 'request' | 'complaint' | 'capaCase';
  entityId: string;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  date: string; // ISO or DD/MM/YYYY depending on type
  dateDimension?: 'CREATED' | 'CLOSED' | 'TRAVEL'; // which date this event is attributed to
  createdAt: string; // ISO when the record was created/updated
}

interface DepartmentPulse {
  name: string;
  employeeCount: number;
  /** Key health indicators per department */
  attendanceRate: number;
  openFollowUps: number;
  qualityCasesThisMonth: number;
  pendingApprovals: number;
  activeTravel: number;
  /** Trend vs last month: -1 down, 0 flat, 1 up */
  trend: -1 | 0 | 1;
  /** Freshness of this department's data */
  lastActivity: string | null;
}

interface PerformancePulse {
  /** Current month KPI score (0-100) — from kpi-reporting logic */
  currentScore: number | null;
  /** Target score if configured */
  targetScore: number | null;
  /** Progress toward target (0-1) */
  progress: number | null;
  /** Trend over last 3 months: array of { monthKey, score } */
  trend: Array<{ monthKey: string; score: number }>;
  /** Completed work this month */
  completedWork: number;
  /** Follow-up completion rate */
  followUpCompletionRate: number;
  /** Quality indicator: deductions per employee */
  qualityDeductionsPerEmployee: number;
  /** Data freshness */
  lastCalculated: string | null;
}

interface MetricFreshness {
  /** ISO timestamp when the underlying data was last read from DB */
  dataFetchedAt: string;
  /** Per-metric last mutation timestamps (if available) */
  metricTimestamps: Record<string, string | null>;
}
function computeMonthlyPerformance(
  attendanceRecords: any[],
  qualityDeductions: any[],
  empMap: Map<string, any>,
  monthsAgo: number
): MonthlyPerformance {
  const { startStr, endStr, monthLabel, monthKey } = getMonthDateRange(monthsAgo);
  const startDateNum = parseDateToSortable(startStr);
  const endDateNum = parseDateToSortable(endStr);

  const monthRecords = attendanceRecords.filter((r: any) => {
    const dateNum = parseDateToSortable(r.date);
    return dateNum >= startDateNum && dateNum <= endDateNum;
  });

  // §WORKFLOW — only APPROVED quality discounts affect dashboard stats.
  const monthQuality = qualityDeductions.filter((qd: any) => qd.month === monthKey && isEffectiveDeduction(qd));

  const workingDaysSet = new Set(monthRecords.map((r: any) => r.date));
  const totalWorkingDays = workingDaysSet.size;

  const perfMap = new Map<string, EmployeePerformanceItem>();

  for (const rec of monthRecords) {
    const emp = empMap.get(rec.employeeId);
    if (!emp) continue;

    if (!perfMap.has(rec.employeeId)) {
      perfMap.set(rec.employeeId, {
        employeeId: rec.employeeId,
        employeeName: emp.name,
        department: emp.department || 'بدون قسم',
        delayCount: 0, totalDelayMinutes: 0,
        deductionAmount: 0, deductionDays: 0,
        presentDays: 0, absentDays: 0,
      });
    }
    const item = perfMap.get(rec.employeeId)!;
    if (rec.status === 'present') item.presentDays += 1;
    else if (rec.status === 'late') { item.delayCount += 1; item.totalDelayMinutes += rec.minutesLate || 0; }
    else if (rec.status === 'absent') item.absentDays += 1;
  }

  for (const qd of monthQuality) {
    const emp = empMap.get(qd.employeeId);
    if (!emp) continue;

    if (!perfMap.has(qd.employeeId)) {
      perfMap.set(qd.employeeId, {
        employeeId: qd.employeeId,
        employeeName: emp.name,
        department: emp.department || 'بدون قسم',
        delayCount: 0, totalDelayMinutes: 0,
        deductionAmount: 0, deductionDays: 0,
        presentDays: 0, absentDays: 0,
      });
    }
    const item = perfMap.get(qd.employeeId)!;
    item.deductionAmount += qd.deductionAmount || 0;
    item.deductionDays += qd.deductionDays || 0;
  }

  const deptMap = new Map<string, DepartmentPerformanceSummary>();
  let totalDelays = 0, totalDelayMinutes = 0, totalDeductionAmount = 0, totalDeductionDays = 0, totalPresent = 0, totalAbsent = 0;

  for (const item of perfMap.values()) {
    if (!deptMap.has(item.department)) {
      deptMap.set(item.department, {
        departmentName: item.department, employeeCount: 0,
        totalDelays: 0, totalDelayMinutes: 0, totalDeductionAmount: 0, totalDeductionDays: 0,
        presentDays: 0, absentDays: 0, employees: [],
      });
    }
    const dept = deptMap.get(item.department)!;
    dept.employeeCount += 1;
    dept.totalDelays += item.delayCount;
    dept.totalDelayMinutes += item.totalDelayMinutes;
    dept.totalDeductionAmount += item.deductionAmount;
    dept.totalDeductionDays += item.deductionDays;
    dept.presentDays += item.presentDays;
    dept.absentDays += item.absentDays;
    dept.employees.push(item);

    totalDelays += item.delayCount;
    totalDelayMinutes += item.totalDelayMinutes;
    totalDeductionAmount += item.deductionAmount;
    totalDeductionDays += item.deductionDays;
    totalPresent += item.presentDays;
    totalAbsent += item.absentDays;
  }

  const departments = Array.from(deptMap.values()).sort((a, b) => b.totalDelays - a.totalDelays);
  for (const dept of departments) dept.employees.sort((a, b) => b.totalDelayMinutes - a.totalDelayMinutes);

  return { monthLabel, monthKey, totalDelays, totalDelayMinutes, totalDeductionAmount, totalDeductionDays, totalPresent, totalAbsent, totalWorkingDays, departments };
}

// Let Next.js cache the response edge-side when possible
// Server-side db.ts cache (15s TTL) handles freshness

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const todayStr = getTodayStr();
    const { monthKey: currentMonthKey } = getMonthDateRange(0);

    // ═══════════════════════════════════════════════════
    // PHASE 1: Batch-load all required tables in parallel
    // (Cache hit = instant, miss = 1 round-trip instead of N)
    // ═══════════════════════════════════════════════════
    const [batch, empMap] = await Promise.all([
      getAllBatch([
        'employees',
        'attendance',
        'requests',
        'travelDeals',
        'qualityDeductions',
        'deductionRules',
        'biometrics',
        'followUps',
        // §Home-CC — timeline sources (same single batch, no extra reads)
        'complaints',
        'capaCases',
      ]),
      getEmployeeMap(),
    ]);

    // ═══════════════════════════════════════════════════
    // READ SCOPE (M0.5) — the dashboard's single scope
    // boundary. Every employee-linked table is intersected
    // with the caller's authorized employee scope BEFORE
    // any aggregation, ranking, count or rate is computed,
    // so all reported metrics describe authorized rows
    // only. deductionRules carries no employee link and is
    // never filtered. Admin/HR/Quality ('all') take the
    // engine's zero-read fast path.
    // ═══════════════════════════════════════════════════
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    const employees = filterEmployeesInScope(batch.get('employees') || [], scopeCtx);
    const attendanceRecords = filterRowsByEmployeeScope(batch.get('attendance') || [], scopeCtx);
    const allRequests = filterRowsByEmployeeScope(batch.get('requests') || [], scopeCtx);
    const travelDeals = filterRowsByEmployeeScope(batch.get('travelDeals') || [], scopeCtx);
    // §WORKFLOW — pending/rejected discounts never reach dashboard stats.
    const allQualityDeductions = filterRowsByEmployeeScope(batch.get('qualityDeductions') || [], scopeCtx)
      .filter(isEffectiveDeduction);
    const deductionRules = batch.get('deductionRules') || [];
    const allBiometrics = filterRowsByEmployeeScope(batch.get('biometrics') || [], scopeCtx);
    const allFollowUps = filterRowsByEmployeeScope(batch.get('followUps') || [], scopeCtx);

    const totalEmployees = employees.length;

    // ═══════════════════════════════════════════════════
    // PHASE 2: Pure in-memory computation (zero DB reads)
    // ═══════════════════════════════════════════════════

    // --- Department groups ---
    const deptGroupMap = new Map<string, number>();
    for (const e of employees) {
      const d = e.department || 'بدون قسم';
      deptGroupMap.set(d, (deptGroupMap.get(d) || 0) + 1);
    }
    const departmentList = Array.from(deptGroupMap.entries()).map(([name, count]) => ({ name, count }));

    // --- Today's attendance (in-memory filter) ---
    const todayRecords = attendanceRecords.filter((r: any) => r.date === todayStr);
    const presentCount = todayRecords.filter((r: any) => r.status === 'present').length;
    const absentCount = todayRecords.filter((r: any) => r.status === 'absent').length;
    const lateCount = todayRecords.filter((r: any) => r.status === 'late').length;
    const todayAttendance = todayRecords.length;

    // --- Dept today stats ---
    const deptTodayStats: DepartmentStat[] = departmentList.map(d => {
      const deptEmpIds = new Set(
        employees.filter((e: any) => (e.department || 'بدون قسم') === d.name).map((e: any) => e.id)
      );
      const deptRecords = todayRecords.filter((r: any) => deptEmpIds.has(r.employeeId));
      return {
        name: d.name,
        employeeCount: d.count,
        presentToday: deptRecords.filter((r: any) => r.status === 'present').length,
        lateToday: deptRecords.filter((r: any) => r.status === 'late').length,
        absentToday: deptRecords.filter((r: any) => r.status === 'absent').length,
      };
    });

    // --- Pending requests (in-memory filter) ---
    const pendingRequestsRaw = allRequests.filter((r: any) => r.status === 'pending');
    pendingRequestsRaw.sort((a: any, b: any) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    const pendingRequestsDetails = pendingRequestsRaw.map((req: any) => {
      const emp = empMap.get(req.employeeId);
      return {
        id: req.id, employeeId: req.employeeId, type: req.type,
        date: req.date, reason: req.reason, status: req.status,
        employeeName: emp?.name || 'غير معروف',
        employeeDepartment: emp?.department || '',
        createdAt: req.createdAt || '',
      };
    });

    // --- Request type summary (already have allRequests) ---
    const typeMap = new Map<string, { pending: number; approved: number; rejected: number }>();
    for (const r of allRequests) {
      if (!typeMap.has(r.type)) typeMap.set(r.type, { pending: 0, approved: 0, rejected: 0 });
      const entry = typeMap.get(r.type)!;
      if (r.status === 'pending') entry.pending++;
      else if (r.status === 'approved') entry.approved++;
      else entry.rejected++;
    }
    const requestTypeLabels: Record<string, string> = {
      leave: 'إجازة', permission: 'استئذان', excuse: 'غياب', tardiness: 'تأخير', remote: 'ريموتلي'
    };
    const requestTypeSummary: RequestTypeSummary[] = Array.from(typeMap.entries()).map(([type, counts]) => ({
      type, label: requestTypeLabels[type] || type, ...counts,
    }));

    // --- Travel ---
    const activeStatusSet = new Set(['upcoming', 'in_progress']);
    const upcomingTravel = travelDeals
      .filter((deal: any) => activeStatusSet.has(deal.status))
      .map((deal: any) => {
        const emp = empMap.get(deal.employeeId);
        return {
          id: deal.id, employeeId: deal.employeeId, employeeName: emp?.name || 'غير معروف',
          employeeDepartment: emp?.department || '',
          destination: deal.destination, departureDate: deal.departureDate,
          returnDate: deal.returnDate, dealerName: deal.dealerName, customerNames: deal.customerNames,
          hasInternationalFlight: deal.hasInternationalFlight, hasDomesticFlight: deal.hasDomesticFlight,
          hasHotel: deal.hasHotel, hasVisa: deal.hasVisa,
          hasTours: deal.hasTours, hasTransportation: deal.hasTransportation,
          internationalFlightStatus: deal.internationalFlightStatus, domesticFlightStatus: deal.domesticFlightStatus, hotelStatus: deal.hotelStatus,
          visaStatus: deal.visaStatus, toursStatus: deal.toursStatus,
          transportationStatus: deal.transportationStatus, notes: deal.notes, status: deal.status,
        };
      })
      .sort((a: any, b: any) => parseDateToSortable(a.departureDate) - parseDateToSortable(b.departureDate));

    const completedTravelCount = travelDeals.filter((d: any) => d.status === 'completed').length;
    const inProgressTravelCount = travelDeals.filter((d: any) => d.status === 'in_progress').length;

    // --- Late employees (in-memory filter) ---
    const lateEmployeesRaw = todayRecords.filter((r: any) => r.status === 'late');
    lateEmployeesRaw.sort((a: any, b: any) => (b.minutesLate || 0) - (a.minutesLate || 0));
    const lateEmployees = lateEmployeesRaw.slice(0, 10).map((att: any) => {
      const emp = empMap.get(att.employeeId);
      return {
        id: emp?.id || att.employeeId,
        employeeName: emp?.name || 'غير معروف',
        department: emp?.department || '',
        checkIn: att.checkIn,
        minutesLate: att.minutesLate,
      };
    });

    // --- Monthly performance (pure computation, no DB reads) ---
    const lastMonthPerformance = computeMonthlyPerformance(attendanceRecords, allQualityDeductions, empMap, 1);
    const currentMonthPerformance = computeMonthlyPerformance(attendanceRecords, allQualityDeductions, empMap, 0);

    // --- Top 5 offenders ---
    const topOffenders: TopOffender[] = [];
    for (const dept of currentMonthPerformance.departments) {
      for (const emp of dept.employees) {
        if (emp.delayCount > 0) {
          topOffenders.push({
            employeeId: emp.employeeId,
            employeeName: emp.employeeName,
            department: emp.department,
            delayCount: emp.delayCount,
            totalDelayMinutes: emp.totalDelayMinutes,
            deductionAmount: emp.deductionAmount,
          });
        }
      }
    }
    topOffenders.sort((a, b) => b.totalDelayMinutes - a.totalDelayMinutes);
    const top5Offenders = topOffenders.slice(0, 5);

    // --- Deduction rules summary ---
    const rulesSorted = [...deductionRules].sort((a: any, b: any) => (b.amount || 0) - (a.amount || 0));
    const rulesSummary = rulesSorted.map((r: any) => ({
      key: r.key, label: r.label, amount: r.amount, unit: r.unit,
    }));

    // --- Quality summary ---
    const qualityThisMonth = allQualityDeductions.filter((q: any) => q.month === currentMonthKey);
    const qualitySummary = {
      totalCases: qualityThisMonth.length,
      totalAmount: qualityThisMonth.reduce((s: number, q: any) => s + (q.deductionAmount || 0), 0),
      totalDays: qualityThisMonth.reduce((s: number, q: any) => s + (q.deductionDays || 0), 0),
      // §EXPORT-MAPPING — display labels, never the raw stored type key.
      byType: {
        [deductionTypeLabel('quality_issue')]: qualityThisMonth.filter((q: any) => q.type === 'quality_issue').length,
        [deductionTypeLabel('safety')]: qualityThisMonth.filter((q: any) => q.type === 'safety').length,
        [deductionTypeLabel('compliance')]: qualityThisMonth.filter((q: any) => q.type === 'compliance').length,
      } as Record<string, number>,
    };

    // --- Biometric stats ---
    const latestBiometric = allBiometrics.length > 0
      ? allBiometrics.reduce((latest: any, b: any) => {
          const bTime = new Date(b.createdAt || 0).getTime();
          return bTime > new Date(latest.createdAt || 0).getTime() ? b : latest;
        }, allBiometrics[0])
      : null;
    const biometricLastSync = latestBiometric?.createdAt || null;
    const biometricRecordCount = allBiometrics.length;

    // --- Today's follow-ups (scheduled for today) ---
    const todayISO = new Date().toISOString().split('T')[0];
    const todaysFollowUps = allFollowUps
      .filter((f: any) => f.nextFollowUpDate === todayISO && (f.status === 'open' || f.status === 'in_progress'))
      .map((f: any) => {
        const emp = empMap.get(f.employeeId);
        const resp = empMap.get(f.responsiblePerson);
        return {
          id: f.id,
          employeeId: f.employeeId,
          employeeName: emp?.name || 'غير معروف',
          employeeDepartment: emp?.department || '',
          responsiblePersonName: resp?.name || 'غير معروف',
          responsiblePersonId: f.responsiblePerson,
          followUpType: f.followUpType,
          priorityLevel: f.priorityLevel,
          status: f.status,
          nextFollowUpDate: f.nextFollowUpDate,
        };
      });

    // --- Follow-ups summary ---
    // §26 DATA ACCURACY — canonical status predicates ONLY. The old
    // inline list used 'in_progress'/'completed' which DO NOT EXIST in
    // the follow-up status vocabulary (open | under_review |
    // under_follow_up | resolved | closed | cancelled) — the dashboard
    // disagreed with the Follow-ups page for the same metric.
    const followUpsSummary = {
      totalActive: allFollowUps.filter((f: any) => isActiveFollowUp(f)).length,
      totalOverdue: allFollowUps.filter((f: any) => isOverdueFollowUp(f)).length,
      totalCompleted: allFollowUps.filter((f: any) => isTerminalFollowUp(f)).length,
      todaysScheduled: todaysFollowUps.length,
    };

    // §Home-CC WORK QUEUE — per-item overdue follow-ups so the queue
    // can answer WHAT/WHO/WHY per record (not just a count). Derived
    // from the SAME rows already read above — zero extra DB reads.
    // Priority order: critical > high > medium > low, then most overdue.
    const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const nowMs = Date.now();
    const overdueFollowUpItems = allFollowUps
      .filter((f: any) => isOverdueFollowUp(f))
      .map((f: any) => {
        const emp = empMap.get(f.employeeId);
        const dueMs = f.nextFollowUpDate ? new Date(f.nextFollowUpDate).getTime() : NaN;
        return {
          id: f.id as string,
          employeeId: f.employeeId as string,
          employeeName: (emp?.name || 'غير معروف') as string,
          employeeDepartment: (emp?.department || '') as string,
          followUpType: f.followUpType as string,
          priorityLevel: f.priorityLevel as string,
          responsiblePersonName: (empMap.get(f.responsiblePerson)?.name || '') as string,
          nextFollowUpDate: f.nextFollowUpDate as string,
          daysOverdue: Number.isFinite(dueMs) ? Math.max(0, Math.floor((nowMs - dueMs) / 86_400_000)) : 0,
        };
      })
      .sort((a, b) =>
        (PRIORITY_RANK[a.priorityLevel] ?? 4) - (PRIORITY_RANK[b.priorityLevel] ?? 4)
        || b.daysOverdue - a.daysOverdue)
      .slice(0, 6);

    /* ═══════════════════════════════════════════════════════════════════
       §Home-CC NEW — Command Center extended metrics
       ═══════════════════════════════════════════════════════════════════ */

    /* ═══════════════════════════════════════════════════════════════════
       §Home-CC — section-level authorization (§12 PERMISSIONS AND SCOPE)
       The Home API never exposes a data source the caller cannot view:
       each timeline entity type maps to its page permission key and the
       section is STRIPPED server-side (not merely hidden in the UI).
       Employee scope is already applied above for every employee-linked
       table; this gate is the PAGE-level complement.
       ═══════════════════════════════════════════════════════════════════ */
    const canViewPage = (pageKey: string): boolean =>
      migratePermission(auth.permissions?.[pageKey]).level !== 'none';
    const viewerCan = {
      travel: canViewPage('travel'),
      quality: canViewPage('quality'),
      followUps: canViewPage('followUps'),
      requests: canViewPage('requests'),
      complaints: canViewPage('complaints'),
      capa: canViewPage('capa'),
    };

    // --- Closed deals summary (CLOSED dimension per deal-dates.ts) ---
    const completedDeals = travelDeals.filter((d: any) => isCompletedDeal(d));
    const closedDealSummary: ClosedDealSummary = viewerCan.travel
      ? (() => {
          const counts = countClosedDealsForMonth(completedDeals, currentMonthKey);
          const lastClosedAt = completedDeals
            .map((d: any) => getDealBusinessDate(d, 'CLOSED'))
            .filter((d: string | null): d is string => !!d)
            .reduce((latest: string | null, d: string) => (!latest || d > latest ? d : latest), null);
          return {
            closedThisMonth: counts.closed,
            closedUnknown: counts.unknown,
            totalValue: 0,
            monthKey: currentMonthKey,
            lastUpdated: lastClosedAt,
          };
        })()
      : { closedThisMonth: 0, closedUnknown: 0, totalValue: 0, monthKey: currentMonthKey, lastUpdated: null, unavailable: true } as ClosedDealSummary & { unavailable: boolean };

    // --- Timeline events (real operational events from existing data) ---
    // §17 NO FAKE DATA — every event is a real stored record attributed
    // to its CANONICAL date dimension (§5 DATE SEMANTICS): deals by
    // closedAt (CLOSED), travel milestones by departureDate (TRAVEL),
    // the rest by their own creation/update timestamps.
    const timelineEvents: TimelineEvent[] = [];

    // 1. Deal completions (CLOSED date = this month)
    if (viewerCan.travel) {
      for (const d of completedDeals) {
        const closedAt = getDealBusinessDate(d, 'CLOSED');
        if (closedAt && getDealMonthKey(d, 'CLOSED') === currentMonthKey) {
          const emp = empMap.get(d.employeeId);
          timelineEvents.push({
            id: `deal-${d.id}`,
            type: 'deal_completed',
            title: 'صفقة مكتملة',
            description: `${emp?.name || 'موظف'} — ${d.destination}`,
            entityType: 'travelDeal',
            entityId: d.id,
            employeeId: d.employeeId,
            employeeName: emp?.name,
            department: emp?.department || undefined,
            date: closedAt,
            dateDimension: 'CLOSED',
            createdAt: d.createdAt,
          });
        }
      }
    }

    // 2. Quality observations this month
    if (viewerCan.quality) {
      for (const q of qualityThisMonth) {
        const emp = empMap.get(q.employeeId);
        timelineEvents.push({
          id: `quality-${q.id}`,
          type: 'quality_observation',
          title: 'ملاحظة جودة',
          description: `${deductionTypeLabel(q.type)} — ${q.deductionDays} يوم`,
          entityType: 'qualityDeduction',
          entityId: q.id,
          employeeId: q.employeeId,
          employeeName: emp?.name,
          department: emp?.department || undefined,
          date: q.date, // DD/MM/YYYY — the deduction's own business date
          dateDimension: 'CLOSED',
          createdAt: q.createdAt,
        });
      }
    }

    // 3. Follow-ups completed recently (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoISO = sevenDaysAgo.toISOString();
    if (viewerCan.followUps) {
      const recentCompletedFollowUps = allFollowUps.filter((f: any) =>
        isTerminalFollowUp(f) && f.updatedAt && f.updatedAt >= sevenDaysAgoISO
      );
      for (const f of recentCompletedFollowUps.slice(0, 10)) {
        const emp = empMap.get(f.employeeId);
        timelineEvents.push({
          id: `followup-${f.id}`,
          type: 'followup_completed',
          title: 'متابعة مكتملة',
          description: `${f.followUpType} — ${emp?.name || 'موظف'}`,
          entityType: 'followUp',
          entityId: f.id,
          employeeId: f.employeeId,
          employeeName: emp?.name,
          department: emp?.department || undefined,
          date: f.updatedAt || f.nextFollowUpDate,
          dateDimension: 'CREATED',
          createdAt: f.updatedAt || f.createdAt,
        });
      }
    }

    // 4. Approved requests recently
    if (viewerCan.requests) {
      const recentApprovedRequests = allRequests
        .filter((r: any) => r.status === 'approved' && r.updatedAt && r.updatedAt >= sevenDaysAgoISO)
        .slice(0, 10);
      for (const r of recentApprovedRequests) {
        const emp = empMap.get(r.employeeId);
        timelineEvents.push({
          id: `request-${r.id}`,
          type: 'approval',
          title: 'طلب معتمد',
          description: `${requestTypeLabels[r.type] || r.type} — ${emp?.name || 'موظف'}`,
          entityType: 'request',
          entityId: r.id,
          employeeId: r.employeeId,
          employeeName: emp?.name,
          department: emp?.department || undefined,
          date: r.updatedAt,
          dateDimension: 'CREATED',
          createdAt: r.updatedAt,
        });
      }
    }

    // 5. Complaints recently
    if (viewerCan.complaints) {
      const scopedComplaints = filterRowsByEmployeeScope(batch.get('complaints') || [], scopeCtx);
      const recentComplaints = scopedComplaints
        .filter((c: any) => c.createdAt && c.createdAt >= sevenDaysAgoISO)
        .slice(0, 5);
      for (const c of recentComplaints) {
        const emp = empMap.get(c.employeeId);
        timelineEvents.push({
          id: `complaint-${c.id}`,
          type: 'complaint',
          title: 'شكوى جديدة',
          description: `${c.type || 'غير محدد'} — ${emp?.name || 'موظف'}`,
          entityType: 'complaint',
          entityId: c.id,
          employeeId: c.employeeId,
          employeeName: emp?.name,
          department: emp?.department || undefined,
          date: c.createdAt,
          dateDimension: 'CREATED',
          createdAt: c.createdAt,
        });
      }
    }

    // 6. CAPA updates recently
    if (viewerCan.capa) {
      const scopedCapa = filterRowsByEmployeeScope(batch.get('capaCases') || [], scopeCtx);
      const recentCapa = scopedCapa
        .filter((c: any) => c.updatedAt && c.updatedAt >= sevenDaysAgoISO)
        .slice(0, 5);
      for (const c of recentCapa) {
        timelineEvents.push({
          id: `capa-${c.id}`,
          type: 'capa_update',
          title: 'تحديث CAPA',
          description: `${c.title || 'CAPA'} — ${c.status}`,
          entityType: 'capaCase',
          entityId: c.id,
          employeeId: c.employeeId,
          department: c.department,
          date: c.updatedAt,
          dateDimension: 'CREATED',
          createdAt: c.updatedAt,
        });
      }
    }

    // 7. Travel milestones (departures/returns today + tomorrow)
    const todayDDMMYYYY = getTodayStr();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDDMMYYYY = `${String(tomorrow.getDate()).padStart(2, '0')}/${String(tomorrow.getMonth() + 1).padStart(2, '0')}/${tomorrow.getFullYear()}`;
    const travelMilestones = travelDeals.filter((t: any) =>
      t.departureDate === todayDDMMYYYY || t.departureDate === tomorrowDDMMYYYY ||
      (t.returnDate && (t.returnDate === todayDDMMYYYY || t.returnDate === tomorrowDDMMYYYY))
    );
    for (const t of travelMilestones.slice(0, 5)) {
      const emp = empMap.get(t.employeeId);
      timelineEvents.push({
        id: `travel-${t.id}-${t.departureDate === todayDDMMYYYY || t.departureDate === tomorrowDDMMYYYY ? 'dep' : 'ret'}`,
        type: 'travel_milestone',
        title: t.departureDate === todayDDMMYYYY || t.departureDate === tomorrowDDMMYYYY ? 'مغادرة سفر' : 'عودة سفر',
        description: `${emp?.name || 'موظف'} → ${t.destination}`,
        entityType: 'travelDeal',
        entityId: t.id,
        employeeId: t.employeeId,
        employeeName: emp?.name,
        department: emp?.department || undefined,
        date: t.departureDate === todayDDMMYYYY || t.departureDate === tomorrowDDMMYYYY ? t.departureDate : (t.returnDate || t.departureDate),
        dateDimension: 'TRAVEL',
        createdAt: t.createdAt,
      });
    }

    // Sort timeline by date desc (newest first), limit to 20
    timelineEvents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recentTimeline = timelineEvents.slice(0, 20);

    // --- Department Pulse ---
    const departmentPulse: DepartmentPulse[] = departmentList.map((dept) => {
      const deptEmpIds = new Set(
        employees.filter((e: any) => (e.department || 'بدون قسم') === dept.name).map((e: any) => e.id)
      );
      const deptAttendance = todayRecords.filter((r: any) => deptEmpIds.has(r.employeeId));
      const deptPresent = deptAttendance.filter((r: any) => r.status === 'present').length;
      const deptRate = dept.count > 0 ? Math.round((deptPresent / dept.count) * 100) : 0;
      
      const deptFollowUps = allFollowUps.filter((f: any) => deptEmpIds.has(f.employeeId) && isActiveFollowUp(f));
      const deptQuality = qualityThisMonth.filter((q: any) => deptEmpIds.has(q.employeeId));
      const deptPendingRequests = pendingRequestsDetails.filter((r: any) => deptEmpIds.has(r.employeeId));
      const deptActiveTravel = upcomingTravel.filter((t: any) => deptEmpIds.has(t.employeeId));
      
      // Last activity timestamp across all data for this department
      const lastActivities = [
        ...deptAttendance.map(r => r.createdAt).filter(Boolean),
        ...deptFollowUps.map(f => f.updatedAt || f.createdAt).filter(Boolean),
        ...deptQuality.map(q => q.createdAt).filter(Boolean),
        ...deptPendingRequests.map(r => r.createdAt).filter(Boolean),
        // travelDeals rows carry createdAt directly (the mapped
        // upcomingTravel alert items do not).
        ...travelDeals.filter((t: any) => deptEmpIds.has(t.employeeId)).map((t: any) => t.createdAt).filter(Boolean),
      ];
      const lastActivity = lastActivities.length > 0
        ? lastActivities.reduce((latest, d) => !latest || d > latest ? d : latest, null)
        : null;

      // Attendance-trend direction vs last month: present-days per
      // employee per working day, computed over the month's OWN
      // working-day set. A ±2pp band reads as flat (no noise trend).
      const lastMonthDept = lastMonthPerformance.departments.find(d => d.departmentName === dept.name);
      const currentDept = currentMonthPerformance.departments.find(d => d.departmentName === dept.name);
      let trend: -1 | 0 | 1 = 0;
      if (lastMonthDept && currentDept && lastMonthPerformance.totalWorkingDays > 0 && currentMonthPerformance.totalWorkingDays > 0) {
        const lastRate = lastMonthDept.employeeCount > 0 ? lastMonthDept.presentDays / (lastMonthDept.employeeCount * lastMonthPerformance.totalWorkingDays) : 0;
        const currentRate = currentDept.employeeCount > 0 ? currentDept.presentDays / (currentDept.employeeCount * currentMonthPerformance.totalWorkingDays) : 0;
        if (currentRate > lastRate + 0.02) trend = 1;
        else if (currentRate < lastRate - 0.02) trend = -1;
      }

      return {
        name: dept.name,
        employeeCount: dept.count,
        attendanceRate: deptRate,
        openFollowUps: deptFollowUps.length,
        qualityCasesThisMonth: deptQuality.length,
        pendingApprovals: deptPendingRequests.length,
        activeTravel: deptActiveTravel.length,
        trend,
        lastActivity,
      };
    });

    // --- Performance Pulse — DETERMINISTIC operational aggregates only.
    // §8/§17: the Home surface must NOT invent KPI formulas. The
    // authoritative Quality-KPI level (avgRawScore) is fetched by the
    // client from the CANONICAL /api/kpi-reports/summary engine —
    // permission-gated (kpiReports view) and scope-resolved there —
    // never recomputed here. What this route provides is the raw
    // operational completion numbers from the data already read above.
    const completedFollowUps = allFollowUps.filter(isTerminalFollowUp).length;
    const totalTrackedFollowUps = allFollowUps.filter((f: any) => isActiveFollowUp(f) || isTerminalFollowUp(f)).length;
    const performanceEmployees = currentMonthPerformance.departments.reduce((s, d) => s + d.employeeCount, 0);

    const performancePulse: PerformancePulse = {
      // Canonical Quality-KPI level comes from the KPI engine (client,
      // permission-gated) — null here means "not computed by Home".
      currentScore: null,
      targetScore: null,
      progress: null,
      trend: [],
      completedWork: completedTravelCount,
      followUpCompletionRate: totalTrackedFollowUps > 0
        ? Math.round((completedFollowUps / totalTrackedFollowUps) * 100)
        : 0,
      qualityDeductionsPerEmployee: performanceEmployees > 0
        ? Math.round((qualitySummary.totalCases / performanceEmployees) * 100) / 100
        : 0,
      lastCalculated: new Date().toISOString(),
    };

    // --- Metric Freshness ---
    const dataFetchedAt = new Date().toISOString();
    const metricTimestamps: Record<string, string | null> = {
      attendance: todayRecords.length > 0 ? todayRecords.reduce((latest, r) => !latest || (r.createdAt && r.createdAt > latest) ? r.createdAt : latest, null as string | null) : null,
      requests: pendingRequestsDetails.length > 0 ? pendingRequestsDetails[0].createdAt : null,
      travel: travelDeals.length > 0
        ? travelDeals.reduce((latest: string | null, t: any) => (!latest || (t.createdAt && t.createdAt > latest)) ? (t.createdAt || latest) : latest, null)
        : null,
      quality: qualityThisMonth.length > 0 ? qualityThisMonth.reduce((latest, q) => !latest || q.createdAt > latest ? q.createdAt : latest, null as string | null) : null,
      followUps: allFollowUps.length > 0 ? allFollowUps.reduce((latest, f) => !latest || (f.updatedAt || f.createdAt) > latest ? (f.updatedAt || f.createdAt) : latest, null as string | null) : null,
      biometric: biometricLastSync,
    };
    const freshness: MetricFreshness = { dataFetchedAt, metricTimestamps };

    return NextResponse.json({
      totalEmployees,
      todayAttendance,
      presentCount,
      absentCount,
      lateCount,
      attendanceRate: totalEmployees > 0 ? Math.round((presentCount / totalEmployees) * 100) : 0,
      departmentList,
      deptTodayStats,
      pendingRequests: pendingRequestsDetails.length,
      pendingRequestsDetails,
      requestTypeSummary,
      activeTravel: upcomingTravel.length,
      completedTravelCount,
      inProgressTravelCount,
      upcomingTravel,
      lateEmployees,
      lastMonthPerformance,
      currentMonthPerformance,
      topOffenders: top5Offenders,
      rulesSummary,
      qualitySummary,
      biometricLastSync,
      biometricRecordCount,
      todaysFollowUps,
      followUpsSummary,
      overdueFollowUpItems,
      // §Home-CC NEW
      closedDealSummary,
      recentTimeline,
      departmentPulse,
      performancePulse,
      freshness,
    });
  } catch (error) {
    console.error('[GET /api/home/stats] Error:', error);
    return NextResponse.json({ error: 'Failed to load home stats' }, { status: 500 });
  }
}
