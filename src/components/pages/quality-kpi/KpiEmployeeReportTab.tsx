'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Reports — Employee KPI Report tab (Phase 2, spec §4/§5/§31)
//
//  Layout (spec §31 — summary first, then supporting details):
//    1. Employee KPI Summary card   — who / period / Quality score /
//                                     contribution / Company KPI status
//    2. Scheme identity             — scheme name + version + weight (§10)
//    3. KPI Components              — every ACTIVE component incl.
//                                     NOT AVAILABLE placeholders (§14)
//    4. Performance Trend           — stored months only, missing =
//                                     غير متاح (§16) + MoM pp delta (§17)
//    5. Quality Evidence            — traceable observations (§18/§32)
//
//  Print-ready (§23): the printable area contains exactly the report
//  content; every control is wrapped in `.no-print`.
// ══════════════════════════════════════════════════════════════

import { useState } from 'react';
import { Printer, Search, FileText, Link2, Info, Archive, Users, Stethoscope } from 'lucide-react';
import { openPrintReport } from '@/components/print/print-report-store';
import { employeeKpiReportToPrintModel } from '@/components/print/print-adapters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { useEmployees } from '@/hooks/use-queries';
import { useKpiEmployeeReport, useKpiVisibilityDiagnose } from '@/hooks/use-kpi-queries';
import type { EmployeeKpiReport, KpiComponentResultStatus } from '@/lib/kpi-reporting';
import {
  StatusBadge,
  ValueBasisBadge,
  formatScore,
  formatContribution,
  formatSignedPoints,
} from './kpi-reports-shared';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatMonthKey, formatDate, formatNumber, formatInteger } from '@/lib/i18n/format';

const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
};

const COMPONENT_STATUS_LABELS: Record<string, string> = {
  AVAILABLE: 'متاح',
  ZERO: 'صفر',
  PENDING: 'غير متاح',
  NOT_ELIGIBLE: 'غير مؤهل',
  INCOMPLETE: 'جزئي',
  FINALIZED: 'مجمّد',
};

export default function KpiEmployeeReportTab({ month }: { month: string }) {
  const { locale } = useLanguage();
  const [employeeId, setEmployeeId] = useState<string>('');
  // Phase 6.3 (§33-§37): on-demand READ-ONLY visibility diagnose.
  const [diagnoseRequested, setDiagnoseRequested] = useState(false);
  const diagnoseQuery = useKpiVisibilityDiagnose(diagnoseRequested ? employeeId || null : null, month);
  const employeesQuery = useEmployees();
  const reportQuery = useKpiEmployeeReport(employeeId || null, month);

  return (
    <div className="space-y-4">
      {/* ── Controls (never printed — §23) ── */}
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label><T>الموظف</T></Label>
            <EmployeeSearchInput
              employees={employeesQuery.data ?? []}
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              placeholder={translateUIText('ابحث بالاسم أو الرقم الوظيفي...', locale)}
              showDepartment
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!employeeId}
              onClick={() => {
                setDiagnoseRequested(true);
                void diagnoseQuery.refetch();
              }}
            >
              <Stethoscope className="h-4 w-4" />
              <T>تشخيص الظهور</T>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={!reportQuery.data}
              onClick={() => {
                // §PRINT — the dedicated clean A4 report document.
                openPrintReport(employeeKpiReportToPrintModel(
                  reportQuery.data as EmployeeKpiReport,
                  month,
                ));
              }}
            >
              <Printer className="h-4 w-4" />
              <T>طباعة / PDF</T>
            </Button>
          </div>
        </CardContent>
      </Card>

      {!employeeId && (
        <Card className="bg-slate-800/30 border-slate-700/40">
          <CardContent className="p-10 text-center text-slate-400 space-y-2">
            <Search className="h-8 w-8 mx-auto opacity-50" />
            <p><T>ابحث عن موظف ثم اختر الفترة من الأعلى لعرض تقرير KPI الخاص به</T></p>
          </CardContent>
        </Card>
      )}

      {employeeId !== '' && reportQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-2xl bg-slate-800/40" />
          <Skeleton className="h-64 w-full rounded-2xl bg-slate-800/40" />
        </div>
      ) : null}

      {employeeId !== '' && reportQuery.isError ? (
        <Card className="bg-red-950/20 border-red-800/40">
          <CardContent className="p-6 text-red-300 text-sm">
            <T>تعذر تحميل التقرير — أعد المحاولة لاحقًا.</T>
          </CardContent>
        </Card>
      ) : null}

      {employeeId !== '' && reportQuery.data ? (
        <EmployeeReportBody report={reportQuery.data as EmployeeKpiReport} month={month} />
      ) : null}

      {/* ── Visibility diagnose panel (§33-§37, read-only) ── */}
      {employeeId && diagnoseRequested && <DiagnosePanel query={diagnoseQuery} />}
    </div>
  );
}

interface DiagnoseTrace {
  found?: boolean;
  monthKey?: string;
  valueBasis?: string;
  layers?: Array<{ key: string; ok: boolean; label: string; detail: string }>;
  firstMissingLayer?: string | null;
  wouldAppearInReport?: boolean;
  rowStatus?: string | null;
  verdict?: string;
}

function DiagnosePanel({
  query,
}: {
  query: ReturnType<typeof useKpiVisibilityDiagnose>;
}) {
  const { locale } = useLanguage();
  if (query.isFetching) {
    return (
      <Card className="no-print bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-4 text-sm text-slate-400"><T>جارٍ التشخيص…</T></CardContent>
      </Card>
    );
  }
  if (query.isError || !query.data) {
    return (
      <Card className="no-print bg-red-950/20 border-red-800/40">
        <CardContent className="p-4 text-sm text-red-300"><T>تعذر تنفيذ التشخيص — أعد المحاولة.</T></CardContent>
      </Card>
    );
  }
  const trace = query.data as DiagnoseTrace;
  return (
    <Card className="no-print bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200 flex items-center gap-2">
          <Stethoscope className="h-4 w-4 text-sky-300" />
          <T>تشخيص الظهور في تقارير KPI</T>
          {trace.monthKey && <span className="text-xs text-slate-500">— {formatMonthKey(trace.monthKey, locale)}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!trace.found ? (
          <p className="text-sm text-amber-300">{trace.verdict}</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge
                variant="outline"
                className={
                  trace.wouldAppearInReport
                    ? 'border-emerald-500/40 text-emerald-300'
                    : 'border-red-500/40 text-red-300'
                }
              >
                <T>{trace.wouldAppearInReport ? 'سيظهر في التقرير' : 'لن يظهر في التقرير'}</T>
              </Badge>
              {trace.rowStatus && (
                <Badge variant="outline" className="border-slate-600/50 text-slate-300 font-mono text-[11px]">
                  {trace.rowStatus}
                </Badge>
              )}
            </div>
            <ol className="space-y-2">
              {(trace.layers ?? []).map((layer) => (
                <li key={layer.key} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      layer.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                    }`}
                    title={translateUIText(layer.ok ? 'مستوٍ سليم' : 'أول مستوى يختفي فيه الموظف', locale)}
                  >
                    {layer.ok ? '✓' : '✕'}
                  </span>
                  <div>
                    <p className="text-slate-200 font-medium">
                      {layer.label}
                      {trace.firstMissingLayer === layer.key && (
                        <span className="text-red-300 text-xs"><T> — أول طبقة يختفي فيها</T></span>
                      )}
                    </p>
                    <p className="text-slate-400 text-xs leading-relaxed">{layer.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="text-xs text-slate-400 border-t border-slate-700/40 pt-3">{trace.verdict}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  Report body
// ─────────────────────────────────────────────────────────────

function EmployeeReportBody({ report, month }: { report: EmployeeKpiReport; month: string }) {
  const { locale } = useLanguage();
  const { employee, period, quality } = report;
  const hasOutcomeMessage = !!report.message;

  return (
    <div className="space-y-4">
      {/* ── 1. Employee KPI Summary (§5) — the printable header ── */}
      <Card className="bg-slate-800/30 border-slate-700/40">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-slate-100">{employee.employeeName || '—'}</h2>
                {employee.employeeCode && (
                  <Badge variant="outline" className="font-mono text-[11px] border-slate-600/50 text-slate-400">
                    {employee.employeeCode}
                  </Badge>
                )}
                {employee.archivedButEligible && (
                  <Badge variant="outline" className="text-[11px] border-orange-500/40 text-orange-300 bg-orange-500/10 gap-1">
                    <Archive className="h-3 w-3" />
                    <T>مؤرشف — أهلية تاريخية</T>
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-400 flex flex-wrap gap-x-2">
                <span>{employee.department ?? '—'}</span>
                {employee.team && <span>· <T>فريق: </T>{employee.team}</span>}
                {employee.position && <span>· {employee.position}</span>}
              </p>
            </div>
            <div className="text-left space-y-1">
              <p className="text-lg font-semibold text-slate-200">{formatMonthKey(month, locale)}</p>
              <div className="flex items-center gap-2 justify-end">
                <ValueBasisBadge basis={period.valueBasis} />
                {period.valueBasis === 'MTD' && (
                  <span className="text-[11px] text-slate-500">
                    <T>حتى </T>{formatDate(new Date(`${period.asOfDate}T00:00:00`), locale)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {hasOutcomeMessage ? (
            <div className="flex items-start gap-2 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-sm text-brand-200">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium"><T>لا توجد نتيجة KPI لهذه الفترة</T></p>
                <p className="text-brand-300/80">{report.message}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SummaryStat
                label="درجة الجودة (خام)"
                value={formatScore(quality?.rawScore ?? null, locale)}
                sub={<StatusBadge status={quality?.status ?? null} />}
                highlight
              />
              <SummaryStat
                label="مساهمة الجودة"
                value={formatContribution(quality?.weightedContribution ?? null, quality?.maxContribution ?? null, locale)}
                sub={<span className="text-[11px] text-slate-500"><T>من وزن </T>{quality?.weight != null ? formatNumber(quality.weight, { locale }) : '—'}%</span>}
              />
              <SummaryStat
                label="KPI الشركة"
                value={report.overallStatus === 'COMPLETE' ? translateUIText('مكتمل', locale) : translateUIText('غير مكتمل', locale)}
                sub={<StatusBadge status={report.overallStatus} />}
              />
            </div>
          )}

          {/* ── 2. Scheme identity (§10) — auditability line ── */}
          {report.scheme && (
            <p className="text-xs text-slate-500 border-t border-slate-700/40 pt-3">
              <T>مخطط KPI: </T><span className="text-slate-300">{report.scheme.schemeName}</span>
              {' · '}<T>الإصدار: </T><span className="text-slate-300 font-mono">v{report.scheme.schemeVersion}</span>
              {report.scheme.qualityWeight !== null && (
                <> · <T>وزن الجودة: </T><span className="text-slate-300">{formatNumber(report.scheme.qualityWeight, { locale })}%</span></>
              )}
              {report.scheme.frozen && <span className="text-sky-400"> · <T>قيم مجمّدة من إغلاق الشهر</T></span>}
              {report.weightedTotal !== null && report.availableWeight !== null && (
                <> · <T>إجمالي المساهمة المتاحة: </T><span className="text-slate-300">{formatNumber(report.weightedTotal, { locale })} / {formatNumber(report.availableWeight, { locale })}</span></>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {!hasOutcomeMessage && (
        <>
          {/* ── 3. KPI Components (§14 — placeholders explicit) ── */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base text-slate-200 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" />
                <T>مكونات KPI</T>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-700/40">
                    <TableHead className="text-right"><T>المكون</T></TableHead>
                    <TableHead className="text-right"><T>الوزن</T></TableHead>
                    <TableHead className="text-right"><T>الدرجة الخام</T></TableHead>
                    <TableHead className="text-right"><T>المساهمة</T></TableHead>
                    <TableHead className="text-right"><T>الحالة</T></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.components.map((c) => (
                    <TableRow key={c.componentId} className="border-slate-700/40">
                      <TableCell className="text-slate-200">{c.name}</TableCell>
                      <TableCell className="text-slate-300 font-mono">{formatNumber(c.weight, { locale })}%</TableCell>
                      <TableCell className="font-mono">
                        {c.rawScore === null
                          ? <span className="text-slate-500"><T>غير متاح</T></span>
                          : <span className="text-slate-100">{formatScore(c.rawScore, locale)}</span>}
                      </TableCell>
                      <TableCell className="font-mono">
                        {c.weightedContribution === null
                          ? <span className="text-slate-500"><T>غير متاح</T></span>
                          : <span className="text-slate-100">{formatContribution(c.weightedContribution, c.maxContribution, locale)}</span>}
                      </TableCell>
                      <TableCell>
                        <ComponentStatusBadge status={c.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* ── 4. Performance trend (§16/§17) ── */}
          <TrendCard report={report} />
        </>
      )}

      {/* ── 5. Quality evidence (§18/§32) ── */}
      <EvidenceCard report={report} />
    </div>
  );
}

function SummaryStat({
  label, value, sub, highlight,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-900/40 p-4 space-y-1.5">
      <p className="text-xs text-slate-400"><T>{label}</T></p>
      <p className={`text-2xl font-bold ${highlight ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</p>
      {sub}
    </div>
  );
}

function ComponentStatusBadge({ status }: { status: KpiComponentResultStatus }) {
  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="text-[11px] border-slate-600/50 text-slate-400">
        <T>غير متاح (PENDING)</T>
      </Badge>
    );
  }
  return <StatusBadge status={status} />;
}

// ─────────────────────────────────────────────────────────────
//  §16/§17  Trend
// ─────────────────────────────────────────────────────────────

function TrendCard({ report }: { report: EmployeeKpiReport }) {
  const { locale } = useLanguage();
  const points = report.trend.months;
  const mom = report.trend.mom;
  if (points.length === 0) return null;

  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200 flex items-center justify-between gap-2 flex-wrap">
          <span><T>الاتجاه الشهري — درجة الجودة</T></span>
          {mom && (
            <Badge
              variant="outline"
              className={
                mom.deltaPoints > 0
                  ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                  : mom.deltaPoints < 0
                    ? 'border-red-500/40 text-red-300 bg-red-500/10'
                    : 'border-slate-600/50 text-slate-300'
              }
              title={translateUIText('الفرق عن الشهر السابق بنقاط مئوية (ليست نسبة نمو)', locale)}
            >
              {formatSignedPoints(mom.deltaPoints, locale)} <T>نقطة مئوية عن </T>{formatMonthKey(mom.previousMonth, locale)}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {points.map((p) => (
            <div
              key={p.monthKey}
              className={`min-w-[104px] rounded-xl border p-3 space-y-1 ${
                p.available
                  ? 'border-slate-700/40 bg-slate-900/40'
                  : 'border-dashed border-slate-700/40 bg-slate-900/20'
              }`}
              title={
                p.available
                  ? `${formatMonthKey(p.monthKey, locale)} — ${p.finalized ? translateUIText('مجمّدة', locale) : p.valueBasis}`
                  : `${formatMonthKey(p.monthKey, locale)} — ${translateUIText('لا توجد نتيجة', locale)} (${p.rowStatus})`
              }
            >
              <p className="text-[11px] text-slate-400">{formatMonthKey(p.monthKey, locale)}</p>
              {p.available ? (
                <>
                  <p className="text-lg font-bold text-slate-100">{formatScore(p.rawScore, locale)}</p>
                  <div className="flex items-center gap-1">
                    {p.finalized ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400" title={translateUIText('مجمّدة', locale)} />
                    ) : p.valueBasis === 'MTD' ? (
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" title={translateUIText('MTD حية', locale)} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" title={translateUIText('غير نهائية', locale)} />
                    )}
                    <span className="text-[10px] text-slate-500 font-mono">
                      {p.weightedContribution !== null ? `${formatNumber(p.weightedContribution, { locale })}/${p.weight != null ? formatNumber(p.weight, { locale }) : '—'}` : '—'}
                    </span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500 py-1.5"><T>غير متاح</T></p>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-600 mt-2">
          <T>الأشهر بدون نتيجة صالحة تُعرض كـ«غير متاح» — لا تُختلق أصفار.</T>
        </p>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
//  §32  Evidence
// ─────────────────────────────────────────────────────────────

function EvidenceCard({ report }: { report: EmployeeKpiReport }) {
  const { locale } = useLanguage();
  const { evidence, traceability } = report;

  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200 flex items-center gap-2">
          <FileText className="h-4 w-4 text-slate-400" />
          <T>أدلة الجودة (الملاحظات)</T>
        </CardTitle>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline" className="text-[11px] border-slate-600/50 text-slate-300">
            <T>الإجمالي: </T>{formatInteger(evidence.counts.total, locale)}
          </Badge>
          <Badge variant="outline" className="text-[11px] border-emerald-500/40 text-emerald-300">
            <T>معتمدة: </T>{formatInteger(evidence.counts.approved, locale)}
          </Badge>
          <Badge variant="outline" className="text-[11px] border-amber-500/40 text-amber-300">
            <T>بانتظار الاعتماد: </T>{formatInteger(evidence.counts.pending, locale)}
          </Badge>
          <Badge variant="outline" className="text-[11px] border-red-500/40 text-red-300">
            <T>مرفوضة: </T>{formatInteger(evidence.counts.rejected, locale)}
          </Badge>
          <Badge variant="outline" className="text-[11px] border-slate-600/50 text-slate-300">
            <T>تؤثر في النتيجة: </T>{formatInteger(evidence.counts.scoring, locale)}
          </Badge>
          {traceability && (
            <Badge variant="outline" className="text-[11px] border-sky-500/40 text-sky-300 gap-1" title={translateUIText('سلسلة التتبع: الموظف ← KPI الجودة ← الملاحظة ← الدليل', locale)}>
              <Link2 className="h-3 w-3" />
              <T>المصدر: </T>{traceability.origin === 'month_snapshot' ? translateUIText('لقطة مجمّدة', locale) : translateUIText('محرك حي', locale)}
              {' · '}<T>خصم: </T>{formatNumber(traceability.deductionPoints, { locale })}{' · '}<T>مكافآت: </T>{formatNumber(traceability.bonusPoints, { locale })}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {evidence.observations.length === 0 ? (
          <p className="text-sm text-slate-500 py-4 text-center"><T>لا توجد ملاحظات جودة لهذه الفترة</T></p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-slate-700/40">
                <TableHead className="text-right"><T>التاريخ</T></TableHead>
                <TableHead className="text-right"><T>التصنيف</T></TableHead>
                <TableHead className="text-right"><T>الخطورة</T></TableHead>
                <TableHead className="text-right"><T>الوصف</T></TableHead>
                <TableHead className="text-right"><T>الحالة</T></TableHead>
                <TableHead className="text-right"><T>الاعتماد</T></TableHead>
                <TableHead className="text-right"><T>الأثر على الجودة</T></TableHead>
                <TableHead className="text-right"><T>الدليل</T></TableHead>
                <TableHead className="text-right"><T>مرتبط</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.observations.map((obs) => (
                <TableRow key={obs.id} className="border-slate-700/40">
                  <TableCell className="text-slate-300 whitespace-nowrap">{obs.observationDate}</TableCell>
                  <TableCell className="text-slate-200">{obs.categoryName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={`text-[11px] ${SEVERITY_STYLES[obs.severity] ?? ''}`}>
                      {obs.severity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 max-w-[220px]">
                    <span className="line-clamp-2" title={obs.notes}>{obs.notes || '—'}</span>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs whitespace-nowrap">{obs.status}</TableCell>
                  <TableCell className="text-slate-400 text-xs whitespace-nowrap">{obs.approvalStatus}</TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap">
                    {obs.effect.counted ? (
                      <span className={obs.effect.signedPoints >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                        {formatSignedPoints(obs.effect.signedPoints, locale)} <T>نقطة</T>
                      </span>
                    ) : obs.effect.applies ? (
                      <span className="text-amber-300"><T>بانتظار الاعتماد</T></span>
                    ) : (
                      <span className="text-slate-500"><T>لا يؤثر</T></span>
                    )}
                  </TableCell>
                  <TableCell>
                    {obs.evidence.kind === 'url' ? (
                      <a
                        href={obs.evidence.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-300 underline text-xs whitespace-nowrap"
                      >
                        <T>فتح الدليل</T>
                      </a>
                    ) : obs.evidence.kind === 'text' ? (
                      <span className="text-slate-400 text-xs max-w-[140px] inline-block truncate" title={obs.evidence.text}>
                        {obs.evidence.text}
                      </span>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {obs.relatedCapaId ? (
                      <Badge variant="outline" className="text-[10px] font-mono border-slate-600/50 text-slate-300">
                        {obs.relatedCapaId}
                      </Badge>
                    ) : (
                      <span className="text-slate-600 text-xs">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
