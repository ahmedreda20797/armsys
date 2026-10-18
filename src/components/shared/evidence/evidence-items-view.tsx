'use client';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE — read-only evidence display (§18/§19)
//
//  The ONE shared evidence viewer for detail dialogs, cards and
//  report surfaces. Every item is INDEPENDENTLY actionable:
//    🔗 link   → open (guarded http(s) only) + copy
//    #️⃣ number → exact string (leading zeros kept) + copy
//    🖼️ image  → authorized thumbnail → lightbox (zoom/download)
//    📝 text   → legacy free text, verbatim + copy
//
//  Never renders all evidence as one concatenated string.
//  `EvidenceSummaryButton` shows «الأدلة (4)» and opens the full
//  list in a dialog — for list rows where space is scarce (§19).
// ══════════════════════════════════════════════════════════════

import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { parseSafeHttpUrl, truncateEvidenceForDisplay, EVIDENCE_EMPTY_LABEL } from '@/lib/quality-observations/evidence';
import { EVIDENCE_TYPE_ICONS, EVIDENCE_TYPE_LABELS_AR } from '@/lib/evidence-items';
import { EvidenceImage } from './evidence-image';
import type { EvidenceItem } from '@/types';

const ACTION_BTN =
  'inline-flex items-center gap-1 h-7 rounded-md border border-slate-600/70 px-2.5 text-[11px] text-slate-300 hover:bg-slate-700/50 transition-colors';

export function EvidenceItemsView({
  items,
  showEmpty = false,
}: {
  items: EvidenceItem[];
  /** Render the explicit empty state when there is no evidence. */
  showEmpty?: boolean;
}) {
  const { locale } = useLanguage();

  const copyValue = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        toast.success(translateUIText('تم النسخ', locale));
      } catch {
        toast.error(translateUIText('فشل النسخ', locale));
      }
    },
    [locale],
  );

  if (items.length === 0) {
    return showEmpty ? <p className="text-xs text-slate-500">{EVIDENCE_EMPTY_LABEL}</p> : null;
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const icon = EVIDENCE_TYPE_ICONS[item.type] ?? '📎';
        const typeLabel = translateUIText(EVIDENCE_TYPE_LABELS_AR[item.type] ?? 'دليل', locale);
        return (
          <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-slate-700/40 bg-slate-800/30 p-2.5 min-w-0">
            <span aria-hidden="true" className="shrink-0 mt-0.5 text-sm">{icon}</span>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-[11px] text-slate-400">
                {typeLabel} {index + 1}
                {item.type === 'image' && item.image?.fileName ? ` · ${item.image.fileName}` : ''}
              </p>

              {item.type === 'link' && item.url && (
                <>
                  <a
                    href={parseSafeHttpUrl(item.url) ? item.url : undefined}
                    target={parseSafeHttpUrl(item.url) ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    dir="ltr"
                    className="block text-xs text-blue-300 break-all hover:text-blue-200 hover:underline underline-offset-2"
                    title={item.url}
                  >
                    {truncateEvidenceForDisplay(item.url, 90)}
                  </a>
                  <div className="flex flex-wrap gap-1.5">
                    {parseSafeHttpUrl(item.url) && (
                      <a href={item.url} target="_blank" rel="noopener noreferrer" className={ACTION_BTN}>
                        <ExternalLink className="size-3" /><T>فتح الدليل</T>
                      </a>
                    )}
                    <button type="button" className={ACTION_BTN} onClick={() => copyValue(item.url!)}>
                      <Copy className="size-3" /><T>نسخ الرابط</T>
                    </button>
                  </div>
                </>
              )}

              {item.type === 'number' && item.number && (
                <>
                  <p dir="ltr" className="text-sm text-slate-100 font-medium tracking-wide select-text">{item.number}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={ACTION_BTN} onClick={() => copyValue(item.number!)}>
                      <Copy className="size-3" /><T>نسخ الرقم</T>
                    </button>
                  </div>
                </>
              )}

              {item.type === 'image' && item.image && (
                <EvidenceImage image={item.image} className="h-24 max-w-xs" />
              )}

              {item.type === 'text' && item.text && (
                <>
                  <p className="text-xs text-slate-200 whitespace-pre-wrap break-words select-text max-h-24 overflow-y-auto">{item.text}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={ACTION_BTN} onClick={() => copyValue(item.text!)}>
                      <Copy className="size-3" /><T>نسخ النص</T>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** «الأدلة (4)» chip that opens the full item list in a dialog (§19). */
export function EvidenceSummaryButton({ items }: { items: EvidenceItem[] }) {
  const [open, setOpen] = useState(false);
  const { locale } = useLanguage();
  if (items.length === 0) return null;
  return (
    <>
      <Button
        type="button" size="sm" variant="outline" className="h-7 px-2 text-xs gap-1.5"
        onClick={() => setOpen(true)}
        title={translateUIText('الأدلة', locale)}
      >
        <Paperclip className="size-3.5" /><T>الأدلة</T> ({items.length})
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5 text-sm">
              <Paperclip className="size-4" /><T>الأدلة</T> ({items.length})
            </DialogTitle>
          </DialogHeader>
          <EvidenceItemsView items={items} />
        </DialogContent>
      </Dialog>
    </>
  );
}
