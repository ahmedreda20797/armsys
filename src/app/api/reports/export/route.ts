import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { verifyPermission } from '@/lib/verify-permission';

export async function POST(request: Request) {
  try {
    // Verify permission: reports page - export action required
    const permCheck = await verifyPermission(request, 'reports', 'export');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();
    const { month, data, meta, summary } = body;

    if (!data || !Array.isArray(data)) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 });
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ARM ERP System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('تقرير الخصومات الشهري', {
      properties: { tabColor: { argb: '1F4E79' } },
      views: [{ state: 'frozen', ySplit: 7 }],
    });

    // ── Page Setup ──
    sheet.pageSetup = {
      orientation: 'landscape',
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    };

    // ════════════════════════════════════════════════════
    // ROW 1: Title Banner
    // ════════════════════════════════════════════════════
    sheet.mergeCells('A1:R1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'تقرير الخصومات الشهري';
    titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 40;

    // ════════════════════════════════════════════════════
    // ROW 2: Sub-info
    // ════════════════════════════════════════════════════
    sheet.mergeCells('A2:D2');
    const monthCell = sheet.getCell('A2');
    monthCell.value = `الشهر: ${month || ''}`;
    monthCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: '1F4E79' } };
    monthCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

    sheet.mergeCells('E2:J2');
    const daysCell = sheet.getCell('E2');
    daysCell.value = `عدد أيام العمل: ${meta?.monthWorkingDays || ''} يوم`;
    daysCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: '1F4E79' } };
    daysCell.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('K2:N2');
    const empCountCell = sheet.getCell('K2');
    empCountCell.value = `عدد الموظفين: ${data.length}`;
    empCountCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: '1F4E79' } };
    empCountCell.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('O2:R2');
    const dateCell = sheet.getCell('O2');
    const today = new Date();
    dateCell.value = `تاريخ التصدير: ${today.toLocaleDateString('ar-EG')}`;
    dateCell.font = { name: 'Arial', size: 11, bold: true, color: { argb: '1F4E79' } };
    dateCell.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

    sheet.getRow(2).height = 25;

    // ════════════════════════════════════════════════════
    // ROW 3: Empty spacing
    // ════════════════════════════════════════════════════
    sheet.getRow(3).height = 8;

    // ════════════════════════════════════════════════════
    // ROW 4: Section Header - Attendance Info
    // ════════════════════════════════════════════════════
    sheet.mergeCells('A4:J4');
    const section1 = sheet.getCell('A4');
    section1.value = 'بيانات الحضور';
    section1.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    section1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2E75B6' } };
    section1.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.mergeCells('K4:R4');
    const section2 = sheet.getCell('K4');
    section2.value = 'الخصومات';
    section2.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    section2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C00000' } };
    section2.alignment = { horizontal: 'center', vertical: 'middle' };

    sheet.getRow(4).height = 22;

    // ════════════════════════════════════════════════════
    // ROW 5: Column Headers
    // ════════════════════════════════════════════════════
    const headers = [
      { text: 'م', width: 5 },
      { text: 'اسم الموظف', width: 28 },
      { text: 'القسم', width: 16 },
      { text: 'المسمى الوظيفي', width: 18 },
      { text: 'أيام الحضور', width: 12 },
      { text: 'أيام التأخير', width: 12 },
      { text: 'دقائق التأخير', width: 14 },
      { text: 'أيام الغياب', width: 12 },
      { text: 'أيام الإعفاء', width: 12 },
      { text: 'إجمالي الإعفاء التلقائي', width: 16 },
      { text: 'أيام المكافأة', width: 12 },
      { text: 'نسبة الالتزام', width: 14 },
      { text: 'خصم التأخير', width: 12 },
      { text: 'خصم الغياب', width: 12 },
      { text: 'خصم الحضور الكلي', width: 14 },
      { text: 'خصم الجودة', width: 12 },
      { text: 'مبلغ الجودة', width: 14 },
      { text: 'إجمالي الخصم', width: 14 },
    ];

    const headerRow = sheet.getRow(5);
    headerRow.height = 28;

    headers.forEach((h, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = h.text;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };

      // Section colors: blue for attendance, red for deductions
      if (idx <= 9) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0604040' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C0504D' } };
      }

      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFF' } },
        left: { style: 'thin', color: { argb: 'D9D9D9' } },
        right: { style: 'thin', color: { argb: 'D9D9D9' } },
      };
    });

    // ════════════════════════════════════════════════════
    // ROW 6: Thin separator
    // ════════════════════════════════════════════════════
    sheet.getRow(6).height = 4;

    // ════════════════════════════════════════════════════
    // DATA ROWS (starting from row 7)
    // ════════════════════════════════════════════════════
    data.forEach((row: Record<string, unknown>, rowIdx: number) => {
      const rowNum = rowIdx + 7;
      const dataRow = sheet.getRow(rowNum);
      dataRow.height = 22;

      const values = [
        rowIdx + 1,
        row.employeeName || '',
        row.department || '',
        row.position || '',
        row.totalPresent || 0,
        row.totalLate || 0,
        row.totalMinutesLateFormatted || (row.totalMinutesLate || 0),
        row.totalAbsent || 0,
        row.totalExempt || 0,
        row.autoExemptDays || 0,
        row.bonusDays || 0,
        row.attendanceCompliance || 0,
        row.lateDeductionDays || 0,
        row.absenceDeductionDays || 0,
        row.totalAttendanceDeductionDays || 0,
        row.totalQualityDays || 0,
        row.totalQualityAmount || 0,
        row.totalDeductionDays || 0,
      ];

      const isEven = rowIdx % 2 === 0;
      const bgColor = isEven ? 'F2F7FB' : 'FFFFFF';

      values.forEach((val, colIdx: number) => {
        const cell = dataRow.getCell(colIdx + 1);
        cell.value = val as ExcelJS.CellValue;

        // Styling
        cell.font = {
          name: 'Arial',
          size: 10,
          bold: colIdx === 0,
          color: { argb: '333333' },
        };
        cell.alignment = {
          horizontal: colIdx <= 3 ? 'right' : 'center',
          vertical: 'middle',
          indent: colIdx <= 3 ? 1 : 0,
        };

        // Alternating row background
        if (!isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        }

        // Borders
        cell.border = {
          top: { style: 'hair', color: { argb: 'D0D0D0' } },
          bottom: { style: 'hair', color: { argb: 'D0D0D0' } },
          left: { style: 'hair', color: { argb: 'D0D0D0' } },
          right: { style: 'hair', color: { argb: 'D0D0D0' } },
        };

        // ── Conditional colors ──
        // Compliance: green >= 90, amber >= 75, red < 75
        if (colIdx === 11) {
          const num = Number(val) || 0;
          if (num >= 90) {
            cell.font = { ...cell.font, color: { argb: '006100' }, bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'C6EFCE' } };
          } else if (num >= 75) {
            cell.font = { ...cell.font, color: { argb: '9C6500' }, bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEB9C' } };
          } else {
            cell.font = { ...cell.font, color: { argb: '9C0006' }, bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC7CE' } };
          }
        }

        // Deduction columns: red if > 0
        if (colIdx === 17 && Number(val) > 0) {
          cell.font = { ...cell.font, color: { argb: 'C00000' }, bold: true };
        }

        // Bonus days: green if > 0
        if (colIdx === 10 && Number(val) > 0) {
          cell.font = { ...cell.font, color: { argb: '006100' }, bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E2EFDA' } };
        }
      });
    });

    // ════════════════════════════════════════════════════
    // SUMMARY ROW
    // ════════════════════════════════════════════════════
    const summaryStartRow = data.length + 7;
    const summaryRow = sheet.getRow(summaryStartRow);
    summaryRow.height = 28;

    // Merge label
    sheet.mergeCells(`A${summaryStartRow}:D${summaryStartRow}`);
    const sumLabel = summaryRow.getCell(1);
    sumLabel.value = 'الإجمالي';
    sumLabel.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    sumLabel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
    sumLabel.alignment = { horizontal: 'center', vertical: 'middle' };

    const summaryValues = [
      (summary?.totalPresentDays || data.reduce((s: number, r: any) => s + (r.totalPresent || 0), 0)),
      (summary?.totalLateDays || data.reduce((s: number, r: any) => s + (r.totalLate || 0), 0)),
      (summary?.totalMinutesLateAll || data.reduce((s: number, r: any) => s + (r.totalMinutesLate || 0), 0)),
      (summary?.totalAbsentDays || data.reduce((s: number, r: any) => s + (r.totalAbsent || 0), 0)),
      (summary?.totalExemptDays || data.reduce((s: number, r: any) => s + (r.totalExempt || 0), 0)),
      (summary?.totalAutoExemptDays || data.reduce((s: number, r: any) => s + (r.autoExemptDays || 0), 0)),
      (summary?.totalBonusDays || data.reduce((s: number, r: any) => s + (r.bonusDays || 0), 0)),
      (summary?.avgCompliance || (data.length > 0 ? Math.round(data.reduce((s: number, r: any) => s + (r.attendanceCompliance || 0), 0) / data.length) : 0)),
      (data.reduce((s: number, r: any) => s + (r.lateDeductionDays || 0), 0)),
      (data.reduce((s: number, r: any) => s + (r.absenceDeductionDays || 0), 0)),
      (data.reduce((s: number, r: any) => s + (r.totalAttendanceDeductionDays || 0), 0)),
      (summary?.totalQualityDaysAll || data.reduce((s: number, r: any) => s + (r.totalQualityDays || 0), 0)),
      (summary?.totalQualityAmountAll || data.reduce((s: number, r: any) => s + (r.totalQualityAmount || 0), 0)),
      (data.reduce((s: number, r: any) => s + (r.totalDeductionDays || 0), 0)),
    ];

    summaryValues.forEach((val: number, idx: number) => {
      const cell = summaryRow.getCell(idx + 5);
      cell.value = idx === 7 ? `${val}%` : val;
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = {
        top: { style: 'thin', color: { argb: '1F4E79' } },
        bottom: { style: 'medium', color: { argb: '1F4E79' } },
        left: { style: 'thin', color: { argb: 'D0D0D0' } },
        right: { style: 'thin', color: { argb: 'D0D0D0' } },
      };
      // Round numbers
      if (typeof val === 'number') {
        cell.value = Math.round(val * 100) / 100;
      }
    });

    // ════════════════════════════════════════════════════
    // FOOTER: Free days policy note
    // ════════════════════════════════════════════════════
    const footerRow = summaryStartRow + 2;
    sheet.mergeCells(`A${footerRow}:R${footerRow}`);
    const footerCell = sheet.getCell(`A${footerRow}`);
    footerCell.value = 'ملاحظة: كل موظف يحصل على 4 أيام إعفاء تلقائي شهرياً من الخصومات. الأيام الغائبة الأقل من 4 تُحسب كمكافأة حضور.';
    footerCell.font = { name: 'Arial', size: 9, italic: true, color: { argb: '666666' } };
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' };

    // ════════════════════════════════════════════════════
    // Set Column Widths
    // ════════════════════════════════════════════════════
    headers.forEach((h, idx) => {
      sheet.getColumn(idx + 1).width = h.width;
    });

    // ════════════════════════════════════════════════════
    // Auto-filter on headers
    // ════════════════════════════════════════════════════
    const lastDataCol = String.fromCharCode(64 + headers.length); // R
    sheet.autoFilter = {
      from: { row: 5, column: 1 },
      to: { row: summaryStartRow - 1, column: headers.length },
    };

    // ════════════════════════════════════════════════════
    // Generate buffer
    // ════════════════════════════════════════════════════
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename=report_${month || 'unknown'}.xlsx`,
      },
    });
  } catch (error) {
    console.error('Export error:', error);
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 });
  }
}
