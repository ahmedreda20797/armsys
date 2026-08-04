'use client';

import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TrendDirection } from '@/types/quality-kpi';

const TREND_CONFIG: Record<TrendDirection, { icon: typeof ArrowUp; className: string; label: string }> = {
  improving: { icon: ArrowUp, className: 'text-emerald-400', label: 'تحسن' },
  declining: { icon: ArrowDown, className: 'text-rose-400', label: 'تراجع' },
  stable: { icon: ArrowRight, className: 'text-slate-400', label: 'ثابت' },
};

interface TrendArrowProps {
  direction: TrendDirection;
  delta?: number;
  className?: string;
}

/** Arrow icon + optional delta showing score trend direction. */
export function TrendArrow({ direction, delta, className }: TrendArrowProps) {
  const config = TREND_CONFIG[direction] ?? TREND_CONFIG.stable;
  const Icon = config.icon;
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium', config.className, className)}>
      <Icon className="size-3.5" />
      {config.label}
      {delta !== undefined && delta !== 0 && (
        <span className="tabular-nums opacity-70">
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </span>
  );
}
