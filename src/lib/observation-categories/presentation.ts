// ══════════════════════════════════════════════════════════════
//  Observation Categories — client-safe presentation helpers.
//
//  PURE module (no db import — safe for client bundles). Every
//  consumer that renders the category vocabulary (observation form,
//  templates, quick actions, dashboards, Master Data workspace) MUST
//  go through these helpers so there is exactly ONE ordering and ONE
//  naming rule:
//    • ordering    → sortOrder, then Arabic name
//    • activation  → isActive !== false (absent = active)
//    • naming      → nameEn in English UI, name (Arabic) otherwise
// ══════════════════════════════════════════════════════════════

import type { ObservationCategory } from '@/types/quality-kpi';
import type { Locale } from '@/lib/i18n/dictionary';

/** Master Data activation — absent field (pre-migration record) reads as active. */
export function isCategoryActive(cat: Pick<ObservationCategory, 'isActive'>): boolean {
  return cat.isActive !== false;
}

/** Canonical display ordering — sortOrder first, then Arabic name. */
export function sortCategories<T extends Pick<ObservationCategory, 'name' | 'sortOrder'>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const sa = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name, 'ar');
  });
}

/**
 * Locale-aware display name — the UI presents nameAr/nameEn, NEVER
 * the record id or the internal key. Arabic is the source label.
 */
export function categoryDisplayName(
  cat: Pick<ObservationCategory, 'name' | 'nameEn'>,
  locale: Locale,
): string {
  return locale === 'en' && cat.nameEn ? cat.nameEn : cat.name;
}

/**
 * §DYNAMIC-LABELS — resolve a FROZEN stored category label
 * (historical observations freeze the Arabic categoryName) through
 * the CURRENT master-data vocabulary: match the stored name against
 * the category list (Arabic name, or English name when resolving for
 * English), then present the canonical bilingual label. Returns null
 * when no master-data record matches — the caller falls back to the
 * legacy alias resolver / verbatim rendering.
 *
 * Pure + client-safe. Match is EXACT (trimmed) — never a substring.
 */
export function categoryLabelFromStoredName(
  storedName: string,
  locale: Locale,
  categories: ReadonlyArray<Pick<ObservationCategory, 'name' | 'nameEn'>>,
): string | null {
  const needle = storedName.trim();
  if (needle === '') return null;
  const hit = categories.find(
    (c) => c.name?.trim() === needle || (locale === 'en' && c.nameEn?.trim() === needle),
  );
  return hit ? categoryDisplayName(hit, locale) : null;
}

/** Active categories only — for NEW-record selectors (forms/templates). */
export function activeCategories<T extends Pick<ObservationCategory, 'isActive'>>(
  list: T[],
): T[] {
  return list.filter(isCategoryActive);
}

/** The full selector pipeline: active + canonical order. */
export function selectorCategories<T extends Pick<ObservationCategory, 'name' | 'sortOrder' | 'isActive'>>(
  list: T[],
): T[] {
  return sortCategories(activeCategories(list));
}
