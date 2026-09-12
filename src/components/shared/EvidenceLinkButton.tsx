'use client';

// ══════════════════════════════════════════════════════════════
//  EvidenceLinkButton — the ONE shared "عرض الدليل / فتح الرابط"
//  button for record details cards (Daily Follow-up, Quality, …).
//
//  • Only http(s) URLs become links (parseSafeHttpUrl guard —
//    javascript:/data:/mailto:… are shown as inert text).
//  • Opens in a NEW TAB with rel="noopener noreferrer".
//  • Tooltip + aria-label always present (accessible meaning).
//  • Same visual language as the Risk Center / observations design
//    system — modules stay independent, only the pattern is shared.
// ══════════════════════════════════════════════════════════════

import { ExternalLink, Link as LinkIcon } from 'lucide-react';
import { parseSafeHttpUrl } from '@/lib/quality-observations/evidence';

interface EvidenceLinkButtonProps {
  /** The raw stored evidence value (URL or text). */
  evidence: string | null | undefined;
  /** Button label — defaults to عرض الدليل. */
  label?: string;
  /** Compact variant for dense cards. */
  compact?: boolean;
  /** Stop click propagation (cards that open details on click). */
  stopPropagation?: boolean;
}

export function EvidenceLinkButton({
  evidence,
  label = 'عرض الدليل',
  compact = false,
  stopPropagation = false,
}: EvidenceLinkButtonProps) {
  const trimmed = typeof evidence === 'string' ? evidence.trim() : '';
  if (!trimmed) return null;
  const safeUrl = parseSafeHttpUrl(trimmed);

  const className = compact
    ? 'inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 text-[11px] bg-cyan-500/10 px-2 py-1 rounded-md border border-cyan-500/20 transition-colors'
    : 'inline-flex items-center justify-center gap-1.5 h-8 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20 transition-colors';

  if (!safeUrl) {
    // Non-URL evidence (text) — shown inertly, never href'ed.
    return (
      <span
        className={className}
        title="الدليل"
      >
        <LinkIcon className="size-3 shrink-0" />
        <span className="max-w-48 truncate" dir="auto">{trimmed}</span>
      </span>
    );
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`${label} — يفتح في تبويب جديد`}
      aria-label={label}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
      }}
    >
      <ExternalLink className="size-3 shrink-0" />
      {label}
    </a>
  );
}
