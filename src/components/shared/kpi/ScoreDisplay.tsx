'use client';

import { cn } from '@/lib/utils';

const SCORE_BANDS = [
  { min: 90, className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
  { min: 75, className: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
  { min: 50, className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { min: 0, className: 'text-rose-400 bg-rose-500/10 border-rose-500/20' },
] as const;

function bandClass(score: number): string {
  return (SCORE_BANDS.find((b) => score >= b.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1]).className;
}

interface ScoreBadgeProps {
  score: number;
  max?: number;
  className?: string;
}

/** Circular badge showing a KPI score with color band. */
export function ScoreBadge({ score, max = 100, className }: ScoreBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-lg border px-2.5 py-0.5 text-sm font-bold tabular-nums',
        bandClass(score),
        className,
      )}
    >
      {score}
      {max !== 100 && <span className="text-xs opacity-60">/{max}</span>}
    </span>
  );
}

interface ScoreRingProps {
  score: number;
  max?: number;
  size?: number;
}

/** Circular progress ring for prominent score display (dashboard cards). */
export function ScoreRing({ score, max = 100, size = 80 }: ScoreRingProps) {
  const pct = Math.max(0, Math.min(1, max > 0 ? score / max : 0));
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct);

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          className="text-slate-700"
          stroke="currentColor"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={4}
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={bandClass(score).split(' ')[0]}
        />
      </svg>
      <span className="absolute text-lg font-bold tabular-nums">{score}</span>
    </div>
  );
}
