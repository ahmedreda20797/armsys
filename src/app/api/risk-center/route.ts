import { NextRequest, NextResponse } from 'next/server';
import { getAll, getAllBatch, getEmployeeMap } from '@/lib/db';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import { filterEmployeesInScope, authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { isEffectiveDeduction } from '@/lib/quality-deductions/domain';
// Canonical metric layer — the ONLY risk/overdue definitions in the system.
import {
  computeRisk,
  levelForScore,
  isOverdueCAPA,
  isClosedCAPA,
  isTerminalCAPA,
  RISK_LEVEL_BANDS,
  type RiskBreakdown,
} from '@/lib/metrics';

interface EmployeeRisk {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  // Canonical breakdown shape — every factor is { count, points }.
  breakdown: RiskBreakdown;
  openCases: number;
  lastActivity: string;
  trend: 'increasing' | 'stable' | 'improving';
  recommendations: string[];
  capaIds: string[];
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // M0.2: risk data is gated by the existing 'riskCenter' page
    // permission — a valid token alone must not expose workforce risk
    // scores. Admin bypass unchanged (inside verifyPermission).
    const permCheck = await verifyPermission(request, 'riskCenter', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get('department');
    const levelFilter = searchParams.get('level');
    // Milestone 7 §14 — optional month attribution: when present, risk
    // factors are computed from the records RECORDED in that month
    // (traceable source data), instead of the default rolling snapshot.
    // The comparison answer is "how did recorded factors change", never
    // a fabricated reconstruction of a past state.
    const monthParam = searchParams.get('month');
    const monthKey =
      monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : null;

    const [batch, empMap] = await Promise.all([
      getAllBatch([
        'employees',
        'attendance',
        'qualityDeductions',
        'hrDeductions',
        'followUps',
        'complaints',
        'capaCases',
      ]),
      getEmployeeMap(),
    ]);

    // ═══════════════════════════════════════════════════
    // READ SCOPE (M0.5) — risk rows exist only for employees
    // inside the caller's authorized scope, and every factor
    // table is intersected with the same scope BEFORE any
    // score, ranking, summary or department analysis is
    // computed. Complaints/CAPA follow the M0.4 optional-link
    // rule (unlinked = organizational; any present link,
    // incl. CAPA relatedEmployeeIds, must be in scope) so a
    // per-employee breakdown only counts cases the viewer
    // could actually open. The risk formula itself is
    // untouched — authorization only changes WHICH employees
    // are scored.
    // ═══════════════════════════════════════════════════
    const scopeCtx = await resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions);
    const employees = filterEmployeesInScope(batch.get('employees') || [], scopeCtx);
    const attendanceRecords = filterRowsByEmployeeScope(batch.get('attendance') || [], scopeCtx);
    // §WORKFLOW — only APPROVED discounts raise an employee's risk.
    const qualityDeductions = filterRowsByEmployeeScope(batch.get('qualityDeductions') || [], scopeCtx)
      .filter(isEffectiveDeduction);
    const hrDeductions = filterRowsByEmployeeScope(batch.get('hrDeductions') || [], scopeCtx);
    const followUps = filterRowsByEmployeeScope(batch.get('followUps') || [], scopeCtx);
    const complaints = filterRowsByEmployeeScope(
      batch.get('complaints') || [],
      scopeCtx,
      { optionalLink: true },
    );
    const capaCases = filterRowsByEmployeeScope(
      batch.get('capaCases') || [],
      scopeCtx,
      { optionalLink: true, relatedEmployeeIdsField: 'relatedEmployeeIds' },
    );

    // ── 30-day window ──
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // ── 7-day window ──
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    // ── §14 month attribution helpers (only active when monthKey set) ──
    // A record belongs to the month when its stored date/month field
    // falls inside it — each table uses its OWN stored field verbatim.
    const inMonth = (record: any, fields: readonly string[]): boolean => {
      if (!monthKey) return true;
      for (const field of fields) {
        const v = record[field];
        if (typeof v === 'string') {
          if (/^\d{4}-\d{2}/.test(v) && v.slice(0, 7) === monthKey) return true;
          // DD/MM/YYYY display dates → compare month+year.
          const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v);
          if (m && `${m[3]}-${m[2]}` === monthKey) return true;
          // MM/YYYY month labels.
          const mm = /^(\d{2})\/(\d{4})$/.exec(v);
          if (mm && `${mm[2]}-${mm[1]}` === monthKey) return true;
        }
      }
      return false;
    };

    const monthScoped = monthKey !== null;
    const attRecordsForScore = monthScoped
      ? attendanceRecords.filter((r: any) => inMonth(r, ['date']))
      : attendanceRecords;
    const qualityForScore = monthScoped
      ? qualityDeductions.filter((r: any) => inMonth(r, ['month', 'date']))
      : qualityDeductions;
    const hrForScore = monthScoped
      ? hrDeductions.filter((r: any) => inMonth(r, ['month', 'deductionDate']))
      : hrDeductions;
    const followUpsForScore = monthScoped
      ? followUps.filter((r: any) => inMonth(r, ['date']))
      : followUps;
    const complaintsForScore = monthScoped
      ? complaints.filter((r: any) => inMonth(r, ['createdAt']))
      : complaints;
    const capaForScore = monthScoped
      ? capaCases.filter((r: any) => inMonth(r, ['createdAt']))
      : capaCases;

    // ── Pre-compute attendance stats per employee ──
    const empAttendance = new Map<string, { delays: number; absences: number; lastDate: string }>();
    for (const r of attRecordsForScore) {
      if (!empAttendance.has(r.employeeId)) {
        empAttendance.set(r.employeeId, { delays: 0, absences: 0, lastDate: '' });
      }
      const stat = empAttendance.get(r.employeeId)!;
      if (r.status === 'late') stat.delays += 1;
      if (r.status === 'absent') stat.absences += 1;
      if (r.date > stat.lastDate) stat.lastDate = r.date;
    }

    // ── Pre-compute quality deductions per employee (all time) ──
    const empQuality = new Map<string, number>();
    for (const q of qualityForScore) {
      empQuality.set(q.employeeId, (empQuality.get(q.employeeId) || 0) + 1);
    }

    // ── Pre-compute HR deductions per employee ──
    const empHr = new Map<string, number>();
    for (const h of hrForScore) {
      empHr.set(h.employeeId, (empHr.get(h.employeeId) || 0) + 1);
    }

    // ── Pre-compute follow-up stats per employee ──
    const empFollowUps = new Map<string, { open: number; high: number; critical: number; repeated: number; lastDate: string }>();
    for (const f of followUpsForScore) {
      if (!empFollowUps.has(f.employeeId)) {
        empFollowUps.set(f.employeeId, { open: 0, high: 0, critical: 0, repeated: 0, lastDate: '' });
      }
      const stat = empFollowUps.get(f.employeeId)!;
      if (f.status === 'open' || f.status === 'under_follow_up' || f.status === 'under_review') stat.open += 1;
      if (f.priorityLevel === 'high') stat.high += 1;
      if (f.priorityLevel === 'critical') stat.critical += 1;
      // Repeated: same type within 30 days
      const recentSameType = followUpsForScore.filter(
        (other: any) => other.employeeId === f.employeeId && other.followUpType === f.followUpType && other.date >= thirtyDaysAgoStr && other.id !== f.id
      );
      if (recentSameType.length > 0) stat.repeated = 1;
      if (f.date > stat.lastDate) stat.lastDate = f.date;
    }

    // ── Pre-compute complaints per employee ──
    const empComplaints = new Map<string, { open: number; lastDate: string }>();
    for (const c of complaintsForScore) {
      if (!c.employeeId) continue;
      if (!empComplaints.has(c.employeeId)) {
        empComplaints.set(c.employeeId, { open: 0, lastDate: '' });
      }
      const stat = empComplaints.get(c.employeeId)!;
      if (c.status === 'open' || c.status === 'under_investigation' || c.status === 'pending_resolution') stat.open += 1;
      if ((c.createdAt || '') > stat.lastDate) stat.lastDate = c.createdAt || '';
    }

    // ── Pre-compute CAPA stats per employee ──
    const empCapa = new Map<string, { open: number; overdue: number; critical: number; reopened: number; capaIds: string[]; lastDate: string }>();

    for (const c of capaForScore) {
      // Collect CAPAs linked directly via employeeId or via relatedEmployeeIds
      const linkedIds: string[] = [];
      if (c.employeeId) linkedIds.push(c.employeeId);
      if (c.relatedEmployeeIds && Array.isArray(c.relatedEmployeeIds)) {
        linkedIds.push(...c.relatedEmployeeIds);
      }

      const terminal = isTerminalCAPA(c);

      for (const eid of linkedIds) {
        if (!empCapa.has(eid)) {
          empCapa.set(eid, { open: 0, overdue: 0, critical: 0, reopened: 0, capaIds: [], lastDate: '' });
        }
        const stat = empCapa.get(eid)!;

        if (!terminal) {
          stat.open += 1;
          // Canonical overdue rule (correctiveDueDate-aware, single source)
          if (isOverdueCAPA(c, now)) stat.overdue += 1;
          if (c.priority === 'critical') stat.critical += 1;
          if (c.status === 'reopened') stat.reopened += 1;
        }

        // Track CAPA IDs for this employee (for "View CAPA" button)
        if (!stat.capaIds.includes(c.id)) {
          stat.capaIds.push(c.id);
        }

        if ((c.updatedAt || c.createdAt || '') > stat.lastDate) {
          stat.lastDate = c.updatedAt || c.createdAt || '';
        }
      }
    }

    // ── Build risk for each employee ──
    const risks: EmployeeRisk[] = [];

    for (const emp of employees) {
      const att = empAttendance.get(emp.id) || { delays: 0, absences: 0, lastDate: '' };
      const qCount = empQuality.get(emp.id) || 0;
      const hCount = empHr.get(emp.id) || 0;
      const fu = empFollowUps.get(emp.id) || { open: 0, high: 0, critical: 0, repeated: 0, lastDate: '' };
      const comp = empComplaints.get(emp.id) || { open: 0, lastDate: '' };
      const capa = empCapa.get(emp.id) || { open: 0, overdue: 0, critical: 0, reopened: 0, capaIds: [], lastDate: '' };

      // Canonical risk score — the ONLY formula in the system.
      // Zero-risk employees are INCLUDED with score 0 so lowRiskCount
      // reflects the true workforce, not just employees with any factor.
      const { score: totalScore, level: riskLevel, breakdown } = computeRisk({
        delayCount: att.delays,
        absenceCount: att.absences,
        qualityCount: qCount,
        hrCount: hCount,
        openFollowUpCount: fu.open,
        highPriorityFollowUpCount: fu.high,
        criticalFollowUpCount: fu.critical,
        openComplaintCount: comp.open,
        repeatedIssueCount: fu.repeated,
        openCapaCount: capa.open,
        overdueCapaCount: capa.overdue,
        criticalCapaCount: capa.critical,
        reopenedCapaCount: capa.reopened,
      });

      // ── Trend (simple heuristic: recent 7 days activity vs older) ──
      // §14: in month-attributed mode the 7-day trend is NOT computable
      // from the attributed month alone — reported as stable (never
      // fabricated) so the UI can flag it honestly.
      let trend: 'increasing' | 'stable' | 'improving' = 'stable';
      if (!monthScoped) {
        const recentAttendance = attendanceRecords.filter(
          (r: any) => r.employeeId === emp.id && r.date >= sevenDaysAgoStr && (r.status === 'late' || r.status === 'absent')
        ).length;
        const recentFollowUps = followUps.filter(
          (f: any) => f.employeeId === emp.id && f.date >= sevenDaysAgoStr && (f.status === 'open' || f.status === 'under_follow_up')
        ).length;
        const recentCapas = capaCases.filter(
          (c: any) => (c.employeeId === emp.id || (c.relatedEmployeeIds || []).includes(emp.id)) && !isTerminalCAPA(c) && (c.updatedAt || c.createdAt || '') >= sevenDaysAgoStr
        ).length;
        if (recentAttendance >= 3 || recentFollowUps >= 2 || recentCapas >= 2) trend = 'increasing';
        else if (recentAttendance === 0 && recentFollowUps === 0 && recentCapas === 0 && totalScore > 10) trend = 'improving';
      }

      // ── Recommendations ──
      const recommendations: string[] = [];
      if (att.delays >= 3) recommendations.push('مراجعة سجل الحضور مع الموظف');
      if (att.absences >= 2) recommendations.push('تحقيق في أسباب الغياب المتكرر');
      if (qCount >= 2) recommendations.push('إعادة تدريب على معايير الجودة');
      if (hCount >= 2) recommendations.push('إحالة لإدارة الموارد البشرية');
      if (fu.critical > 0) recommendations.push('فتح قضية CAPA');
      if (comp.open > 0) recommendations.push('مراجعة شكاوى العملاء');
      if (riskLevel === 'critical') recommendations.push('تصعيد لمدير الموارد البشرية فوراً');
      if (fu.repeated > 0) recommendations.push('تحليل السبب الجذري للمشكلة المتكررة');
      if (capa.overdue > 0) recommendations.push('إعطاز حالات كابا — اتخاذ إجراء فوري');
      if (capa.reopened > 0) recommendations.push('حالات كابا معاد فتحها — مراجعة فعالية الإجراءات التصحيحية');
      if (capa.open >= 3) recommendations.push('عدد كبير من حالات كابا المفتوحة — تحليل نمطي مطلوب');

      // ── Last Activity ──
      const dates = [att.lastDate, fu.lastDate, comp.lastDate, capa.lastDate].filter(Boolean);
      const lastActivity = dates.length > 0 ? dates.sort().reverse()[0] : '';

      risks.push({
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department || '',
        position: emp.position || '',
        riskScore: totalScore,
        riskLevel,
        breakdown,
        openCases: fu.open + comp.open + capa.open,
        lastActivity,
        trend,
        recommendations,
        capaIds: capa.capaIds,
      });
    }

    // ── Sort by risk score descending ──
    risks.sort((a, b) => b.riskScore - a.riskScore);

    // ── Filters ──
    let filtered = risks;
    if (deptFilter) filtered = filtered.filter(r => r.department === deptFilter);
    if (levelFilter) filtered = filtered.filter(r => r.riskLevel === levelFilter);

    // ── Summary stats ──
    const totalEmployees = employees.length;
    const lowRiskCount = risks.filter(r => r.riskLevel === 'low').length;
    const mediumRiskCount = risks.filter(r => r.riskLevel === 'medium').length;
    const highRiskCount = risks.filter(r => r.riskLevel === 'high').length;
    const criticalRiskCount = risks.filter(r => r.riskLevel === 'critical').length;
    const openCasesTotal = risks.reduce((s, r) => s + r.openCases, 0);
    const immediateActionCount = risks.filter(r => r.riskScore >= RISK_LEVEL_BANDS.high).length;

    // ── Department analysis ──
    const deptAnalysis: Record<string, { count: number; avgScore: number; totalScore: number; openCases: number; qualityViolations: number; attendanceIssues: number; openCapas: number; overdueCapas: number }> = {};
    for (const r of risks) {
      const dept = r.department || 'بدون قسم';
      if (!deptAnalysis[dept]) deptAnalysis[dept] = { count: 0, avgScore: 0, totalScore: 0, openCases: 0, qualityViolations: 0, attendanceIssues: 0, openCapas: 0, overdueCapas: 0 };
      deptAnalysis[dept].count += 1;
      deptAnalysis[dept].totalScore += r.riskScore;
      deptAnalysis[dept].openCases += r.openCases;
      deptAnalysis[dept].qualityViolations += r.breakdown.quality.count;
      deptAnalysis[dept].attendanceIssues += r.breakdown.delay.count + r.breakdown.absence.count;
      deptAnalysis[dept].openCapas += r.breakdown.openCapa.count;
      deptAnalysis[dept].overdueCapas += r.breakdown.overdueCapa.count;
    }
    for (const dept of Object.values(deptAnalysis)) {
      dept.avgScore = dept.count > 0 ? Math.round(dept.totalScore / dept.count) : 0;
    }

    return NextResponse.json({
      employees: filtered,
      summary: {
        totalEmployees,
        lowRiskCount,
        mediumRiskCount,
        highRiskCount,
        criticalRiskCount,
        openCasesTotal,
        immediateActionCount,
      },
      departmentAnalysis: deptAnalysis,
      // §14 auditability: which attribution produced these numbers.
      basis: monthScoped ? 'month' : 'rolling',
      monthKey,
      basisLabel: monthScoped
        ? `عوامل الخطر المسجلة خلال ${monthKey}`
        : 'لقطة متجددة (آخر 30 يوماً / الحالة الحالية)',
    });
  } catch (error) {
    console.error('[GET /api/risk-center] Error:', error);
    return NextResponse.json({ error: 'Failed to load risk center data' }, { status: 500 });
  }
}
