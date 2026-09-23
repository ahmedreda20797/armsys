'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports — Monthly / MTD / Historical table tab (Phase 2)
//
//  ONE table component over the THREE logically separated reports
//  (spec §3 keeps the reports separate; the presentation shares the
//  row shape). Columns per spec §6; sorting + filtering per §19/§20;
//  basis banners per §7/§8/§9; Excel export per §22 through the
//  registered unified reports (same verified rows).
//
//  §10: archived employees are EXCLUDED by default — the switch
//  below opts back in and rows stay visibly labelled (🔒 + chip).
//  §17: each row's ⋮ opens the universal PeriodComparisonDialog.
//  §10: the master employee report (one row per employee, deduction
//  reasons included) exports through the registered kpi-master-employee.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDownUp, ChevronDown, ChevronUp, FileSpreadsheet, Lock, AlertTriangle, Info,
  MoreVertical, ArrowLeftRight, User as UserIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import type { OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { PeriodComparisonDialog } from '@/components/shared/comparison/PeriodComparisonDialog';
import { useAppStore } from '@/lib/store';
import { useKpiReportTable } from '@/hooks/use-kpi-queries';
import { usePageState } from '@/hooks/use-page-state';
import type { KpiReportTableParams } from '@/hooks/use-kpi-queries';
import type { KpiMonthlyReport } from '@/lib/kpi-reporting';
import {
  StatusBadge,
  ValueBasisBadge,
  downloadKpiReportExcel,
  formatContribution,
  formatScore,
} from './kpi-reports-shared';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatDate, formatNumber, formatInteger } from '@/lib/i18n/format';

export type TableTabKind = 'monthly' | 'mtd' | 'historical';

const REPORT_IDS: Record<TableTabKind, 'kpi-monthly' | 'kpi-mtd' | 'kpi-historical'> = {
  monthly: 'kpi-monthly',
  mtd: 'kpi-mtd',
  historical: 'kpi-historical',
};

interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export default function KpiMonthlyTableTab({
  kind,
  month,
}: {
  kind: TableTabKind;
  month: string;
}) {
  // Phase 6.3 (§8/§38): the full filter/sort context persists per user;
  // defaults are all-rows (documented table default).
  const [tableView, setTableView] = usePageState<{
    search: string;
    department: string;
    team: string;
    status: string;
    minScore: string;
    maxScore: string;
    includeArchived: boolean;
    sort: SortState;
  }>({
    page: 'kpiReports',
    slot: `table-${kind}`,
    version: 1,
    initial: () => ({
      search: '',
      department: 'all',
      team: 'all',
      status: 'all',
      minScore: '',
      maxScore: '',
      includeArchived: false,
      sort: { key: 'employeeName', dir: 'asc' },
    }),
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { status?: unknown }).status === 'string'
        ? raw
        : null,
  });
  const search = tableView.search;
  const setSearch = (v: string) => setTableView((s) => ({ ...s, search: v }));
  const department = tableView.department;
  const setDepartment = (v: string) => setTableView((s) => ({ ...s, department: v }));
  const team = tableView.team;
  const setTeam = (v: string) => setTableView((s) => ({ ...s, team: v }));
  const status = tableView.status;
  const setStatus = (v: string) => setTableView((s) => ({ ...s, status: v }));
  const minScore = tableView.minScore;
  const setMinScore = (v: string) => setTableView((s) => ({ ...s, minScore: v }));
  const maxScore = tableView.maxScore;
  const setMaxScore = (v: string) => setTableView((s) => ({ ...s, maxScore: v }));
  // §10 — archived employees: excluded by default, opt-in via switch.
  const includeArchived = tableView.includeArchived ?? false;
  const setIncludeArchived = (v: boolean) => setTableView((s) => ({ ...s, includeArchived: v }));
  const sort = tableView.sort;
  const setSort = (v: SortState) => setTableView((s) => ({ ...s, sort: v }));
  const toggleSort = (key: string) => {
    setSort(
      sort.key === key
        ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  const params: KpiReportTableParams = useMemo(
    () => ({
      employeeQuery: search || undefined,
      department: department === 'all' ? undefined : department,
      team: team === 'all' ? undefined : team,
      status: status === 'all' ? undefined : status,
      minScore: minScore || undefined,
      maxScore: maxScore || undefined,
      includeArchived,
      sortBy: sort.key,
      sortDir: sort.dir,
    }),
    [search, department, team, status, minScore, maxScore, includeArchived, sort],
  );

  const query = useKpiReportTable(kind, month, params);
  const report = query.data as KpiMonthlyReport | undefined;
  const { locale } = useLanguage();

  // §17 comparison dialog state (one dialog, opened from row ⋮)
  const [comparison, setComparison] = useState<{ id: string; name: string } | null>(null);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const [exportingMaster, setExportingMaster] = useState(false);

  const handleExportMaster = async () => {
    setExportingMaster(true);
    try {
      await downloadKpiReportExcel(
        'kpi-master-employee',
        {
          monthKey: month,
          employeeScope: 'all',
          filters: includeArchived ? { includeArchived: 'true' } : undefined,
        },
        `kpi_master_employee_${month}.xlsx`,
      );
      toast.success(translateUIText('تم تصدير التقرير الشامل لكل الموظفين', locale));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translateUIText('فشل التصدير', locale));
    } finally {
      setExportingMaster(false);
    }
  };

  const rowMenu = (row: { employeeId: string; employeeName: string }): OverflowMenuItem[] => [
    {
      key: 'comparison',
      label: translateUIText('مقارنة الأداء', locale),
      icon: <ArrowLeftRight className="size-3.5" />,
      onSelect: () => setComparison({ id: row.employeeId, name: row.employeeName }),
    },
    {
      key: 'e360',
      label: translateUIText('فتح ملف الموظف', locale),
      icon: <UserIcon className="size-3.5" />,
      onSelect: () => openEmployee360(row.employeeId),
    },
  ];

  // Filter option lists derive from the loaded (scope-authorized) rows.
  const departments = useMemo(
    () => uniqueSorted((report?.rows ?? []).map((r) => r.department)),
    [report],
  );
  const teams = useMemo(
    () => uniqueSorted((report?.rows ?? []).map((r) => r.team)),
    [report],
  );

  const handleExport = async () => {
    try {
      await downloadKpiReportExcel(
        REPORT_IDS[kind],
        { monthKey: month, employeeScope: 'all' },
        `${REPORT_IDS[kind]}_${month}.xlsx`,
      );
      toast.success(translateUIText('تم تصدير التقرير Excel بنجاح', locale));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : translateUIText('فشل التصدير', locale));
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Basis banner (§7/§8/§9) ── */}
      {report && <BasisBanner report={report} kind={kind} />}

      {/* ── Filters (never printed) ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-end">
          <div className="space-y-1.5 col-span-2 md:col-span-1">
            <Label className="text-xs"><T>بحث بالموظف</T></Label>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={translateUIText('اسم / رقم / معرّف...', locale)}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs"><T>القسم</T></Label>
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><T>كل الأقسام</T></SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d} value={d}>{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs"><T>الفريق</T></Label>
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><T>كل الفرق</T></SelectItem>
                {teams.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs"><T>الحالة</T></Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all"><T>كل الحالات</T></SelectItem>
                {['AVAILABLE', 'PENDING', 'INCOMPLETE', 'ZERO', 'FINALIZED', 'NO_SCHEME'].map((s) => (
                  <SelectItem key={s} value={s} className="font-mono text-xs">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs"><T>نطاق الدرجة</T></Label>
            <div className="flex gap-1.5">
              <Input
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                placeholder={translateUIText('من', locale)}
                inputMode="numeric"
                className="h-9"
              />
              <Input
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                placeholder={translateUIText('إلى', locale)}
                inputMode="numeric"
                className="h-9"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end flex-wrap">
            <div className="flex items-center gap-1.5">
              <Switch
                checked={includeArchived}
                onCheckedChange={setIncludeArchived}
                aria-label={translateUIText('تضمين الموظفين المؤرشفين', locale)}
              />
              <Label className="text-xs text-slate-400 whitespace-nowrap"><T>تضمين المؤرشفين</T></Label>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void handleExportMaster()} disabled={query.isLoading || exportingMaster}>
              {exportingMaster ? <Skeleton className="size-4 rounded-full" /> : <FileSpreadsheet className="h-4 w-4" />}
              <T>التقرير الشامل</T>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport} disabled={query.isLoading}>
              <FileSpreadsheet className="h-4 w-4" />
              <T>تصدير Excel</T>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Totals chips ── */}
      {report && (
        <div className="no-print flex flex-wrap gap-2 text-[11px]">
          <Badge variant="outline" className="border-slate-600/50 text-slate-300">
            <T>مؤهلون: </T>{formatInteger(report.totals.eligibleCount, locale)}
          </Badge>
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
            <T>متاح: </T>{formatInteger(report.totals.available, locale)}
          </Badge>
          <Badge variant="outline" className="border-amber-500/40 text-amber-300">
            <T>غير مكتمل: </T>{formatInteger(report.totals.incomplete, locale)}
          </Badge>
          <Badge variant="outline" className="border-slate-500/40 text-slate-300">
            <T>معلّق: </T>{formatInteger(report.totals.pending, locale)}
          </Badge>
          <Badge variant="outline" className="border-red-500/40 text-red-300">
            <T>صفر: </T>{formatInteger(report.totals.zero, locale)}
          </Badge>
          <Badge variant="outline" className="border-sky-500/40 text-sky-300">
            <T>مجمّد: </T>{formatInteger(report.totals.finalized, locale)}
          </Badge>
          {report.totals.notEligibleCount > 0 && (
            <Badge variant="outline" className="border-slate-600/40 text-slate-500">
              <T>مستبعدون (غير موظفين بالفترة): </T>{formatInteger(report.totals.notEligibleCount, locale)}
            </Badge>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {query.isLoading && <Skeleton className="h-72 w-full rounded-2xl bg-slate-800/40" />}

      {query.isError && (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-red-300 text-sm"><T>تعذر تحميل التقرير — أعد المحاولة.</T></CardContent>
        </Card>
      )}

      {report && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/40">
                  <SortableHead label="الموظف" sortKey="employeeName" sort={sort} onToggle={toggleSort} />
                  <SortableHead label="القسم" sortKey="department" sort={sort} onToggle={toggleSort} />
                  <SortableHead label="الفريق" sortKey="team" sort={sort} onToggle={toggleSort} />
                  <SortableHead label="درجة الجودة (خام)" sortKey="score" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right"><T>الوزن</T></TableHead>
                  <TableHead className="text-right"><T>المساهمة</T></TableHead>
                  <TableHead className="text-right"><T>حالة الجودة</T></TableHead>
                  <SortableHead label="حالة KPI" sortKey="status" sort={sort} onToggle={toggleSort} />
                  <TableHead className="text-right"><T>الأساس</T></TableHead>
                  <TableHead className="text-right"><T>المخطط</T></TableHead>
                  <TableHead className="text-right w-10"><span className="sr-only"><T>إجراءات</T></span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-slate-500 py-8">
                      <T>لا توجد بيانات مطابقة</T>
                    </TableCell>
                  </TableRow>
                )}
                {report.rows.map((row) => (
                  <TableRow key={row.employeeId} className="border-slate-700/40">
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-slate-100 flex items-center gap-1.5">
                          {row.employeeName}
                          {row.archivedButEligible && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0 rounded-full bg-orange-500/10 border border-orange-500/25 text-orange-400 text-[9px] font-bold" title={translateUIText('مؤرشف — أهلية تاريخية', locale)}>
                              <Lock className="h-2.5 w-2.5" /> <T>مؤرشف</T>
                            </span>
                          )}
                        </span>
                        {row.employeeCode && (
                          <span className="text-[10px] text-slate-500 font-mono">{row.employeeCode}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300">{row.department ?? '—'}</TableCell>
                    <TableCell className="text-slate-300">{row.team ?? '—'}</TableCell>
                    <TableCell className="font-mono">
                      {row.quality?.rawScore === null || row.quality === null
                        ? <span className="text-slate-500">—</span>
                        : <span className="text-slate-100">{formatScore(row.quality.rawScore, locale)}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-slate-400">
                      {row.quality ? `${formatNumber(row.quality.weight, { locale })}%` : '—'}
                    </TableCell>
                    <TableCell className="font-mono">
                      {row.quality
                        ? <span className="text-slate-100">{formatContribution(row.quality.weightedContribution, row.quality.maxContribution, locale)}</span>
                        : <span className="text-slate-500">—</span>}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={row.quality?.status ?? null} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={row.rowStatus} />
                        {row.overallStatus && (
                          <span className="text-[10px] text-slate-500">KPI: {row.overallStatus}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><ValueBasisBadge basis={row.valueBasis} /></TableCell>
                    <TableCell className="text-xs text-slate-400 whitespace-nowrap">
                      {row.schemeName ? (
                        <>{row.schemeName} <span className="font-mono text-slate-500">v{row.schemeVersion}</span></>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <SmartActionMenu actions={rowMenu(row)} label={`${translateUIText('إجراءات', locale)} ${row.employeeName}`} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* §17 — universal period comparison (opened from row ⋮) */}
      <PeriodComparisonDialog
        open={!!comparison}
        onOpenChange={(o) => { if (!o) setComparison(null); }}
        employeeId={comparison?.id ?? null}
        employeeName={comparison?.name}
        defaultMonth={month}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Basis banner (§7/§8/§9 labeling rules)
// ─────────────────────────────────────────────────────────────

function BasisBanner({ report, kind }: { report: KpiMonthlyReport; kind: TableTabKind }) {
  const { locale } = useLanguage();
  if (kind === 'mtd' && report.valueBasis !== 'FINALIZED') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-3 text-sm text-cyan-200">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">
            <T>MTD — بيانات حية حتى </T>
            {report.asOfDate != null ? formatDate(new Date(`${report.asOfDate}T00:00:00`), locale) : <T>الآن</T>}
          </p>
          <p className="text-cyan-300/80 text-xs">
            <T>هذه ليست النتيجة النهائية — لا تُوسم FINAL ما لم يُغلق الشهر عبر عملية إغلاق الشهر.</T>
          </p>
        </div>
      </div>
    );
  }

  if (report.valueBasis === 'FINALIZED') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200">
        <Lock className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">
            <T>قيم مجمّدة من إغلاق الشهر</T>
            {report.closedByName ? <> — <T>بواسطة</T> {report.closedByName}</> : ''}
          </p>
          <p className="text-sky-300/80 text-xs">
            <T>تُقرأ هذه النتائج من اللقطة غير القابلة للتغيير؛ تغيير المخطط الحالي أو بيانات الموظف لا يعدّلها.</T>
          </p>
        </div>
      </div>
    );
  }

  // Historical / monthly over a past month that was never closed.
  return (
    <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-200">
      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
      <div>
        <p className="font-medium"><T>قيم حية — الشهر لم يُغلق بعد</T></p>
        <p className="text-orange-300/80 text-xs">
          <T>هذه ليست نتيجة نهائية معتمدة؛ لا توجد لقطة مجمّدة لهذا الشهر.</T>
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Sortable header
// ─────────────────────────────────────────────────────────────

function SortableHead({
  label, sortKey, sort, onToggle,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onToggle: (key: string) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className="text-right">
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 text-xs hover:text-slate-200 ${active ? 'text-slate-200' : 'text-slate-400'}`}
      >
        <T>{label}</T>
        {active ? (
          sort.dir === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
        ) : (
          <ArrowDownUp className="h-3 w-3 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function uniqueSorted(values: Array<string | null>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (typeof v === 'string' && v.length > 0) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'ar'));
}
