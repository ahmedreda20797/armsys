'use client';

// ══════════════════════════════════════════════════════════════
//  PageHeaderBar — the ONE unified page identity (§7 + §HEADER-V3)
//
//  IDENTITY CONTRACT (§HEADER-V3): the page's identity — icon ·
//  title · description — is REGISTERED INTO the global app Header
//  (usePageIdentity) and rendered in its compact PAGE-IDENTITY zone.
//  This bar no longer repeats the large title inside the page
//  content: it renders only the page's actionable row (primary
//  create + contextual actions) and its extras (period indicators…).
//  Pages declare identity exactly as before — same props, new home.
//
//  BEHAVIORAL CONTRACT: the global app Header is the fixed surface.
//  The page action row is NOT sticky. The page's PRIMARY create
//  action lives here while the row is on screen; once the user
//  scrolls past it, this bar registers the action into the app store
//  and the global Header animates it in — ONE effective primary
//  create action at any moment. Utility actions (upload/export/
//  import) are NEVER registered; they stay in the page context.
//
//  Implementation: IntersectionObserver with a rootMargin matching
//  the app header height (h-12 = 3rem) — readiness/state-driven,
//  no scroll-throttling hacks, no timers. The observer fires only
//  on visibility transitions (not on scroll ticks).
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { usePageIdentity } from '@/hooks/use-page-header';

export interface PagePrimaryAction {
  /** Button label, e.g. "إضافة موظف". */
  label: string;
  onClick: () => void;
}

export interface PageHeaderBarProps {
  icon: React.ReactNode;
  /**
   * Tile styling around the in-page icon (legacy — the icon now lives
   * in the Header's neutral identity tile). Accepted for
   * compatibility; no longer rendered.
   */
  iconClassName?: string;
  title: string;
  /**
   * One-line purpose statement under the title (§HEADER-V3 subtitle
   * in the Header). Pass explicitly for dynamic text; pages built
   * from APP_PAGES can omit it when the registry description is
   * already right.
   */
  description?: React.ReactNode;
  /** Legacy alias — registered the same as `description`. */
  subtitle?: React.ReactNode;
  /** Primary create action (the ONLY one that can migrate to the global Header). */
  primaryAction?: PagePrimaryAction;
  /** Secondary/contextual actions (stay in the page — never migrate). */
  actions?: React.ReactNode;
  /** Extra context row (period indicator etc.) — stays in the page. */
  extras?: React.ReactNode;
}

export function PageHeaderBar({
  icon,
  title,
  description,
  subtitle,
  primaryAction,
  actions,
  extras,
}: PageHeaderBarProps) {
  const identityLine = description ?? subtitle;

  // §HEADER-V3 — identity moves INTO the global Header (icon · title ·
  // context line). No in-page repetition of the same large title.
  usePageIdentity({ title, description: identityLine, icon });

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
        // the app header line (top edge above 48px) — never when the
        // bar is merely below the fold.
        if (!entry.isIntersecting && entry.boundingClientRect.top < 48) {
          setHeaderCreateAction({ label, onClick: () => onClickRef.current?.() });
        } else {
          setHeaderCreateAction(null);
        }
      },
      // 48px = the app header height (h-12) — the action belongs to the
      // header the moment the page action row crosses under it.
      { rootMargin: '-48px 0px 0px 0px', threshold: 0 },
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
      className="flex flex-col gap-2"
    >
      {extras && <div>{extras}</div>}
      {(primaryAction || actions) && (
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap overflow-x-auto sm:overflow-visible pb-0.5 sm:pb-0 justify-end">
          {/* §7: primary create action — first, visually distinct. It is
              the SAME action the global Header hosts while scrolling. */}
          {primaryAction && (
            <Button
              onClick={primaryAction.onClick}
              size="sm"
              className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-4 shadow-lg shadow-brand-500/20 transition-all whitespace-nowrap"
            >
              <Plus className="size-4 ml-1" />
              {primaryAction.label}
            </Button>
          )}
          {actions}
        </div>
      )}
    </motion.div>
  );
}
