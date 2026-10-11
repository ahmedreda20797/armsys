'use client';

// ══════════════════════════════════════════════════════════════
//  KpiEmployeeReportDetail — single-employee deep view (§31)
//
//  The drill-down body behind the employee-report dialog: summary →
//  components → trend → evidence. Percentage terminology per spec
//  §25: نسبة الجودة · النسبة المحددة · النسبة المحققة · النسبة
//  المحتسبة · إجمالي النسبة · حالة التقييم — no weight/contribution
//  wording, no raw status keys, missing data = غير متاح.
// ══════════════════════════════════════════════════════════════

import { Archive, FileText, Info, Link2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { EmployeeKpiReport, KpiComponentResultStatus } from '@/lib/kpi-reporting';
import {
  StatusBadge,
  ValueBasisBadge,
  formatScore,
  formatContribution,
  formatSignedPoints,
} from '../kpi-reports-shared';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { presentStatus } from '@/lib/i18n/presentation';
import { formatMonthKey, formatDate, formatNumber, formatInteger } from '@/lib/i18n/format';
import { pick, TERMS } from './insights-labels';

const SEVERITY_STYLES: Record<string, string> = {
  low: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  critical: 'bg-red-500/15 text-red-300 border-red-500/30',
};

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
      <p className="text-xs text-slate-400">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</p>
      {sub}
    </div>
  );
}

function ComponentStatusBadge({ status }: { status: KpiComponentResultStatus }) {
  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="text-[11px] border-slate-600/50 text-slate-400">
        <T>غير متاح (قيد الانتظار)</T>
      </Badge>
    );
  }
  return <StatusBadge status={status} />;
}

function TrendCard({ report }: { report: EmployeeKpiReport }) {
  const { locale } = useLanguage();
  const points = report.trend.months;
  const mom = report.trend.mom;
  if (points.length === 0) return null;

  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base text-slate-200 flex items-center justify-between gap-2 flex-wrap">
          <span><T>الاتجاه الشهري — نسبة الجودة</T></span>
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
                  ? `${formatMonthKey(p.monthKey, locale)} — ${p.finalized ? translateUIText('مجمّدة', locale) : presentStatus(p.valueBasis, locale)}`
                  : `${formatMonthKey(p.monthKey, locale)} — ${translateUIText('لا توجد نتيجة', locale)} (${presentStatus(p.rowStatus, locale)})`
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
                      {presentStatus(obs.severity, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-300 max-w-[220px]">
                    <span className="line-clamp-2" title={obs.notes}>{obs.notes || '—'}</span>
                  </TableCell>
                  <TableCell className="text-slate-400 text-xs whitespace-nowrap">{presentStatus(obs.status, locale)}</TableCell>
                  <TableCell className="text-slate-400 text-xs whitespace-nowrap">{presentStatus(obs.approvalStatus, locale)}</TableCell>
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

export function EmployeeReportDetail({ report, month }: { report: EmployeeKpiReport; month: string }) {
  const { locale } = useLanguage();
  const { employee, period, quality } = report;
  const hasOutcomeMessage = !!report.message;

  return (
    <div className="space-y-4">
      {/* ── 1. Summary (the printable header) ── */}
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
                label={pick(locale, TERMS.qualityPct)}
                value={formatScore(quality?.rawScore ?? null, locale)}
                sub={<StatusBadge status={quality?.status ?? null} />}
                highlight
              />
              <SummaryStat
                label={pick(locale, TERMS.calculatedPct)}
                value={formatContribution(quality?.weightedContribution ?? null, quality?.maxContribution ?? null, locale)}
                sub={
                  <span className="text-[11px] text-slate-500">
                    {pick(locale, TERMS.definedPct)}:{' '}
                    {quality?.weight != null ? formatNumber(quality.weight, { locale }) : '—'}%
                  </span>
                }
              />
              <SummaryStat
                label={pick(locale, TERMS.evaluationStatus)}
                value={
                  report.overallStatus === 'COMPLETE'
                    ? translateUIText('مكتمل', locale)
                    : translateUIText('غير مكتمل', locale)
                }
                sub={<StatusBadge status={report.overallStatus} />}
              />
            </div>
          )}

          {/* ── 2. Scheme identity — auditability line ── */}
          {report.scheme && (
            <p className="text-xs text-slate-500 border-t border-slate-700/40 pt-3">
              <T>مخطط KPI: </T><span className="text-slate-300">{report.scheme.schemeName}</span>
              {' · '}<T>الإصدار: </T><span className="text-slate-300 font-mono">v{report.scheme.schemeVersion}</span>
              {report.scheme.qualityWeight !== null && (
                <> · {pick(locale, TERMS.definedPct)}: <span className="text-slate-300">{formatNumber(report.scheme.qualityWeight, { locale })}%</span></>
              )}
              {report.scheme.frozen && <span className="text-sky-400"> · <T>قيم مجمّدة من إغلاق الشهر</T></span>}
              {report.weightedTotal !== null && report.availableWeight !== null && (
                <> · {pick(locale, TERMS.totalPct)}: <span className="text-slate-300">{formatNumber(report.weightedTotal, { locale })} / {formatNumber(report.availableWeight, { locale })}</span></>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {!hasOutcomeMessage && (
        <>
          {/* ── 3. Components ── */}
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
                    <TableHead className="text-right"><T>{TERMS.definedPct[0]}</T></TableHead>
                    <TableHead className="text-right"><T>{TERMS.achievedPct[0]}</T></TableHead>
                    <TableHead className="text-right"><T>{TERMS.calculatedPct[0]}</T></TableHead>
                    <TableHead className="text-right"><T>{TERMS.evaluationStatus[0]}</T></TableHead>
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

          <TrendCard report={report} />
        </>
      )}

      <EvidenceCard report={report} />
    </div>
  );
}
