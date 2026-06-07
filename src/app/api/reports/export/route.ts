import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { data } = body;

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 });
    }

    const worksheet = XLSX.utils.json_to_sheet(
      data.map((row: Record<string, unknown>) => ({
        'الموظف': row.employeeName,
        'القسم': row.department,
        'أيام الحضور': row.totalPresent,
        'أيام التأخير': row.totalLate,
        'أيام الغياب': row.totalAbsent,
        'أيام معفاة (طلبات مقبولة)': row.totalExempt,
        'إجمالي دقائق التأخير': row.totalMinutesLate,
        'خصم التأخير (يوم)': row.lateDeductionDays,
        'خصم الغياب (يوم)': row.absenceDeductionDays,
        'إجمالي الخصم (يوم)': row.totalDeductionDays,
        'خصومات الجودة (ج.م)': row.totalQualityDeductions,
        'الإجمالي': row.totalAmount,
        'نسبة الالتزام %': row.attendanceCompliance,
      }))
    );

    worksheet['!cols'] = [
      { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 },
      { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
      { wch: 18 }, { wch: 12 }, { wch: 14 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير الخصومات الشهري');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename=report.xlsx',
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}