'use client';

// ══════════════════════════════════════════════════════════════
//  DataFreshnessIndicator — subtle background-revalidation state
//  (§32). Rendered ONLY while a background revalidation is running
//  on top of an already-visible snapshot. Never a loading screen:
//  the existing data stays on screen (§10/§11). RTL-safe (icon is
//  directional-neutral), localized through the shared <T> runtime.
// ══════════════════════════════════════════════════════════════

import { RefreshCcw } from 'lucide-react';
import { T } from '@/lib/i18n/T';

export function DataFreshnessIndicator({
  revalidating,
  className = '',
}: {
  revalidating: boolean;
  className?: string;
}) {
  if (!revalidating) return null;
  return (
    <div
      className={`flex justify-end ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-2.5 py-1 text-[11px] text-slate-400">
        <RefreshCcw className="size-3 animate-spin text-cyan-400" />
        <T>جاري تحديث البيانات…</T>
      </span>
    </div>
  );
}
