// ══════════════════════════════════════════════════════════════
//  Master Data simple lists — CLIENT-SAFE presentation helpers.
//
//  Pure functions only (no server imports) — the same contract as
//  observation-categories/presentation.ts: ONE canonical ordering,
//  ONE label rule, ONE selector filter for every consumer.
//
//  Label rule (the global presentation boundary): the DB record's
//  name (Arabic) / nameEn (English) — never record ids, never raw
//  internal keys. Unknown/legacy keys fall back to the caller's
//  static map, then to the verbatim value (historical records keep
//  rendering whatever they carry — nothing is auto-translated).
// ══════════════════════════════════════════════════════════════

import type { Locale } from '@/lib/i18n/dictionary';
import type { MasterDataListItem, MasterDataListItemWithUsage } from '@/types/master-data';

/** True unless the record explicitly carries isActive === false. */
export function isListItemActive(record: Pick<MasterDataListItem, 'isActive'>): boolean {
  return record.isActive !== false;
}

/** Canonical display order: sortOrder (absent = last), then Arabic name. */
export function sortListItems<T extends Pick<MasterDataListItem, 'name' | 'sortOrder'>>(records: T[]): T[] {
  return [...records].sort((a, b) => {
    const sa = Number(a.sortOrder ?? Number.MAX_SAFE_INTEGER);
    const sb = Number(b.sortOrder ?? Number.MAX_SAFE_INTEGER);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, 'ar');
  });
}

/**
 * The label for a list item in the active locale — the ONE rendering
 * rule for every consumer of the domain.
 */
export function listItemDisplayName(record: Pick<MasterDataListItem, 'name' | 'nameEn'>, locale: Locale): string {
  return locale === 'en' ? (record.nameEn || record.name) : record.name;
}

/**
 * Selector options for NEW records: active items only, canonical order,
 * locale-aware labels.
 */
export function selectorListItems(
  records: MasterDataListItem[],
  locale: Locale,
): Array<{ key: string; label: string }> {
  return sortListItems(records.filter(isListItemActive))
    .map((r) => ({ key: r.key, label: listItemDisplayName(r, locale) }));
}

/**
 * Label for a STORED value (transactional record field). DB-driven
 * first; unknown keys fall back to the provided static map (the
 * historical canonical labels), then to the verbatim value — legacy
 * free-text values keep rendering exactly what they carry.
 */
export function presentListValue(
  value: string | null | undefined,
  records: MasterDataListItem[] | undefined,
  locale: Locale,
  fallbackLabels?: Record<string, string>,
): string {
  if (!value) return '';
  const record = records?.find((r) => r.key === value);
  if (record) return listItemDisplayName(record, locale);
  if (fallbackLabels?.[value]) return fallbackLabels[value];
  return value;
}

/** Usage-count accessor for the management rows. */
export function usageCountOf(record: MasterDataListItemWithUsage): number {
  return typeof record.usageCount === 'number' ? record.usageCount : 0;
}
