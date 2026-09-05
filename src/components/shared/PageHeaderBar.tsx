'use client';

// ══════════════════════════════════════════════════════════════
//  PageHeaderBar — unified page header (UX Corrections §7)
//
//  BEHAVIORAL CONTRACT: the global app Header is the fixed surface.
//  The page header is NOT sticky. The page's PRIMARY create action
//  lives here while the header is on screen; once the user scrolls
//  past it, PageHeaderBar registers the action into the app store
//  and the global Header animates it in — ONE effective primary
//  create action at any moment. Utility actions (upload/export/
//  import) are NEVER registered; they stay in the page context.
//
//  Implementation: IntersectionObserver with a rootMargin matching
//  the app header height (h-16 = 4rem) — readiness/state-driven,
//  no scroll-throttling hacks, no timers. The observer fires only
//  on visibility transitions (not on scroll ticks).
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';

export interface PagePrimaryAction {
  /** Button label, e.g. "إضافة موظف". */
  label: string;
  onClick: () => void;
}

export interface PageHeaderBarProps {
  icon: React.ReactNode;
  /** Tile styling around the icon, e.g. "bg-rose-500/15 border-rose-500/30 text-rose-400". */
  iconClassName?: string;
  title: string;
  subtitle?: React.ReactNode;
  /** Primary create action (the ONLY one that can migrate to the global Header). */
  primaryAction?: PagePrimaryAction;
  /** Secondary/contextual actions (stay in the page — never migrate). */
  actions?: React.ReactNode;
  /** Extra context row shown under the title (period indicator etc.). */
  extras?: React.ReactNode;
}

export function PageHeaderBar({
  icon,
  iconClassName = 'bg-violet-500/15 border-violet-500/30 text-violet-400',
  title,
  subtitle,
  primaryAction,
  actions,
  extras,
}: PageHeaderBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  // The onClick closure lives in a ref so the observer does not need
  // to be re-created when the parent re-renders with a new closure.
  // (Synced in an effect — refs are never written during render.)
  const onClickRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    onClickRef.current = primaryAction?.onClick;
  }, [primaryAction?.onClick]);
  const label = primaryAction?.label;

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const setHeaderCreateAction = useAppStore.getState().setHeaderCreateAction;

    if (!label) {
      setHeaderCreateAction(null);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Header becomes the host ONLY when the bar has scrolled above
        // the app header line (top edge above 64px) — never when the
        // bar is merely below the fold.
        if (!entry.isIntersecting && entry.boundingClientRect.top < 64) {
          setHeaderCreateAction({ label, onClick: () => onClickRef.current?.() });
        } else {
          setHeaderCreateAction(null);
        }
      },
      // 64px = the app header height (h-16) — the action belongs to the
      // header the moment the page header crosses under it.
      { rootMargin: '-64px 0px 0px 0px', threshold: 0 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      // Leaving the page always clears the global slot.
      useAppStore.getState().setHeaderCreateAction(null);
    };
  }, [label]);

  return (
    <motion.div
      ref={barRef}
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`flex items-center justify-center size-10 rounded-xl border shrink-0 ${iconClassName}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white truncate">{title}</h1>
          {subtitle && <div className="text-slate-500 text-xs mt-0.5">{subtitle}</div>}
          {extras && <div className="mt-1.5">{extras}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-x-auto sm:overflow-visible pb-0.5 sm:pb-0 shrink-0">
        {/* §7: primary create action — first, visually distinct. It is
            the SAME action the global Header hosts while scrolling. */}
        {primaryAction && (
          <Button
            onClick={primaryAction.onClick}
            size="sm"
            className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-4 shadow-lg shadow-violet-500/20 transition-all whitespace-nowrap"
          >
            <Plus className="size-4 ml-1" />
            {primaryAction.label}
          </Button>
        )}
        {actions}
      </div>
    </motion.div>
  );
}
