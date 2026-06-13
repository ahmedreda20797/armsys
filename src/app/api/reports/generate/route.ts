import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhereContains, findWhere, findFirst, createRecord, updateRecord, invalidateCache } from '@/lib/db';

// ══════════════════════════════════════════════════════════════
// Canonical rule definitions — amounts MUST match these values
// ══════════════════════════════════════════════════════════════
const CANONICAL_RULES: Record<string, { label: string; amount: number; unit: string }> = {
  late15:              { label: 'تأخير من 16 إلى 30 دقيقة', amount: 0.25, unit: 'days' },
  late30:              { label: 'تأخير من 31 إلى 60 دقيقة', amount: 0.5,  unit: 'days' },
  late60:              { label: 'تأخير 61 دقيقة فأكثر',     amount: 1,    unit: 'days' },
  absence:             { label: 'غياب',                       amount: 1,    unit: 'days' },
  singleFingerprint:   { label: 'بصمة واحدة فقط (دخول أو خروج بدون الأخرى)', amount: 0.5, unit: 'days' },
};

async function syncRulesToCanonical(): Promise<void> {
  for (const [key, canonical] of Object.entries(CANONICAL_RULES)) {
    const existing = await findFirst('deductionRules', { key });
    if (!existing) {
      await createRecord('deductionRules', { key, ...canonical });
    } else if (existing.amount !== canonical.amount || existing.label !== canonical.label) {
      await updateRecord('deductionRules', existing.id, {
        amount: canonical.amount,
        label: canonical.label,
        unit: canonical.unit,
      });
    }
  }
}

// ══════════════════════════════════════════════════════════════
// Every employee gets 4 FREE absence days per month (auto-assigned)
// - First 4 absent days = no deduction (free allowance)
// - Absent > 4: only excess days get deducted
// - Absent < 4 (or 0): unused days counted as bonus attendance
// - No request needed for the free allowance
// ══════════════════════════════════════════════════════════════
const FREE_ABSENCE_ALLOWANCE = 4;

function getWorkingDaysInMonth(year: number, month: number): { date: string; dayIndex: number }[] {
  const days: { date: string; dayIndex: number }[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    days.push({
      date: `${String(d).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`,
      dayIndex: dayOfWeek,
    });
  }
  return days;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}د`;
  return mins > 0 ? `${hours}س ${mins}د` : `${hours}س`;
}

export async function POST(request: NextRequest) {
  try {
    const { month } = await request.json();

    if (!month) {
      return NextResponse.json({ error: 'Month is required (YYYY-MM)' }, { status: 400 });
    }

    const [yearStr, monStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monStr, 10);

    const workingDays = getWorkingDaysInMonth(year, mon);
    // Exclude weekends (Friday=5, Saturday=6) from working days count
    const actualWorkDays = workingDays.filter(d => d.dayIndex !== 5 && d.dayIndex !== 6).length;
    const monthWorkingDays = actualWorkDays;
    const datePattern = `/${monStr.padStart(2, '0')}/${yearStr}`;

    // Auto-sync deduction rules to canonical amounts before fetching
    await syncRulesToCanonical();
    invalidateCache('deductionRules');

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

    // ── Lookup Maps ──
    const bioByEmp = new Map<string, Map<string, any>>();
    for (const b of biometricRecords) {
      if (!bioByEmp.has(b.employeeId)) bioByEmp.set(b.employeeId, new Map());
      bioByEmp.get(b.employeeId)!.set(b.date, b);
    }

    const attByEmp = new Map<string, Map<string, any>>();
    for (const a of attendanceRecords) {
      if (!attByEmp.has(a.employeeId)) attByEmp.set(a.employeeId, new Map());
      attByEmp.get(a.employeeId)!.set(a.date, a);
    }

    const reqByEmpDate = new Map<string, Map<string, any>>();
    for (const r of allRequests) {
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

    // HR deductions: sum approved deductions per employee
    const hrDedByEmp = new Map<string, { totalDays: number; totalAmount: number; items: any[] }>();
    for (const h of hrDeductions) {
      if (!hrDedByEmp.has(h.employeeId)) hrDedByEmp.set(h.employeeId, { totalDays: 0, totalAmount: 0, items: [] });
      const entry = hrDedByEmp.get(h.employeeId)!;
      if (h.unit === 'days') {
        entry.totalDays += (parseFloat(h.amount) || 0);
      } else {
        // Convert EGP amount to days using a base of 300 EGP/day (standard daily wage assumption)
        entry.totalAmount += (parseFloat(h.amount) || 0);
      }
      entry.items.push(h);
    }

    const waivedByEmp = new Map<string, Map<string, string[]>>(); // employeeId -> date -> type[]
    for (const w of waivedDeductions) {
      if (!waivedByEmp.has(w.employeeId)) waivedByEmp.set(w.employeeId, new Map());
      const dateMap = waivedByEmp.get(w.employeeId)!;
      const types = dateMap.get(w.date) || [];
      types.push(w.deductionType || 'all');
      dateMap.set(w.date, types);
    }

    function isWaived(employeeId: string, date: string, type?: string): boolean {
      const dateMap = waivedByEmp.get(employeeId);
      if (!dateMap) return false;
      const types = dateMap.get(date);
      if (!types) return false;
      if (!type) return types.length > 0;
      return types.includes(type) || types.includes('all');
    }

    const rulesMap = new Map<string, any>();
    for (const rule of deductionRules) {
      rulesMap.set(rule.key, rule);
    }

    // ── Helpers ──
    const LATE_GRACE_PERIOD = 15; // minutes — first 15 min are free, late starts at minute 16

    function calcLateMinutes(checkIn: string | null, shiftStart: string | null): number {
      if (!checkIn || !shiftStart) return 0;
      const [cH, cM] = checkIn.split(':').map(Number);
      const [sH, sM] = shiftStart.split(':').map(Number);
      if (isNaN(cH) || isNaN(cM) || isNaN(sH) || isNaN(sM)) return 0;
      return Math.max(0, (cH * 60 + cM) - (sH * 60 + sM));
    }

    function isLate(minutesLate: number): boolean {
      return minutesLate > LATE_GRACE_PERIOD;
    }

    function getLateRuleKey(minutesLate: number): string {
      if (minutesLate <= LATE_GRACE_PERIOD) return '';  // ≤15 min → no deduction
      if (minutesLate <= 30) return 'late15';   // 16-30 min → quarter day
      if (minutesLate <= 60) return 'late30';   // 31-60 min → half day
      return 'late60';                        // 61+ min → full day
    }

    function getDeductionDays(ruleKey: string): number {
      if (!ruleKey) return 0;
      const rule = rulesMap.get(ruleKey);
      return rule?.amount || 0;
    }

    // ══════════════════════════════════════════════════════════════
    // Process each employee
    // ══════════════════════════════════════════════════════════════
    const rows: any[] = [];

    for (const emp of employees) {
      const empBio = bioByEmp.get(emp.id) || new Map();
      const empAtt = attByEmp.get(emp.id) || new Map();
      const empReqs = reqByEmpDate.get(emp.id) || new Map();
      const empQuality = qualityByEmp.get(emp.id) || [];
      const shiftStart = emp.shiftStart || null;

      let totalPresent = 0;
      let totalLate = 0;
      let totalAbsent = 0;
      let totalExempt = 0;
      let totalMinutesLate = 0;
      let lateDeductionDays = 0;
      let unaccountedDays = 0;

      // Track each absent day and its deduction amount (for post-processing)
      const absentDaysList: { date: string; deduction: number }[] = [];

      // ══════════════════════════════════════════════════════
      // Process EACH working day
      // ══════════════════════════════════════════════════════
      for (const { date: dateStr, dayIndex } of workingDays) {
        // Skip weekends (Friday=5, Saturday=6) — they are not working days
        if (dayIndex === 5 || dayIndex === 6) continue;
        const bio = empBio.get(dateStr);
        const att = empAtt.get(dateStr);
        const req = empReqs.get(dateStr);

        // ── PRIORITY 1: Attendance record with approved request (excuse absence) ──
        // For excuse-type absences: approved = 1 day deduction, rejected = 2 days deduction
        if (att && att.approvedRequestId) {
          const excReq = empReqs.get(dateStr);
          if (excReq && excReq.status === 'approved') {
            absentDaysList.push({ date: dateStr, deduction: 1 });
            totalAbsent++;
          } else if (excReq && excReq.status === 'rejected') {
            absentDaysList.push({ date: dateStr, deduction: 2 });
            totalAbsent++;
          } else {
            // Request pending or unknown - treat as absent with 1 day deduction
            absentDaysList.push({ date: dateStr, deduction: 1 });
            totalAbsent++;
            unaccountedDays++;
          }
          continue;
        }

        // ── PRIORITY 1b: Attendance record with approved status (non-excuse, like leave) ──
        if (att && att.status === 'approved') {
          totalExempt++;
          continue;
        }

        // ── PRIORITY 2: Approved request = exempt from ALL deductions ──
        // Applies even if biometric/attendance data exists — approved request overrides
        if (req && req.status === 'approved') {
          totalExempt++;
          continue;
        }

        // ── PRIORITY 3: Biometric check-in ──
        const bioCheckIn = bio?.checkIn || null;
        const bioCheckOut = bio?.checkOut || null;

        if (bioCheckIn) {
          const minutes = calcLateMinutes(bioCheckIn, shiftStart);
          if (isLate(minutes)) {
            totalLate++;
            totalMinutesLate += minutes;
            if (!isWaived(emp.id, dateStr, 'late')) {
              lateDeductionDays += getDeductionDays(getLateRuleKey(minutes));
            }
          } else {
            totalPresent++;
          }
          // Half-day deduction if missing check-out
          if (!bioCheckOut && !isWaived(emp.id, dateStr, 'absence')) {
            lateDeductionDays += getDeductionDays('singleFingerprint');
          }
          continue;
        }

        // ── PRIORITY 4: Biometric without checkIn but with checkOut ──
        if (bio && !bioCheckIn && bioCheckOut) {
          totalPresent++;
          if (!isWaived(emp.id, dateStr, 'absence')) {
            lateDeductionDays += getDeductionDays('singleFingerprint');
          }
          continue;
        }

        // ── PRIORITY 5: No valid biometric → use attendance record ──
        if (att) {
          const attCheckIn = att.checkIn || null;
          const attMinutesLate = att.minutesLate || 0;

          if (attCheckIn) {
            const minutes = calcLateMinutes(attCheckIn, shiftStart);
            const effectiveMinutes = Math.max(minutes, attMinutesLate);
            if (isLate(effectiveMinutes)) {
              totalLate++;
              totalMinutesLate += effectiveMinutes;
              if (!isWaived(emp.id, dateStr, 'late')) {
                lateDeductionDays += getDeductionDays(getLateRuleKey(effectiveMinutes));
              }
            } else {
              totalPresent++;
            }
            continue;
          }

          if (att.status === 'absent') {
            if (isWaived(emp.id, dateStr, 'absence')) {
              absentDaysList.push({ date: dateStr, deduction: 0 });
              totalAbsent++;
              continue;
            }
            let deduction = 0;
            if (req && req.status === 'rejected') {
              deduction = 2;
            } else if (req && req.status === 'approved') {
              // Already handled in Priority 2 (shouldn't reach here with att)
              deduction = 0;
            } else {
              deduction = getDeductionDays('absence');
            }
            absentDaysList.push({ date: dateStr, deduction });
            totalAbsent++;
            continue;
          }

          if (att.status === 'present') {
            totalPresent++;
            continue;
          }

          if (att.status === 'late' || attMinutesLate > 0) {
            totalLate++;
            totalMinutesLate += attMinutesLate;
            if (!isWaived(emp.id, dateStr, 'late')) {
              lateDeductionDays += getDeductionDays(getLateRuleKey(attMinutesLate));
            }
            continue;
          }
        }

        // ── PRIORITY 6: No biometric AND no attendance → check request ──
        if (req) {
          if (req.status === 'approved') {
            // Already handled in Priority 2 (shouldn't reach here without att)
            totalExempt++;
            continue;
          }
          if (req.status === 'rejected') {
            if (isWaived(emp.id, dateStr, 'absence')) {
              absentDaysList.push({ date: dateStr, deduction: 0 });
              totalAbsent++;
              continue;
            }
            absentDaysList.push({ date: dateStr, deduction: 2 });
            totalAbsent++;
            continue;
          }
          // Pending request
          if (isWaived(emp.id, dateStr, 'absence')) {
            absentDaysList.push({ date: dateStr, deduction: 0 });
            totalAbsent++;
            unaccountedDays++;
            continue;
          }
          absentDaysList.push({ date: dateStr, deduction: getDeductionDays('absence') });
          totalAbsent++;
          unaccountedDays++;
          continue;
        }

        // ── PRIORITY 7: No records at all ──
        if (isWaived(emp.id, dateStr, 'absence')) {
          absentDaysList.push({ date: dateStr, deduction: 0 });
          totalAbsent++;
          unaccountedDays++;
          continue;
        }
        absentDaysList.push({ date: dateStr, deduction: getDeductionDays('absence') });
        totalAbsent++;
        unaccountedDays++;
      }

      // ══════════════════════════════════════════════════════
      // POST-PROCESSING: Apply 4-day free absence allowance
      // First 4 absent days (by date) are FREE — no deduction
      // ══════════════════════════════════════════════════════
      absentDaysList.sort((a, b) => a.date.localeCompare(b.date));
      const freeDaysCount = Math.min(absentDaysList.length, FREE_ABSENCE_ALLOWANCE);
      const autoExemptDays = freeDaysCount;
      const bonusDays = Math.max(FREE_ABSENCE_ALLOWANCE - totalAbsent, 0);

      // Calculate actual absence deduction (only excess beyond free allowance)
      let absenceDeductionDays = 0;
      for (let i = 0; i < absentDaysList.length; i++) {
        if (i < freeDaysCount) {
          // This day is covered by free allowance — no deduction
        } else {
          absenceDeductionDays += absentDaysList[i].deduction;
        }
      }
      absenceDeductionDays = Math.round(absenceDeductionDays * 100) / 100;

      // Quality deductions
      const totalQualityDays = empQuality.reduce((sum: number, q: any) => sum + (q.deductionDays || 0), 0);
      const totalQualityAmount = empQuality.reduce((sum: number, q: any) => sum + (q.deductionAmount || 0), 0);

      // HR deductions (approved)
      const empHrDed = hrDedByEmp.get(emp.id) || { totalDays: 0, totalAmount: 0, items: [] };
      const totalHrDeductionDays = Math.round(empHrDed.totalDays * 100) / 100;
      const totalHrDeductionAmount = Math.round(empHrDed.totalAmount * 100) / 100;

      // Totals
      const totalAttendanceDeductionDays = Math.round((lateDeductionDays + absenceDeductionDays) * 100) / 100;
      const totalDeductionDays = Math.round((totalAttendanceDeductionDays + totalQualityDays + totalHrDeductionDays) * 100) / 100;

      // ══════════════════════════════════════════════════════
      // Compliance: (present + late + exempt + bonus) / actualWorkDays * 100
      // Bonus = unused free days added to effective attendance
      // Weekends (Fri/Sat) excluded from both numerator and denominator
      // ══════════════════════════════════════════════════════
      const effectiveWorkingDays = Math.round((totalPresent + totalLate + totalExempt + autoExemptDays + bonusDays) * 100) / 100;
      const effectiveAttendance = totalPresent + totalLate + totalExempt + bonusDays;
      const attendanceCompliance = actualWorkDays > 0
        ? Math.min(Math.round((effectiveAttendance / actualWorkDays) * 100), 100)
        : 0;

      rows.push({
        employeeId: emp.id,
        employeeName: emp.name,
        department: emp.department || '—',
        position: emp.position || null,
        totalPresent,
        totalLate,
        totalAbsent,
        totalExempt,
        totalMinutesLate,
        totalMinutesLateFormatted: formatMinutes(totalMinutesLate),
        lateDeductionDays: Math.round(lateDeductionDays * 100) / 100,
        absenceDeductionDays,
        totalAttendanceDeductionDays,
        totalQualityDays: Math.round(totalQualityDays * 100) / 100,
        totalQualityAmount: Math.round(totalQualityAmount * 100) / 100,
        totalHrDeductionDays,
        totalHrDeductionAmount,
        hrDeductionCount: empHrDed.items.length,
        totalDeductionDays,
        attendanceCompliance: Math.min(Math.max(attendanceCompliance, 0), 100),
        workDays: monthWorkingDays,
        effectiveWorkingDays,
        unaccountedDays,
        qualityCount: empQuality.length,
        autoExemptDays,
        bonusDays,
      });
    }

    const sorted = [...rows].sort((a, b) => {
      if (b.attendanceCompliance !== a.attendanceCompliance) {
        return b.attendanceCompliance - a.attendanceCompliance;
      }
      return a.employeeName.localeCompare(b.employeeName, 'ar');
    });

    // Global summary
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
        monthWorkingDays,
        totalEmployees: employees.length,
      },
      summary,
    });
  } catch (error) {
    console.error('Generate report error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
