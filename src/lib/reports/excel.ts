// ══════════════════════════════════════════════════════════════
//  Generic Report Excel Export (Milestone 8 — spec §20)
//
//  ONE definition-driven Excel generator for every registered
//  report: columns, labels, widths and the summary row all come
//  from the ReportDefinition — no bespoke per-report workbook
//  code. Uses ExcelJS, the same library as the existing legacy
//  exports (no second export dependency).
//
//  Existing bespoke exports (/api/reports/export, /api/reports/
//  capa-export) are untouched — this engine serves reports built
//  on the new architecture.
//
//  §DYNAMIC-LABELS — known system enum/status labels and legacy
//  stored semantic labels are localized in the exported workbook;
//  free text / user data passes through verbatim.
// ══════════════════════════════════════════════════════════════

import ExcelJS from 'exceljs';
import type { ReportDefinition, ReportRunResponse, ReportColumnSpec } from './types';
import { presentStatus } from '@/lib/i18n/presentation';
import { resolveStoredLabelOrVerbatim } from '@/lib/i18n/dynamic-labels';

/** Default column width when a spec omits one. */
const DEFAULT_WIDTH = 16;

/** Locale for the export (passed through the request context). */
let currentExportLocale: 'ar' | 'en' = 'ar';

/**
 * Apply the column's localization strategy to a raw cell value.
 * §DYNAMIC-LABELS — exact-match resolution; unknown values pass through.
 */
function localizeCellValue(
  col: ReportColumnSpec,
  value: unknown,
): unknown {
  if (!col.localize || value === null || value === undefined) return value;
  const locale = currentExportLocale;
  const raw = String(value);
  switch (col.localize) {
    case 'system':
      return presentStatus(raw, locale);
    case 'stored':
      return resolveStoredLabelOrVerbatim(raw, locale);
    default:
      return value;
  }
}

/**
 * Render a report response to an XLSX buffer. RTL sheet, Arabic
 * headers from visibleColumns, summary row from availableMetrics.
 */
export async function buildReportExcel(
  definition: ReportDefinition,
  response: ReportRunResponse<Record<string, unknown>>,
  locale: 'ar' | 'en' = 'ar',
): Promise<Buffer> {
  currentExportLocale = locale;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Qnalys';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(definition.name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 4 }],
  });

  // ── Title + period banner ──
  const columns = definition.visibleColumns;
  const lastColLetter = columnLetter(columns.length);
  sheet.mergeCells(`A1:${lastColLetter}1`);
  const title = sheet.getCell('A1');
  title.value = definition.name;
  title.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFF' } };
  title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(1).height = 32;

  sheet.mergeCells(`A2:${lastColLetter}2`);
  const periodCell = sheet.getCell('A2');
  periodCell.value = `الفترة: ${response.meta.period} — تاريخ الإنشاء: ${response.meta.generatedAt}`;
  periodCell.font = { name: 'Arial', size: 10, color: { argb: '1F4E79' } };
  periodCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(2).height = 20;

  sheet.getRow(3).height = 6;

  // ── Header row ──
  const headerRow = sheet.getRow(4);
  headerRow.height = 24;
  columns.forEach((col, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = col.label;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFFFFF' } },
      bottom: { style: 'thin', color: { argb: 'FFFFFF' } },
      left: { style: 'thin', color: { argb: 'D9D9D9' } },
      right: { style: 'thin', color: { argb: 'D9D9D9' } },
    };
  });

  // ── Data rows ──
  response.rows.forEach((row, rowIdx) => {
    const dataRow = sheet.getRow(rowIdx + 5);
    // §10/§11: rows carrying multi-line cells (e.g. deduction reasons)
    // get a taller row so every bullet line stays readable.
    const hasMultiline = columns.some((col) =>
      typeof row[col.key] === 'string' && (row[col.key] as string).includes('\n'));
    dataRow.height = hasMultiline ? Math.max(20, 14 * Math.max(...columns.map((col) =>
      typeof row[col.key] === 'string' ? (row[col.key] as string).split('\n').length : 1))) : 20;
    columns.forEach((col, colIdx) => {
      const cell = dataRow.getCell(colIdx + 1);
      const raw = row[col.key];
      // §DYNAMIC-LABELS — localize known system/stored values in the export.
      const localized = localizeCellValue(col, raw);
      cell.value = (localized === null || localized === undefined ? '' : localized) as ExcelJS.CellValue;
      const isMultiline = typeof localized === 'string' && localized.includes('\n');
      cell.font = { name: 'Arial', size: 10, color: { argb: '333333' } };
      cell.alignment = {
        horizontal: typeof raw === 'number' ? 'center' : 'right',
        vertical: isMultiline ? 'top' : 'middle',
        // Multi-line cells wrap so bulleted reasons stay organized
        // inside ONE cell (§10/§11 Excel contract).
        wrapText: isMultiline,
      };
      cell.border = {
        top: { style: 'hair', color: { argb: 'D0D0D0' } },
        bottom: { style: 'hair', color: { argb: 'D0D0D0' } },
        left: { style: 'hair', color: { argb: 'D0D0D0' } },
        right: { style: 'hair', color: { argb: 'D0D0D0' } },
      };
      if (rowIdx % 2 === 0) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F7FB' } };
      }
    });
  });

  // ── Summary row (declared metrics only) ──
  const summaryMetrics = definition.availableMetrics.filter((m) => m.metricId in response.summary);
  if (summaryMetrics.length > 0) {
    const summaryRowNum = response.rows.length + 6;
    const summaryRow = sheet.getRow(summaryRowNum);
    summaryRow.height = 24;
    summaryMetrics.forEach((metric, idx) => {
      const cell = summaryRow.getCell(idx + 1);
      cell.value = `${metric.label}: ${response.summary[metric.metricId]}`;
      cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1F4E79' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
  }

  // ── Column widths ──
  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width ?? DEFAULT_WIDTH;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** 1-based column index → Excel letter (A..ZZ is enough here). */
function columnLetter(count: number): string {
  let letter = '';
  let n = count;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter || 'A';
}
