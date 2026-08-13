'use client';

import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RankMedal } from './RankMedal';
import { ScoreBadge } from './ScoreDisplay';
import type { RankedEmployee } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Leaderboard — shared ranked-employee list (presentation only)
//
//  Renders the backend-provided ranked entries. No ranking, scoring
//  or trend logic lives here — the entries arrive already ordered by
//  the canonical KPI engine / dashboard aggregator.
//
//  • variant 'top'    → ranks 1..n (gold/silver/bronze via RankMedal)
//  • variant 'bottom' → uses each entry's backend rank (worst-first)
// ─────────────────────────────────────────────────────────────

interface LeaderboardEntry extends RankedEmployee {
  /** Optional richer fields supplied by the dashboard contract. */
  position?: string;
  deductionPoints?: number;
  bonusPoints?: number;
}

interface LeaderboardProps {
  entries: LeaderboardEntry[];
  variant?: 'top' | 'bottom';
  /** Called with the employeeId when a row is clicked (optional). */
  onSelect?: (employeeId: string) => void;
  emptyLabel?: string;
  /** Max rows to render (defaults to 10). */
  maxItems?: number;
  className?: string;
}

export function Leaderboard({
  entries,
  variant = 'top',
  onSelect,
  emptyLabel = 'لا توجد بيانات. تظهر القائمة بعد إغلاق الشهر.',
  maxItems = 10,
  className,
}: LeaderboardProps) {
  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Trophy className="size-8 text-slate-600 mb-2" />
        <p className="text-xs text-slate-500 max-w-xs">{emptyLabel}</p>
      </div>
    );
  }

  const rows = entries.slice(0, maxItems);

  return (
    <div className={cn('space-y-1', className)}>
      {rows.map((emp, i) => {
        const rank = variant === 'top' ? i + 1 : emp.rank;
        const interactive = typeof onSelect === 'function';
        return (
          <div
            key={emp.employeeId}
            onClick={interactive ? () => onSelect?.(emp.employeeId) : undefined}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors',
              interactive && 'hover:bg-slate-800/50 cursor-pointer',
            )}
          >
            <div className="w-7 flex justify-center shrink-0">
              <RankMedal rank={rank} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-100 truncate">{emp.employeeName}</p>
              <p className="text-xs text-slate-400 truncate">
                {emp.department}
                {emp.position ? ` · ${emp.position}` : ''}
              </p>
            </div>
            {emp.bonusPoints !== undefined && emp.bonusPoints > 0 && (
              <span className="text-[11px] text-emerald-400 tabular-nums shrink-0">+{emp.bonusPoints}</span>
            )}
            {emp.deductionPoints !== undefined && emp.deductionPoints > 0 && (
              <span className="text-[11px] text-rose-400 tabular-nums shrink-0">-{emp.deductionPoints}</span>
            )}
            <ScoreBadge score={emp.score} />
          </div>
        );
      })}
    </div>
  );
}

export default Leaderboard;
