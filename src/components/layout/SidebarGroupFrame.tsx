'use client';

// ══════════════════════════════════════════════════════════════
//  SidebarGroupFrame — §SIDEBAR-GROUP-FRAME
//
//  The visual container of an EXPANDED navigation group: a transparent
//  glass surface whose 1px Qnalys boundary is DRAWN as one continuous
//  SVG path (top-center → inline-start side → bottom → wrap around →
//  back to the start point) and RETRACTED in reverse on close — the
//  same line pulled back to its origin, never a border that fades.
//
//  Used by BOTH sidebar surfaces with the same logic:
//    • expanded surface — frame around header + page rows;
//    • collapsed rail — frame around the group icon + its page icons
//      (§UNIFIED-RAIL parity: the identical draw/retract contract).
//
//  Fully state-driven: a CSS transition + one keyframe on
//  stroke-dashoffset. `pathLength={100}` normalizes the perimeter, so
//  the same dash values fit ANY group height — 3 items or 8, Arabic
//  or English, any sidebar width. No hardcoded geometry.
//
//  Geometry is derived from the REAL content box: a ResizeObserver
//  writes viewBox/path data straight to the SVG attributes (zero
//  React state updates, no timers, disconnected on unmount), so the
//  frame refits live while framer animates the item list height.
// ══════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Half the stroke width — keeps the 1px path crisp inside the viewBox. */
const STROKE_INSET = 0.5;
/** Default frame corner radius — a small radius, per the glass-frame spec. */
const DEFAULT_CORNER_RADIUS = 10;

/**
 * Rounded-rect perimeter as ONE continuous path, starting at the TOP
 * CENTER and travelling toward the inline-start side (left in the
 * base geometry — the SVG is mirrored via CSS in RTL), down along the
 * items, around the bottom, and back to the exact start point.
 */
function framePathD(width: number, height: number, cornerRadius: number): string {
  const g = STROKE_INSET;
  const r = Math.min(cornerRadius, (width - 2 * g) / 2, (height - 2 * g) / 2);
  if (r <= 0) return '';
  const startX = width / 2;
  const leftX = g + r;
  const rightX = width - g - r;
  const topY = g + r;
  const bottomY = height - g - r;
  return [
    `M ${startX} ${g}`,
    `L ${leftX} ${g}`,
    `Q ${g} ${g} ${g} ${topY}`,
    `L ${g} ${bottomY}`,
    `Q ${g} ${height - g} ${leftX} ${height - g}`,
    `L ${rightX} ${height - g}`,
    `Q ${width - g} ${height - g} ${width - g} ${bottomY}`,
    `L ${width - g} ${topY}`,
    `Q ${width - g} ${g} ${rightX} ${g}`,
    `L ${startX} ${g}`,
  ].join(' ');
}

interface SidebarGroupFrameProps {
  /** Group expanded? Drives draw (open) / retract (close) of the frame. */
  open: boolean;
  children: React.ReactNode;
  className?: string;
  /** Frame corner radius (px) — shared by the drawn path and the glass. */
  radius?: number;
}

export function SidebarGroupFrame({ open, children, className, radius = DEFAULT_CORNER_RADIUS }: SidebarGroupFrameProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pathRef = useRef<SVGPathElement | null>(null);

  // §SIDEBAR-GROUP-FRAME — geometry tracking. The observer only acts
  // when dimensions actually change (group open/close animation,
  // sidebar width, font load) and writes straight to the DOM so React
  // never re-renders; disconnected on unmount.
  useEffect(() => {
    const box = boxRef.current;
    const svg = svgRef.current;
    const path = pathRef.current;
    if (!box || !svg || !path) return;
    let last = '';
    const sync = () => {
      const w = Math.round(box.clientWidth);
      const h = Math.round(box.clientHeight);
      if (w < 8 || h < 8) return;
      const key = `${w}:${h}`;
      if (key === last) return;
      last = key;
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      path.setAttribute('d', framePathD(w, h, radius));
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    return () => observer.disconnect();
  }, [radius]);

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      {/* Glass surface — fades with the frame; it owns NO border: the
          drawn path below is the boundary. */}
      <div
        aria-hidden="true"
        style={{ borderRadius: radius }}
        className={cn(
          'sidebar-group-frame-glass pointer-events-none absolute inset-0 transition-opacity duration-300 ease-out',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      {/* The drawn boundary. Mirrored in RTL via CSS so the line always
          travels down the INLINE-START side first. */}
      <svg
        ref={svgRef}
        aria-hidden="true"
        className="sidebar-group-frame-svg pointer-events-none absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
      >
        <path
          ref={pathRef}
          pathLength={100}
          fill="none"
          className="sidebar-group-frame-path"
          data-open={open ? 'true' : 'false'}
        />
      </svg>
      {children}
    </div>
  );
}
