import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const { month } = await request.json();

    if (!month) {
      return NextResponse.json({ error: 'Month is required (YYYY-MM)' }, { status: 400 });
    }

    const [year, mon] = month.split('-');
    const datePattern = `/${mon.padStart(2, '0')}/${year}`;

    const employees = await db.employee.findMany({
      select: { id: true, name: true, department: true, shiftStart: true },
    });

    const deductionRules = await db.deductionRule.findMany();

    const biometricRecords = await db.biometric.findMany({
      where: { date: { contains: datePattern } },
    });

    const attendanceRecords = await db.attendance.findMany({
      where: { date: { contains: datePattern } },
    });

    const allRequests = await db.request.findMany({
      where: { date: { contains: datePattern } },
    });

    const qualityDeductions = await db.qualityDeduction.findMany({
      where: { month },
    });

    const bioByEmp = new Map<string, Map<string, (typeof biometricRecords)[0]>>();
    for (const b of biometricRecords) {
      if (!bioByEmp.has(b.employeeId)) bioByEmp.set(b.employeeId, new Map());
      bioByEmp.get(b.employeeId)!.set(b.date, b);
    }

    const attByEmp = new Map<string, Map<string, (typeof attendanceRecords)[0]>>();
    for (const a of attendanceRecords) {
      if (!attByEmp.has(a.employeeId)) attByEmp.set(a.employeeId, new Map());
      attByEmp.get(a.employeeId)!.set(a.date, a);
    }

    const approvedDates = new Map<string, Set<string>>();
    for (const r of allRequests) {
      if (r.status === 'approved') {
        if (!approvedDates.has(r.employeeId)) approvedDates.set(r.employeeId, new Set());
        approvedDates.get(r.employeeId)!.add(r.date);
      }
    }

    const qualityByEmp = new Map<string, (typeof qualityDeductions)>();
    for (const q of qualityDeductions) {
      if (!qualityByEmp.has(q.employeeId)) qualityByEmp.set(q.employeeId, []);
      qualityByEmp.get(q.employeeId)!.push(q);
    }

    const rulesMap = new Map<string, (typeof deductionRules)[0]>();
    for (const rule of deductionRules) {
      rulesMap.set(rule.key, rule);
    }

    function calcLateMinutes(checkIn: string, shiftStart: string): number {
      const [cH, cM] = checkIn.split(':').map(Number);
      const [sH, sM] = shiftStart.split(':').map(Number);
      return Math.max(0, (cH * 60 + cM) - (sH * 60 + sM));
    }

    function getLateRuleKey(minutesLate: number): string {
      if (minutesLate <= 0) return '';
      if (minutesLate <= 15) return 'late15';
      if (minutesLate <= 30) return 'late30';
      if (minutesLate <= 60) return 'late60';
      return 'late60plus';
    }

    const rows = employees.map((emp) => {
      const empBio = bioByEmp.get(emp.id) || new Map();
      const empAtt = attByEmp.get(emp.id) || new Map();
      const empApproved = approvedDates.get(emp.id) || new Set();
      const empQuality = qualityByEmp.get(emp.id) || [];

      const allDates = new Set([...empBio.keys(), ...empAtt.keys()]);

      let totalPresent = 0;
      let totalLate = 0;
      let totalAbsent = 0;
      let totalExempt = 0;
      let totalMinutesLate = 0;
      let lateDeductionDays = 0;
      let absenceDeductionDays = 0;

      for (const date of allDates) {
        if (empApproved.has(date)) {
          totalExempt++;
          continue;
        }

        const bio = empBio.get(date);
        const att = empAtt.get(date);
        const shiftStart = emp.shiftStart;

        const checkIn = bio?.checkIn || att?.checkIn || null;

        if (checkIn && shiftStart) {
          const minutesLate = calcLateMinutes(checkIn, shiftStart);

          if (minutesLate > 0) {
            totalLate++;
            totalMinutesLate += minutesLate;
            const ruleKey = getLateRuleKey(minutesLate);
            const rule = ruleKey ? rulesMap.get(ruleKey) : null;
            if (rule) {
              lateDeductionDays += rule.amount;
            }
          } else {
            totalPresent++;
          }
        } else if (checkIn && !shiftStart) {
          totalPresent++;
        } else if (att && att.status === 'absent') {
          totalAbsent++;
          const absenceRule = rulesMap.get('absence');
          if (absenceRule) {
            absenceDeductionDays += absenceRule.amount;
          }
        } else if (att && (att.status === 'late' || att.minutesLate > 0)) {
          totalLate++;
          totalMinutesLate += att.minutesLate;
          const ruleKey = getLateRuleKey(att.minutesLate);
          const rule = ruleKey ? rulesMap.get(ruleKey) : null;
          if (rule) {
            lateDeductionDays += rule.amount;
          }
        } else if (att && att.status === 'present') {
          totalPresent++;
        }
      }

      const totalDeductionDays = lateDeductionDays + absenceDeductionDays;
      const totalQualityDeductions = empQuality.reduce((sum, q) => sum + q.deductionAmount, 0);

      const activeDays = allDates.size - totalExempt;
      const attendanceCompliance = activeDays > 0
        ? Math.round(((totalPresent + totalLate) / (activeDays)) * 100)
        : 0;

      return {
        employeeName: emp.name,
        department: emp.department || '—',
        totalPresent,
        totalLate,
        totalAbsent,
        totalExempt,
        totalMinutesLate,
        totalDelays: totalLate,
        lateDeductionDays: Math.round(lateDeductionDays * 100) / 100,
        absenceDeductionDays: Math.round(absenceDeductionDays * 100) / 100,
        totalDeductionDays: Math.round(totalDeductionDays * 100) / 100,
        totalQualityDeductions: Math.round(totalQualityDeductions * 100) / 100,
        totalDeductions: Math.round(totalDeductionDays * 100) / 100,
        totalAmount: Math.round((totalDeductionDays + totalQualityDeductions) * 100) / 100,
        attendanceCompliance,
        workDays: activeDays,
      };
    });

    const sorted = [...rows].sort((a, b) => b.attendanceCompliance - a.attendanceCompliance);

    return NextResponse.json({ rows: sorted });
  } catch (error) {
    console.error('Generate report error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}