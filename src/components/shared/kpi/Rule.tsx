'use client';

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─────────────────────────────────────────────────────────────
//  Rule — presentational KPI rule / parameter tile
//
//  Displays a single configured rule (e.g. defaultScore, maximumBonus)
//  as a labeled value. Pure presentation — no business meaning, no
//  mutation. Tone only affects the accent color.
// ─────────────────────────────────────────────────────────────

export type RuleTone = 'default' | 'positive' | 'negative' | 'pending';

const TONE_ACCENT: Record<RuleTone, string> = {
  default: 'bg-slate-500/10 text-slate-300',
  positive: 'bg-emerald-500/10 text-emerald-400',
  negative: 'bg-rose-500/10 text-rose-400',
  pending: 'bg-amber-500/10 text-amber-400',
};

interface RuleProps {
  label: string;
  /** The rule's value (string or node so booleans/numbers can be styled). */
  value: React.ReactNode;
  description?: string;
  icon?: LucideIcon;
  tone?: RuleTone;
  className?: string;
}

export function Rule({
  label,
  value,
  description,
  icon: Icon,
  tone = 'default',
  className,
}: RuleProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-slate-700/40 bg-slate-800/30 px-3 py-2.5',
        className,
      )}
    >
      {Icon && (
        <div className={cn('size-9 rounded-lg flex items-center justify-center shrink-0', TONE_ACCENT[tone])}>
          <Icon className="size-4.5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-slate-400 truncate">{label}</p>
        <p className="text-sm font-semibold text-slate-100 tabular-nums">{value}</p>
        {description && <p className="text-[11px] text-slate-500 truncate">{description}</p>}
      </div>
    </div>
  );
}

export default Rule;
