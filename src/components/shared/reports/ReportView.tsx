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
import { BarChart3, ChevronDown, ChevronLeft, Download, FileSpreadsheet, Loader2, Printer, RotateCcw, Search } from 'lucide-react';
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
import { usePageState } from '@/hooks/use-page-state';
import { useReportDefinition, useReportFilterOptions, useReportRun } from '@/hooks/use-report-queries';
import type { ReportColumnSpec, ReportRunRequest } from '@/lib/reports/types';
import { openPrintReport } from '@/components/print/print-report-store';
import { tableToPrintModel } from '@/components/print/print-adapters';

type Row = Record<string, unknown>;

/** Sentinel "all" value for Select-based filters (Radix rejects ''). */
const ALL_VALUE = '__all__';

export interface ReportViewProps {
  reportId: string;
  /**
   * §24 — deterministic-analytics honesty: when the filtered dataset
   * is smaller than this row count, an explicit "insufficient data"
   * notice renders above the table instead of implying significance.
   */
  insufficientBelow?: number;
  /** Custom cell renderer per column key (badges, links, coloring). */
  renderCell?: (column: ReportColumnSpec, row: Row) => React.ReactNode;
  /**
   * §11 — OPT-IN hierarchical rows: when set, each data row gains a
   * chevron column and can expand to the rendered detail beneath it.
   * Reports that do not pass it render exactly as before.
   */
  renderExpanded?: (row: Row) => React.ReactNode;
  /**
   * §EXPANSION-UX — column keys whose WHOLE cell toggles the row's
   * expansion (e.g. the "تفاصيل الخصومات / اضغط للتوسيع" cell), so
   * the hint text and the chevron behave identically.
   */
  expandTriggerColumns?: ReadonlyArray<string>;
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
  columns, rows, renderCell, renderExpanded, expandTriggerColumns,
}: {
  columns: ReadonlyArray<ReportColumnSpec>;
  rows: Row[];
  renderCell?: (column: ReportColumnSpec, row: Row) => React.ReactNode;
  renderExpanded?: (row: Row) => React.ReactNode;
  expandTriggerColumns?: ReadonlyArray<string>;
}) {
  // §11 expansion state — row id → expanded (page-local, not persisted).
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const isTriggerColumn = (key: string) => !!renderExpanded && !!expandTriggerColumns?.includes(key);

  return (
    <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 overflow-hidden print:border-slate-300">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-700/50 hover:bg-transparent">
              {renderExpanded && <TableHead className="w-8" />}
              {columns.map((col) => (
                <TableHead key={col.key} className="text-slate-300 text-xs whitespace-nowrap text-right">
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const rowId = String(row.id ?? row.employeeId ?? i);
              const isExpanded = expandedIds.has(rowId);
              return (
                <React.Fragment key={rowId}>
                  <TableRow className="border-slate-800/60">
                    {renderExpanded && (
                      <TableCell className="w-8">
                        <button
                          type="button"
                          onClick={() => toggleRow(rowId)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'طي التفاصيل' : 'توسيع التفاصيل'}
                          className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-700/40 transition-colors"
                        >
                          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronLeft className="size-4" />}
                        </button>
                      </TableCell>
                    )}
                    {columns.map((col) => (
                      <TableCell
                        key={col.key}
                        onClick={isTriggerColumn(col.key) ? () => toggleRow(rowId) : undefined}
                        className={`text-slate-200 text-xs text-right ${isTriggerColumn(col.key) ? 'cursor-pointer select-none' : ''} ${typeof row[col.key] === 'string' && (row[col.key] as string).includes('\n') ? 'whitespace-pre-line leading-relaxed align-top' : 'whitespace-nowrap'}`}
                        {...(isTriggerColumn(col.key) ? { 'aria-expanded': isExpanded } : {})}
                      >
                        {renderCell
                          ? (renderCell(col, row) ?? formatCell(row[col.key]))
                          : formatCell(row[col.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                  {renderExpanded && isExpanded && (
                    <TableRow className="border-slate-800/60 hover:bg-transparent">
                      <TableCell colSpan={columns.length + 1} className="bg-slate-950/40 px-4 py-3">
                        {renderExpanded(row)}
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })}
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

export function ReportView({ reportId, renderCell, renderExpanded, expandTriggerColumns, insufficientBelow }: ReportViewProps) {
  const { definition, isLoading: defLoading } = useReportDefinition(reportId);
  const { data: employees } = useEmployees();
  const { data: filterOptions } = useReportFilterOptions();

  const months = useMemo(() => generateMonthOptions('YYYY-MM'), []);
  const currentMonth = months[0];

  // ── Filter state — PERSISTED per user (§PAGE-STATE) ──
  // Every declared filter lives in ONE persisted object:
  //   • survives navigation (restored on mount, user-scoped),
  //   • "تصفير" resets to the page default AND clears the stored
  //     record — cleared values can never resurrect.
  // Keys not declared by the definition are simply ignored by the
  // request builder (hasFilter guards the controls AND the payload).
  const [filters, setFilters, resetFilters] = usePageState<{
    monthKey: string;
    fromDate: string;
    toDate: string;
    useDateRange: boolean;
    employeeId: string;
    department: string;
    team: string;
    search: string;
    category: string;
    archived: string;
  }>({
    page: reportId,
    slot: 'filters',
    version: 1,
    initial: () => ({
      monthKey: currentMonth,
      fromDate: '',
      toDate: '',
      useDateRange: false,
      employeeId: '',
      department: '',
      team: '',
      search: '',
      category: '',
      archived: 'active',
    }),
  });

  const setFilter = <K extends keyof typeof filters>(key: K, value: (typeof filters)[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  // Transient export state — never persisted (§8 transient UI state).
  const [exporting, setExporting] = useState(false);

  const hasFilter = (key: string) => !!definition?.allowedFilters.some((f) => f.key === key);

  const request = useMemo<ReportRunRequest | null>(() => {
    if (!definition) return null;
    const base: ReportRunRequest = { reportId: definition.reportId };
    if (filters.useDateRange && hasFilter('fromDate') && filters.fromDate && filters.toDate) {
      base.fromDate = filters.fromDate;
      base.toDate = filters.toDate;
    } else if (hasFilter('monthKey') && filters.monthKey) {
      base.monthKey = filters.monthKey;
    }
    if (filters.employeeId) base.employeeId = filters.employeeId;
    if (filters.department.trim() && hasFilter('department')) base.department = filters.department.trim();
    if (filters.team.trim() && hasFilter('team')) base.team = filters.team.trim();
    if (filters.search.trim() && hasFilter('search')) base.search = filters.search.trim();
    const extra: Record<string, string> = {};
    if (filters.category.trim() && hasFilter('category')) extra.category = filters.category.trim();
    if (filters.archived && hasFilter('archived')) extra.archived = filters.archived;
    if (Object.keys(extra).length > 0) base.filters = extra;
    return base;
  }, [definition, filters]);

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

  // §PRINT — push the CURRENT result set into the shared clean A4
  // report document (no live-UI printing, no navigation chrome).
  const handlePrint = () => {
    if (!definition || !response?.rows) return;
    const columns = definition.visibleColumns;
    openPrintReport(tableToPrintModel({
      title: definition.name,
      subject: definition.description,
      period: response.meta?.period,
      columns: columns.map((c) => c.label),
      rows: (response.rows as Row[]).map((row) =>
        columns.map((c) => {
          const v = row[c.key];
          return v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('ar-EG') : String(v);
        }),
      ),
      ltrColumns: columns.map((c, i) => (c.width ? i : -1)).filter((i) => i >= 0),
    }));
  };

  if (defLoading) {
    return (
      <div className="space-y-4">
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
    <div className="space-y-5">
      {/* ═══ Header ═══ */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-center gap-3">
          <div className="size-11 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center">
            <BarChart3 className="size-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100">{definition.name}</h1>
            <p className="text-xs text-slate-400 mt-0.5 max-w-xl">{definition.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {response && (
            <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-brand-300 text-[11px]">
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
            <Button size="sm" variant="secondary" onClick={handlePrint}>
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
                onClick={() => setFilter('useDateRange', false)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${!filters.useDateRange ? 'bg-brand-500/20 text-brand-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                حسب الشهر
              </button>
              <button
                type="button"
                onClick={() => setFilter('useDateRange', true)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${filters.useDateRange ? 'bg-brand-500/20 text-brand-300' : 'text-slate-400 hover:text-slate-200'}`}
              >
                نطاق تاريخ
              </button>
            </div>
          )}

          {!filters.useDateRange && hasFilter('monthKey') && (
            <div className="min-w-40">
              <label className="block text-[11px] text-slate-400 mb-1">الشهر</label>
              <Select value={filters.monthKey} onValueChange={(v) => setFilter('monthKey', v)}>
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

          {filters.useDateRange && hasFilter('fromDate') && (
            <>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">من تاريخ</label>
                <Input type="date" value={filters.fromDate} onChange={(e) => setFilter('fromDate', e.target.value)} className="h-9 w-40 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
              </div>
              <div>
                <label className="block text-[11px] text-slate-400 mb-1">إلى تاريخ</label>
                <Input type="date" value={filters.toDate} onChange={(e) => setFilter('toDate', e.target.value)} className="h-9 w-40 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
              </div>
            </>
          )}

          {hasFilter('employeeId') && (
            <div className="min-w-56 flex-1 max-w-xs">
              <label className="block text-[11px] text-slate-400 mb-1">الموظف</label>
              <EmployeeSearchInput
                employees={(employees ?? []) as never}
                value={filters.employeeId}
                onChange={(id) => setFilter('employeeId', id)}
                placeholder="كل الموظفين"
                variant="filter"
                showAllOption
                allOptionValue=""
                allOptionLabel="كل الموظفين"
                allowClear
              />
            </div>
          )}

          {hasFilter('search') && (
            <div className="min-w-44">
              <label className="block text-[11px] text-slate-400 mb-1">بحث باسم الموظف</label>
              <div className="relative">
                <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
                <Input
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                  placeholder="اسم أو رقم الموظف"
                  className="h-9 w-44 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs pr-8"
                />
              </div>
            </div>
          )}

          {hasFilter('department') && (
            <div className="min-w-40">
              <label className="block text-[11px] text-slate-400 mb-1">القسم</label>
              <Select
                value={filters.department || ALL_VALUE}
                onValueChange={(v) => setFilter('department', v === ALL_VALUE ? '' : v)}
              >
                <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                  <SelectValue placeholder="كل الأقسام" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>كل الأقسام</SelectItem>
                  {(filterOptions?.departments ?? []).map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {hasFilter('team') && (
            <div className="min-w-40">
              <label className="block text-[11px] text-slate-400 mb-1">الفريق</label>
              <Select
                value={filters.team || ALL_VALUE}
                onValueChange={(v) => setFilter('team', v === ALL_VALUE ? '' : v)}
              >
                <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                  <SelectValue placeholder="كل الفرق" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE}>كل الفرق</SelectItem>
                  {(filterOptions?.teams ?? []).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {hasFilter('archived') && (
            <div className="min-w-36">
              <label className="block text-[11px] text-slate-400 mb-1">حالة الخصم</label>
              <Select value={filters.archived} onValueChange={(v) => setFilter('archived', v)}>
                <SelectTrigger className="h-9 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">الخصومات النشطة</SelectItem>
                  <SelectItem value="archived">الخصومات المؤرشفة</SelectItem>
                  <SelectItem value="all">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {hasFilter('category') && (
            <div>
              <label className="block text-[11px] text-slate-400 mb-1">نوع الخصم</label>
              <Input value={filters.category} onChange={(e) => setFilter('category', e.target.value)} placeholder="الكل" className="h-9 w-36 bg-slate-950/40 border-slate-700/60 text-slate-200 text-xs" />
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="text-slate-400"
            onClick={resetFilters}
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
          {typeof insufficientBelow === 'number'
            && (response.summary.totalCount ?? response.rows.length) < insufficientBelow
            && (response.summary.totalCount ?? response.rows.length) > 0
            && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                بيانات غير كافية للتحليل — الأرقام المعروضة مازالت مستدلة من السجلات الفعلية ولكنها لا تكفي لاستنتاج أنماط.
              </div>
            )}
          <div className="text-[11px] text-slate-500 print:text-slate-600">
            الفترة: {response.meta.period} · عدد الصفوف: {response.rows.length} · تاريخ الإنشاء: {new Date(response.meta.generatedAt).toLocaleString('ar-EG')}
          </div>
          <ReportTable columns={definition.visibleColumns} rows={response.rows} renderCell={renderCell} renderExpanded={renderExpanded} expandTriggerColumns={expandTriggerColumns} />
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
