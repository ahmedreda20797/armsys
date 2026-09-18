'use client';

// ══════════════════════════════════════════════════════════════
//  CompactMetricCard — the ONE unified metric/stat card (§8)
//
//  Replaces the per-page copy-pasted StatCard/StatBox/QuickStatCard
//  implementations. Two densities:
//    compact  — single row (icon · label · value) for metric grids
//    standard — stacked label/value with room for a trend line
//  Tone drives the value color only — the card shell stays uniform
//  so every page's metric row reads as one system.
// ══════════════════════════════════════════════════════════════

import { memo } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MetricTone = 'default' | 'positive' | 'warning' | 'danger' | 'info' | 'violet';

const TONE_VALUE: Record<MetricTone, string> = {
  default: 'text-white',
  positive: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-red-400',
  info: 'text-cyan-400',
  violet: 'text-brand-300',
};

const TONE_ICON: Record<MetricTone, string> = {
  default: 'bg-slate-600/20 text-slate-300',
  positive: 'bg-emerald-500/10 text-emerald-400',
  warning: 'bg-amber-500/10 text-amber-400',
  danger: 'bg-red-500/10 text-red-400',
  info: 'bg-cyan-500/10 text-cyan-400',
  violet: 'bg-brand-500/10 text-brand-300',
};

export interface CompactMetricCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  tone?: MetricTone;
  trend?: { direction: 'up' | 'down' | 'neutral'; label?: string };
  /** compact = one-row tile (default); standard = stacked with subtitle room. */
  density?: 'compact' | 'standard';
  hint?: string;
  onClick?: () => void;
  className?: string;
}

export const CompactMetricCard = memo(function CompactMetricCard({
  label,
  value,
  icon,
  tone = 'default',
  trend,
  density = 'compact',
  hint,
  onClick,
  className,
}: CompactMetricCardProps) {
  const interactive = typeof onClick === 'function';

  const TrendMark = trend ? (
    <span
      className={cn(
        'flex items-center gap-0.5 text-[10px] font-semibold',
        trend.direction === 'up' && 'text-red-400',
        trend.direction === 'down' && 'text-emerald-400',
        trend.direction === 'neutral' && 'text-slate-500',
      )}
    >
      {trend.direction === 'up' ? (
        <ArrowUpRight className="size-3" />
      ) : trend.direction === 'down' ? (
        <ArrowDownRight className="size-3" />
      ) : (
        <Minus className="size-3" />
      )}
      {trend.label}
    </span>
  ) : null;

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      title={hint}
      className={cn(
        'group relative rounded-xl border border-slate-700/40 bg-slate-800/40 backdrop-blur-sm px-3 py-2.5 transition-colors',
        interactive && 'cursor-pointer hover:border-brand-500/40 hover:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
        className,
      )}
    >
      {density === 'compact' ? (
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && (
            <span className={cn('flex items-center justify-center size-8 rounded-lg shrink-0', TONE_ICON[tone])}>
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-slate-500 font-medium truncate leading-tight">{label}</p>
            <div className="flex items-baseline gap-1.5">
              <span className={cn('text-lg font-bold tabular-nums leading-tight', TONE_VALUE[tone])}>{value}</span>
              {TrendMark}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <p className="text-[10px] text-slate-500 font-medium truncate leading-tight">{label}</p>
            <span className={cn('block text-2xl font-bold tabular-nums leading-tight mt-0.5', TONE_VALUE[tone])}>{value}</span>
            {hint && <p className="text-[10px] text-slate-600 truncate mt-0.5">{hint}</p>}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {icon && (
              <span className={cn('flex items-center justify-center size-8 rounded-lg', TONE_ICON[tone])}>
                {icon}
              </span>
            )}
            {TrendMark}
          </div>
        </div>
      )}
    </div>
  );
});
