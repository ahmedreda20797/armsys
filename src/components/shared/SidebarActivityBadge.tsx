'use client';

// ══════════════════════════════════════════════════════════════
//  SidebarActivityBadge — the ONE sidebar counter/badge pattern
//  (§SIDEBAR-BADGES + §APPROVAL-NOTIFY)
//
//  Two tones:
//    violet — "unseen" new items (cleared by visiting the page)
//    amber  — "action needed" (e.g. pending approvals; cleared only
//             by the decision itself, never by visiting)
//
//  Counts come from /api/unseen and are already filtered by the
//  viewer's permissions server-side — this component is display-only.
// ══════════════════════════════════════════════════════════════

import { cn } from '@/lib/utils';

export type SidebarBadgeTone = 'violet' | 'amber';

const TONE_STYLES: Record<SidebarBadgeTone, { pill: string; dot: string }> = {
  violet: {
    pill: 'bg-brand-500/25 border border-brand-300/40 text-brand-100',
    dot: 'bg-brand-400',
  },
  amber: {
    pill: 'bg-amber-500 text-slate-950 font-extrabold',
    dot: 'bg-amber-400',
  },
};

export function SidebarActivityBadge({
  count,
  tone = 'violet',
  title,
  variant = 'pill',
}: {
  count: number;
  tone?: SidebarBadgeTone;
  title: string;
  /** pill = inline counter; dot = rail icon dot. */
  variant?: 'pill' | 'dot';
}) {
  if (count <= 0) return null;
  const styles = TONE_STYLES[tone];
  if (variant === 'dot') {
    return (
      <span
        className={cn('absolute -top-0.5 -left-0.5 size-2 rounded-full ring-2 ring-slate-900', styles.dot)}
        title={title}
        aria-label={title}
      />
    );
  }
  return (
    <span
      className={cn(
        'mr-auto shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[10px] font-bold tabular-nums',
        styles.pill,
      )}
      title={title}
      aria-label={title}
    >
      {count > 99 ? '+99' : count}
    </span>
  );
}
