// src/components/connect/floating/connect-animations.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect — LAUNCHER→PANEL ANIMATION CONTRACT
//
//  The conversation panel must EMERGE FROM THE LAUNCHER itself (§spec
//  9) — not slide in from the screen edge. The mechanism:
//    • the panel is anchored at the launcher's position (far-left,
//      just above it) with transformOrigin "left bottom" — the exact
//      corner where the button sits;
//    • opening plays opacity + scale (0.62→1) + a small x/y settle —
//      GPU-friendly transform/opacity only (no layout properties, no
//      page reflow, no flicker);
//    • closing reverses toward the same origin.
//
//  §RECOVERY — DECLARATIVE CSS TRANSITIONS, not frame-loop animation.
//  The previous framer-motion variants froze at the `hidden` state in
//  rendering contexts where requestAnimationFrame is throttled
//  (backgrounded panes), leaving the panel invisible at 62% scale.
//  CSS transitions declare the FINAL state at render time — the
//  compositor animates toward it and the end state is correct even
//  if no animation frame ever fires.
//
//  prefers-reduced-motion: callers pass `reduced` to disable the
//  transition (instant swap, no scale, no movement).
// ══════════════════════════════════════════════════════════════

import type { CSSProperties } from 'react';

export const CONNECT_PANEL_ORIGIN = 'left bottom';

/** Fast, restrained ease — matches the app's overlay entrance feel. */
export const CONNECT_PANEL_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Open ≈220ms (expand + settle); close slightly faster (reversal). */
export const CONNECT_OPEN_MS = 220;
export const CONNECT_CLOSE_MS = 150;

export type OverlayKind = 'panel' | 'window';

/**
 * The motion style for one overlay surface (panel / conversation
 * window). Pure — every property is compositor-friendly (opacity,
 * transform, visibility) plus pointer-events gating; the element is
 * ALWAYS fully styled for its current state the moment React commits.
 */
export function overlayMotionStyle(
  open: boolean,
  reduced: boolean,
  kind: OverlayKind,
): CSSProperties {
  const duration = open ? CONNECT_OPEN_MS : CONNECT_CLOSE_MS;
  // Closed geometry: shrink toward the launcher corner.
  const closedTransform = kind === 'panel'
    ? 'scale(0.62) translate(-14px, 10px)'
    : 'scale(0.9) translateY(14px)';
  return {
    opacity: open ? 1 : 0,
    transform: open ? 'scale(1) translate(0px, 0px)' : closedTransform,
    // visibility participates in the transition: flips immediately on
    // open, and AFTER the close transition finishes (delay = duration).
    visibility: open ? 'visible' : 'hidden',
    pointerEvents: open ? 'auto' : 'none',
    transition: reduced
      ? 'none'
      : [
          `opacity ${duration}ms ${CONNECT_PANEL_EASE}`,
          `transform ${duration}ms ${CONNECT_PANEL_EASE}`,
          `visibility 0ms linear ${open ? 0 : duration}ms`,
        ].join(', '),
    willChange: open ? 'transform, opacity' : 'auto',
  };
}
