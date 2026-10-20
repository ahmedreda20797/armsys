// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-PRESENTATION — the ONE canonical evidence presentation
//  resolver (copy / print / report text / compact display lines).
//
//  The canonical multi-item model lives in lib/evidence-items.ts:
//  normalizeEvidenceItems(record, legacyKind) is THE record → items
//  resolver (new collection authoritative once present, legacy
//  single-value adapted at read, never duplicated). This module is
//  its PRESENTATION layer — the single deterministic projection of
//  EvidenceItem[] into:
//    • ordered display lines (link / number / image / text) carrying
//      the AUTHORIZED clickable URL for openable items;
//    • plain copy text (ALL items, numbered, original order);
//    • plain report/print text (Excel cells, print models).
//
//  EVERY surface that shows, copies or prints evidence consumes
//  THESE helpers — no per-report evidence logic, no first-item
//  shortcut, never evidence[0]:
//    Evidence Collection = ALL valid evidence items.
//
//  Rules (§presentation):
//    • LINK   → exact stored URL, clickable when it passes the
//               safe http(s) guard; never rewritten.
//    • NUMBER → exact stored string (leading zeros kept), plain text.
//    • IMAGE  → compact localized label + the authorized image URL
//               (the existing /api/evidence/image route — parent-record
//               authorization applies per request). Storage internals
//               are never exposed directly.
//    • TEXT   → legacy free text, verbatim.
//    • Malformed/empty items never crash and never hide the valid
//      items after them; order is the stored collection order.
//
//  Pure and client-safe — no server imports.
// ══════════════════════════════════════════════════════════════

import type { EvidenceItem, EvidenceItemType } from '@/types';
import { evidenceImageUrl, parseEvidenceStoragePath } from '@/lib/evidence-items';
import { parseSafeHttpUrl } from '@/lib/quality-observations/evidence';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';

/** One display-ready evidence line (original collection order). */
export interface ResolvedEvidenceLine {
  /** 1-based position among the VALID items (no gaps). */
  position: number;
  type: EvidenceItemType;
  /** Readable text: exact URL / exact number / verbatim legacy text / localized image label. */
  text: string;
  /**
   * Authorized clickable URL — http(s) links as stored, images through
   * the authorized evidence-image route. Null for numbers, legacy text
   * and items that fail their safety guard (still displayed as text).
   */
  href: string | null;
  /** True when the line is IMAGE evidence (its href opens the authorized image). */
  image: boolean;
}

export interface ResolveEvidenceOptions {
  /**
   * Absolute origin to prefix to authorized image URLs (e.g.
   * window.location.origin) for copy/print text that leaves the app.
   * Omitted → relative authorized path (fine for in-app hrefs).
   */
  baseUrl?: string | null;
  /** Locale for system-owned labels (image evidence). Default 'ar'. */
  locale?: Locale;
}

/** Localized image-evidence label — numbered only when several images exist. */
export function evidenceImageLabel(ordinal: number, totalImages: number, locale: Locale = 'ar'): string {
  const base = translateUIText('صورة دليل', locale);
  return totalImages > 1 ? `${base} ${ordinal}` : base;
}

/** Plain value of one resolved line for text surfaces (image → «label: url»). */
export function evidenceLineValue(line: ResolvedEvidenceLine): string {
  return line.image && line.href ? `${line.text}: ${line.href}` : line.text;
}

/**
 * THE canonical presentation resolver: EvidenceItem[] → ordered
 * display lines. Deterministic, order-preserving, all items; a
 * malformed item degrades to text (or is skipped when it carries no
 * value at all) without hiding the valid items after it.
 */
export function resolveEvidenceLines(
  items: ReadonlyArray<EvidenceItem>,
  opts: ResolveEvidenceOptions = {},
): ResolvedEvidenceLine[] {
  const origin = opts.baseUrl ? opts.baseUrl.replace(/\/+$/, '') : '';
  const locale = opts.locale ?? 'ar';
  const totalImages = items.reduce(
    (n, it) => (it && it.type === 'image' && typeof it.image?.storagePath === 'string' && it.image.storagePath !== '' ? n + 1 : n),
    0,
  );
  const lines: ResolvedEvidenceLine[] = [];
  let imageOrdinal = 0;

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    switch (item.type) {
      case 'link': {
        const url = typeof item.url === 'string' ? item.url.trim() : '';
        if (!url) continue;
        lines.push({ position: lines.length + 1, type: 'link', text: url, href: parseSafeHttpUrl(url), image: false });
        break;
      }
      case 'number': {
        const number = typeof item.number === 'string' ? item.number.trim() : '';
        if (!number) continue;
        lines.push({ position: lines.length + 1, type: 'number', text: number, href: null, image: false });
        break;
      }
      case 'image': {
        const storagePath = typeof item.image?.storagePath === 'string' ? item.image.storagePath : '';
        if (!storagePath) continue;
        imageOrdinal += 1;
        // The authorized route ONLY for parseable storage paths — a
        // malformed path renders as a label without a broken URL.
        const href = parseEvidenceStoragePath(storagePath)
          ? `${origin}${evidenceImageUrl(storagePath)}`
          : null;
        lines.push({
          position: lines.length + 1,
          type: 'image',
          text: evidenceImageLabel(imageOrdinal, totalImages, locale),
          href,
          image: true,
        });
        break;
      }
      case 'text': {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) continue;
        lines.push({ position: lines.length + 1, type: 'text', text, href: null, image: false });
        break;
      }
    }
  }
  return lines;
}

/**
 * ALL evidence items as numbered multi-line text (no header) — the
 * value for report/print/Excel evidence cells. Empty string when the
 * record carries no evidence. Original order, never evidence[0].
 */
export function formatEvidenceItemsAsText(
  items: ReadonlyArray<EvidenceItem>,
  opts: ResolveEvidenceOptions = {},
): string {
  return resolveEvidenceLines(items, opts)
    .map((line, i) => `${i + 1}. ${evidenceLineValue(line)}`)
    .join('\n');
}

/**
 * ALL evidence items as user-facing COPY text:
 *   الأدلة:
 *   1. https://example.com/…
 *   2. 12345
 *   3. صورة دليل 1: <authorized image URL>
 *   4. https://example.com/…
 * Empty string when there is no evidence (the caller omits the block).
 */
export function formatEvidenceItemsForCopy(
  items: ReadonlyArray<EvidenceItem>,
  opts: ResolveEvidenceOptions = {},
): string {
  const body = formatEvidenceItemsAsText(items, opts);
  if (!body) return '';
  return `${translateUIText('الأدلة', opts.locale ?? 'ar')}:\n${body}`;
}
