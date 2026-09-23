'use client';

// ══════════════════════════════════════════════════════════════
//  HR Monthly Employee Performance Report tab (audience-aware)
//
//  The first audience-specific report surface: HR receives each
//  employee's final performance result + organizational context.
//  The server (/api/reports/hr-performance) resolves the caller's
//  audience + scope and projects the CANONICAL monthly KPI report;
//  the response structurally contains NO technical evidence fields
//  (no observation text/counts, no deduction/bonus detail, no
//  component math) — this tab renders exactly what the server sent.
//
//  KPI TRUTH RULES: scores/statuses render verbatim (PENDING /
//  INCOMPLETE / NOT_ELIGIBLE / NO_SCHEME stay distinct; missing
//  results render '—', never 0).
//
//  Print flows through the EXISTING print infrastructure
//  (openPrintReport + the pure hrPerformanceToPrintModel adapter) —
//  printing this sanitized view can never leak technical detail.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Printer, ShieldCheck } from 'lucide-react';import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useHrPerformanceReport } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatInteger } from '@/lib/i18n/format';
import type { HrPerformanceReport } from '@/lib/report-audience';
import {
  StatusBadge,
  ValueBasisBadge,
  formatScore,
} from './kpi-reports-shared';
import { hrPerformanceToPrintModel } from '@/components/print/print-adapters';
import { openPrintReport } from '@/components/print/print-report-store';
import HrDecisionView from './HrDecisionView';

const STATUS_OPTIONS = [
  'AVAILABLE', 'PENDING', 'INCOMPLETE', 'ZERO', 'FINALIZED',
  'NO_SCHEME', 'AMBIGUOUS', 'OVERRIDE_NOT_RESOLVABLE',
] as const;

// Locale-aware employment-status labels (enum-code map: [ar, en]).
const EMPLOYMENT_LABELS: Record<string, [string, string]> = {
  active: ['نشط', 'Active'],
  inactive: ['غير نشط', 'Inactive'],
  archived: ['مؤرشف', 'Archived'],
  unknown: ['—', '—'],
};

const TOTAL_LABELS_AR: Array<{ key: keyof HrPerformanceReport['totals']; label: string }> = [
  { key: 'employees', label: 'الموظفون' },
  { key: 'withResult', label: 'بنتيجة أداء' },
  { key: 'pending', label: 'معلّق' },
  { key: 'incomplete', label: 'غير مكتمل' },
  { key: 'finalized', label: 'مجمّد' },
  { key: 'noScheme', label: 'بلا خطة' },
];

export default function HrPerformanceReportTab({ month }: { month: string }) {
  // Sub-view toggle: the sanitized RESULT table (original HR view)
  // or the richer DECISION-SUPPORT projection. Local state — a view
  // preference, not a filter; the persisted slot keeps only filters.
  const [view, setView] = useState<'result' | 'decision'>('result');
  const { locale } = useLanguage();
  // Phase 6.3: filter context persists per user (same convention as
  // the technical table tab — slot-scoped to this audience view).
  const [filters, setFilters] = usePageState<{
    search: string;
    department: string;
    team: string;
    status: string;
  }>({
    page: 'kpiReports',
    slot: 'hr-performance',
    version: 1,
    initial: () => ({ search: '', department: 'all', team: 'all', status: 'all' }),
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { search?: unknown }).search === 'string'
        ? raw
        : null,
  });

  const query = useHrPerformanceReport(month, {
    employeeQuery: filters.search.trim() || undefined,
    department: filters.department !== 'all' ? filters.department : undefined,
    team: filters.team !== 'all' ? filters.team : undefined,
    status: filters.status !== 'all' ? filters.status : undefined,
  });
  const report = query.data as HrPerformanceReport | undefined;

  // Filter option lists derive from the AUTHORIZED response rows —
  // the server already narrowed scope; the client can never widen it.
  const departments = useMemo(
    () => [...new Set((report?.rows ?? []).map((r) => r.department).filter((d): d is string => !!d))].sort((a, b) => a.localeCompare(b, 'ar')),
    [report?.rows],
  );
  const teams = useMemo(
    () => [...new Set((report?.rows ?? []).map((r) => r.team).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'ar')),
    [report?.rows],
  );

  const openPrint = () => {
    if (report) openPrintReport(hrPerformanceToPrintModel(report));
  };

  return (
    <div className="space-y-3">
      {/* Audience banner — the server-enforced contract, stated up-front */}
      <div className="no-print flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
        <ShieldCheck className="size-4 text-emerald-400 shrink-0" />
        <p className="text-[11px] text-slate-300">
          <T>تقرير الموارد البشرية — نتيجة الأداء النهائية والسياق التنظيمي فقط.</T>
          <span className="text-slate-500"> <T>التفاصيل الفنية (الأدلة، الخصومات، الملاحظات) لا تُرسل من الخادم لهذا التقرير أساسا.</T></span>
        </p>
      </div>

      {/* Shared row: sub-view toggle + search (applies to both views) */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <div className="flex rounded-lg border border-slate-700/60 overflow-hidden">
          <button
            type="button"
            onClick={() => setView('result')}
            className={`px-3 h-9 text-xs transition-colors ${view === 'result' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'}`}
          >
            <T>نتيجة الأداء</T>
          </button>
          <button
            type="button"
            onClick={() => setView('decision')}
            className={`px-3 h-9 text-xs border-r border-slate-700/60 transition-colors ${view === 'decision' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800'}`}
          >
            <T>قرار دعم</T>
          </button>
        </div>
        <Input
          value={filters.search}
          onChange={(e) => setFilters((s) => ({ ...s, search: e.target.value }))}
          placeholder={translateUIText('بحث بالاسم أو الكود...', locale)}
          className="h-9 w-56 bg-slate-900/60 border-slate-700/60"
        />
      </div>

      {view === 'decision' ? (
        <HrDecisionView
          month={month}
          filters={{
            search: filters.search,
            department: filters.department,
            team: filters.team,
            onDepartmentChange: (v) => setFilters((s) => ({ ...s, department: v })),
            onTeamChange: (v) => setFilters((s) => ({ ...s, team: v })),
          }}
        />
      ) : (
        <>
      {/* Filters (same design language as the technical table) */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <Select value={filters.department} onValueChange={(v) => setFilters((s) => ({ ...s, department: v }))}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('القسم', locale)} /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all"><T>كل الأقسام</T></SelectItem>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.team} onValueChange={(v) => setFilters((s) => ({ ...s, team: v }))}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('الفريق', locale)} /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all"><T>كل الفرق</T></SelectItem>
            {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((s) => ({ ...s, status: v }))}>
          <SelectTrigger className="h-9 w-40 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('حالة النتيجة', locale)} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><T>كل الحالات</T></SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9 border-slate-700/60 text-slate-300 hover:bg-slate-800 gap-1.5" onClick={openPrint} disabled={!report}>
          <Printer className="size-3.5" /> <T>طباعة</T>
        </Button>
      </div>

      {/* Period basis banner */}
      {report && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <ValueBasisBadge basis={report.valueBasis} />
          <span><T>{report.finalized ? 'شهر مغلق — نتائج مجمّدة' : 'شهر مفتوح — نتائج حية'}</T></span>
        </div>
      )}

      {/* Totals (counts only) */}
      {report && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {TOTAL_LABELS_AR.map(({ key, label }) => (
            <Card key={key} className="border-slate-700/40 bg-slate-800/30">
              <CardContent className="px-3 py-2.5">
                <p className="text-[10px] text-slate-500"><T>{label}</T></p>
                <p className="text-lg font-bold text-slate-100 tabular-nums">{formatInteger(report.totals[key], locale)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Table */}
      {query.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 rounded-lg bg-slate-800/60" />)}
        </div>
      ) : !report || report.rows.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="py-10 text-center text-sm text-slate-400">
            <T>لا توجد صفوف لعرضها — تحقق من الفلاتر أو الفترة المحددة</T>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-700/40 bg-slate-800/30 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/60 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-xs"><T>الموظف</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden md:table-cell"><T>القسم</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden md:table-cell"><T>الفريق</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell"><T>الوظيفة</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden xl:table-cell"><T>حالة العمل</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell"><T>خطة الأداء</T></TableHead>
                  <TableHead className="text-slate-400 text-xs"><T>نتيجة الأداء</T></TableHead>
                  <TableHead className="text-slate-400 text-xs"><T>الحالة</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <TableRow key={row.employeeId} className="border-slate-700/40 hover:bg-slate-800/50">
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-slate-100 truncate max-w-[180px]" title={row.employeeName}>{row.employeeName}</span>
                        {row.employeeCode && <span className="text-[10px] font-mono text-slate-500" dir="ltr">{row.employeeCode}</span>}
                        {row.archivedButEligible && (
                          <span className="text-[9px] rounded border border-slate-600 text-slate-400 px-1"><T>مؤرشف</T></span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.department || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.team || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden lg:table-cell">{row.position || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden xl:table-cell">{EMPLOYMENT_LABELS[row.employmentStatus]?.[locale === 'en' ? 1 : 0] ?? '—'}</TableCell>
                    <TableCell className="text-slate-400 text-xs hidden lg:table-cell truncate max-w-[160px]" title={row.schemeName ?? undefined}>{row.schemeName || '—'}</TableCell>
                    {/* KPI TRUTH: verbatim canonical result — missing = '—', never 0 */}
                    <TableCell className="text-slate-100 text-sm font-semibold tabular-nums">
                      {formatScore(row.performanceScore)}
                    </TableCell>
                    <TableCell><StatusBadge status={row.performanceStatus} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
        </>
      )}
    </div>
  );
}
