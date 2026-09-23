'use client';

// ══════════════════════════════════════════════════════════════
//  HR Decision-Support — employee drill-down dialog
//
//  Fetches the SANITIZED per-employee decision report
//  (/api/reports/hr-performance/decision/employee — the same
//  authorization chain + scope engine as the team view) and renders
//  the full HR-safe evidence: executive summary, six-dimension
//  scorecard, KPI trend, measured strengths/concerns, the
//  recommended review action WITH its fixed safety disclaimer, and
//  the data-quality notes. Missing data renders as named absence —
//  never as zero, never as poor performance.
// ══════════════════════════════════════════════════════════════

import { Printer, ShieldAlert } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useHrDecisionEmployeeReport } from '@/hooks/use-kpi-queries';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatNumber, formatPercentage } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/dictionary';
import type { HrEmployeeDecisionReport, HrDecisionStatus } from '@/lib/hr-decision/types';
import { HR_DECISION_STATUS_LABELS_AR, HR_DECISION_CATEGORY_LABELS_AR } from '@/lib/hr-decision/types';
import { hrDecisionEmployeeToPrintModel } from '@/components/print/print-adapters';
import { openPrintReport } from '@/components/print/print-report-store';
import { HR_DECISION_STATUS_STYLES, HR_DECISION_ACTION_LABELS_AR } from './HrDecisionView';

const STATE_LABELS: Record<string, { label: string; className: string }> = {
  OK: { label: 'سليم', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
  POSITIVE: { label: 'إيجابي', className: 'border-sky-500/30 bg-sky-500/10 text-sky-300' },
  WATCH: { label: 'للمراقبة', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
  WEAK: { label: 'ضعيف', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  UNKNOWN: { label: 'بلا حكم', className: 'border-slate-600 bg-slate-800 text-slate-400' },
};

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: 'text-rose-300 border-rose-500/30 bg-rose-500/10',
  MEDIUM: 'text-amber-300 border-amber-500/30 bg-amber-500/10',
  LOW: 'text-slate-400 border-slate-600 bg-slate-800',
};

const TREND_LABELS: Record<string, string> = { UP: 'تحسّن', DOWN: 'تراجع', STABLE: 'مستقر' };

function formatValue(value: number | null, unit: string, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  if (unit === 'percent') return formatPercentage(value, { locale, maximumFractionDigits: 1 });
  const n = formatNumber(value, { locale, maximumFractionDigits: 1 });
  if (unit === 'days') return `${n} يوم`;
  if (unit === 'minutes') return `${n} دقيقة`;
  return n;
}

function formatScoreLike(value: number | null, locale: Locale): string {
  if (value === null || value === undefined) return '—';
  return formatPercentage(value, { locale, maximumFractionDigits: 1 });
}

export function HrDecisionEmployeeDialog({
  month,
  employeeId,
  onClose,
}: {
  month: string;
  employeeId: string | null;
  onClose: () => void;
}) {
  const query = useHrDecisionEmployeeReport(month, employeeId);
  const report = query.data as HrEmployeeDecisionReport | undefined;
  const { locale } = useLanguage();

  const openPrint = () => {
    if (report) openPrintReport(hrDecisionEmployeeToPrintModel(report));
  };

  return (
    <Dialog open={!!employeeId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto bg-slate-900 border-slate-700">
        {query.isLoading || !report ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-8 w-2/3 bg-slate-800/60" />
            <Skeleton className="h-24 bg-slate-800/60" />
            <Skeleton className="h-40 bg-slate-800/60" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-slate-100 flex items-center gap-2 flex-wrap">
                <span>{report.employee.employeeName}</span>
                {report.employee.employeeCode && (
                  <span className="text-xs font-mono text-slate-500" dir="ltr">{report.employee.employeeCode}</span>
                )}
                <span className={`text-[10px] rounded border px-1.5 py-0.5 ${HR_DECISION_STATUS_STYLES[report.executive.status as HrDecisionStatus]}`}>
                  {HR_DECISION_STATUS_LABELS_AR[report.executive.status]}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3">
              {/* Header context */}
              <p className="text-[11px] text-slate-500">
                {report.employee.department || '—'} · {report.employee.team || '—'} · {report.employee.position || '—'}
                {' · '}الفترة {report.period.monthKey}
              </p>

              {/* Executive summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <SummaryTile label="نتيجة الأداء" value={formatScoreLike(report.executive.kpiScore, locale)} />
                <SummaryTile
                  label="الاتجاه"
                  value={report.executive.trendDirection ? (TREND_LABELS[report.executive.trendDirection] ?? '—') : '—'}
                  hint={report.executive.momDeltaPoints !== null
                    ? `الفارق الشهري ${formatValue(report.executive.momDeltaPoints, 'points', locale)}`
                    : 'لا توجد مقارنة شهر سابق'}
                />
                <SummaryTile label="مستوى المخاطر" value={RISK_AR[report.executive.riskLevel] ?? report.executive.riskLevel} hint={`النظام القانوني للمخاطر: ${report.executive.riskScore}`} />
                <SummaryTile label="الإجراء المقترح" value={HR_DECISION_ACTION_LABELS_AR[report.executive.actionKind] ?? '—'} />
              </div>

              {/* Recommended action + safety disclaimer */}
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="size-4 text-amber-400 shrink-0" />
                  <p className="text-xs font-semibold text-amber-300">{report.action.actionAr}</p>
                </div>
                <p className="text-[11px] text-slate-400">{report.action.rationaleAr}</p>
                <p className="text-[11px] text-slate-500">{report.action.disclaimerAr}</p>
              </div>

              {/* Scorecard — six HR-safe dimensions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {report.scorecard.map((entry) => {
                  const state = STATE_LABELS[entry.state] ?? STATE_LABELS.UNKNOWN;
                  return (
                    <Card key={entry.category} className="border-slate-700/40 bg-slate-800/30">
                      <CardContent className="px-3 py-2.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-200">{entry.labelAr}</p>
                          <span className={`text-[10px] rounded border px-1.5 py-0.5 ${state.className}`}>{state.label}</span>
                        </div>
                        {entry.availability === 'NOT_AVAILABLE' ? (
                          <p className="text-[11px] text-slate-500">{entry.unavailableReasonAr ?? 'البيانات غير متاحة'}</p>
                        ) : (
                          <div className="space-y-0.5">
                            {entry.metrics.map((m) => (
                              <p key={m.labelAr} className="text-[11px] text-slate-400 flex justify-between gap-2">
                                <span>{m.labelAr}</span>
                                <span className="text-slate-200 tabular-nums">
                                  {formatValue(m.value, m.unit, locale)}
                                  {m.hintAr && <span className="text-slate-500"> · {m.hintAr}</span>}
                                </span>
                              </p>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Trend */}
              <Card className="border-slate-700/40 bg-slate-800/30">
                <CardContent className="px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-200">{HR_DECISION_CATEGORY_LABELS_AR.TREND}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {report.trend.points.map((p) => (
                      <span key={p.monthKey} className="text-[10px] rounded border border-slate-700 bg-slate-900/60 px-1.5 py-0.5 text-slate-400" dir="ltr">
                        {p.monthKey}: {p.available && p.rawScore !== null ? formatScoreLike(p.rawScore, locale) : 'غير متاح'}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500">
                    أشهر متتالية تحت الهدف المُهيّأ: {report.trend.consecutiveBelowTarget} ·
                    خطوات تراجع متتالية: {report.trend.consecutiveDecliningSteps} ·
                    الهدف المُهيّأ: {formatScoreLike(report.trend.targetScore, locale)}
                  </p>
                </CardContent>
              </Card>

              {/* Strengths / Concerns (measured signals only) */}
              <FactorList title="نقاط القوة (من إشارات مقاسة)" factors={report.strengths} emptyAr="لا توجد إشارات إيجابية مقاسة في هذه الفترة" />
              <FactorList title="مواطن الاهتمام (من إشارات مقاسة)" factors={report.concerns} emptyAr="لا توجد إشارات سلبية مقاسة في هذه الفترة" />

              {/* Data quality */}
              {report.dataQuality.notesAr.length > 0 && (
                <Card className="border-slate-700/40 bg-slate-800/20">
                  <CardContent className="px-3 py-2.5 space-y-1">
                    <p className="text-[11px] font-semibold text-slate-400">جودة البيانات</p>
                    {report.dataQuality.notesAr.map((note) => (
                      <p key={note} className="text-[11px] text-slate-500 leading-5">• {note}</p>
                    ))}
                  </CardContent>
                </Card>
              )}

              <div className="flex justify-end">
                <Button variant="outline" size="sm" className="h-9 border-slate-700/60 text-slate-300 hover:bg-slate-800 gap-1.5" onClick={openPrint}>
                  <Printer className="size-3.5" /> طباعة التقرير
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const RISK_AR: Record<string, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج',
};

function SummaryTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 px-3 py-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="text-sm font-bold text-slate-100">{value}</p>
      {hint && <p className="text-[10px] text-slate-500">{hint}</p>}
    </div>
  );
}

function FactorList({
  title,
  factors,
  emptyAr,
}: {
  title: string;
  factors: HrEmployeeDecisionReport['strengths'];
  emptyAr: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-200 mb-1.5">{title}</p>
      {factors.length === 0 ? (
        <p className="text-[11px] text-slate-500">{emptyAr}</p>
      ) : (
        <div className="space-y-1.5">
          {factors.map((f) => (
            <div key={`${f.category}-${f.ruleId}`} className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] rounded border px-1.5 py-0.5 ${SEVERITY_STYLES[f.severity]}`}>{f.severity}</span>
                <span className="text-[10px] text-slate-500">{HR_DECISION_CATEGORY_LABELS_AR[f.category]}</span>
              </div>
              <p className="text-[11px] text-slate-200 mt-1">{f.signalAr}</p>
              {f.comparisonAr && <p className="text-[10px] text-slate-500 mt-0.5">{f.comparisonAr}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
