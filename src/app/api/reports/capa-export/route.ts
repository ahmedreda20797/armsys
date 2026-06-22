import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getAll, getEmployeeMap, TTL } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import type { CAPACase } from '@/types';

// ══════════════════════════════════════════════════════════════
//  Arabic Mapping Tables
// ══════════════════════════════════════════════════════════════

const STATUS_MAP: Record<string, string> = {
  open: 'مفتوح',
  investigation: 'تحقيق',
  root_cause_analysis: 'تحليل السبب الجذري',
  corrective_action: 'الإجراء التصحيحي',
  preventive_action: 'الإجراء الوقائي',
  verification: 'التحقق',
  closed: 'مغلق',
  rejected: 'مرفوض',
  reopened: 'معاد فتحه',
};

const PRIORITY_MAP: Record<string, string> = {
  critical: 'حرج',
  high: 'عالي',
  medium: 'متوسط',
  low: 'منخفض',
};

const SOURCE_MAP: Record<string, string> = {
  audit: 'تدقيق',
  complaint: 'شكوى',
  mistake_pattern: 'نمط أخطاء',
  management_review: 'مراجعة إدارية',
  employee_feedback: 'ملاحظات موظف',
  automation: 'أتمتة',
  manual: 'يدوي',
};

const CORRECTIVE_STATUS_MAP: Record<string, string> = {
  not_started: 'لم يبدأ',
  in_progress: 'قيد التنفيذ',
  completed: 'مكتمل',
};

const VERIFICATION_RESULT_MAP: Record<string, string> = {
  effective: 'فعّال',
  partially_effective: 'فعّال جزئياً',
  not_effective: 'غير فعّال',
};

// ══════════════════════════════════════════════════════════════
//  Column Definitions
// ══════════════════════════════════════════════════════════════

const COLUMNS = [
  { key: 'capaId', header: 'رقم كابا', width: 18 },
  { key: 'title', header: 'العنوان', width: 32 },
  { key: 'department', header: 'القسم', width: 18 },
  { key: 'employeeName', header: 'الموظف', width: 22 },
  { key: 'status', header: 'الحالة', width: 20 },
  { key: 'priority', header: 'الأولوية', width: 12 },
  { key: 'issueCategory', header: 'التصنيف', width: 18 },
  { key: 'source', header: 'المصدر', width: 16 },
  { key: 'problemDescription', header: 'وصف المشكلة', width: 40 },
  { key: 'assignedToName', header: 'المسؤول', width: 22 },
  { key: 'slaDays', header: 'أيام SLA', width: 12 },
  { key: 'overdueDays', header: 'أيام التأخير', width: 14 },
  { key: 'correctiveAction', header: 'الإجراء التصحيحي', width: 40 },
  { key: 'correctiveStatus', header: 'حالة الإجراء التصحيحي', width: 22 },
  { key: 'preventiveAction', header: 'الإجراء الوقائي', width: 40 },
  { key: 'verificationResult', header: 'نتيجة التحقق', width: 18 },
  { key: 'createdAt', header: 'تاريخ الإنشاء', width: 20 },
  { key: 'closedAt', header: 'تاريخ الإغلاق', width: 20 },
] as const;

// ══════════════════════════════════════════════════════════════
//  SLA defaults
// ══════════════════════════════════════════════════════════════

const SLA_DAYS: Record<string, number> = {
  critical: 1,
  high: 3,
  medium: 7,
  low: 14,
};

// ══════════════════════════════════════════════════════════════
//  Helper: Enrich a CAPA case with computed fields
// ══════════════════════════════════════════════════════════════

interface Filters {
  status?: string;
  priority?: string;
  department?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

interface ExportRow {
  capaId: string;
  title: string;
  department: string;
  employeeName: string;
  status: string;
  priority: string;
  issueCategory: string;
  source: string;
  problemDescription: string;
  assignedToName: string;
  slaDays: number;
  overdueDays: number;
  correctiveAction: string;
  correctiveStatus: string;
  preventiveAction: string;
  verificationResult: string;
  createdAt: string;
  closedAt: string;
}

function mapRow(c: CAPACase): ExportRow {
  return {
    capaId: c.capaId || '',
    title: c.title || '',
    department: c.department || '',
    employeeName: c.employeeName || '',
    status: STATUS_MAP[c.status] || c.status,
    priority: PRIORITY_MAP[c.priority] || c.priority,
    issueCategory: c.issueCategory || '',
    source: SOURCE_MAP[c.source] || c.source,
    problemDescription: c.problemDescription || '',
    assignedToName: c.assignedToName || '',
    slaDays: c.slaDays || SLA_DAYS[c.priority] || 7,
    overdueDays: c.overdueDays ?? 0,
    correctiveAction: c.correctiveAction || '',
    correctiveStatus: CORRECTIVE_STATUS_MAP[c.correctiveStatus] || c.correctiveStatus,
    preventiveAction: c.preventiveAction || '',
    verificationResult: c.verificationResult ? (VERIFICATION_RESULT_MAP[c.verificationResult] || c.verificationResult) : '',
    createdAt: c.createdAt ? formatDate(c.createdAt) : '',
    closedAt: c.closedAt ? formatDate(c.closedAt) : '',
  };
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}

function applyFilters(records: CAPACase[], filters: Filters): CAPACase[] {
  let result = records;

  if (filters.status) {
    result = result.filter((r) => r.status === filters.status);
  }
  if (filters.priority) {
    result = result.filter((r) => r.priority === filters.priority);
  }
  if (filters.department) {
    result = result.filter((r) => r.department === filters.department);
  }
  if (filters.dateFrom) {
    const fromMs = new Date(filters.dateFrom).getTime();
    result = result.filter((r) => new Date(r.createdAt).getTime() >= fromMs);
  }
  if (filters.dateTo) {
    const toMs = new Date(filters.dateTo).getTime();
    result = result.filter((r) => new Date(r.createdAt).getTime() <= toMs);
  }
  if (filters.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.capaId.toLowerCase().includes(q) ||
        r.problemDescription.toLowerCase().includes(q) ||
        (r.employeeName && r.employeeName.toLowerCase().includes(q)) ||
        (r.department && r.department.toLowerCase().includes(q))
    );
  }

  return result;
}

// ══════════════════════════════════════════════════════════════
//  Excel Generation
// ══════════════════════════════════════════════════════════════

async function generateExcel(rows: ExportRow[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ARM ERP System';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('تقرير حالات كابا', {
    properties: { tabColor: { argb: '1F4E79' } },
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // ── Header Row ──
  const headerRow = sheet.getRow(1);
  headerRow.height = 30;

  COLUMNS.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.header;
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
    cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFFFFF' } },
      bottom: { style: 'thin', color: { argb: 'FFFFFF' } },
      left: { style: 'thin', color: { argb: 'D9D9D9' } },
      right: { style: 'thin', color: { argb: 'D9D9D9' } },
    };
    sheet.getColumn(idx + 1).width = col.width;
  });

  // ── Data Rows ──
  rows.forEach((row, rowIdx) => {
    const dataRow = sheet.getRow(rowIdx + 2);
    dataRow.height = 22;

    const isEven = rowIdx % 2 === 0;
    const bgColor = isEven ? 'F2F7FB' : 'FFFFFF';

    COLUMNS.forEach((col, colIdx) => {
      const cell = dataRow.getCell(colIdx + 1);
      const val = row[col.key as keyof ExportRow];
      cell.value = val as ExcelJS.CellValue;
      cell.font = { name: 'Arial', size: 10, color: { argb: '333333' } };
      cell.alignment = { horizontal: 'right', vertical: 'middle', wrapText: true, indent: 1 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
      cell.border = {
        top: { style: 'hair', color: { argb: 'D0D0D0' } },
        bottom: { style: 'hair', color: { argb: 'D0D0D0' } },
        left: { style: 'hair', color: { argb: 'D0D0D0' } },
        right: { style: 'hair', color: { argb: 'D0D0D0' } },
      };
    });
  });

  // ── Auto-filter on headers ──
  if (rows.length > 0) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: rows.length + 1, column: COLUMNS.length },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

// ══════════════════════════════════════════════════════════════
//  CSV Generation
// ══════════════════════════════════════════════════════════════

function escapeCsvField(value: unknown): string {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function generateCsv(rows: ExportRow[]): string {
  const headers = COLUMNS.map((c) => c.header);
  const headerLine = headers.map(escapeCsvField).join(',');

  const dataLines = rows.map((row) =>
    COLUMNS.map((col) => escapeCsvField(row[col.key as keyof ExportRow])).join(',')
  );

  return [headerLine, ...dataLines].join('\n');
}

// ══════════════════════════════════════════════════════════════
//  POST /api/reports/capa-export
// ══════════════════════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    // ── Auth & Permission Check ──
    const permCheck = await verifyPermission(request, 'capa', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    // ── Parse Body ──
    const body = await request.json();
    const { format, filters = {} } = body;

    if (!format || !['xlsx', 'csv'].includes(format)) {
      return NextResponse.json({ error: 'format must be "xlsx" or "csv"' }, { status: 400 });
    }

    // ── Fetch Data ──
    const allCases = await getAll<CAPACase>('capaCases', TTL.MEDIUM);

    // Enrich with employee names (for cases missing them)
    const empMap = await getEmployeeMap();
    const enriched = allCases.map((c) => {
      if (!c.employeeName && c.employeeId) {
        c.employeeName = empMap.get(c.employeeId)?.name || '';
      }
      if (!c.assignedToName && c.assignedTo) {
        c.assignedToName = empMap.get(c.assignedTo)?.name || '';
      }
      return c;
    });

    // ── Apply Filters ──
    const filtered = applyFilters(enriched, filters as Filters);

    // ── Sort by creation date descending ──
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // ── Map to export rows ──
    const rows = filtered.map(mapRow);

    // ── Filename ──
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // ── Generate & Respond ──
    if (format === 'xlsx') {
      const buffer = await generateExcel(rows);
      return new NextResponse(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename=capa_report_${today}.xlsx`,
        },
      });
    }

    // CSV with BOM for proper Arabic encoding
    const csv = '\uFEFF' + generateCsv(rows);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename=capa_report_${today}.csv`,
      },
    });
  } catch (error) {
    console.error('[POST /api/reports/capa-export] Error:', error);
    return NextResponse.json({ error: 'Failed to export CAPA report' }, { status: 500 });
  }
}