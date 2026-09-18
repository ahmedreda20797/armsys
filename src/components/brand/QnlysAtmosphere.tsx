'use client';

import { memo } from 'react';

// ══════════════════════════════════════════════════════════════
//  QnlysAtmosphere — the "data intelligence" ambient layer for the
//  Login brand zone and the Loading screen ONLY. PersistentBackground
//  remains the app-wide canvas (base + glows + vignette); this is a
//  scoped decorative layer on top of it, not a second background
//  system. All styling lives in globals.css (§LOGIN ATMOSPHERE).
//
//  Inspired by DATA + ANALYSIS + OPERATIONS + QUALITY:
//    • a fine analytical grid (radially masked, fades at edges)
//    • three thin flowing signal curves (brand-red gradient)
//    • sparse monitoring points with a slow opacity pulse
//  Extremely restrained by design — never competes with the logo
//  or the login form. pointer-events-none, aria-hidden, GPU/paint-
//  only motion, fully disabled under prefers-reduced-motion.
// ══════════════════════════════════════════════════════════════

/** Sparse signal points — pinned to the periphery (corners/edges) so
    they never sit under content, with staggered pulse delays. */
const SIGNAL_POINTS = [
  { top: '12%', left: '7%', delay: '0s' },
  { top: '18%', left: '90%', delay: '1.4s' },
  { top: '46%', left: '3.5%', delay: '2.6s' },
  { top: '54%', left: '95%', delay: '0.8s' },
  { top: '88%', left: '12%', delay: '3.4s' },
  { top: '82%', left: '80%', delay: '2s' },
] as const;

export const QnlysAtmosphere = memo(function QnlysAtmosphere({
  className = '',
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {/* Fine analytical grid, radially masked toward the edges */}
      <div className="qnlys-amb-grid absolute inset-0" />

      {/* Flowing signal curves — thin brand-red paths drifting slowly */}
      <svg
        className="qnlys-amb-svg absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <defs>
          <linearGradient id="qnlys-amb-flow" x1="0" y1="0" x2="1" y2="0">
            <stop stopColor="#c22334" stopOpacity="0" />
            <stop offset="0.5" stopColor="#db4a58" stopOpacity="0.75" />
            <stop offset="1" stopColor="#7c1624" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="qnlys-amb-curve"
          d="M -40 620 C 300 560 520 700 780 640 S 1300 480 1480 540"
          pathLength={1}
        />
        <path
          className="qnlys-amb-curve qnlys-amb-curve-2"
          d="M -40 300 C 260 360 560 240 860 300 S 1320 400 1480 340"
          pathLength={1}
        />
        <path
          className="qnlys-amb-curve qnlys-amb-curve-3"
          d="M -40 780 C 340 740 620 820 940 760 S 1340 640 1480 700"
          pathLength={1}
        />
      </svg>

      {/* Sparse monitoring points */}
      {SIGNAL_POINTS.map((p) => (
        <span
          key={`${p.top}-${p.left}`}
          className="qnlys-amb-dot"
          style={{ top: p.top, left: p.left, animationDelay: p.delay }}
        />
      ))}
    </div>
  );
});
