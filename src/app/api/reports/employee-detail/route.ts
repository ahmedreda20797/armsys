import { NextRequest, NextResponse } from 'next/server';
import { getAll, findWhereContains, findWhere, getById, findFirst, createRecord, updateRecord, invalidateCache } from '@/lib/db';

const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

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
// - Absent < 4 (or 0): unused days = bonus attendance
// - No request needed
// ══════════════════════════════════════════════════════════════
const FREE_ABSENCE_ALLOWANCE = 4;
const LATE_GRACE_PERIOD = 15; // minutes — first 15 min are free, late starts at minute 16

function getWorkingDaysInMonth(year: number, month: number): { date: string; dayName: string; dayIndex: number }[] {
  const days: { date: string; dayName: string; dayIndex: number }[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dayOfWeek = new Date(year, month - 1, d).getDay();
    const dateStr = `${String(d).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    days.push({ date: dateStr, dayName: DAY_NAMES_AR[dayOfWeek], dayIndex: dayOfWeek });
  }
  return days;
}

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

function effectiveLateMinutes(minutesLate: number): number {
  return isLate(minutesLate) ? minutesLate : 0;
}

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours === 0) return `${mins}د`;
  return mins > 0 ? `${hours}س ${mins}د` : `${hours}س`;
}

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
    const { employeeId, month } = await request.json();

    if (!employeeId || !month) {
      return NextResponse.json({ error: 'employeeId and month are required' }, { status: 400 });
    }

    const [yearStr, monStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monStr, 10);

    const workingDays = getWorkingDaysInMonth(year, mon);
    const datePattern = `/${monStr.padStart(2, '0')}/${yearStr}`;

    // Auto-sync deduction rules to canonical amounts before fetching
    await syncRulesToCanonical();
    invalidateCache('deductionRules');

    const [employee, deductionRules, biometricRecords, attendanceRecords, allRequests, qualityDeductions, waivedDeductions] = await Promise.all([
      getById('employees', employeeId),
      getAll('deductionRules'),
      findWhereContains('biometrics', 'date', datePattern),
      findWhereContains('attendance', 'date', datePattern),
      findWhereContains('requests', 'date', datePattern),
      findWhere('qualityDeductions', { month }),
      findWhere('waivedDeductions', { month }),
    ]);

    if (!employee) {
      return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });
    }

    const bioByDate = new Map<string, any>();
    for (const b of biometricRecords) {
      if (b.employeeId === employeeId) bioByDate.set(b.date, b);
    }

    const attByDate = new Map<string, any>();
    for (const a of attendanceRecords) {
      if (a.employeeId === employeeId) attByDate.set(a.date, a);
    }

    const reqByDate = new Map<string, any>();
    for (const r of allRequests) {
      if (r.employeeId === employeeId) {
        const existing = reqByDate.get(r.date);
        if (!existing || new Date(r.createdAt || 0) > new Date(existing.createdAt || 0)) {
          reqByDate.set(r.date, r);
        }
      }
    }

    const empRequests = allRequests.filter((r: any) => r.employeeId === employeeId);
    const empQuality = qualityDeductions.filter((q: any) => q.employeeId === employeeId);

    const waivedMap = new Map<string, string[]>(); // date -> deductionType[]
    for (const w of waivedDeductions) {
      if (w.employeeId === employeeId) {
        const types = waivedMap.get(w.date) || [];
        types.push(w.deductionType || 'all');
        waivedMap.set(w.date, types);
      }
    }
    function isWaived(date: string, type?: string): boolean {
      const types = waivedMap.get(date);
      if (!types) return false;
      if (!type) return types.length > 0; // any type waived
      return types.includes(type) || types.includes('all');
    }
    function getWaivedType(date: string): string | null {
      return waivedMap.get(date)?.[0] || null;
    }

    const rulesMap = new Map<string, any>();
    for (const rule of deductionRules) {
      rulesMap.set(rule.key, rule);
    }

    function getDeductionDays(ruleKey: string): number {
      if (!ruleKey) return 0;
      return rulesMap.get(ruleKey)?.amount || 0;
    }

    function getLateRuleKey(minutesLate: number): string {
      if (minutesLate <= LATE_GRACE_PERIOD) return '';  // ≤15 min → no deduction
      if (minutesLate <= 30) return 'late15';   // 16-30 min → quarter day
      if (minutesLate <= 60) return 'late30';   // 31-60 min → half day
      return 'late60';                        // 61+ min → full day
    }

    const shiftStart = (employee as any).shiftStart || null;
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalExempt = 0;
    let totalMinutesLate = 0;
    let lateDeductionDays = 0;
    let unaccountedDays = 0;

    // Track absent days for post-processing (4 free days)
    const absentDaysList: { date: string; deduction: number }[] = [];

    type DayStatus = 'present' | 'late' | 'absent' | 'exempt' | 'unaccounted';
    const dailyBreakdown: {
      date: string;
      dayName: string;
      status: DayStatus;
      biometricCheckIn: string | null;
      biometricCheckOut: string | null;
      attendanceCheckIn: string | null;
      attendanceCheckOut: string | null;
      minutesLate: number;
      requestStatus: string | null;
      requestType: string | null;
      requestReason: string | null;
      absenceDeduction: number;
      source: string;
      waived: boolean;
      autoFree: boolean;
    }[] = [];

    for (const day of workingDays) {
      // Skip weekends (Friday=5, Saturday=6) — they are not working days
      if (day.dayIndex === 5 || day.dayIndex === 6) continue;
      const bio = bioByDate.get(day.date);
      const att = attByDate.get(day.date);
      const req = reqByDate.get(day.date);

      const entry = {
        date: day.date,
        dayName: day.dayName,
        status: 'present' as DayStatus,
        biometricCheckIn: bio?.checkIn || null,
        biometricCheckOut: bio?.checkOut || null,
        attendanceCheckIn: att?.checkIn || null,
        attendanceCheckOut: att?.checkOut || null,
        minutesLate: 0,
        requestStatus: req?.status || null,
        requestType: req?.type || null,
        requestReason: req?.reason || null,
        absenceDeduction: 0,
        lateDeduction: 0,
        source: '',
        waived: isWaived(day.date),
        waivedType: getWaivedType(day.date),
        autoFree: false,
      };

      // Priority 1: Approved attendance
      if (att && (att.status === 'approved' || att.approvedRequestId)) {
        entry.status = 'exempt';
        entry.source = 'تسجيل حضور معتمد';
        totalExempt++;
        dailyBreakdown.push(entry);
        continue;
      }

      // Priority 2: Approved request (tardiness/leave/excuse) = exempt from ALL deductions
      // Applies even if biometric data exists — approved request overrides deductions
      if (req && req.status === 'approved') {
        entry.status = 'exempt';
        const reqTypeLabel = req.type === 'tardiness' ? 'تأخير' : req.type === 'leave' ? 'إجازة' : req.type === 'permission' ? 'استئذان' : 'طلب';
        entry.source = `طلب معتمد (${reqTypeLabel})`;
        totalExempt++;
        dailyBreakdown.push(entry);
        continue;
      }

      // Priority 3: Biometric check-in
      const bioCheckIn = bio?.checkIn || null;
      const bioCheckOut = bio?.checkOut || null;

      if (bioCheckIn) {
        const minutes = calcLateMinutes(bioCheckIn, shiftStart);
        entry.minutesLate = minutes;
        if (isLate(minutes)) {
          entry.status = 'late';
          entry.source = `بصمة (متأخر ${minutes} دقيقة)`;
          totalLate++;
          totalMinutesLate += minutes;
          if (!isWaived(day.date, 'late')) {
            const dd = getDeductionDays(getLateRuleKey(minutes));
            entry.lateDeduction = dd;
            lateDeductionDays += dd;
          } else {
            entry.source += ' (تم إلغاء خصم التأخير)';
          }
        } else {
          entry.status = 'present';
          entry.source = 'بصمة';
          totalPresent++;
        }
        if (!bioCheckOut) {
          if (!isWaived(day.date, 'absence')) {
            entry.absenceDeduction = getDeductionDays('singleFingerprint');
            entry.source += ' (بصمة دخول فقط - خصم نصف يوم)';
          } else {
            entry.source += ' (بصمة دخول فقط - تم إلغاء الخصم)';
          }
        }
        dailyBreakdown.push(entry);
        continue;
      }

      // Priority 4: Biometric without checkIn but with checkOut
      if (bio && !bioCheckIn && bioCheckOut) {
        entry.status = 'present';
        if (!isWaived(day.date, 'absence')) {
          entry.source = 'بصمة خروج فقط - خصم نصف يوم';
          entry.absenceDeduction = getDeductionDays('singleFingerprint');
        } else {
          entry.source = 'بصمة خروج فقط - تم إلغاء الخصم';
        }
        totalPresent++;
        dailyBreakdown.push(entry);
        continue;
      }

      // Priority 5: No valid biometric → use attendance
      if (att) {
        const attCheckIn = att.checkIn || null;
        const attMinutesLate = att.minutesLate || 0;

        if (attCheckIn) {
          const minutes = calcLateMinutes(attCheckIn, shiftStart);
          const effectiveMinutes = Math.max(minutes, attMinutesLate);
          entry.minutesLate = effectiveMinutes;
          if (isLate(effectiveMinutes)) {
            entry.status = 'late';
            entry.source = `تسجيل حضور (متأخر ${effectiveMinutes} دقيقة)`;
            totalLate++;
            totalMinutesLate += effectiveMinutes;
            if (!isWaived(day.date, 'late')) {
              const dd = getDeductionDays(getLateRuleKey(effectiveMinutes));
              entry.lateDeduction = dd;
              lateDeductionDays += dd;
            } else {
              entry.source += ' (تم إلغاء خصم التأخير)';
            }
          } else {
            entry.status = 'present';
            entry.source = 'تسجيل حضور';
            totalPresent++;
          }
          dailyBreakdown.push(entry);
          continue;
        }

        if (att.status === 'absent') {
          entry.status = 'absent';
          if (isWaived(day.date, 'absence')) {
            entry.source = 'تسجيل غياب - تم إلغاء الخصم يدوياً';
            absentDaysList.push({ date: day.date, deduction: 0 });
          } else if (req && req.status === 'rejected') {
            entry.absenceDeduction = 2;
            entry.source = 'تسجيل غياب + طلب مرفوض (خصم يومين)';
            absentDaysList.push({ date: day.date, deduction: 2 });
          } else {
            entry.absenceDeduction = getDeductionDays('absence');
            entry.source = 'تسجيل غياب';
            absentDaysList.push({ date: day.date, deduction: entry.absenceDeduction });
          }
          totalAbsent++;
          dailyBreakdown.push(entry);
          continue;
        }

        if (att.status === 'present') {
          entry.status = 'present';
          entry.source = 'تسجيل حضور';
          totalPresent++;
          dailyBreakdown.push(entry);
          continue;
        }

        if (att.status === 'late' || attMinutesLate > 0) {
          entry.status = 'late';
          entry.source = 'تسجيل تأخير';
          entry.minutesLate = attMinutesLate;
          totalLate++;
          totalMinutesLate += attMinutesLate;
          if (!isWaived(day.date, 'late')) {
            const dd = getDeductionDays(getLateRuleKey(attMinutesLate));
            entry.lateDeduction = dd;
            lateDeductionDays += dd;
          } else {
            entry.source += ' (تم إلغاء خصم التأخير)';
          }
          dailyBreakdown.push(entry);
          continue;
        }
      }

      // Priority 6: No biometric, no attendance → check request
      if (req) {
        if (req.status === 'approved') {
          entry.status = 'exempt';
          entry.source = 'طلب معتمد (إجازة)';
          totalExempt++;
          dailyBreakdown.push(entry);
          continue;
        }
        if (req.status === 'rejected') {
          entry.status = 'absent';
          if (isWaived(day.date, 'absence')) {
            entry.source = 'طلب مرفوض - تم إلغاء الخصم يدوياً';
            absentDaysList.push({ date: day.date, deduction: 0 });
          } else {
            entry.absenceDeduction = 2;
            entry.source = 'طلب مرفوض (خصم يومين)';
            absentDaysList.push({ date: day.date, deduction: 2 });
          }
          totalAbsent++;
          dailyBreakdown.push(entry);
          continue;
        }
        // Pending
        entry.status = 'absent';
        if (isWaived(day.date, 'absence')) {
          entry.source = 'طلب معلق - تم إلغاء الخصم يدوياً';
          absentDaysList.push({ date: day.date, deduction: 0 });
        } else {
          entry.absenceDeduction = getDeductionDays('absence');
          entry.source = 'طلب معلق (غياب)';
          absentDaysList.push({ date: day.date, deduction: entry.absenceDeduction });
        }
        totalAbsent++;
        unaccountedDays++;
        dailyBreakdown.push(entry);
        continue;
      }

      // Priority 7: No records at all
      entry.status = 'absent';
      if (isWaived(day.date, 'absence')) {
        entry.source = 'بدون سجل - تم إلغاء الخصم يدوياً';
        absentDaysList.push({ date: day.date, deduction: 0 });
      } else {
        entry.absenceDeduction = getDeductionDays('absence');
        entry.source = 'بدون سجل';
        absentDaysList.push({ date: day.date, deduction: entry.absenceDeduction });
      }
      totalAbsent++;
      unaccountedDays++;
      dailyBreakdown.push(entry);
    }

    // ══════════════════════════════════════════════════════
    // POST-PROCESSING: Apply 4-day free absence allowance
    // First 4 absent days (by date) = FREE (no deduction)
    // Mark them in dailyBreakdown as autoFree
    // ══════════════════════════════════════════════════════
    absentDaysList.sort((a, b) => a.date.localeCompare(b.date));
    const autoFreeSet = new Set<string>();
    const freeDaysCount = Math.min(absentDaysList.length, FREE_ABSENCE_ALLOWANCE);
    for (let i = 0; i < freeDaysCount; i++) {
      autoFreeSet.add(absentDaysList[i].date);
    }

    let absenceDeductionDays = 0;
    for (let i = 0; i < absentDaysList.length; i++) {
      if (i < freeDaysCount) {
        // Free — no deduction
      } else {
        absenceDeductionDays += absentDaysList[i].deduction;
      }
    }
    absenceDeductionDays = Math.round(absenceDeductionDays * 100) / 100;

    const autoExemptDays = freeDaysCount;
    const bonusDays = Math.max(FREE_ABSENCE_ALLOWANCE - totalAbsent, 0);

    // Update daily breakdown to mark auto-free days
    for (const dayEntry of dailyBreakdown) {
      if (autoFreeSet.has(dayEntry.date)) {
        dayEntry.autoFree = true;
        dayEntry.absenceDeduction = 0;
        if (!dayEntry.waived) {
          dayEntry.source += ' (إعفاء تلقائي من 4 أيام)';
        }
      }
    }

    // Quality deductions
    const totalQualityDays = empQuality.reduce((sum: number, q: any) => sum + (q.deductionDays || 0), 0);
    const totalQualityAmount = empQuality.reduce((sum: number, q: any) => sum + (q.deductionAmount || 0), 0);

    const totalAttendanceDeductionDays = Math.round((lateDeductionDays + absenceDeductionDays) * 100) / 100;
    const totalDeductionDays = Math.round((totalAttendanceDeductionDays + totalQualityDays) * 100) / 100;

    // Compliance: (present + late + exempt + bonus) / actualWorkingDays * 100
    // Exclude weekends (Friday=5, Saturday=6) from denominator
    const actualWorkDays = workingDays.filter(d => d.dayIndex !== 5 && d.dayIndex !== 6).length;
    const effectiveAttendance = totalPresent + totalLate + totalExempt + bonusDays;
    const attendanceCompliance = actualWorkDays > 0
      ? Math.min(Math.round((effectiveAttendance / actualWorkDays) * 100), 100)
      : 0;

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
        effectiveWorkingDays: Math.round((totalPresent + totalLate + totalExempt + autoExemptDays + bonusDays) * 100) / 100,
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
        totalDeductionDays,
        attendanceCompliance: Math.min(Math.max(attendanceCompliance, 0), 100),
        unaccountedDays,
        autoExemptDays,
        bonusDays,
      },
      dailyBreakdown,
      requests: formattedRequests,
      qualityDeductions: formattedQuality,
    });
  } catch (error) {
    console.error('Employee detail error:', error);
    return NextResponse.json({ error: 'خطأ داخلي في الخادم' }, { status: 500 });
  }
}
