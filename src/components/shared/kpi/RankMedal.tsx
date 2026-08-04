'use client';

import { cn } from '@/lib/utils';
import { Crown, Medal, Award } from 'lucide-react';

const MEDAL_CONFIG: Record<number, { icon: typeof Crown; className: string }> = {
  1: { icon: Crown, className: 'text-amber-400' },
  2: { icon: Medal, className: 'text-slate-300' },
  3: { icon: Award, className: 'text-orange-400' },
};

interface RankMedalProps {
  rank: number;
  className?: string;
}

/** Medal icon for leaderboard top-3 ranks; plain number for others. */
export function RankMedal({ rank, className }: RankMedalProps) {
  const config = MEDAL_CONFIG[rank];
  if (config) {
    const Icon = config.icon;
    return <Icon className={cn('size-5', config.className, className)} />;
  }
  return (
    <span className={cn('text-sm font-bold text-slate-500 tabular-nums', className)}>
      {rank}
    </span>
  );
}
