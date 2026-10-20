'use client';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-PRESENTATION — the ONE shared COMPACT evidence renderer
//  for report surfaces (report rows, expanded details, employee
//  report blocks). Complements the rich EvidenceItemsView (detail
//  dialogs): same canonical resolver (lib/evidence/presentation),
//  same rules, compact non-card UI.
//
//  ALL items render, in stored order — never evidence[0]:
//    🔗 link   → clickable (safe http(s) guard)
//    #️⃣ number → exact string, plain text (never a URL)
//    🖼️ image  → compact clickable shortcut → authorized image route
//               (parent-record authorization, per request — storage
//               internals are never exposed directly)
//    📝 text   → legacy free text, verbatim
//
//  mode="screen" → app palette, truncated links (title carries the full URL).
//  mode="print"  → print-safe plain styling; links stay real <a>
//                  anchors so browser print-to-PDF keeps them clickable.
// ══════════════════════════════════════════════════════════════

import { resolveEvidenceLines } from '@/lib/evidence/presentation';
import { EVIDENCE_TYPE_ICONS } from '@/lib/evidence-items';
import { EVIDENCE_EMPTY_LABEL } from '@/lib/quality-observations/evidence';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { EvidenceItem } from '@/types';

export function EvidenceDisplay({
  items,
  mode = 'screen',
  showEmpty = false,
  className = '',
}: {
  items: EvidenceItem[];
  /** screen = app palette; print = print-safe plain anchors. */
  mode?: 'screen' | 'print';
  /** Render the explicit empty state when there is no evidence. */
  showEmpty?: boolean;
  className?: string;
}) {
  const { locale } = useLanguage();
  const lines = resolveEvidenceLines(items);

  if (lines.length === 0) {
    return showEmpty ? <p className={`text-xs text-slate-500 ${className}`}>{EVIDENCE_EMPTY_LABEL}</p> : null;
  }

  const isPrint = mode === 'print';

  return (
    <div className={`space-y-1 min-w-0 ${className}`} data-testid="evidence-display" data-evidence-count={lines.length}>
      {lines.map((line) => {
        const icon = EVIDENCE_TYPE_ICONS[line.type] ?? '📎';
        const title =
          line.type === 'image'
            ? translateUIText('فتح الدليل في تبويب جديد', locale)
            : line.text;
        return (
          <div key={`${line.position}-${line.type}`} className="flex items-center gap-1.5 min-w-0 text-[11px] leading-5">
            <span aria-hidden="true" className="shrink-0">{icon}</span>
            {line.href ? (
              <a
                href={line.href}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                title={title}
                aria-label={line.type === 'image' ? title : `${translateUIText('رابط الدليل', locale)}: ${line.text}`}
                className={
                  isPrint
                    ? 'underline underline-offset-2 break-all text-slate-800'
                    : 'inline-flex items-center text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline break-all'
                }
              >
                {line.text}
              </a>
            ) : (
              <span
                dir={line.type === 'number' ? 'ltr' : undefined}
                className={
                  line.type === 'number'
                    ? `font-mono tracking-wide select-text ${isPrint ? 'text-slate-800' : 'text-slate-100'}`
                    : `whitespace-pre-wrap break-words ${isPrint ? 'text-slate-800' : 'text-slate-300'}`
                }
                title={line.text}
              >
                {line.text}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
