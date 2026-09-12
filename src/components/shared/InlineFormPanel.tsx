'use client';

// ══════════════════════════════════════════════════════════════
//  InlineFormPanel — the ONE inline form host card (§12 standard)
//
//  Every inline create surface (CAPA-from-X, complaint-from-deal,
//  dashboard quick actions, …) previously re-implemented the same
//  motion card + header + close button. This component is the single
//  implementation:
//    • Title sits at the READING START (right in RTL).
//    • The close control sits at the far OPPOSITE end (justify-between,
//      shrink-0, guaranteed gap) — it can never crowd or overlap the
//      title, no matter how long the title gets (title truncates).
//    • Same entry/exit motion, border tone and body padding everywhere.
//
//  NOTE (close behavior): clicking OUTSIDE does not close inline form
//  panels — they hold unsaved form state, and outside-click would fire
//  while the user interacts with portal-based selects/date pickers.
//  The explicit close button (Escape-safe, always opposite the title)
//  remains the dismiss affordance, so the rule is: close control kept,
//  positioned at the opposite side of the title with real spacing.
// ══════════════════════════════════════════════════════════════

import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Static tailwind tone classes (never build class names dynamically). */
const TONE_CLASSES = {
  violet: 'border-violet-500/30 shadow-violet-900/20',
  rose: 'border-rose-500/30 shadow-rose-900/20',
  cyan: 'border-cyan-500/30 shadow-cyan-900/20',
  amber: 'border-amber-500/30 shadow-amber-900/20',
  emerald: 'border-emerald-500/30 shadow-emerald-900/20',
  slate: 'border-slate-600/40 shadow-black/40',
} as const;

export type InlineFormPanelTone = keyof typeof TONE_CLASSES;

export interface InlineFormPanelProps {
  /** Anchor id — callers scroll to this element when opening the panel. */
  id?: string;
  /** Small leading icon shown before the title (already colored). */
  icon?: React.ReactNode;
  /** Header title (truncates before it can ever reach the close button). */
  title: React.ReactNode;
  /** Card border/shadow tone — matches the triggering feature color. */
  tone?: InlineFormPanelTone;
  /** Close handler — wired to the standard close button. */
  onClose: () => void;
  /** Accessible label for the close button. */
  closeLabel?: string;
  /** Panel body (the actual form). */
  children: React.ReactNode;
  className?: string;
}

export function InlineFormPanel({
  id,
  icon,
  title,
  tone = 'violet',
  onClose,
  closeLabel = 'إغلاق',
  children,
  className,
}: InlineFormPanelProps) {
  return (
    <motion.div
      id={id}
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
      className={cn(
        'rounded-2xl border bg-slate-900/60 backdrop-blur-md shadow-2xl',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {/* Header — title at the reading start, close pinned to the far
          opposite end. gap-3 + shrink-0 guarantee spacing even when the
          title is long (it truncates first, the button never moves). */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-700/50">
        <p className="flex items-center gap-2 min-w-0 text-xs font-bold text-slate-200">
          {icon}
          <span className="truncate">{title}</span>
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label={closeLabel}
          title={closeLabel}
          className="h-7 shrink-0 gap-1 px-2 text-xs text-slate-400 hover:text-white"
        >
          <X className="size-3.5" />
          {closeLabel}
        </Button>
      </div>
      <div className="p-4">{children}</div>
    </motion.div>
  );
}
