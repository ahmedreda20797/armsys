'use client';

import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export type SidebarLogoVariant = 'expanded' | 'collapsed';

interface SidebarLogoProps {
  variant: SidebarLogoVariant;
  className?: string;
  /** Accessible name for the brand mark (decorative by default). */
  label?: string;
}

/**
 * SidebarLogo — the Qnlys mark using the OFFICIAL complete lockup assets.
 *
 * COLLAPSED  → Q mark only (centered). We show the COMPLETE official
 *               lockup but clip it to the Q glyph area via viewBox
 *               cropping so the transition to expanded is seamless.
 * EXPANDED   → Full official Qnlys wordmark (qnlys.svg dark /
 *               qnlys-print.svg light), intrinsic aspect ratio,
 *               fits within the sidebar width.
 *
 * Both states use the SAME asset; the difference is the viewBox
 * window and container width. No manual Q+nlys composition, no
 * absolute-positioned letters, no custom clip-path animations.
 * The brand reads Q→nlys physically (dir="ltr") independent of
 * the RTL application direction.
 */
export function SidebarLogo({ variant, className, label = 'Qnlys' }: SidebarLogoProps) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Official complete lockup: silver wordmark on dark, charcoal on light
  const lockupSrc = mounted && resolvedTheme === 'light' ? '/qnlys-print.svg' : '/qnlys.svg';

  if (variant === 'collapsed') {
    // Collapsed: show only the Q glyph by cropping the viewBox.
    // The official lockup is 1933×813; the Q occupies roughly
    // the first 35% (≈680px) of the width. We use a square viewBox
    // centered on the Q for a clean, stable mark that scales.
    return (
      <div className={cn('flex items-center justify-center', className)} aria-label={label} dir="ltr">
        <svg
          viewBox="0 0 680 813"
          width="36"
          height="36"
          aria-hidden="true"
          focusable="false"
          className="object-contain select-none"
        >
          <image href={lockupSrc} width="1933" height="813" />
        </svg>
      </div>
    );
  }

  // Expanded: full official lockup at intrinsic aspect ratio.
  // The sidebar expanded width (288px) accommodates the full
  // wordmark; we constrain max-width to the container and let
  // height scale proportionally.
  return (
    <div className={cn('flex items-center justify-center', className)} dir="ltr" aria-label={label}>
      <img
        src={lockupSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="h-10 w-auto max-w-full object-contain select-none"
      />
    </div>
  );
}
