'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { QnlysWordmark } from './QnlysWordmark';

// ══════════════════════════════════════════════════════════════
//  QnlysBrandReveal — the ONE shared Q→nlys lockup + reveal.
//
//  LOADING-REVEAL CONTRACT (§BRAND + §LOADING-V3):
//    Q is the identity anchor and, in loading mode, the logo IS
//    the whole loading indicator — no text, no bar:
//      • the Q BREATHES (slow scale + brand-red glow pulse —
//        .qnlys-q-breathe on the Q wrapper)
//      • each nlys letter rises out from behind the Q, overshoots
//        slightly and settles to its baseline, then a soft crest
//        keeps traveling n→l→y→s (.qnlys-letter-* engine in
//        globals.css §BRAND-LETTERS)
//      • a restrained red signal sweeps through the whole mark
//        (.qnlys-signal-sweep)
//    There is NO clipping region: the letters layer BELOW the Q
//    (z-0 under z-10) and move freely — no overflow-hidden, no
//    clip-path, no rectangular bounding-box feeling. The wordmark
//    is the real asset geometry inlined per-letter (QnlysWordmark),
//    which is what makes individual letter motion possible.
//
//  mode="static": one-shot entrance (Q in, letters rise once) for
//  the login brand zone.
//
//  prefers-reduced-motion: content appears settled, no loops.
//  Consumers: app LoadingOverlay and the Login brand zone.
// ══════════════════════════════════════════════════════════════

interface QnlysBrandRevealProps {
  /** Overall rendered height of the lockup in px. */
  size?: number;
  /** 'loading' = looping readiness cue; 'static' = one-shot reveal. */
  mode?: 'loading' | 'static';
  className?: string;
}

export function QnlysBrandReveal({
  size = 160,
  mode = 'static',
  className = '',
}: QnlysBrandRevealProps) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // §LIGHT-THEME — charcoal letters on paper; silver on dark surfaces.
  const theme = mounted && resolvedTheme === 'light' ? 'light' : 'dark';

  // ── Lockup geometry — measured from the OFFICIAL qnlys.svg ──
  // Official art (viewBox 1933×813): Q glyph 663×629 at (159,37);
  // wordmark 949×485 at (830,203). Derived ratios, applied to the Q
  // glyph actually visible inside Q.svg (PNG glyph fills 481/497 of
  // its box, canvas-measured):
  //   word height  = 485/629 = 0.771 of the Q glyph   → 0.75 of the Q box
  //   gap Q→word   = 8.5/663 ≈ 0.013 of the Q glyph   → +0.01 of the Q box
  //   word center sits 94/629 ≈ 0.15 of QH BELOW the
  //   Q center (the wordmark anchors to the Q's lower bowl) → the
  //   margin-top shift below (margin-top M moves a centered flex
  //   item down by M/2, so M = 2 × 0.153 × qPx).
  // The previous -6% overlap / raised / 0.62-height wordmark did not
  // match the official lockup — that was the visible inconsistency.
  const qPx = Math.round(size * 0.5);
  const wordPx = Math.round(qPx * 0.75);
  const loading = mode === 'loading';

  return (
    <span
      className={`relative inline-flex items-center select-none ${
        loading ? 'qnlys-lockup-loading' : ''
      } ${className}`}
      dir="ltr"
      role="img"
      aria-label="Qnlys"
    >
      {/* The Q anchors the identity — layered ABOVE the letters so
          they physically emerge from behind it; BREATHES while
          loading (the breathing IS the readiness cue). */}
      <span
        className={`relative z-10 shrink-0 inline-flex ${loading ? 'qnlys-q-breathe' : ''}`}
        style={{ width: qPx, height: qPx }}
      >
        <img
          src="/Q.svg"
          alt=""
          aria-hidden="true"
          draggable={false}
          className="qnlys-q-in object-contain"
          style={{ width: qPx, height: qPx }}
        />
      </span>

      {/* The wordmark ONLY — n·l·y·s (no second Q). Sits flush to the
          Q's edge and anchored low, exactly as in the official full
          lockup; each letter animates as a free SVG group. */}
      <span
        aria-hidden="true"
        className="relative z-0 inline-flex"
        style={{
          height: wordPx,
          width: (wordPx * 950) / 485,
          marginLeft: qPx * 0.01,
          marginTop: qPx * 0.305,
        }}
      >
        <QnlysWordmark height={wordPx} theme={theme} />
      </span>

      {/* Restrained red signal traveling through the whole mark. */}
      {loading && (
        <span
          aria-hidden="true"
          className="qnlys-signal-sweep qnlys-sweep-light pointer-events-none absolute inset-y-0 left-0 z-20 w-[12%] rounded-full"
        />
      )}
    </span>
  );
}
