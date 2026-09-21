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

import { useMemo } from 'react';
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
import type { HrPerformanceReport } from '@/lib/report-audience';
import {
  StatusBadge,
  ValueBasisBadge,
  formatScore,
} from './kpi-reports-shared';
import { hrPerformanceToPrintModel } from '@/components/print/print-adapters';
import { openPrintReport } from '@/components/print/print-report-store';

const STATUS_OPTIONS = [
  'AVAILABLE', 'PENDING', 'INCOMPLETE', 'ZERO', 'FINALIZED',
  'NO_SCHEME', 'AMBIGUOUS', 'OVERRIDE_NOT_RESOLVABLE',
] as const;

const EMPLOYMENT_LABELS_AR: Record<string, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
  unknown: '—',
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
          تقرير الموارد البشرية — نتيجة الأداء النهائية والسياق التنظيمي فقط.
          <span className="text-slate-500"> التفاصيل الفنية (الأدلة، الخصومات، الملاحظات) لا تُرسل من الخادم لهذا التقرير أساساً.</span>
        </p>
      </div>

      {/* Filters (same design language as the technical table) */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <Input
          value={filters.search}
          onChange={(e) => setFilters((s) => ({ ...s, search: e.target.value }))}
          placeholder="بحث بالاسم أو الكود..."
          className="h-9 w-56 bg-slate-900/60 border-slate-700/60"
        />
        <Select value={filters.department} onValueChange={(v) => setFilters((s) => ({ ...s, department: v }))}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder="القسم" /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all">كل الأقسام</SelectItem>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.team} onValueChange={(v) => setFilters((s) => ({ ...s, team: v }))}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder="الفريق" /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all">كل الفرق</SelectItem>
            {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => setFilters((s) => ({ ...s, status: v }))}>
          <SelectTrigger className="h-9 w-40 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder="حالة النتيجة" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-9 border-slate-700/60 text-slate-300 hover:bg-slate-800 gap-1.5" onClick={openPrint} disabled={!report}>
          <Printer className="size-3.5" /> طباعة
        </Button>
      </div>

      {/* Period basis banner */}
      {report && (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <ValueBasisBadge basis={report.valueBasis} />
          <span>{report.finalized ? 'شهر مغلق — نتائج مجمّدة' : 'شهر مفتوح — نتائج حية'}</span>
        </div>
      )}

      {/* Totals (counts only) */}
      {report && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {TOTAL_LABELS_AR.map(({ key, label }) => (
            <Card key={key} className="border-slate-700/40 bg-slate-800/30">
              <CardContent className="px-3 py-2.5">
                <p className="text-[10px] text-slate-500">{label}</p>
                <p className="text-lg font-bold text-slate-100 tabular-nums">{report.totals[key]}</p>
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
            لا توجد صفوف لعرضها — تحقق من الفلاتر أو الفترة المحددة
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-700/40 bg-slate-800/30 overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/60 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-xs">الموظف</TableHead>
                  <TableHead className="text-slate-400 text-xs hidden md:table-cell">القسم</TableHead>
                  <TableHead className="text-slate-400 text-xs hidden md:table-cell">الفريق</TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell">الوظيفة</TableHead>
                  <TableHead className="text-slate-400 text-xs hidden xl:table-cell">حالة العمل</TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell">خطة الأداء</TableHead>
                  <TableHead className="text-slate-400 text-xs">نتيجة الأداء</TableHead>
                  <TableHead className="text-slate-400 text-xs">الحالة</TableHead>
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
                          <span className="text-[9px] rounded border border-slate-600 text-slate-400 px-1">مؤرشف</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.department || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.team || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden lg:table-cell">{row.position || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden xl:table-cell">{EMPLOYMENT_LABELS_AR[row.employmentStatus] ?? '—'}</TableCell>
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
    </div>
  );
}
