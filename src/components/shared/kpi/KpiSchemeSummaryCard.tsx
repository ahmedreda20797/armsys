'use client';

// ══════════════════════════════════════════════════════════════
//  KPI Framework (Phase 1) — minimal summary card
//
//  NOT a redesign: the smallest read-only surface needed to
//    • view the active scheme and its version,
//    • view component weights,
//    • understand the Quality contribution (raw score preserved —
//      never replaced by its weighted contribution),
//    • see the explicit INCOMPLETE company-KPI status while future
//      components have no adapter.
// ══════════════════════════════════════════════════════════════

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Percent, Layers, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EmployeeKpiResult, KpiScheme } from '@/lib/kpi-framework';

/** Arabic label for a component result status. */
const STATUS_LABELS_AR: Record<string, string> = {
  AVAILABLE: 'محسوب',
  PENDING: 'غير متاح حالياً',
  INCOMPLETE: 'غير مكتمل',
  NOT_ELIGIBLE: 'غير مشمول',
  ZERO: 'صفر (محسوب)',
  FINALIZED: 'معتمد',
};

/** Arabic label for a component owner. */
const OWNER_LABELS_AR: Record<string, string> = {
  quality: 'إدارة الجودة',
  management: 'الإدارة',
  hr: 'الموارد البشرية',
  sales: 'المبيعات',
  other: 'أخرى',
};

function StatusChip({ status }: { status: string }) {
  const computed = status === 'AVAILABLE' || status === 'ZERO' || status === 'FINALIZED';
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] px-1.5 py-0 h-auto',
        computed
          ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
          : 'text-amber-400 border-amber-500/30 bg-amber-500/10',
      )}
    >
      {STATUS_LABELS_AR[status] ?? status}
    </Badge>
  );
}

export interface KpiSchemeSummaryCardProps {
  /** The resolved scheme (active scheme view). */
  scheme: KpiScheme | null;
  /** The employee&apos;s framework result for a period, when viewing one. */
  result?: EmployeeKpiResult | null;
  /** Loading state for the data fetch. */
  loading?: boolean;
  className?: string;
}

/**
 * Read-only summary of the KPI scheme: weights per component and,
 * when a result is supplied, the raw-score / contribution breakdown.
 * The raw score (0–100) is always shown separately from its weighted
 * contribution — the two are never conflated.
 */
export function KpiSchemeSummaryCard({
  scheme,
  result,
  loading,
  className,
}: KpiSchemeSummaryCardProps) {
  if (loading) {
    return (
      <Card className={cn('bg-slate-800/30 border-slate-700/40', className)}>
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!scheme) {
    return (
      <Card className={cn('bg-slate-800/30 border-slate-700/40', className)}>
        <CardContent className="p-4 text-sm text-slate-400">
          لا يوجد نظام مؤشرات أداء نشط يسري على هذه الفترة
        </CardContent>
      </Card>
    );
  }

  const components = result?.components ?? scheme.components.filter((c) => c.status === 'ACTIVE');

  return (
    <Card className={cn('bg-slate-800/30 border-slate-700/40', className)}>
      <CardContent className="p-4 space-y-4">
        {/* Scheme header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Layers className="size-4 text-sky-400 shrink-0" />
              <span className="truncate">{scheme.name}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">
              إصدار {scheme.version}
              {scheme.effectiveFrom ? ` · ساري من ${scheme.effectiveFrom}` : ''}
              {scheme.effectiveTo ? ` حتى ${scheme.effectiveTo}` : ''}
            </div>
          </div>
          {result && (
            <Badge
              variant="outline"
              className={cn(
                'shrink-0',
                result.overallStatus === 'COMPLETE'
                  ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                  : 'text-amber-400 border-amber-500/30 bg-amber-500/10',
              )}
            >
              {result.overallStatus === 'COMPLETE' ? 'مؤشر الشركة مكتمل' : 'مؤشر الشركة غير مكتمل'}
            </Badge>
          )}
        </div>

        {/* Components breakdown */}
        <div className="space-y-2">
          {components.map((c) => {
            const hasValue = c.status !== 'PENDING' && c.rawScore !== null;
            return (
              <div
                key={c.componentId}
                className="rounded-lg border border-slate-700/40 bg-slate-900/40 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm text-slate-200 truncate">{c.name}</span>
                    <StatusChip status={c.status} />
                  </div>
                  <div className="flex items-center gap-1 text-xs text-slate-400 shrink-0">
                    <Percent className="size-3" />
                    <span className="font-semibold tabular-nums">{c.weight}%</span>
                  </div>
                </div>
                {hasValue && (
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400">
                    <span>
                      النتيجة الأصلية:{' '}
                      <span className="font-semibold text-slate-200 tabular-nums">{c.rawScore}%</span>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span>
                      المساهمة الموزونة:{' '}
                      <span className="font-semibold text-slate-200 tabular-nums">
                        {c.weightedContribution} / {c.maxContribution}
                      </span>
                    </span>
                    {result?.finalizedAt && (
                      <span className="inline-flex items-center gap-0.5 text-slate-500">
                        <Lock className="size-3" />
                        مجمّد
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Totals footer */}
        {result && (
          <div className="flex items-center justify-between text-xs border-t border-slate-700/40 pt-3">
            <span className="text-slate-400">
              إجمالي المساهمات المتاحة:{' '}
              <span className="font-semibold text-slate-200 tabular-nums">
                {result.weightedTotal} / {result.availableWeight}
              </span>
              {' '}من أصل 100
            </span>
            <span className="text-slate-500">
              {OWNER_LABELS_AR[scheme.components.find((c) => c.calculationType === 'quality_engine')?.owner ?? 'quality'] ?? ''}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
