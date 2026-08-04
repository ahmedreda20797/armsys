'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Award, ArrowDownCircle, ArrowUpCircle, Clock, TrendingDown, BarChart3,
} from 'lucide-react';
import { ScoreRing, ScoreBadge, TrendArrow, ApprovalStatusBadge } from '@/components/shared/kpi';
import { useKpiDashboard, useObservations, useObservationCategories } from '@/hooks/use-kpi-queries';
import type { QualityObservation } from '@/types/quality-kpi';

// ─── Helpers ──────────────────────────────────────────────────
const MONTH_LABELS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return monthKey;
  return `${MONTH_LABELS_AR[idx]} ${y}`;
}

// ─── Component ────────────────────────────────────────────────
/**
 * Employee 360 "Quality & KPIs" panel.
 *
 * Self-contained: fetches the employee's current-month KPI summary +
 * recent observations from the canonical APIs. Presentation-only —
 * no score computation on the client.
 */
export function EmployeeQualityKpiPanel({ employeeId }: { employeeId: string }) {
  // Employee-scoped dashboard for the current month.
  const { data: dashData, isLoading: dashLoading } = useKpiDashboard({
    range: 'current_month',
    employeeId,
  });
  // Employee's observations for the current month (all statuses).
  const { data: obsData } = useObservations({ employeeId, month: CURRENT_MONTH });
  const { data: catData } = useObservationCategories();

  const dash = (dashData ?? {}) as Record<string, unknown>;
  const observations = (Array.isArray(obsData) ? obsData : []) as QualityObservation[];
  const categories = (Array.isArray(catData) ? catData : []) as Array<{ id: string; name: string; color?: string }>;

  const categoryName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);

  // Split observations by status for the three lists.
  const { approved, pending, bonuses } = useMemo(() => {
    const app: QualityObservation[] = [];
    const pend: QualityObservation[] = [];
    const bonus: QualityObservation[] = [];
    for (const o of observations) {
      if (!o.applyPointDeduction) continue;
      if (o.approvalStatus === 'approved') {
        app.push(o);
        if (o.isBonus) bonus.push(o);
      } else if (o.approvalStatus === 'pending') {
        pend.push(o);
      }
    }
    return { approved: app, pending: pend, bonuses: bonus };
  }, [observations]);

  if (dashLoading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-40" />
      </div>
    );
  }

  const avgScore = (dash.avgScore as number) ?? 0;
  const maxScore = ((dash.settings as Record<string, number> | undefined)?.defaultScore) ?? 100;
  const trend = dash.trend as { direction: 'improving' | 'stable' | 'declining'; momDelta: number; sampleSize: number } | undefined;
  const totalDeductions = (dash.totalDeductions as number) ?? 0;
  const totalBonuses = (dash.totalBonuses as number) ?? 0;
  const pendingCount = (dash.pendingApprovals as number) ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      {/* Score + trend row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Score ring */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 flex flex-col items-center justify-center">
            <p className="text-xs text-slate-400 mb-2">درجة الجودة — {formatMonth(CURRENT_MONTH)}</p>
            <ScoreRing score={avgScore} max={maxScore} size={96} />
            {trend && trend.sampleSize > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <TrendArrow direction={trend.direction} delta={trend.momDelta} />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deductions / bonuses / pending */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-3">
            <StatRow icon={ArrowDownCircle} color="text-rose-400" label="نقاط الخصم" value={totalDeductions} />
            <StatRow icon={ArrowUpCircle} color="text-emerald-400" label="نقاط المكافأة" value={totalBonuses} />
            <StatRow icon={Clock} color="text-amber-400" label="بانتظار الاعتماد" value={pendingCount} />
          </CardContent>
        </Card>

        {/* Counts summary */}
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-3">
            <StatRow icon={Award} color="text-blue-400" label="ملاحظات معتمدة" value={approved.length} />
            <StatRow icon={ArrowUpCircle} color="text-emerald-400" label="منها مكافآت" value={bonuses.length} />
            <StatRow icon={Clock} color="text-amber-400" label="ملاحظات معلقة" value={pending.length} />
          </CardContent>
        </Card>
      </div>

      {/* Recent approved deductions */}
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-700/30">
            <TrendingDown className="size-4 text-rose-400" />
            <h4 className="text-sm font-semibold text-slate-200">أحدث الخصومات المعتمدة</h4>
          </div>
          {approved.length > 0 ? (
            <ObservationList items={approved.slice(0, 5)} categoryName={categoryName} showPoints />
          ) : (
            <EmptyHint label="لا توجد خصوم معتمدة هذا الشهر" />
          )}
        </CardContent>
      </Card>

      {/* Pending approvals */}
      <Card className="bg-slate-800/40 border border-slate-700/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-700/30">
            <Clock className="size-4 text-amber-400" />
            <h4 className="text-sm font-semibold text-slate-200">ملاحظات بانتظار الاعتماد</h4>
          </div>
          {pending.length > 0 ? (
            <ObservationList items={pending.slice(0, 5)} categoryName={categoryName} />
          ) : (
            <EmptyHint label="لا توجد ملاحظات معلقة" />
          )}
        </CardContent>
      </Card>

      {/* Category breakdown (bonus-specific list) */}
      {bonuses.length > 0 && (
        <Card className="bg-slate-800/40 border border-slate-700/30">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center gap-2 pb-2 border-b border-slate-700/30">
              <ArrowUpCircle className="size-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-slate-200">المكافآت المعتمدة</h4>
            </div>
            <ObservationList items={bonuses.slice(0, 5)} categoryName={categoryName} showPoints />
          </CardContent>
        </Card>
      )}

      {/* No data at all */}
      {observations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-slate-500">
          <BarChart3 className="size-10 mb-2 opacity-50" />
          <p className="text-sm">لا توجد ملاحظات جودة لهذا الموظف في الشهر الحالي</p>
        </div>
      )}
    </motion.div>
  );
}

// ─── Sub-components ───────────────────────────────────────────
function StatRow({
  icon: Icon, color, label, value,
}: {
  icon: typeof Award;
  color: string;
  label: string;
  value: number;
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

function ObservationList({
  items, categoryName, showPoints = false,
}: {
  items: QualityObservation[];
  categoryName: Map<string, string>;
  showPoints?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      {items.map((o) => (
        <div key={o.id} className="flex items-center gap-2 py-1.5">
          <ApprovalStatusBadge status={o.approvalStatus} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-200 truncate">
              {o.type || categoryName.get(o.categoryId || '') || o.categoryName || 'ملاحظة جودة'}
            </p>
            {o.notes && <p className="text-xs text-slate-500 truncate">{o.notes}</p>}
          </div>
          {showPoints && (
            <ScoreBadge
              score={o.points}
              className={o.isBonus
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}
            />
          )}
          {!showPoints && (
            <Badge variant="outline" className="text-slate-400 border-slate-600/40 text-[10px]">
              {o.isBonus ? 'مكافأة' : 'خصم'}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function EmptyHint({ label }: { label: string }) {
  return <p className="text-center text-xs text-slate-500 py-4">{label}</p>;
}
