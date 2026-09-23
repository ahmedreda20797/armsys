'use client';

// ══════════════════════════════════════════════════════════════
//  HR Decision-Support view — the richer HR projection
//  (/api/reports/hr-performance/decision)
//
//  Answers, with deterministic evidence:
//    "How is this employee performing overall? Is the problem
//     isolated or repeated? Improving or declining? What measurable
//     factors explain the status? What management action should be
//     considered?"
//
//  SAFETY: the vocabulary shows a RECOMMENDED review/action — never
//  a final employment decision (the disclaimer travels with every
//  status and every printout). The server sends the sanitized
//  HR-safe projection only; this tab renders exactly that.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { Printer, ShieldCheck, TrendingUp, TrendingDown, Minus, FileQuestion } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { useHrDecisionReport } from '@/hooks/use-kpi-queries';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatPercentage, formatInteger } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';
import type {
  HrDecisionStatus,
  HrTeamDecisionReport,
} from '@/lib/hr-decision/types';
import { HR_DECISION_STATUS_LABELS_AR } from '@/lib/hr-decision/types';
import { hrDecisionToPrintModel } from '@/components/print/print-adapters';
import { openPrintReport } from '@/components/print/print-report-store';
import { ValueBasisBadge } from './kpi-reports-shared';
import { HrDecisionEmployeeDialog } from './HrDecisionEmployeeDialog';

export const HR_DECISION_STATUS_STYLES: Record<HrDecisionStatus, string> = {
  STABLE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  IMPROVING: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  NEEDS_COACHING: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  PERFORMANCE_IMPROVEMENT_REVIEW: 'border-orange-500/30 bg-orange-500/10 text-orange-300',
  MANAGEMENT_REVIEW: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

const DECISION_STATUS_OPTIONS: HrDecisionStatus[] = [
  'STABLE', 'IMPROVING', 'NEEDS_COACHING',
  'PERFORMANCE_IMPROVEMENT_REVIEW', 'MANAGEMENT_REVIEW',
];

const TOTAL_CARDS: Array<{ key: keyof HrTeamDecisionReport['totals']; label: string }> = [
  { key: 'employees', label: 'الموظفون' },
  { key: 'stable', label: 'مستقر' },
  { key: 'improving', label: 'يتحسّن' },
  { key: 'needsCoaching', label: 'يحتاج توجيهاً' },
  { key: 'performanceImprovementReview', label: 'مراجعة تحسين أداء' },
  { key: 'managementReview', label: 'مراجعة إدارة' },
  { key: 'withKpiResult', label: 'بنتيجة أداء' },
];

function TrendIcon({ direction }: { direction: string | null }) {
  if (direction === 'UP') return <TrendingUp className="size-3.5 text-emerald-400" />;
  if (direction === 'DOWN') return <TrendingDown className="size-3.5 text-rose-400" />;
  if (direction === 'STABLE') return <Minus className="size-3.5 text-slate-400" />;
  return <FileQuestion className="size-3.5 text-slate-600" />;
}

// Locale-aware trend labels (enum-code map: [ar, en]).
const TREND_LABELS: Record<string, [string, string]> = {
  UP: ['تحسّن', 'Improving'],
  DOWN: ['تراجع', 'Declining'],
  STABLE: ['مستقر', 'Stable'],
};

function formatScoreLike(value: number | null, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  return formatPercentage(value, { locale, maximumFractionDigits: 1 });
}

export default function HrDecisionView({
  month,
  filters,
}: {
  month: string;
  filters: {
    search: string;
    department: string;
    team: string;
    onDepartmentChange: (v: string) => void;
    onTeamChange: (v: string) => void;
  };
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const { locale } = useLanguage();

  const query = useHrDecisionReport(month, {
    employeeQuery: filters.search.trim() || undefined,
    department: filters.department !== 'all' ? filters.department : undefined,
    team: filters.team !== 'all' ? filters.team : undefined,
    decisionStatus: statusFilter !== 'all' ? statusFilter : undefined,
  });
  const report = query.data as HrTeamDecisionReport | undefined;

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
    if (report) openPrintReport(hrDecisionToPrintModel(report));
  };

  const ops = report?.operational;

  return (
    <div className="space-y-3">
      {/* Audience + safety banner */}
      <div className="no-print flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
        <ShieldCheck className="size-4 text-emerald-400 shrink-0" />
        <p className="text-[11px] text-slate-300">
          <T>تقرير دعم القرار — يدمج نتيجة الأداء مع المؤشرات التشغيلية ليوضّح لماذا صدرت كل حالة.</T>
          <span className="text-slate-500"> <T>التوصية مراجعة إجرائية فقط، وليست قراراً نهائياً — التفاصيل الفنية (الأدلة، النصوص، الأسباب) لا تُرسل من الخادم أساساً.</T></span>
        </p>
      </div>

      {/* Filters (decision-specific status filter; shared search/dept/team) */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-48 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('حالة القرار', locale)} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><T>كل الحالات</T></SelectItem>
            {DECISION_STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>{translateUIText(HR_DECISION_STATUS_LABELS_AR[s], locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.department} onValueChange={(v) => filters.onDepartmentChange(v)}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('القسم', locale)} /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all"><T>كل الأقسام</T></SelectItem>
            {departments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.team} onValueChange={(v) => filters.onTeamChange(v)}>
          <SelectTrigger className="h-9 w-44 bg-slate-900/60 border-slate-700/60"><SelectValue placeholder={translateUIText('الفريق', locale)} /></SelectTrigger>
          <SelectContent className="max-h-56">
            <SelectItem value="all"><T>كل الفرق</T></SelectItem>
            {teams.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
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

      {/* Status distribution (counts only — never a leaderboard) */}
      {report && (
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {TOTAL_CARDS.map(({ key, label }) => (
            <Card key={key} className="border-slate-700/40 bg-slate-800/30">
              <CardContent className="px-3 py-2.5">
                <p className="text-[10px] text-slate-500"><T>{label}</T></p>
                <p className="text-lg font-bold text-slate-100 tabular-nums">{report.totals[key] != null ? formatInteger(report.totals[key], locale) : '—'}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Aggregate operational indicators (HR-safe averages/counts) */}
      {ops && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="px-3 py-2.5">
              <p className="text-[10px] text-slate-500"><T>متوسط إنجاز المتابعات</T></p>
              <p className="text-sm font-semibold text-slate-100 tabular-nums">{formatScoreLike(ops.followUps.averageCompletionRate, locale)}</p>
              <p className="text-[10px] text-slate-500"><T>متأخرة: </T>{formatInteger(ops.followUps.totalOverdue, locale)}</p>
            </CardContent>
          </Card>
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="px-3 py-2.5">
              <p className="text-[10px] text-slate-500"><T>متوسط الالتزام بالحضور</T></p>
              <p className="text-sm font-semibold text-slate-100 tabular-nums">{formatScoreLike(ops.attendance.averageCompliance, locale)}</p>
              <p className="text-[10px] text-slate-500"><T>قيمة مقاسة — بلا حد مُهيّأ</T></p>
            </CardContent>
          </Card>
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="px-3 py-2.5">
              <p className="text-[10px] text-slate-500"><T>الإنتاجية — صفقات مكتملة (تاريخ الإغلاق)</T></p>
              <p className="text-sm font-semibold text-slate-100 tabular-nums">{formatInteger(ops.productivity.closedDeals, locale)} <span className="text-[10px] text-slate-500"><T>/ حجم السفر (تاريخ المغادرة) </T>{formatInteger(ops.productivity.travelVolume, locale)}</span></p>
              <p className="text-[10px] text-slate-500"><T>قيمة مقاسة — بلا هدف مُهيّأ</T></p>
            </CardContent>
          </Card>
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="px-3 py-2.5">
              <p className="text-[10px] text-slate-500"><T>الاتجاه (تحسّن/تراجع/بلا بيانات)</T></p>
              <p className="text-sm font-semibold text-slate-100 tabular-nums">{formatInteger(ops.trend.improving, locale)} / {formatInteger(ops.trend.declining, locale)} / {formatInteger(ops.trend.noData, locale)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      {query.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <SkeletonRow key={i} />)}
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
                  <TableHead className="text-slate-400 text-xs"><T>حالة القرار</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell"><T>الإجراء المقترح</T></TableHead>
                  <TableHead className="text-slate-400 text-xs"><T>نتيجة الأداء</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden lg:table-cell"><T>الاتجاه</T></TableHead>
                  <TableHead className="text-slate-400 text-xs hidden xl:table-cell"><T>أهم ملاحظة</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row) => (
                  <TableRow
                    key={row.employeeId}
                    className="border-slate-700/40 hover:bg-slate-800/50 cursor-pointer"
                    onClick={() => setSelectedEmployeeId(row.employeeId)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm text-slate-100 truncate max-w-[180px]" title={row.employeeName}>{row.employeeName}</span>
                        {row.employeeCode && <span className="text-[10px] font-mono text-slate-500" dir="ltr">{row.employeeCode}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.department || '—'}</TableCell>
                    <TableCell className="text-slate-300 text-xs hidden md:table-cell">{row.team || '—'}</TableCell>
                    <TableCell>
                      <span className={`text-[10px] rounded border px-1.5 py-0.5 whitespace-nowrap ${HR_DECISION_STATUS_STYLES[row.status]}`}>
                        {translateUIText(HR_DECISION_STATUS_LABELS_AR[row.status], locale)}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-300 text-xs hidden lg:table-cell">{translateUIText(HR_DECISION_ACTION_LABELS_AR[row.actionKind] ?? '—', locale)}</TableCell>
                    {/* KPI TRUTH: verbatim canonical result — missing = '—', never 0 */}
                    <TableCell className="text-slate-100 text-sm font-semibold tabular-nums">{formatScoreLike(row.kpiScore, locale)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="flex items-center gap-1 text-[11px] text-slate-300">
                        <TrendIcon direction={row.trendDirection} />
                        {row.trendDirection ? TREND_LABELS[row.trendDirection]?.[locale === 'en' ? 1 : 0] : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-400 text-[11px] hidden xl:table-cell max-w-[240px]">
                      <span className="block truncate" title={row.topConcernAr ?? undefined}>
                        {row.concernCount > 0 ? (<>{formatInteger(row.concernCount, locale)} · {row.topConcernAr ?? '—'}</>) : '—'}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Data-quality notes (missing data is named, never judged) */}
      {report && report.dataQuality.notesAr.length > 0 && (
        <Card className="border-slate-700/40 bg-slate-800/20">
          <CardContent className="px-3 py-2.5 space-y-1">
            <p className="text-[11px] font-semibold text-slate-400"><T>جودة البيانات</T></p>
            {report.dataQuality.notesAr.map((note) => (
              <p key={note} className="text-[11px] text-slate-500 leading-5">• {note}</p>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Employee drill-down (fetches the sanitized employee report) */}
      <HrDecisionEmployeeDialog
        month={month}
        employeeId={selectedEmployeeId}
        onClose={() => setSelectedEmployeeId(null)}
      />
    </div>
  );
}

function SkeletonRow() {
  return <div className="h-10 rounded-lg bg-slate-800/60" />;
}

export const HR_DECISION_ACTION_LABELS_AR: Record<string, string> = {
  CONTINUE_MONITORING: 'متابعة دورية اعتيادية',
  RECOGNIZE_IMPROVEMENT: 'متابعة + تشجيع التحسّن',
  COACHING: 'توجيه/تدريب موجّه',
  IMPROVEMENT_PLAN: 'مراجعة أداء رسمية / خطة تحسين',
  MANAGEMENT_HR_REVIEW: 'مراجعة الإدارة والموارد البشرية',
};
