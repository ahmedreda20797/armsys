'use client';

// ══════════════════════════════════════════════════════════════
//  Employee 360 — shared presentation primitives (rebuild)
//
//  ONE design language for every section: semantic theme tokens
//  (dark + light), restrained brand accents, explicit data states.
//  States are NEVER conflated:
//    • لا توجد بيانات        — the canonical source has no records
//    • غير متوفر / غير مؤمل  — unknown (e.g. closure date unknown)
//    • لا تملك صلاحية        — section denied server-side
//    • يتطلب إعداداً         — configuration missing (no scheme, …)
// ══════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { ChevronLeft, Info, Lock, Settings2, Sparkles } from 'lucide-react';
import { T } from '@/lib/i18n/T';
import { cn } from '@/lib/utils';

/* ── Section shell ──────────────────────────────────────────── */

export function SectionShell({
  title,
  icon,
  periodLabel,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  icon: React.ReactNode;
  /** Explicit period label — sections never silently mix periods. */
  periodLabel?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 26 }}
      className={cn('rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-3.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 border border-brand-500/20">
            {icon}
          </div>
          <h3 className="text-sm font-semibold text-foreground truncate">{title}</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {periodLabel && (
            <span className="rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
              {periodLabel}
            </span>
          )}
          {actions}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </motion.section>
  );
}

/* ── Metric tile (compact, scannable) ───────────────────────── */

export type MetricTone = 'neutral' | 'good' | 'warn' | 'bad' | 'brand';

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: 'text-foreground',
  good: 'text-emerald-500 dark:text-emerald-400',
  warn: 'text-amber-500 dark:text-amber-400',
  bad: 'text-red-500 dark:text-red-400',
  brand: 'text-brand-600 dark:text-brand-400',
};

export function MetricTile({
  label,
  value,
  sub,
  tone = 'neutral',
  onClick,
  big,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: MetricTone;
  onClick?: () => void;
  big?: boolean;
}) {
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        'rounded-xl border border-border/50 bg-muted/30 px-3.5 py-3 text-start transition-colors',
        interactive && 'hover:bg-muted/60 hover:border-border cursor-pointer',
        !interactive && 'cursor-default',
      )}
    >
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-bold leading-tight', big ? 'text-2xl' : 'text-lg', TONE_TEXT[tone])}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </button>
  );
}

/* ── Explicit state lines ───────────────────────────────────── */

export function EmptyState({ text }: { text: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Info className="size-5 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export function NoPermissionState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Lock className="size-5 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground"><T>لا تملك صلاحية عرض هذا القسم</T></p>
    </div>
  );
}

export function ConfigRequiredState({ text }: { text?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <Settings2 className="size-5 text-amber-500/70" />
      <p className="text-sm text-amber-600 dark:text-amber-400">
        {text ?? <T>يتطلب إعداداً — لا يمكن عرض قيمة بدون إعدادات محددة</T>}
      </p>
    </div>
  );
}

/* ── Semantic score tones ───────────────────────────────────── */

/** Semantic color for a 0–100 score — green/amber/red by band, never brand-red for decoration. */
export function scoreTone(score: number | null | undefined): MetricTone {
  if (score === null || score === undefined) return 'neutral';
  if (score >= 85) return 'good';
  if (score >= 70) return 'warn';
  return 'bad';
}

/* ── Sparkline (compact trend, RTL-safe: pure value path) ───── */

export function Sparkline({
  values,
  className,
  strokeClass = 'stroke-brand-500',
}: {
  /** Values oldest → newest; null = unavailable month (gap). */
  values: Array<number | null>;
  className?: string;
  strokeClass?: string;
}) {
  const usable = values.filter((v): v is number => v !== null);
  if (usable.length < 2) return null;
  const W = 160;
  const H = 40;
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  const span = max - min || 1;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  // Build the path with gaps for unavailable points.
  let d = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = (i * step).toFixed(1);
    const y = (H - 4 - ((v - min) / span) * (H - 8)).toFixed(1);
    d += `${pen ? 'L' : 'M'}${x} ${y} `;
    pen = true;
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-10 w-full', className)} aria-hidden>
      <path d={d} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={strokeClass} />
    </svg>
  );
}

/* ── Delta chip (+3 / −2 in percentage points) ──────────────── */

export function DeltaChip({ delta, suffix = '' }: { delta: number | null; suffix?: string }) {
  if (delta === null || delta === undefined) return null;
  const positive = delta > 0;
  const neutral = delta === 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold',
        neutral
          ? 'bg-muted/60 text-muted-foreground'
          : positive
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-500/10 text-red-600 dark:text-red-400',
      )}
      dir="ltr"
    >
      {positive ? '+' : ''}{delta}{suffix}
    </span>
  );
}

/* ── Section divider (typographic, not another card) ────────── */

export function SectionDivider({ label }: { label: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-4">
      <div className="h-px flex-1 bg-border/60" />
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="size-3" />
        {label}
      </span>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}

/* ── "View evidence" affordance ─────────────────────────────── */

export function DrillLink({ onClick, label }: { onClick: () => void; label: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
    >
      {label}
      <ChevronLeft className="size-3.5 rtl:rotate-180" />
    </button>
  );
}
