'use client';

// ═══════════════════════════════════════════════════════════════
//  §SETTINGS-READINESS — the ONE canonical under-preparation slot.
//
//  Rendered by the Settings Center (and by the Master Data registry
//  for its 'planned' domains) when a section's implementation is not
//  finished. It NEVER navigates the user elsewhere and NEVER fakes a
//  management screen: the Settings shell stays mounted and the
//  content area explains the state in the active locale (§8 of the
//  Settings navigation task).
// ═══════════════════════════════════════════════════════════════

import { Settings2 } from 'lucide-react';
import { T } from '@/lib/i18n/T';

export function SectionUnderPreparation() {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-slate-700/40 bg-slate-800/20 px-6 py-12 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-2xl border border-slate-700/50 bg-slate-800/60">
        <Settings2 className="size-5 text-slate-400" />
      </span>
      <p className="text-sm font-bold text-slate-200">
        <T>هذا القسم قيد التهيئة</T>
      </p>
      <p className="max-w-md text-xs leading-relaxed text-slate-400">
        <T>نعمل حاليًا على تجهيز إعدادات هذا القسم. سيصبح متاحًا عند اكتمال التهيئة.</T>
      </p>
    </div>
  );
}
