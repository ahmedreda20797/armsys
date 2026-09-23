'use client';

import { useState, useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Award, ArrowDownCircle, ArrowUpCircle, Clock, TrendingDown, BarChart3,
  Lock, ExternalLink, ChevronDown, ChevronUp, CalendarDays, History,
} from 'lucide-react';
import { ScoreRing, ScoreBadge, TrendArrow, ApprovalStatusBadge } from '@/components/shared/kpi';
import { TimelineView } from '@/components/shared/audit';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDate as localeDate, displayLocale, formatMonthKey, formatInteger } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';
import { buildTimeline } from '@/lib/audit/timeline-builder';
import { useAppStore } from '@/lib/store';
import {
  useKpiDashboard,
  useObservations,
  useObservationCategories,
  useMonthSnapshots,
  useMonthSnapshot,
} from '@/hooks/use-kpi-queries';
import { usePermissions } from '@/hooks/usePermissions';
import type { QualityObservation, EmployeeScoreEntry } from '@/types/quality-kpi';

// ─── Constants & Helpers ─────────────────────────────────────
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

function formatDate(dateStr: string, locale: Locale = displayLocale()): string {
  if (!dateStr) return '';
  // DD/MM/YYYY stored format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) return dateStr;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return localeDate(d, locale);
}

const SEVERITY_COLORS: Record<string, string> = {
  low: 'text-slate-400',
  medium: 'text-amber-400',
  high: 'text-orange-400',
  critical: 'text-rose-400',
};

// ─── Main Component ──────────────────────────────────────────
/**
 * Employee 360 "Quality & KPIs" panel — Milestone 9 enhanced.
 *
 * Self-contained: fetches the employee's KPI summary, monthly history,
 * observations, and timelines from the canonical APIs. Presentation-only
 * — no score computation on the client.
 *
 * Data sources:
 *   • /api/kpi-dashboard (current-month live score, trend, stats)
 *   • /api/month-snapshots (monthly snapshot list)
 *   • /api/month-snapshots/{monthKey} (frozen/live detail per month)
 *   • /api/quality-observations?employeeId=&month= (observation records)
 *   • /api/observation-categories (category names)
 */
export function EmployeeQualityKpiPanel({ employeeId }: { employeeId: string }) {
  const { locale } = useLanguage();
  // ── Month selection ──
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
  const [expandedObsId, setExpandedObsId] = useState<string | null>(null);
  const [historyCount, setHistoryCount] = useState(6);

  const isCurrentMonth = selectedMonth === CURRENT_MONTH;

  // ── Data: canonical APIs ──
  const { data: dashData, isLoading: dashLoading } = useKpiDashboard({
    range: 'current_month',
    employeeId,
  });

  const { data: snapshotList } = useMonthSnapshots();

  // Per-month detail — disabled when viewing the current live month
  // (dashboard provides that data instead).
  const { data: monthDetail, isLoading: monthLoading } = useMonthSnapshot(
    isCurrentMonth ? null : selectedMonth,
  );

  // Observations for the selected month
  const { data: obsData } = useObservations({ employeeId, month: selectedMonth });

  const { data: catData } = useObservationCategories();

  // Permission & store
  const { canApprove } = usePermissions('observations');
  const close360 = useAppStore((s) => s.closeEmployee360);
  const navigateToPage = useAppStore((s) => s.navigateTo);

  // ── Derived data ──
  const dash = (dashData ?? {}) as Record<string, unknown>;
  const observations = (Array.isArray(obsData) ? obsData : []) as QualityObservation[];
  const categories = (Array.isArray(catData) ? catData : []) as Array<{ id: string; name: string; color?: string }>;

  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Frozen/live status for the selected month
  const isFrozen = !isCurrentMonth && monthDetail?.status === 'closed';

  // Employee entry from the month snapshot (historical months only)
  const employeeEntry: EmployeeScoreEntry | null = useMemo(() => {
    if (isCurrentMonth || !monthDetail?.employeeScores) return null;
    return (monthDetail.employeeScores as Record<string, EmployeeScoreEntry>)[employeeId] ?? null;
  }, [isCurrentMonth, monthDetail, employeeId]);

  // ── Score & stats (single source per month type) ──
  const score = isCurrentMonth
    ? ((dash.avgScore as number) ?? 0)
    : (employeeEntry?.score ?? 0);
  const maxScore = isCurrentMonth
    ? (((dash.settings as Record<string, number> | undefined)?.defaultScore) ?? 100)
    : ((monthDetail?.settingsSnapshot?.defaultScore) ?? 100);
  const deductions = isCurrentMonth
    ? ((dash.totalDeductions as number) ?? 0)
    : (employeeEntry?.deductionPoints ?? 0);
  const bonuses = isCurrentMonth
    ? ((dash.totalBonuses as number) ?? 0)
    : (employeeEntry?.bonusPoints ?? 0);
  const pendingApprovals = isCurrentMonth
    ? ((dash.pendingApprovals as number) ?? 0)
    : (employeeEntry?.pendingCount ?? 0);
  const trend = isCurrentMonth
    ? (dash.trend as { direction: 'improving' | 'stable' | 'declining'; momDelta: number; sampleSize: number } | undefined)
    : undefined;

  // ── Observation splitting ──
  const { approved, pending, approvedBonuses } = useMemo(() => {
    const app: QualityObservation[] = [];
    const pend: QualityObservation[] = [];
    const bon: QualityObservation[] = [];
    for (const o of observations) {
      if (!o.applyPointDeduction) continue;
      if (o.approvalStatus === 'approved' && !o.isBonus) app.push(o);
      else if (o.approvalStatus === 'approved' && o.isBonus) bon.push(o);
      else if (o.approvalStatus === 'pending') pend.push(o);
    }
    return { approved: app, pending: pend, approvedBonuses: bon };
  }, [observations]);

  // Month options for the selector
  const monthOptions = useMemo(() => {
    const opts: Array<{ value: string; label: string; frozen: boolean }> = [
      { value: CURRENT_MONTH, label: `${formatMonthKey(CURRENT_MONTH, locale)} ${translateUIText('(الشهر الحالي)', locale)}`, frozen: false },
    ];
    const snapshots = Array.isArray(snapshotList) ? snapshotList : [];
    for (const s of snapshots) {
      const mk = (s as Record<string, string>).monthKey;
      if (!mk || mk === CURRENT_MONTH) continue;
      opts.push({ value: mk, label: formatMonthKey(mk, locale), frozen: (s as Record<string, string>).status === 'closed' });
    }
    return opts;
  }, [snapshotList, locale]);

  // Snapshot list for the monthly history table
  const historyMonths = useMemo(() => {
    const snapshots = Array.isArray(snapshotList) ? snapshotList : [];
    return snapshots.map((s) => ({
      monthKey: (s as Record<string, string>).monthKey,
      status: (s as Record<string, string>).status,
    }));
  }, [snapshotList]);

  // ── Loading state ──
  const isLoading = (isCurrentMonth && dashLoading) || (!isCurrentMonth && monthLoading);

  if (isLoading && !observations.length) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  // ── Handler: navigate to observations page ──
  function handleNavigateToObservations() {
    close360();
    navigateToPage('observations');
  }

  // ── Handler: toggle observation timeline ──
  function handleToggleObsTimeline(obsId: string) {
    setExpandedObsId((prev) => (prev === obsId ? null : obsId));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* ─── Month Selector ─── */}
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-4 flex items-center gap-3">
          <CalendarDays className="size-4 text-slate-400 shrink-0" />
          <Select value={selectedMonth} onValueChange={(v) => { setSelectedMonth(v); setExpandedObsId(null); }}>
            <SelectTrigger className="flex-1 bg-slate-900/40 border-slate-600/40">
              <SelectValue placeholder={translateUIText('اختر شهراً', locale)} />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFrozen && (
            <Badge variant="outline" className="shrink-0 text-blue-400 border-blue-500/30 text-[10px]">
              <Lock className="size-3 ms-1" />
              <T>مجمّد</T>
            </Badge>
          )}
          {!isCurrentMonth && !isFrozen && monthDetail != null && (
            <Badge variant="outline" className="shrink-0 text-amber-400 border-amber-500/30 text-[10px]">
              <T>مباشر</T>
            </Badge>
          )}
          {isCurrentMonth && (
            <Badge variant="outline" className="shrink-0 text-emerald-400 border-emerald-500/30 text-[10px]">
              <T>مباشر</T>
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* ─── Score + Stats Overview ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Score Ring */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 flex flex-col items-center justify-center">
            <p className="text-xs text-slate-400 mb-2">
              <T>درجة الجودة — </T>{formatMonthKey(selectedMonth, locale)}
            </p>
            {!isCurrentMonth && monthLoading ? (
              <Skeleton className="size-24 rounded-full" />
            ) : (
              <>
                <ScoreRing score={score} max={maxScore} size={96} />
                {trend && trend.sampleSize > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <TrendArrow direction={trend.direction} delta={trend.momDelta} />
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Deductions / Bonuses / Pending */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-3">
            <StatRow icon={ArrowDownCircle} color="text-rose-400" label={<T>نقاط الخصم</T>} value={formatInteger(deductions, locale)} />
            <StatRow icon={ArrowUpCircle} color="text-emerald-400" label={<T>نقاط المكافأة</T>} value={formatInteger(bonuses, locale)} />
            <StatRow icon={Clock} color="text-amber-400" label={<T>بانتظار الاعتماد</T>} value={formatInteger(pendingApprovals, locale)} />
          </CardContent>
        </Card>

        {/* Counts + Rank */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-3">
            <StatRow icon={Award} color="text-blue-400" label={<T>ملاحظات معتمدة</T>} value={formatInteger(approved.length + approvedBonuses.length, locale)} />
            <StatRow icon={ArrowUpCircle} color="text-emerald-400" label={<T>منها مكافآت</T>} value={formatInteger(approvedBonuses.length, locale)} />
            <StatRow icon={Clock} color="text-amber-400" label={<T>ملاحظات معلقة</T>} value={formatInteger(pending.length, locale)} />
            {employeeEntry && employeeEntry.rank > 0 && (
              <StatRow icon={Award} color="text-brand-400" label={<T>الترتيب</T>} value={`#${formatInteger(employeeEntry.rank, locale)}`} />
            )}
            {employeeEntry && (
              <StatRow icon={Award} color="text-slate-400" label={<T>القسم</T>} value={employeeEntry.dept || employeeEntry.employeeSnapshot.departmentName} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Monthly Quality History ─── */}
      {historyMonths.length > 0 && (
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between pb-2 border-b border-slate-700/30">
              <div className="flex items-center gap-2">
                <History className="size-4 text-slate-400" />
                <h4 className="text-sm font-semibold text-slate-200"><T>السجل الشهري</T></h4>
              </div>
              <Badge variant="outline" className="text-slate-400 border-slate-600/40 text-[10px]">
                {formatInteger(historyMonths.length, locale)} <T>شهر</T>
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-700/20">
                    <th className="text-start py-1.5 px-2 font-normal"><T>الشهر</T></th>
                    <th className="text-center py-1.5 px-1 font-normal"><T>الدرجة</T></th>
                    <th className="text-center py-1.5 px-1 font-normal"><T>الخصم</T></th>
                    <th className="text-center py-1.5 px-1 font-normal"><T>المكافأة</T></th>
                    <th className="text-center py-1.5 px-1 font-normal"><T>الملاحظات</T></th>
                    <th className="text-center py-1.5 px-1 font-normal hidden sm:table-cell"><T>المعتمدة</T></th>
                    <th className="text-center py-1.5 px-1 font-normal hidden sm:table-cell"><T>المعلقة</T></th>
                    <th className="text-center py-1.5 px-1 font-normal hidden md:table-cell"><T>الترتيب</T></th>
                    <th className="text-center py-1.5 px-1 font-normal hidden md:table-cell"><T>الحالة</T></th>
                  </tr>
                </thead>
                <tbody>
                  {/* Current month row */}
                  <HistoryTableRow
                    monthKey={CURRENT_MONTH}
                    label={`${formatMonthKey(CURRENT_MONTH, locale)} ${translateUIText('(الحالي)', locale)}`}
                    isLive
                    isSelected={selectedMonth === CURRENT_MONTH}
                    onClick={() => setSelectedMonth(CURRENT_MONTH)}
                    employeeId={employeeId}
                  />
                  {/* Snapshot months */}
                  {historyMonths.slice(0, historyCount).map((m) => (
                    <HistoryTableRow
                      key={m.monthKey}
                      monthKey={m.monthKey}
                      label={formatMonthKey(m.monthKey, locale)}
                      isLive={m.status === 'open'}
                      isSelected={selectedMonth === m.monthKey}
                      onClick={() => setSelectedMonth(m.monthKey)}
                      employeeId={employeeId}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {historyMonths.length > historyCount && (
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-400 hover:text-slate-200"
                  onClick={() => setHistoryCount((c) => c + 6)}
                >
                  <ChevronDown className="size-3 ms-1" />
                  <T>عرض المزيد</T>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Approved Deductions ─── */}
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-700/30">
            <TrendingDown className="size-4 text-rose-400" />
            <h4 className="text-sm font-semibold text-slate-200"><T>الخصومات المعتمدة</T></h4>
            <Badge variant="outline" className="text-slate-500 text-[10px]">{formatInteger(approved.length, locale)}</Badge>
          </div>
          {approved.length > 0 ? (
            <EnhancedObservationList
              items={approved}
              categoryName={categoryName}
              showPoints
              showDetails
              expandedId={expandedObsId}
              onToggle={handleToggleObsTimeline}
            />
          ) : (
            <EmptyHint label={<T>لا توجد خصومات معتمدة لهذا الشهر</T>} />
          )}
        </CardContent>
      </Card>

      {/* ─── Pending Approvals ─── */}
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-slate-700/30">
            <div className="flex items-center gap-2">
              <Clock className="size-4 text-amber-400" />
              <h4 className="text-sm font-semibold text-slate-200"><T>ملاحظات بانتظار الاعتماد</T></h4>
              <Badge variant="outline" className="text-slate-500 text-[10px]">{formatInteger(pending.length, locale)}</Badge>
            </div>
            {canApprove && pending.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-emerald-400 hover:text-emerald-300"
                onClick={handleNavigateToObservations}
              >
                <ExternalLink className="size-3 ms-1" />
                <T>إدارة الاعتمادات</T>
              </Button>
            )}
          </div>
          {pending.length > 0 ? (
            <EnhancedObservationList
              items={pending}
              categoryName={categoryName}
              showPoints
              showDetails
              expandedId={expandedObsId}
              onToggle={handleToggleObsTimeline}
            />
          ) : (
            <EmptyHint label={<T>لا توجد ملاحظات معلقة</T>} />
          )}
        </CardContent>
      </Card>

      {/* ─── Approved Bonuses ─── */}
      {approvedBonuses.length > 0 && (
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-700/30">
            <ArrowUpCircle className="size-4 text-emerald-400" />
            <h4 className="text-sm font-semibold text-slate-200"><T>المكافآت المعتمدة</T></h4>
            <Badge variant="outline" className="text-slate-500 text-[10px]">{formatInteger(approvedBonuses.length, locale)}</Badge>
            </div>
            <EnhancedObservationList
              items={approvedBonuses}
              categoryName={categoryName}
              showPoints
              showDetails
              expandedId={expandedObsId}
              onToggle={handleToggleObsTimeline}
            />
          </CardContent>
        </Card>
      )}

      {/* ─── Expanded Observation Timeline ─── */}
      {expandedObsId && (
        <ObservationTimelineCard
          observation={observations.find((o) => o.id === expandedObsId) ?? null}
          onClose={() => setExpandedObsId(null)}
          categoryName={categoryName}
        />
      )}

      {/* ─── Empty State ─── */}
      {observations.length === 0 && !employeeEntry && (
        <div className="flex flex-col items-center justify-center py-10 text-slate-500">
          <BarChart3 className="size-10 mb-2 opacity-50" />
          <p className="text-sm"><T>لا توجد بيانات جودة لهذا الموظف في </T>{formatMonthKey(selectedMonth, locale)}</p>
        </div>
      )}
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Sub-components
// ══════════════════════════════════════════════════════════════

/** Numeric stat row with icon. */
function StatRow({
  icon: Icon, color, label, value,
}: {
  icon: typeof Award;
  color: string;
  label: ReactNode;
  value: number | string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon className={`size-4 ${color}`} />
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <span className="text-sm font-bold text-slate-100 tabular-nums">{value}</span>
    </div>
  );
}

/** A single row in the monthly history table. Fetches its own snapshot detail. */
function HistoryTableRow({
  monthKey,
  label,
  isLive,
  isSelected,
  onClick,
  employeeId,
}: {
  monthKey: string;
  label: string;
  isLive: boolean;
  isSelected: boolean;
  onClick: () => void;
  employeeId: string;
}) {
  // Fetch full snapshot detail for this row (React Query cached, bounded by parent's historyCount).
  // Closed months return frozen snapshot; open months return live preview — both canonical.
  const { locale } = useLanguage();
  const { data: detail } = useMonthSnapshot(monthKey);
  const entry = (detail?.employeeScores as Record<string, EmployeeScoreEntry> | undefined)?.[employeeId];
  const max = detail?.settingsSnapshot?.defaultScore ?? 100;
  const rowScore = entry?.score;

  return (
    <tr
      className={`cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/10' : 'hover:bg-slate-700/20'}`}
      onClick={onClick}
    >
      <td className="py-1.5 px-2 text-slate-200 whitespace-nowrap">{label}</td>
      <td className="text-center py-1.5 px-1">
        {rowScore != null ? (
          <ScoreBadge score={rowScore} max={max} />
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="text-center py-1.5 px-1 tabular-nums text-rose-400">
        {formatInteger(entry?.deductionPoints ?? 0, locale)}
      </td>
      <td className="text-center py-1.5 px-1 tabular-nums text-emerald-400">
        {formatInteger(entry?.bonusPoints ?? 0, locale)}
      </td>
      <td className="text-center py-1.5 px-1 tabular-nums">
        {formatInteger(entry?.observationCount ?? 0, locale)}
      </td>
      <td className="text-center py-1.5 px-1 tabular-nums hidden sm:table-cell">
        {formatInteger(entry?.approvedCount ?? 0, locale)}
      </td>
      <td className="text-center py-1.5 px-1 tabular-nums text-amber-400 hidden sm:table-cell">
        {formatInteger(entry?.pendingCount ?? 0, locale)}
      </td>
      <td className="text-center py-1.5 px-1 hidden md:table-cell">
        {entry?.rank ? (
          <Badge variant="outline" className="text-brand-400 border-brand-500/20 text-[10px]">
            #{formatInteger(entry.rank, locale)}
          </Badge>
        ) : (
          <span className="text-slate-600">—</span>
        )}
      </td>
      <td className="text-center py-1.5 px-1 hidden md:table-cell">
        {isLive ? (
          <Badge variant="outline" className="text-emerald-400 border-emerald-500/20 text-[10px]"><T>مباشر</T></Badge>
        ) : (
          <Badge variant="outline" className="text-blue-400 border-blue-500/20 text-[10px]">
            <Lock className="size-2.5 ms-0.5" />
            <T>مجمّد</T>
          </Badge>
        )}
      </td>
    </tr>
  );
}

/** Enhanced observation list with full fields and expandable timeline. */
function EnhancedObservationList({
  items,
  categoryName,
  showPoints = false,
  showDetails = false,
  expandedId,
  onToggle,
}: {
  items: QualityObservation[];
  categoryName: Map<string, string>;
  showPoints?: boolean;
  showDetails?: boolean;
  expandedId: string | null;
  onToggle: (id: string) => void;
}) {
  const { locale } = useLanguage();
  return (
    <div className="space-y-1.5">
      {items.map((o) => {
        const isExpanded = expandedId === o.id;
        return (
          <div key={o.id}>
            <div
              className="flex items-start gap-2 py-1.5 cursor-pointer hover:bg-slate-700/10 rounded px-1 transition-colors"
              onClick={() => onToggle(o.id)}
            >
              <div className="flex items-center gap-2 pt-0.5">
                <ApprovalStatusBadge status={o.approvalStatus} />
                {o.severity && (
                  <span className={`text-[10px] ${SEVERITY_COLORS[o.severity] ?? 'text-slate-400'}`}>
                    {o.severity}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm text-slate-200 truncate">
                  {o.type || categoryName.get(o.categoryId || '') || o.categoryName || translateUIText('ملاحظة جودة', locale)}
                </p>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
                  <span>{o.observerName || ''}</span>
                  {o.observationDate && <span>{formatDate(o.observationDate, locale)}</span>}
                  {showDetails && o.categoryName && (
                    <span>{categoryName.get(o.categoryId || '') || o.categoryName}</span>
                  )}
                </div>
                {showDetails && o.notes && (
                  <p className="text-xs text-slate-400 truncate">{o.notes}</p>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {showPoints && (
                  <ScoreBadge
                    score={o.points}
                    className={o.isBonus
                      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}
                  />
                )}
                {o.approvalHistory && o.approvalHistory.length > 0 && (
                  <ChevronDown className={`size-3 text-slate-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Expanded observation timeline card — reuses buildTimeline + TimelineView. */
function ObservationTimelineCard({
  observation,
  onClose,
  categoryName,
}: {
  observation: QualityObservation | null;
  onClose: () => void;
  categoryName: Map<string, string>;
}) {
  const { locale } = useLanguage();
  const timeline = useMemo(() => {
    if (!observation) return [];
    return buildTimeline(
      observation.auditLog ?? [],
      observation.approvalHistory ?? [],
    );
  }, [observation]);

  if (!observation) return null;

  const catLabel = categoryName.get(observation.categoryId || '') || observation.categoryName || '';

  return (
    <Card className="bg-slate-800/40 border border-slate-700/30">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="size-4 text-slate-400" />
            <h4 className="text-sm font-semibold text-slate-200"><T>سجل الأحداث</T></h4>
          </div>
          <Button variant="ghost" size="sm" className="text-xs text-slate-400" onClick={onClose}>
            <ChevronUp className="size-3 ms-1" />
            <T>إغلاق</T>
          </Button>
        </div>
        {/* Observation summary */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="text-slate-300 border-slate-600/40">
            {observation.type || catLabel}
          </Badge>
          {observation.severity && (
            <Badge variant="outline" className={SEVERITY_COLORS[observation.severity]}>
              {observation.severity}
            </Badge>
          )}
          {catLabel && (
            <Badge variant="outline" className="text-slate-400 border-slate-600/40">
              {catLabel}
            </Badge>
          )}
          <span className="text-slate-500">
            {observation.observerName} — {formatDate(observation.observationDate, locale)}
          </span>
        </div>
        {observation.notes && (
          <p className="text-xs text-slate-300 bg-slate-800/60 rounded px-2 py-1 border border-slate-700/30">
            {observation.notes}
          </p>
        )}
        {/* Timeline — canonical buildTimeline output rendered by shared TimelineView */}
        <TimelineView
          points={timeline}
          emptyLabel={translateUIText('لا يوجد سجل أحداث لهذه الملاحظة', locale)}
          className="max-h-64 overflow-y-auto"
        />
      </CardContent>
    </Card>
  );
}

/** Centered empty hint. */
function EmptyHint({ label }: { label: ReactNode }) {
  return <p className="text-center text-xs text-slate-500 py-4">{label}</p>;
}
