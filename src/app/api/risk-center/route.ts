import { NextRequest, NextResponse } from 'next/server';
import { getAll, getAllBatch, getEmployeeMap } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

interface EmployeeRisk {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  breakdown: {
    delayCount: number;
    delayPoints: number;
    absenceCount: number;
    absencePoints: number;
    qualityViolations: number;
    qualityPoints: number;
    hrViolations: number;
    hrPoints: number;
    openFollowUps: number;
    openFollowUpPoints: number;
    highPriorityFollowUps: number;
    highPriorityPoints: number;
    criticalFollowUps: number;
    criticalPoints: number;
    complaints: number;
    complaintPoints: number;
    repeatedIssues: number;
    repeatedPoints: number;
    // CAPA integration factors
    openCapas: number;
    openCapaPoints: number;
    overdueCapas: number;
    overdueCapaPoints: number;
    criticalCapas: number;
    criticalCapaPoints: number;
    reopenedCapas: number;
    reopenedCapaPoints: number;
  };
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

    const { searchParams } = new URL(request.url);
    const deptFilter = searchParams.get('department');
    const levelFilter = searchParams.get('level');

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

    const employees = batch.get('employees') || [];
    const attendanceRecords = batch.get('attendance') || [];
    const qualityDeductions = batch.get('qualityDeductions') || [];
    const hrDeductions = batch.get('hrDeductions') || [];
    const followUps = batch.get('followUps') || [];
    const complaints = batch.get('complaints') || [];
    const capaCases = batch.get('capaCases') || [];

    // ── 30-day window ──
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

    // ── 7-day window ──
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    // ── Pre-compute attendance stats per employee ──
    const empAttendance = new Map<string, { delays: number; absences: number; lastDate: string }>();
    for (const r of attendanceRecords) {
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
    for (const q of qualityDeductions) {
      empQuality.set(q.employeeId, (empQuality.get(q.employeeId) || 0) + 1);
    }

    // ── Pre-compute HR deductions per employee ──
    const empHr = new Map<string, number>();
    for (const h of hrDeductions) {
      empHr.set(h.employeeId, (empHr.get(h.employeeId) || 0) + 1);
    }

    // ── Pre-compute follow-up stats per employee ──
    const empFollowUps = new Map<string, { open: number; high: number; critical: number; repeated: number; lastDate: string }>();
    for (const f of followUps) {
      if (!empFollowUps.has(f.employeeId)) {
        empFollowUps.set(f.employeeId, { open: 0, high: 0, critical: 0, repeated: 0, lastDate: '' });
      }
      const stat = empFollowUps.get(f.employeeId)!;
      if (f.status === 'open' || f.status === 'under_follow_up' || f.status === 'under_review') stat.open += 1;
      if (f.priorityLevel === 'high') stat.high += 1;
      if (f.priorityLevel === 'critical') stat.critical += 1;
      // Repeated: same type within 30 days
      const recentSameType = followUps.filter(
        (other: any) => other.employeeId === f.employeeId && other.followUpType === f.followUpType && other.date >= thirtyDaysAgoStr && other.id !== f.id
      );
      if (recentSameType.length > 0) stat.repeated = 1;
      if (f.date > stat.lastDate) stat.lastDate = f.date;
    }

    // ── Pre-compute complaints per employee ──
    const empComplaints = new Map<string, { open: number; lastDate: string }>();
    for (const c of complaints) {
      if (!c.employeeId) continue;
      if (!empComplaints.has(c.employeeId)) {
        empComplaints.set(c.employeeId, { open: 0, lastDate: '' });
      }
      const stat = empComplaints.get(c.employeeId)!;
      if (c.status === 'open' || c.status === 'under_investigation' || c.status === 'pending_resolution') stat.open += 1;
      if ((c.createdAt || '') > stat.lastDate) stat.lastDate = c.createdAt || '';
    }

    // ── Pre-compute CAPA stats per employee ──
    const CLOSED_STATUSES = ['closed', 'rejected'];
    const empCapa = new Map<string, { open: number; overdue: number; critical: number; reopened: number; capaIds: string[]; lastDate: string }>();

    for (const c of capaCases) {
      // Collect CAPAs linked directly via employeeId or via relatedEmployeeIds
      const linkedIds: string[] = [];
      if (c.employeeId) linkedIds.push(c.employeeId);
      if (c.relatedEmployeeIds && Array.isArray(c.relatedEmployeeIds)) {
        linkedIds.push(...c.relatedEmployeeIds);
      }

      const isClosed = CLOSED_STATUSES.includes(c.status);

      for (const eid of linkedIds) {
        if (!empCapa.has(eid)) {
          empCapa.set(eid, { open: 0, overdue: 0, critical: 0, reopened: 0, capaIds: [], lastDate: '' });
        }
        const stat = empCapa.get(eid)!;

        if (!isClosed) {
          stat.open += 1;

          // Check overdue: SLA exceeded
          const slaDays = c.slaDays || 7;
          const createdMs = new Date(c.createdAt).getTime();
          const dueMs = createdMs + slaDays * 86400000;
          if (Date.now() > dueMs) {
            stat.overdue += 1;
          }

          // Critical priority CAPAs
          if (c.priority === 'critical') {
            stat.critical += 1;
          }

          // Reopened CAPAs
          if (c.status === 'reopened') {
            stat.reopened += 1;
          }
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

      // Skip employees with zero risk
      if (att.delays === 0 && att.absences === 0 && qCount === 0 && hCount === 0 && fu.open === 0 && comp.open === 0 && capa.open === 0) continue;

      const delayPoints = att.delays * 1;
      const absencePoints = att.absences * 3;
      const qualityPoints = qCount * 5;
      const hrPoints = hCount * 5;
      const openFollowUpPoints = fu.open * 3;
      const highPriorityPoints = fu.high * 5;
      const criticalPoints = fu.critical * 10;
      const complaintPoints = comp.open * 8;
      const repeatedPoints = fu.repeated * 5;

      // CAPA risk factors
      const openCapaPoints = capa.open * 5;      // Open CAPA = +5
      const overdueCapaPoints = capa.overdue * 10; // Overdue CAPA = +10
      const criticalCapaPoints = capa.critical * 8; // Critical CAPA = +8
      const reopenedCapaPoints = capa.reopened * 15; // Reopened CAPA = +15

      const totalScore = delayPoints + absencePoints + qualityPoints + hrPoints + openFollowUpPoints + highPriorityPoints + criticalPoints + complaintPoints + repeatedPoints + openCapaPoints + overdueCapaPoints + criticalCapaPoints + reopenedCapaPoints;

      // ── Risk Level ──
      let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
      if (totalScore >= 36) riskLevel = 'critical';
      else if (totalScore >= 21) riskLevel = 'high';
      else if (totalScore >= 11) riskLevel = 'medium';

      // ── Trend (simple heuristic: recent 7 days activity vs older) ──
      const recentAttendance = attendanceRecords.filter(
        (r: any) => r.employeeId === emp.id && r.date >= sevenDaysAgoStr && (r.status === 'late' || r.status === 'absent')
      ).length;
      const recentFollowUps = followUps.filter(
        (f: any) => f.employeeId === emp.id && f.date >= sevenDaysAgoStr && (f.status === 'open' || f.status === 'under_follow_up')
      ).length;
      const recentCapas = capaCases.filter(
        (c: any) => (c.employeeId === emp.id || (c.relatedEmployeeIds || []).includes(emp.id)) && !CLOSED_STATUSES.includes(c.status) && (c.updatedAt || c.createdAt || '') >= sevenDaysAgoStr
      ).length;
      let trend: 'increasing' | 'stable' | 'improving' = 'stable';
      if (recentAttendance >= 3 || recentFollowUps >= 2 || recentCapas >= 2) trend = 'increasing';
      else if (recentAttendance === 0 && recentFollowUps === 0 && recentCapas === 0 && totalScore > 10) trend = 'improving';

      // ── Recommendations ──
      const recommendations: string[] = [];
      if (att.delays >= 3) recommendations.push('مراجعة سجل الحضور مع الموظف');
      if (att.absences >= 2) recommendations.push('تحقيق في أسباب الغياب المتكرر');
      if (qCount >= 2) recommendations.push('إعادة تدريب على معايير الجودة');
      if (hCount >= 2) recommendations.push('إحالة لإدارة الموارد البشرية');
      if (fu.critical > 0) recommendations.push('فتح قضية CAPA');
      if (comp.open > 0) recommendations.push('مراجعة شكاوى العملاء');
      if (totalScore >= 36) recommendations.push('تصعيد لمدير الموارد البشرية فوراً');
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
        breakdown: {
          delayCount: att.delays,
          delayPoints,
          absenceCount: att.absences,
          absencePoints,
          qualityViolations: qCount,
          qualityPoints,
          hrViolations: hCount,
          hrPoints,
          openFollowUps: fu.open,
          openFollowUpPoints,
          highPriorityFollowUps: fu.high,
          highPriorityPoints,
          criticalFollowUps: fu.critical,
          criticalPoints,
          complaints: comp.open,
          complaintPoints,
          repeatedIssues: fu.repeated,
          repeatedPoints,
          // CAPA breakdown
          openCapas: capa.open,
          openCapaPoints,
          overdueCapas: capa.overdue,
          overdueCapaPoints,
          criticalCapas: capa.critical,
          criticalCapaPoints,
          reopenedCapas: capa.reopened,
          reopenedCapaPoints,
        },
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
    const immediateActionCount = risks.filter(r => r.riskScore >= 21).length;

    // ── Department analysis ──
    const deptAnalysis: Record<string, { count: number; avgScore: number; totalScore: number; openCases: number; qualityViolations: number; attendanceIssues: number; openCapas: number; overdueCapas: number }> = {};
    for (const r of risks) {
      const dept = r.department || 'بدون قسم';
      if (!deptAnalysis[dept]) deptAnalysis[dept] = { count: 0, avgScore: 0, totalScore: 0, openCases: 0, qualityViolations: 0, attendanceIssues: 0, openCapas: 0, overdueCapas: 0 };
      deptAnalysis[dept].count += 1;
      deptAnalysis[dept].totalScore += r.riskScore;
      deptAnalysis[dept].openCases += r.openCases;
      deptAnalysis[dept].qualityViolations += r.breakdown.qualityViolations;
      deptAnalysis[dept].attendanceIssues += r.breakdown.delayCount + r.breakdown.absenceCount;
      deptAnalysis[dept].openCapas += r.breakdown.openCapas;
      deptAnalysis[dept].overdueCapas += r.breakdown.overdueCapas;
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
    });
  } catch (error) {
    console.error('[GET /api/risk-center] Error:', error);
    return NextResponse.json({ error: 'Failed to load risk center data' }, { status: 500 });
  }
}
