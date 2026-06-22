import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

/* ── Types ────────────────────────────────────────────────────── */

type CAPAStatus =
  | 'open'
  | 'investigation'
  | 'root_cause_analysis'
  | 'corrective_action'
  | 'preventive_action'
  | 'verification'
  | 'closed'
  | 'rejected'
  | 'reopened';

type CAPAPriority = 'critical' | 'high' | 'medium' | 'low';

type VerificationResult = 'effective' | 'partially_effective' | 'not_effective' | '';

type CAPASource =
  | 'audit'
  | 'complaint'
  | 'mistake_pattern'
  | 'management_review'
  | 'employee_feedback'
  | 'automation'
  | 'manual';

interface CAPACase {
  id: string;
  capaId: string;
  title: string;
  department: string;
  employeeId: string;
  employeeName: string;
  status: CAPAStatus;
  priority: CAPAPriority;
  verificationResult: VerificationResult;
  source: CAPASource;
  issueCategory: string;
  slaDays: number;
  overdueDays: number;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  assignedTo?: string;
  assignedToName?: string;
}

/* ── Response types ───────────────────────────────────────────── */

interface SummaryMetrics {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  critical: number;
  reopened: number;
  effectivenessPct: number;
}

interface GroupMetrics {
  total: number;
  open: number;
  closed: number;
  overdue: number;
  critical: number;
  effectivenessPct: number;
}

interface EmployeeMetrics {
  employeeName: string;
  department: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
  critical: number;
}

interface MonthlyTrend {
  month: string;
  total: number;
  open: number;
  closed: number;
  overdue: number;
}

interface CAPAReportResponse {
  summary: SummaryMetrics;
  byDepartment: Record<string, GroupMetrics>;
  byEmployee: Record<string, EmployeeMetrics>;
  monthlyTrends: MonthlyTrend[];
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  bySource: Record<string, number>;
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** Returns true if the case is in a closed state (counted towards closed metrics). */
function isClosed(status: CAPAStatus): boolean {
  return status === 'closed';
}

/** Returns true if the case is in a terminal state (closed or rejected). */
function isTerminal(status: CAPAStatus): boolean {
  return status === 'closed' || status === 'rejected';
}

/** Extracts 'YYYY-MM' from an ISO date string. */
function toMonthKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Generates the last 12 month keys from the current date. */
function getLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Calculates effectiveness percentage.
 * Effective closed cases / total closed cases × 100
 */
function calcEffectiveness(cases: CAPACase[]): number {
  const closedCases = cases.filter((c) => isClosed(c.status));
  if (closedCases.length === 0) return 0;
  const effective = closedCases.filter(
    (c) => c.verificationResult === 'effective'
  ).length;
  return Math.round((effective / closedCases.length) * 100);
}

/** Builds group-level metrics from a subset of cases. */
function buildGroupMetrics(cases: CAPACase[]): GroupMetrics {
  return {
    total: cases.length,
    open: cases.filter((c) => !isTerminal(c.status)).length,
    closed: cases.filter((c) => isClosed(c.status)).length,
    overdue: cases.filter(
      (c) => c.overdueDays > 0 && !isTerminal(c.status)
    ).length,
    critical: cases.filter(
      (c) => c.priority === 'critical' && !isTerminal(c.status)
    ).length,
    effectivenessPct: calcEffectiveness(cases),
  };
}

/* ── GET Handler ──────────────────────────────────────────────── */

export async function GET(
  request: NextRequest
): Promise<NextResponse<CAPAReportResponse | { error: string }>> {
  const auth = requireAuth(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'غير مصرح بالوصول' },
      { status: 401 }
    );
  }

  const { searchParams } = new URL(request.url);
  const filterDepartment = searchParams.get('department') || '';
  const filterDateFrom = searchParams.get('dateFrom') || '';
  const filterDateTo = searchParams.get('dateTo') || '';
  const filterStatus = searchParams.get('status') || '';
  const filterPriority = searchParams.get('priority') || '';

  try {
    const allCases: CAPACase[] = await getAll('capaCases');

    /* ── Apply query-param filters ─────────────────────────────── */

    let cases = allCases.filter((c) => {
      if (filterDepartment && c.department !== filterDepartment) return false;
      if (filterStatus && c.status !== filterStatus) return false;
      if (filterPriority && c.priority !== filterPriority) return false;
      if (
        filterDateFrom &&
        new Date(c.createdAt) < new Date(filterDateFrom)
      )
        return false;
      if (
        filterDateTo &&
        new Date(c.createdAt) > new Date(filterDateTo + 'T23:59:59.999Z')
      )
        return false;
      return true;
    });

    /* ── 1. Summary ────────────────────────────────────────────── */

    const summary: SummaryMetrics = {
      total: cases.length,
      open: cases.filter((c) => !isTerminal(c.status)).length,
      closed: cases.filter((c) => isClosed(c.status)).length,
      overdue: cases.filter(
        (c) => c.overdueDays > 0 && !isTerminal(c.status)
      ).length,
      critical: cases.filter(
        (c) => c.priority === 'critical' && !isTerminal(c.status)
      ).length,
      reopened: cases.filter((c) => c.status === 'reopened').length,
      effectivenessPct: calcEffectiveness(cases),
    };

    /* ── 2. By Department ──────────────────────────────────────── */

    const deptMap: Record<string, CAPACase[]> = {};
    for (const c of cases) {
      const dept = c.department || 'غير محدد';
      if (!deptMap[dept]) deptMap[dept] = [];
      deptMap[dept].push(c);
    }

    const byDepartment: Record<string, GroupMetrics> = {};
    for (const [dept, deptCases] of Object.entries(deptMap)) {
      byDepartment[dept] = buildGroupMetrics(deptCases);
    }

    /* ── 3. By Employee (top 20 by total) ─────────────────────── */

    const empMap: Record<
      string,
      { name: string; dept: string; cases: CAPACase[] }
    > = {};

    for (const c of cases) {
      const empId = c.employeeId || c.assignedTo || 'غير معرّف';
      if (!empMap[empId]) {
        empMap[empId] = {
          name: c.employeeName || c.assignedToName || 'غير معروف',
          dept: c.department || 'غير محدد',
          cases: [],
        };
      }
      empMap[empId].cases.push(c);
    }

    const byEmployee: Record<string, EmployeeMetrics> = {};

    Object.entries(empMap)
      .sort((a, b) => b[1].cases.length - a[1].cases.length)
      .slice(0, 20)
      .forEach(([empId, emp]) => {
        byEmployee[empId] = {
          employeeName: emp.name,
          department: emp.dept,
          total: emp.cases.length,
          open: emp.cases.filter((c) => !isTerminal(c.status)).length,
          closed: emp.cases.filter((c) => isClosed(c.status)).length,
          overdue: emp.cases.filter(
            (c) => c.overdueDays > 0 && !isTerminal(c.status)
          ).length,
          critical: emp.cases.filter(
            (c) => c.priority === 'critical' && !isTerminal(c.status)
          ).length,
        };
      });

    /* ── 4. Monthly Trends (last 12 months) ────────────────────── */

    const last12 = getLast12Months();
    const monthlyBucket: Record<string, CAPACase[]> = {};
    for (const m of last12) monthlyBucket[m] = [];

    for (const c of cases) {
      const mk = toMonthKey(c.createdAt);
      if (monthlyBucket[mk]) monthlyBucket[mk].push(c);
    }

    const monthlyTrends: MonthlyTrend[] = last12.map((month) => {
      const mc = monthlyBucket[month];
      return {
        month,
        total: mc.length,
        open: mc.filter((c) => !isTerminal(c.status)).length,
        closed: mc.filter((c) => isClosed(c.status)).length,
        overdue: mc.filter(
          (c) => c.overdueDays > 0 && !isTerminal(c.status)
        ).length,
      };
    });

    /* ── 5. By Status ──────────────────────────────────────────── */

    const byStatus: Record<string, number> = {};
    for (const c of cases) {
      byStatus[c.status] = (byStatus[c.status] || 0) + 1;
    }

    /* ── 6. By Priority ────────────────────────────────────────── */

    const byPriority: Record<string, number> = {};
    for (const c of cases) {
      byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;
    }

    /* ── 7. By Category ────────────────────────────────────────── */

    const byCategory: Record<string, number> = {};
    for (const c of cases) {
      const cat = c.issueCategory || 'غير مصنف';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    /* ── 8. By Source ──────────────────────────────────────────── */

    const bySource: Record<string, number> = {};
    for (const c of cases) {
      bySource[c.source] = (bySource[c.source] || 0) + 1;
    }

    /* ── Response ──────────────────────────────────────────────── */

    return NextResponse.json({
      summary,
      byDepartment,
      byEmployee,
      monthlyTrends,
      byStatus,
      byPriority,
      byCategory,
      bySource,
    });
  } catch (error) {
    console.error('[تقرير كابا] خطأ أثناء إنشاء التقرير:', error);
    return NextResponse.json(
      { error: 'حدث خطأ أثناء إنشاء التقرير' },
      { status: 500 }
    );
  }
}