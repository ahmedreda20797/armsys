import { NextRequest, NextResponse } from 'next/server';
import {
  getAll, getAllBatch, count, countWhere,
  findWhere, findWhereIn, groupByCount, sortByField,
  sortByDateField, getEmployeeMap,
} from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

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

/** Pre-compute monthly performance from already-fetched data (no additional DB reads) */
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

  const monthQuality = qualityDeductions.filter((qd: any) => qd.month === monthKey);

  const workingDaysSet = new Set(monthRecords.map((r: any) => r.date));
  const totalWorkingDays = workingDaysSet.size || 22;

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
      ]),
      getEmployeeMap(),
    ]);

    const employees = batch.get('employees') || [];
    const attendanceRecords = batch.get('attendance') || [];
    const allRequests = batch.get('requests') || [];
    const travelDeals = batch.get('travelDeals') || [];
    const allQualityDeductions = batch.get('qualityDeductions') || [];
    const deductionRules = batch.get('deductionRules') || [];
    const allBiometrics = batch.get('biometrics') || [];
    const allFollowUps = batch.get('followUps') || [];

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
      byType: {
        quality_issue: qualityThisMonth.filter((q: any) => q.type === 'quality_issue').length,
        safety: qualityThisMonth.filter((q: any) => q.type === 'safety').length,
        compliance: qualityThisMonth.filter((q: any) => q.type === 'compliance').length,
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
    const followUpsSummary = {
      totalActive: allFollowUps.filter((f: any) => f.status === 'open' || f.status === 'in_progress').length,
      totalOverdue: allFollowUps.filter((f: any) => f.status === 'overdue').length,
      totalCompleted: allFollowUps.filter((f: any) => f.status === 'completed').length,
      todaysScheduled: todaysFollowUps.length,
    };

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
    });
  } catch (error) {
    console.error('[GET /api/home/stats] Error:', error);
    return NextResponse.json({ error: 'Failed to load home stats' }, { status: 500 });
  }
}
