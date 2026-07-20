'use client';

/**
 * Phase 4 / 13 — Node color palette popover.
 * Used by the context menu "Color" action and the Inspector "Appearance" tab.
 * Pure UI: emits a tailwind bg-* class string.
 */

import React, { memo, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export const NODE_COLORS: string[] = [
  'bg-emerald-500', 'bg-red-500', 'bg-violet-500', 'bg-amber-500',
  'bg-cyan-600', 'bg-emerald-600', 'bg-blue-500', 'bg-indigo-500',
  'bg-slate-500', 'bg-orange-500', 'bg-yellow-600', 'bg-teal-600',
  'bg-sky-600', 'bg-blue-600', 'bg-pink-600', 'bg-green-600',
  'bg-indigo-600', 'bg-amber-600', 'bg-red-600', 'bg-slate-600',
];

interface ColorPaletteProps {
  current: string | undefined;
  onSelect: (color: string) => void;
  onClose: () => void;
  /** Anchor coordinates (screen). */
  x: number;
  y: number;
}

export const ColorPalette = memo(function ColorPalette({
  current, onSelect, onClose, x, y,
}: ColorPaletteProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Keep inside viewport.
  const adjX = typeof window !== 'undefined' ? Math.min(x, window.innerWidth - 220) : x;
  const adjY = typeof window !== 'undefined' ? Math.min(y, window.innerHeight - 220) : y;

  return (
    <div
      ref={ref}
      dir="ltr"
      className="fixed z-[110] p-2 bg-slate-900/95 backdrop-blur-md border border-slate-700/60 rounded-lg shadow-2xl"
      style={{ left: adjX, top: adjY }}
    >
      <div className="grid grid-cols-5 gap-1.5">
        {NODE_COLORS.map((c) => (
          <button
            key={c}
            onClick={() => { onSelect(c); onClose(); }}
            className={cn(
              'w-7 h-7 rounded-md transition-transform hover:scale-110',
              c,
              current === c && 'ring-2 ring-white ring-offset-1 ring-offset-slate-900',
            )}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
});
