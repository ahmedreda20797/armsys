import { NextResponse } from 'next/server';
import { findFirst, createRecord, updateRecord } from '@/lib/db';

export async function POST() {
  try {
    const sampleEmployees = [
      { name: 'أحمد محمد', department: 'قسم الإنتاج', position: 'عامل', shiftStart: '08:00', shiftEnd: '16:00' },
      { name: 'محمود علي', department: 'قسم الجودة', position: 'فني', shiftStart: '09:00', shiftEnd: '17:00' },
      { name: 'سارة حسن', department: 'قسم الإدارة', position: 'موظف إداري', shiftStart: '09:00', shiftEnd: '17:00' },
      { name: 'خالد إبراهيم', department: 'قسم الصيانة', position: 'مهندس', shiftStart: '08:30', shiftEnd: '16:30' },
    ];

    const createdEmployees: { id: string; name: string }[] = [];

    for (const emp of sampleEmployees) {
      const existing = await findFirst('employees', { name: emp.name });
      if (!existing) {
        const created = await createRecord('employees', emp);
        createdEmployees.push({ id: created.id, name: created.name });
      } else {
        createdEmployees.push({ id: existing.id, name: existing.name });
      }
    }

    const now = new Date();
    const todayStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const sampleDeductions = [
      { employeeId: createdEmployees[1]?.id, date: todayStr, type: 'quality_issue', description: 'عدم الالتزام بإجراءات الفحص', deductionDays: 0.5, deductionAmount: 0, month: monthStr },
      { employeeId: createdEmployees[0]?.id, date: todayStr, type: 'safety', description: 'عدم ارتداء معدات الحماية', deductionDays: 0.25, deductionAmount: 0, month: monthStr },
      { employeeId: createdEmployees[3]?.id, date: todayStr, type: 'compliance', description: 'تأخر في تقديم تقرير الصيانة', deductionDays: 1, deductionAmount: 0, month: monthStr },
    ];

    for (const ded of sampleDeductions) {
      if (!ded.employeeId) continue;
      const existing = await findFirst('qualityDeductions', { employeeId: ded.employeeId, date: ded.date });
      if (!existing) {
        await createRecord('qualityDeductions', ded);
      }
    }

    const sampleAttendance = [
      { employeeId: createdEmployees[0]?.id, date: todayStr, status: 'present', checkIn: '08:00', checkOut: null, minutesLate: 0 },
      { employeeId: createdEmployees[1]?.id, date: todayStr, status: 'late', checkIn: '09:17', checkOut: null, minutesLate: 17 },
      { employeeId: createdEmployees[2]?.id, date: todayStr, status: 'present', checkIn: '08:55', checkOut: null, minutesLate: 0 },
      { employeeId: createdEmployees[3]?.id, date: todayStr, status: 'absent', checkIn: null, checkOut: null, minutesLate: 0 },
    ];

    for (const att of sampleAttendance) {
      if (!att.employeeId) continue;
      const existing = await findFirst('attendance', { employeeId: att.employeeId, date: att.date });
      if (!existing) {
        await createRecord('attendance', att);
      }
    }

    const defaultRules = [
      { key: 'late15', label: 'تأخير من 16 إلى 30 دقيقة', amount: 0.25, unit: 'days' },
      { key: 'late30', label: 'تأخير من 31 إلى 60 دقيقة', amount: 0.5, unit: 'days' },
      { key: 'late60', label: 'تأخير 61 دقيقة فأكثر', amount: 1, unit: 'days' },
      { key: 'absence', label: 'غياب', amount: 1, unit: 'days' },
    ];

    for (const rule of defaultRules) {
      const existing = await findFirst('deductionRules', { key: rule.key });
      if (!existing) {
        await createRecord('deductionRules', rule);
      } else if (existing.amount !== rule.amount || existing.label !== rule.label) {
        // Update existing rule if amounts or labels changed
        await updateRecord('deductionRules', existing.id, { amount: rule.amount, label: rule.label });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Test data seeded successfully',
      employees: createdEmployees.map((e) => e.name),
      attendanceRecords: sampleAttendance.length,
      qualityDeductions: sampleDeductions.length,
      rules: defaultRules.length,
    });
  } catch (error) {
    console.error('Seed test data error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}