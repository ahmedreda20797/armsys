'use client';

// ══════════════════════════════════════════════════════════════
//  ReportView — reusable presentation primitives for the Unified
//  Reporting Architecture (Milestone 8 — spec §27)
//
//  NOT a giant universal report page: a set of small contracts
//  (header, filters, summary cards, table, export actions, empty
//  state) driven ENTIRELY by a ReportDefinition from the catalog.
//  Individual reports mount <ReportView reportId=… /> and may
//  override cell rendering — no report-specific layout code.
//
//  Reused foundations: EmployeeSearchInput, ui/Table/Select/Input,
//  generateMonthOptions, useReportDefinition/useReportRun,
//  authFetch (blob download like the legacy export).
//
//  RTL + forced dark theme + responsive (tables scroll, cards
//  reflow 2/3/6 columns). No fixed widths.
// ══════════════════════════════════════════════════════════════

import React, { useMemo, useState } from 'react';
import { BarChart3, Download, FileSpreadsheet, Loader2, Printer, RotateCcw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { authFetch } from '@/lib/api-fetch';
import { generateMonthOptions } from '@/lib/date-utils';
import { useEmployees } from '@/hooks/use-queries';
import { useReportDefinition, useReportRun } from '@/hooks/use-report-queries';
import type { ReportColumnSpec, ReportRunRequest } from '@/lib/reports/types';

type Row = Record<string, unknown>;

export interface ReportViewProps {
  reportId: string;
  /** Custom cell renderer per column key (badges, links, coloring). */
  renderCell?: (column: ReportColumnSpec, row: Row) => React.ReactNode;
}

// ─────────────────────────────────────────────────────────────
//  Small primitives (also exported for individual report pages)
// ─────────────────────────────────────────────────────────────

/** Summary metric cards — values keyed by declared metric ids. */
export function ReportSummaryCards({
  metrics, summary,
}: {
  metrics: ReadonlyArray<{ metricId: string; label: string; unit?: string }>;
  summary: Record<string, number>;
}) {
  const visible = metrics.filter((m) => m.metricId in summary);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {visible.map((m) => (
        <div key={m.metricId} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3">
          <div className="text-[11px] text-slate-400 truncate">{m.label}</div>
          <div className="text-lg font-bold text-slate-100 mt-1 tabular-nums">
            {summary[m.metricId]}
            {m.unit === 'EGP' ? <span className="text-xs font-normal text-slate-400 mr-1">ج.م</span> : null}
            {m.unit === 'days' ? <span className="text-xs font-normal text-slate-400 mr-1">يوم</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Definition-driven table (columns from visibleColumns). */
export function ReportTable({
  columns, rows, renderCell,
}: {
  columns: ReadonlyArray<ReportColumnSpec>;
  rows: Row[];
  renderCell?: (column: ReportColumnSpec, row: Row) => React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 overflow-hidden print:border-slate-300">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700/50 hover:bg-transparent">
              {columns.map((col) => (
                <TableHead key={col.key} className="text-slate-300 text-xs whitespace-nowrap text-right">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => (
              <TableRow key={String(row.id ?? i)} className="border-slate-800/60">
                {columns.map((col) => (
                  <TableCell key={col.key} className="text-slate-200 text-xs whitespace-nowrap">
                    {renderCell
                      ? (renderCell(col, row) ?? formatCell(row[col.key]))
                      : formatCell(row[col.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function formatCell(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === '') return <span className="text-slate-500">—</span>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  return String(value);
}

/** No-data state (spec §23 — never fabricated data). */
export function ReportEmptyState({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-dashed border-slate-700/60 bg-slate-900/30">
      <Search className="size-10 text-slate-600 mb-3" />
      <p className="text-slate-400 text-sm">{label ?? 'لا توجد بيانات مطابقة للفلاتر المحددة'}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  ReportView
// ─────────────────────────────────────────────────────────────

export function ReportView({ reportId, renderCell }: ReportViewProps) {
  const { definition, isLoading: defLoading } = useReportDefinition(reportId);
  const { data: employees } = useEmployees();

  const months = useMemo(() => generateMonthOptions('YYYY-MM'), []);
  const currentMonth = months[0];

  // Filter state — only for controls the definition declares.
  const [monthKey, setMonthKey] = useState<string>(currentMonth);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [useDateRange, setUseDateRange] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [exporting, setExporting] = useState(false);

  const hasFilter = (key: string) => !!definition?.allowedFilters.some((f) => f.key === key);

  const request = useMemo<ReportRunRequest | null>(() => {
    if (!definition) return null;
    const base: ReportRunRequest = { reportId: definition.reportId };
    if (useDateRange && hasFilter('fromDate') && fromDate && toDate) {
      base.fromDate = fromDate;
      base.toDate = toDate;
    } else if (hasFilter('monthKey') && monthKey) {
      base.monthKey = monthKey;
    }
    if (employeeId) base.employeeId = employeeId;
    if (department.trim()) base.department = department.trim();
    const filters: Record<string, string> = {};
    if (category.trim() && hasFilter('category')) filters.category = category.trim();
    if (Object.keys(filters).length > 0) base.filters = filters;
    return base;
  }, [definition, useDateRange, fromDate, toDate, monthKey, employeeId, department, category]);

  const run = useReportRun<Row>(reportId, request ?? { reportId }, !!definition);
  const canExport = definition && 'canExport' in definition ? Boolean((definition as { canExport?: boolean }).canExport) : false;

  const handleExport = async () => {
    if (!request || exporting) return;
    setExporting(true);
    try {
      const res = await authFetch('/api/reports/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(request ?? { reportId }), format: 'excel' }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${definition?.reportId ?? 'report'}_${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  };

  if (defLoading) {
    return (
      <div className="space-y-4" dir="rtl">
        <Skeleton className="h-10 w-64 rounded-xl bg-slate-800/60" />
        <Skeleton className="h-24 w-full rounded-2xl bg-slate-800/40" />
        <Skeleton className="h-72 w-full rounded-2xl bg-slate-800/40" />
      </div>
    );
  }

  if (!definition) {
    return <ReportEmptyState label="هذا التقرير غير متاح لحسابك" />;
  }

  const response = run.data;
  const modeBadge =
    response?.meta.dataMode.dataMode === 'snapshot' ? 'نتيجة شهرية معتمدة'
    : response?.meta.dataMode.dataMode === 'hybrid' ? 'بيانات مختلطة'
    : 'بيانات حية';

  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <BarChart3 className="size-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">{definition.name}</h1>
            <p className="text-xs text-slate-400 mt-0.5 max-w-xl">{definition.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {response && (
            <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-300 text-[11px]">
              {modeBadge}
            </Badge>
          )}
          {definition.exportFormats.includes('excel') && canExport && (
            <Button size="sm" variant="secondary" onClick={handleExport} disabled={exporting || !response?.hasData}>
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
              تصدير Excel
            </Button>
          )}
          {definition.exportFormats.includes('print') && response?.hasData && (
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              <Printer className="size-4" />
              طباعة
            </Button>
          )}
        </div>
      </div>

      {/* ═══ Filters ═══ */}
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4 space-y-3 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          {/* Time mechanism: date-range ⇄ month switch */}
          {hasFilter('fromDate') && hasFilter('monthKey') && (
            <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-950/40 p-1">
              <button
                type="button"
                onClick={() => setUseDateRange(false)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!useDateRange ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                حسب الشهر
              </button>
              <button
                type="button"
                onClick={() => setUseDateRange(true)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${useDateRange ? 'bg-violet-500/20 text-violet-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                نطاق تاريخ
              </button>
            </div>
          )}

          {!useDateRange && hasFilter('monthKey') && (
            <div className="min-w-40">
              <label className="block text-[11px] text-slate-400 mb-1">الشهر</label>
              <Select value={monthKey} onValueChange={setMonthKey}>
                <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {useDateRange && hasFilter('fromDate') && (
            <>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">من تاريخ</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9 w-40 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">إلى تاريخ</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9 w-40 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
              </div>
            </>
          )}

          {hasFilter('employeeId') && (
            <div className="min-w-56 flex-1 max-w-xs">
              <label className="block text-[11px] text-slate-400 mb-1">الموظف</label>
              <EmployeeSearchInput
                employees={(employees ?? []) as never}
                value={employeeId}
                onChange={(id) => setEmployeeId(id)}
                placeholder="كل الموظفين"
                variant="filter"
                showAllOption
                allOptionValue=""
                allOptionLabel="كل الموظفين"
                allowClear
              />
            </div>
          )}

          {hasFilter('department') && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">القسم</label>
              <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="كل الأقسام" className="h-9 w-36 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
            </div>
          )}

          {hasFilter('category') && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">نوع الخصم</label>
              <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="الكل" className="h-9 w-36 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="text-slate-400"
            onClick={() => {
              setMonthKey(currentMonth);
              setFromDate('');
              setToDate('');
              setUseDateRange(false);
              setEmployeeId('');
              setDepartment('');
              setCategory('');
            }}
          >
            <RotateCcw className="size-4" />
            تصفير
          </Button>
        </div>
      </div>

      {/* ═══ Body ═══ */}
      {run.isLoading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl bg-slate-800/40" />)}
          </div>
          <Skeleton className="h-72 w-full rounded-2xl bg-slate-800/40" />
        </div>
      ) : run.isError ? (
        <ReportEmptyState label="تعذر تحميل التقرير — حاول مرة أخرى" />
      ) : !response || !response.hasData ? (
        <ReportEmptyState />
      ) : (
        <div className="space-y-4">
          <ReportSummaryCards metrics={definition.availableMetrics} summary={response.summary} />
          <div className="text-[11px] text-slate-500 print:text-slate-600">
            الفترة: {response.meta.period} · عدد الصفوف: {response.rows.length} · تاريخ الإنشاء: {new Date(response.meta.generatedAt).toLocaleString('ar-EG')}
          </div>
          <ReportTable columns={definition.visibleColumns} rows={response.rows} renderCell={renderCell} />
        </div>
      )}

      {/* Download affordance for screen readers when export hidden */}
      {response?.hasData && !canExport && definition.exportFormats.includes('excel') && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500 print:hidden">
          <Download className="size-3" />
          تصدير Excel يتطلب صلاحية تصدير التقارير
        </div>
      )}
    </div>
  );
}
