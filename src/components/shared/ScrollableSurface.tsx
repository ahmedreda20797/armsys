'use client';

// ══════════════════════════════════════════════════════════════
//  ScrollableSurface — the ONE reusable bounded internal-scroll
//  region (§UX-STRUCTURE PART 5 / PART 16).
//
//  A long data surface should be:
//    Surface Header (stays visible)
//    ────────────────────────────
//    scrollable data region  ← this component
//    ────────────────────────────
//
//  It wraps the canonical `.arm-scroll` utility (global thin
//  scrollbar tokens, overscroll containment, stable gutter) so
//  every internal scroll region looks and behaves identically —
//  dark/light, RTL/LTR, keyboard reachable. Never reintroduce
//  page-specific scrollbar styles or max-height hacks.
// ══════════════════════════════════════════════════════════════

import { cn } from '@/lib/utils';

export interface ScrollableSurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Bounded height — the region scrolls internally within it. */
  maxHeight?: string;
  /** Accessible label for the scroll region (a11y §PART 19). */
  label?: string;
  /** Rendered element (div by default). */
  as?: 'div' | 'nav' | 'section';
}

export function ScrollableSurface({
  maxHeight = 'min(60vh, 480px)',
  label,
  className,
  style,
  as = 'div',
  children,
  ...rest
}: ScrollableSurfaceProps) {
  const Tag = as;
  return (
    <Tag
      role={label ? 'region' : undefined}
      aria-label={label}
      tabIndex={label ? 0 : undefined}
      className={cn('arm-scroll overscroll-contain', className)}
      style={{ maxHeight, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
