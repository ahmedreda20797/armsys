import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhereContains, findWhere, getById } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { validateMonthKey } from '@/lib/month-utils';
import {
  buildDailyBreakdown,
  computeMonthlyAttendance,
  formatMinutes,
  getEvaluatedDates,
  isValidLegacyDate,
  resolveAttendancePolicy,
  round2,
} from '@/lib/attendance';
import type { DeductionWaiverType } from '@/lib/attendance';

function getRequestStatusLabel(status: string): string {
  switch (status) {
    case 'approved': return 'مقبول';
    case 'rejected': return 'مرفوض';
    case 'pending': return 'معلق';
    default: return status;
  }
}

function getRequestTypeLabel(type: string): string {
  switch (type) {
    case 'leave': return 'إجازة';
    case 'permission': return 'استئذان';
    case 'excuse': return 'غياب';
    case 'tardiness': return 'تأخير';
    case 'remote': return 'ريموتلي';
    default: return type;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Verify permission: reports page - view access required
    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { employeeId, month } = await request.json();

    if (!employeeId || !month) {
      return NextResponse.json({ error: 'employeeId and month are required' }, { status: 400 });
    }
    const monthError = validateMonthKey(month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    const [yearStr, monStr] = month.split('-');

    // Legacy month semantics: every calendar day; current month cut off
    // at today (server-local, as before).
    const asOf = new Date();
    const workingDays = getEvaluatedDates(month, asOf);
    const actualWorkDays = workingDays.length;
    const datePattern = `/${monStr.padStart(2, '0')}/${yearStr}`;

    const [employee, deductionRules, biometricRecords, attendanceRecords, allRequests, qualityDeductions, waivedDeductions, hrDeductions] = await Promise.all([
      getById('employees', employeeId),
      getAll('deductionRules'),
      findWhereContains('biometrics', 'date', datePattern),
      findWhereContains('attendance', 'date', datePattern),
      findWhereContains('requests', 'date', datePattern),
      findWhere('qualityDeductions', { month }),
      findWhere('waivedDeductions', { month }),
      findWhere('hrDeductions', { month, status: 'approved' }),
    ]);

    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    // Policy from the deductionRules collection (canonical defaults for
    // missing rows). No write-on-read sync — Milestone 2 §27.
    const policy = resolveAttendancePolicy(deductionRules);

    // ── Per-date lookups for this employee (latest request wins per
    //    date, matching legacy) ──
    const bioByDate = new Map<string, any>();
    for (const b of biometricRecords) {
      if (b.employeeId === employeeId && isValidLegacyDate(b.date)) bioByDate.set(b.date, b);
    }

    const attByDate = new Map<string, any>();
    for (const a of attendanceRecords) {
      if (a.employeeId === employeeId && isValidLegacyDate(a.date)) attByDate.set(a.date, a);
    }

    const reqByDate = new Map<string, any>();
    for (const r of allRequests) {
      if (r.employeeId !== employeeId || !isValidLegacyDate(r.date)) continue;
      const existing = reqByDate.get(r.date);
      if (!existing || new Date(r.createdAt || 0) > new Date(existing.createdAt || 0)) {
        reqByDate.set(r.date, r);
      }
    }

    const empRequests = allRequests.filter((r: any) => r.employeeId === employeeId);
    const empQuality = qualityDeductions.filter((q: any) => q.employeeId === employeeId);
    const empHrDeductions = hrDeductions.filter((h: any) => h.employeeId === employeeId);

    const waivedMap = new Map<string, DeductionWaiverType[]>();
    for (const w of waivedDeductions) {
      if (w.employeeId !== employeeId || !isValidLegacyDate(w.date)) continue;
      const types = waivedMap.get(w.date) || [];
      types.push((w.deductionType || 'all') as DeductionWaiverType);
      waivedMap.set(w.date, types);
    }

    // ── Canonical engine ──
    const result = computeMonthlyAttendance({
      employeeId,
      month,
      shiftStart: (employee as any).shiftStart || null,
      asOf,
      policy,
      biometricByDate: bioByDate.size > 0 ? Object.fromEntries(bioByDate) : undefined,
      attendanceByDate: attByDate.size > 0 ? Object.fromEntries(attByDate) : undefined,
      requestByDate: reqByDate.size > 0 ? Object.fromEntries(reqByDate) : undefined,
      waiversByDate: waivedMap.size > 0 ? Object.fromEntries(waivedMap) : undefined,
    });

    const dailyBreakdown = buildDailyBreakdown(result, {
      biometricByDate: Object.fromEntries(bioByDate),
      attendanceByDate: Object.fromEntries(attByDate),
      requestByDate: Object.fromEntries(reqByDate),
      waiversByDate: Object.fromEntries(waivedMap),
    });

    // ── External deduction domains (Decision E / R19) ──
    const totalQualityDays = empQuality.reduce((sum: number, q: any) => sum + (q.deductionDays || 0), 0);
    const totalQualityAmount = empQuality.reduce((sum: number, q: any) => sum + (q.deductionAmount || 0), 0);
    const totalHrDeductionDays = empHrDeductions.reduce((sum: number, h: any) => sum + (h.unit === 'days' ? (parseFloat(h.amount) || 0) : 0), 0);
    const totalHrDeductionAmount = empHrDeductions.reduce((sum: number, h: any) => sum + (h.unit !== 'days' ? (parseFloat(h.amount) || 0) : 0), 0);

    const totalAttendanceDeductionDays = round2(result.lateDeductionDays + result.absenceDeductionDays);
    // R19 resolution: HR deductions stay a separate domain value
    // (totalHrDeductionDays). The combined total now uses the same
    // composition as /api/reports/generate (attendance + quality + HR)
    // so both routes agree — intentional, documented change (the old
    // detail route excluded HR days from this total).
    const totalDeductionDays = round2(totalAttendanceDeductionDays + totalQualityDays + totalHrDeductionDays);

    const formattedRequests = empRequests.map((r: any) => ({
      id: r.id,
      type: r.type,
      typeLabel: getRequestTypeLabel(r.type),
      date: r.date,
      reason: r.reason,
      status: r.status,
      statusLabel: getRequestStatusLabel(r.status),
      reviewedAt: r.reviewedAt || null,
      createdAt: r.createdAt,
    }));

    const formattedQuality = empQuality.map((q: any) => ({
      id: q.id,
      date: q.date,
      type: q.type,
      description: q.description,
      deductionDays: q.deductionDays || 0,
      deductionAmount: q.deductionAmount || 0,
      evidence: q.evidence || null,
      createdAt: q.createdAt,
    }));

    const formattedHrDeductions = empHrDeductions.map((h: any) => ({
      id: h.id,
      date: h.deductionDate || h.createdAt || '',
      type: h.type,
      reason: h.reason || '',
      amount: h.amount,
      unit: h.unit,
      month: h.month,
      createdAt: h.createdAt,
    }));

    return NextResponse.json({
      employee: {
        id: employee.id,
        name: employee.name,
        code: employee.code || null,
        department: employee.department || null,
        position: employee.position || null,
        shiftStart: employee.shiftStart || null,
        shiftEnd: employee.shiftEnd || null,
        hireDate: employee.hireDate || null,
        mobile: employee.mobile || null,
        createdById: employee.createdById || null,
      },
      reportSummary: {
        monthWorkingDays: actualWorkDays,
        effectiveWorkingDays: result.effectiveWorkingDays,
        totalPresent: result.presentDays,
        totalLate: result.lateDays,
        totalAbsent: result.absentDays,
        totalExempt: result.exemptDays,
        totalMinutesLate: result.totalMinutesLate,
        totalMinutesLateFormatted: formatMinutes(result.totalMinutesLate),
        lateDeductionDays: round2(result.lateDeductionDays),
        absenceDeductionDays: round2(result.absenceDeductionDays),
        totalAttendanceDeductionDays,
        totalQualityDays: round2(totalQualityDays),
        totalQualityAmount: round2(totalQualityAmount),
        totalHrDeductionDays: round2(totalHrDeductionDays),
        totalHrDeductionAmount: round2(totalHrDeductionAmount),
        hrDeductionCount: empHrDeductions.length,
        totalDeductionDays,
        attendanceCompliance: result.compliance,
        unaccountedDays: result.unaccountedDays,
        autoExemptDays: result.autoExemptDays,
        bonusDays: result.bonusDays,
      },
      dailyBreakdown,
      requests: formattedRequests,
      qualityDeductions: formattedQuality,
      hrDeductions: formattedHrDeductions,
    });
  } catch (error) {
    console.error('Employee detail error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
