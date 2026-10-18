'use client';

// ══════════════════════════════════════════════════════════════
//  §EVIDENCE — Evidence Collection form section
//
//  The ONE shared evidence editor (§15) — the same interaction
//  philosophy as the Travel form's booking items:
//
//    الأدلة
//    ├── دليل 1  (نوع: رابط)  → رابط + فتح الدليل
//    ├── دليل 2  (نوع: رقم)   → الرقم المرجعي + نسخ الرقم
//    ├── دليل 3  (نوع: صورة)  → لصق/اختيار/سحب + معاينة
//    └── + إضافة دليل
//
//  Rules (§22): items are independent objects keyed by id; remove
//  never corrupts siblings; switching type resets ONLY the fields
//  of the old type (a LINK→IMAGE switch leaves no hidden URL).
//  Legacy 'text' items round-trip read-only.
//
//  Controlled component: `items`/`onChange` — the parent form owns
//  the state, validates per item before save (isCompleteEvidenceItem)
//  and submits `evidenceItems` alongside the record.
// ══════════════════════════════════════════════════════════════

import { useCallback } from 'react';
import { toast } from 'sonner';
import { Copy, ExternalLink, Paperclip, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { T } from '@/lib/i18n/T';
import { useLanguage } from '@/lib/i18n/language-context';
import { translateUIText } from '@/lib/i18n/ui-text';
import { parseSafeHttpUrl } from '@/lib/quality-observations/evidence';
import type { EvidenceModuleKey } from '@/lib/evidence-modules';
import {
  EVIDENCE_ITEM_TYPES,
  EVIDENCE_TYPE_ICONS,
  EVIDENCE_TYPE_LABELS_AR,
  MAX_EVIDENCE_ITEMS,
  isCompleteEvidenceItem,
  newEvidenceItemId,
} from '@/lib/evidence-items';
import { EvidenceImageInput } from './evidence-image-input';
import type { EvidenceItem, EvidenceItemType } from '@/types';

export function EvidenceCollectionInput({
  moduleKey,
  items,
  onChange,
  disabled = false,
}: {
  /** Target module — gates the image upload permission server-side. */
  moduleKey: EvidenceModuleKey;
  items: EvidenceItem[];
  onChange: (items: EvidenceItem[]) => void;
  disabled?: boolean;
}) {
  const { locale } = useLanguage();

  const add = useCallback(() => {
    if (items.length >= MAX_EVIDENCE_ITEMS) {
      toast.error(translateUIText('تم الوصول للحد الأقصى من الأدلة', locale));
      return;
    }
    onChange([
      ...items,
      { id: newEvidenceItemId(), type: 'link', url: '', number: null, image: null, text: null, createdAt: null, createdBy: null },
    ]);
  }, [items, locale, onChange]);

  const update = useCallback(
    (itemId: string, patch: Partial<EvidenceItem>) => {
      onChange(items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
    },
    [items, onChange],
  );

  const remove = useCallback(
    (itemId: string) => {
      onChange(items.filter((it) => it.id !== itemId));
    },
    [items, onChange],
  );

  // §22 — switching type must not leave the old value hidden inside
  // the item: reset every type-specific field, then apply the type.
  const changeType = useCallback(
    (itemId: string, type: EvidenceItemType) => {
      onChange(items.map((it) => (it.id === itemId ? { ...it, type, url: null, number: null, image: null, text: null } : it)));
    },
    [items, onChange],
  );

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

  const hasIncomplete = items.some((it) => !isCompleteEvidenceItem(it));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-slate-300 flex items-center gap-1.5">
          <Paperclip className="size-3.5" />
          <T>الأدلة</T>
          {items.length > 0 && <span className="text-slate-500">({items.length})</span>}
        </Label>
        <Button
          type="button" variant="outline" size="sm" onClick={add} disabled={disabled}
          className="border-brand-500/40 text-brand-400 hover:bg-brand-500/10 h-7 px-2 text-xs gap-1"
        >
          <Plus className="size-3.5" /><T>إضافة دليل</T>
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-slate-500"><T>لا أدلة بعد — أضف رابطًا أو رقمًا أو صورة</T></p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => {
            const trimmedUrl = item.type === 'link' && item.url ? item.url.trim() : '';
            const openableUrl = trimmedUrl ? parseSafeHttpUrl(trimmedUrl) : null;
            return (
              <div key={item.id} className="rounded-lg border border-slate-700/40 bg-slate-800/20 p-2.5 space-y-2">
                <div className="flex items-center gap-2">
                  <span aria-hidden="true" className="shrink-0 text-sm">{EVIDENCE_TYPE_ICONS[item.type]}</span>
                  <span className="text-xs text-slate-400 flex-1">
                    <T>الدليل</T> {index + 1}
                  </span>
                  <Select
                    value={item.type}
                    onValueChange={(v) => changeType(item.id, v as EvidenceItemType)}
                    disabled={disabled}
                  >
                    <SelectTrigger className="bg-slate-800/50 border-slate-700 h-8 w-32 text-xs" aria-label={translateUIText('نوع الدليل', locale)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_ITEM_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {translateUIText(EVIDENCE_TYPE_LABELS_AR[type], locale)}
                        </SelectItem>
                      ))}
                      {/* Legacy text items keep a matching option so the
                          selector renders their stored value correctly. */}
                      {item.type === 'text' && (
                        <SelectItem value="text">{translateUIText('نص (قديم)', locale)}</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => remove(item.id)}
                    disabled={disabled}
                    className="shrink-0 text-red-400/70 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                    title={translateUIText('إزالة الدليل', locale)}
                    aria-label={translateUIText('إزالة الدليل', locale)}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>

                {item.type === 'link' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400"><T>الرابط</T></Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        dir="ltr"
                        value={item.url ?? ''}
                        onChange={(e) => update(item.id, { url: e.target.value })}
                        placeholder="https://..."
                        disabled={disabled}
                        className="bg-slate-800/50 border-slate-700 h-8 text-xs"
                      />
                      {openableUrl && (
                        <a
                          href={openableUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={translateUIText('فتح الدليل', locale)}
                          className="inline-flex items-center justify-center size-8 shrink-0 rounded-md border border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 transition-colors"
                        >
                          <ExternalLink className="size-3.5" />
                        </a>
                      )}
                    </div>
                    {trimmedUrl && !openableUrl && (
                      <p className="text-[11px] text-red-400"><T>رابط غير صالح</T></p>
                    )}
                  </div>
                )}

                {item.type === 'number' && (
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-400"><T>الرقم المرجعي</T></Label>
                    <div className="flex items-center gap-1.5">
                      {/* Plain text input — leading zeros are meaningful (§6). */}
                      <Input
                        dir="ltr"
                        value={item.number ?? ''}
                        onChange={(e) => update(item.id, { number: e.target.value })}
                        placeholder="458721"
                        disabled={disabled}
                        className="bg-slate-800/50 border-slate-700 h-8 text-xs"
                      />
                      <Button
                        type="button" size="sm" variant="outline" className="h-8 px-2 text-xs gap-1 shrink-0"
                        onClick={() => item.number && copyValue(item.number)}
                        disabled={disabled || !item.number}
                      >
                        <Copy className="size-3.5" /><T>نسخ الرقم</T>
                      </Button>
                    </div>
                  </div>
                )}

                {item.type === 'image' && (
                  <EvidenceImageInput
                    moduleKey={moduleKey}
                    value={item.image ?? null}
                    onChange={(image) => update(item.id, { image })}
                    disabled={disabled}
                  />
                )}

                {item.type === 'text' && (
                  <p className="text-xs text-slate-300 whitespace-pre-wrap break-words rounded border border-slate-700/30 bg-slate-800/30 p-2 select-text">
                    {item.text}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasIncomplete && (
        <p className="text-[11px] text-amber-400">
          <T>أكمل بيانات الأدلة غير المكتملة أو أزلها قبل الحفظ</T>
        </p>
      )}
    </div>
  );
}
