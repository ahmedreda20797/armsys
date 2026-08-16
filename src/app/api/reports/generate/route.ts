import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhereContains, findWhere } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { validateMonthKey } from '@/lib/month-utils';
import {
  buildReportRow,
  computeMonthlyAttendance,
  formatMinutes,
  getEvaluatedDates,
  isValidLegacyDate,
  resolveAttendancePolicy,
} from '@/lib/attendance';
import type { DeductionWaiverType, GenerateReportRow } from '@/lib/attendance';

export async function POST(request: NextRequest) {
  try {
    // Verify permission: reports page - view access required
    const permCheck = await verifyPermission(request, 'reports', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { month } = await request.json();

    if (!month) {
      return NextResponse.json({ error: 'Month is required (YYYY-MM)' }, { status: 400 });
    }
    const monthError = validateMonthKey(month);
    if (monthError) {
      return NextResponse.json({ error: monthError }, { status: 400 });
    }

    const [yearStr, monStr] = month.split('-');

    // Legacy month semantics: every calendar day of the month; for the
    // current month only days up to today (server-local, as before).
    const asOf = new Date();
    const workingDays = getEvaluatedDates(month, asOf);
    const actualWorkDays = workingDays.length;
    const datePattern = `/${monStr.padStart(2, '0')}/${yearStr}`;

    const [employees, deductionRules, biometricRecords, attendanceRecords, allRequests, qualityDeductions, waivedDeductions, hrDeductions] = await Promise.all([
      getAll('employees'),
      getAll('deductionRules'),
      findWhereContains('biometrics', 'date', datePattern),
      findWhereContains('attendance', 'date', datePattern),
      findWhereContains('requests', 'date', datePattern),
      findWhere('qualityDeductions', { month }),
      findWhere('waivedDeductions', { month }),
      findWhere('hrDeductions', { month, status: 'approved' }),
    ]);

    // Policy from the deductionRules collection (canonical defaults for
    // missing rows). No write-on-read sync — Milestone 2 §27.
    const policy = resolveAttendancePolicy(deductionRules);

    // ── Lookup Maps (malformed legacy dates can never match a calendar
    //    key and are excluded here, mirroring legacy behavior) ──
    const bioByEmp = new Map<string, Map<string, any>>();
    for (const b of biometricRecords) {
      if (!isValidLegacyDate(b.date)) continue;
      if (!bioByEmp.has(b.employeeId)) bioByEmp.set(b.employeeId, new Map());
      bioByEmp.get(b.employeeId)!.set(b.date, b);
    }

    const attByEmp = new Map<string, Map<string, any>>();
    for (const a of attendanceRecords) {
      if (!isValidLegacyDate(a.date)) continue;
      if (!attByEmp.has(a.employeeId)) attByEmp.set(a.employeeId, new Map());
      attByEmp.get(a.employeeId)!.set(a.date, a);
    }

    const reqByEmpDate = new Map<string, Map<string, any>>();
    for (const r of allRequests) {
      if (!isValidLegacyDate(r.date)) continue;
      if (!reqByEmpDate.has(r.employeeId)) reqByEmpDate.set(r.employeeId, new Map());
      const existing = reqByEmpDate.get(r.employeeId)!.get(r.date);
      if (!existing || new Date(r.createdAt || 0) > new Date(existing.createdAt || 0)) {
        reqByEmpDate.get(r.employeeId)!.set(r.date, r);
      }
    }

    const qualityByEmp = new Map<string, any[]>();
    for (const q of qualityDeductions) {
      if (!qualityByEmp.has(q.employeeId)) qualityByEmp.set(q.employeeId, []);
      qualityByEmp.get(q.employeeId)!.push(q);
    }

    // HR deductions: independent domain (Decision E / R19) — composed
    // into the legacy row shape, never merged inside the engine.
    const hrDedByEmp = new Map<string, { totalDays: number; totalAmount: number; items: any[] }>();
    for (const h of hrDeductions) {
      if (!hrDedByEmp.has(h.employeeId)) hrDedByEmp.set(h.employeeId, { totalDays: 0, totalAmount: 0, items: [] });
      const entry = hrDedByEmp.get(h.employeeId)!;
      if (h.unit === 'days') {
        entry.totalDays += (parseFloat(h.amount) || 0);
      } else {
        entry.totalAmount += (parseFloat(h.amount) || 0);
      }
      entry.items.push(h);
    }

    const waivedByEmp = new Map<string, Map<string, DeductionWaiverType[]>>();
    for (const w of waivedDeductions) {
      if (!isValidLegacyDate(w.date)) continue;
      if (!waivedByEmp.has(w.employeeId)) waivedByEmp.set(w.employeeId, new Map());
      const dateMap = waivedByEmp.get(w.employeeId)!;
      const types = dateMap.get(w.date) || [];
      types.push((w.deductionType || 'all') as DeductionWaiverType);
      dateMap.set(w.date, types);
    }

    // ── Canonical engine per employee + legacy row mapping ──
    const rows: GenerateReportRow[] = [];
    const toRecord = (map?: Map<string, any>): Record<string, any> | undefined =>
      map && map.size > 0 ? Object.fromEntries(map) : undefined;

    for (const emp of employees) {
      const result = computeMonthlyAttendance({
        employeeId: emp.id,
        month,
        shiftStart: emp.shiftStart || null,
        asOf,
        policy,
        biometricByDate: toRecord(bioByEmp.get(emp.id)),
        attendanceByDate: toRecord(attByEmp.get(emp.id)),
        requestByDate: toRecord(reqByEmpDate.get(emp.id)),
        waiversByDate: toRecord(waivedByEmp.get(emp.id)),
      });

      const empQuality = qualityByEmp.get(emp.id) || [];
      const empHrDed = hrDedByEmp.get(emp.id) || { totalDays: 0, totalAmount: 0, items: [] };

      rows.push(buildReportRow(result, {
        employeeName: emp.name,
        department: emp.department || '—',
        position: emp.position || null,
        quality: {
          days: empQuality.reduce((sum: number, q: any) => sum + (q.deductionDays || 0), 0),
          amount: empQuality.reduce((sum: number, q: any) => sum + (q.deductionAmount || 0), 0),
          count: empQuality.length,
        },
        hr: {
          days: empHrDed.totalDays,
          amount: empHrDed.totalAmount,
          count: empHrDed.items.length,
        },
      }));
    }

    const sorted = [...rows].sort((a, b) => {
      if (b.attendanceCompliance !== a.attendanceCompliance) {
        return b.attendanceCompliance - a.attendanceCompliance;
      }
      return a.employeeName.localeCompare(b.employeeName, 'ar');
    });

    // Global summary (legacy field set, computed from canonical rows)
    const summary = {
      totalEmployees: employees.length,
      employeesWithData: rows.filter(r => r.totalPresent + r.totalLate + r.totalAbsent + r.totalExempt > 0).length,
      totalPresentDays: rows.reduce((s, r) => s + r.totalPresent, 0),
      totalLateDays: rows.reduce((s, r) => s + r.totalLate, 0),
      totalAbsentDays: rows.reduce((s, r) => s + r.totalAbsent, 0),
      totalExemptDays: rows.reduce((s, r) => s + r.totalExempt, 0),
      totalBonusDays: rows.reduce((s, r) => s + r.bonusDays, 0),
      totalAutoExemptDays: rows.reduce((s, r) => s + r.autoExemptDays, 0),
      totalMinutesLateAll: rows.reduce((s, r) => s + r.totalMinutesLate, 0),
      totalMinutesLateFormatted: formatMinutes(rows.reduce((s, r) => s + r.totalMinutesLate, 0)),
      totalDeductionDaysAll: Math.round(rows.reduce((s, r) => s + r.totalDeductionDays, 0) * 100) / 100,
      totalQualityDaysAll: Math.round(rows.reduce((s, r) => s + r.totalQualityDays, 0) * 100) / 100,
      totalQualityAmountAll: rows.reduce((s, r) => s + r.totalQualityAmount, 0),
      totalHrDeductionDaysAll: Math.round(rows.reduce((s, r) => s + (r.totalHrDeductionDays || 0), 0) * 100) / 100,
      totalHrDeductionAmountAll: rows.reduce((s, r) => s + (r.totalHrDeductionAmount || 0), 0),
      avgCompliance: rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.attendanceCompliance, 0) / rows.length) : 0,
      highComplianceCount: rows.filter(r => r.attendanceCompliance >= 90).length,
      lowComplianceCount: rows.filter(r => r.attendanceCompliance < 75).length,
    };

    return NextResponse.json({
      rows: sorted,
      meta: {
        month,
        monthWorkingDays: actualWorkDays,
        totalEmployees: employees.length,
      },
      summary,
    });
  } catch (error) {
    console.error('Generate report error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
