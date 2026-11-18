// src/lib/i18n/dynamic-labels.ts
// ══════════════════════════════════════════════════════════════
//  §DYNAMIC-LABELS — the canonical resolver for DYNAMIC STORED VALUES
//  (§8 of the performance-hub spec: "Canonical Dynamic Label
//  Resolution").
//
//  Resolution model:
//
//    stored value/key
//      → 1. master-data vocabulary (caller-provided labelAr/labelEn)
//      → 2. system enum vocabulary (./presentation STATUS_LABELS)
//      → 3. known LEGACY Arabic alias (exact match below)
//      → 4. null → the caller renders the stored value VERBATIM
//         (user/business data — never auto-translated)
//
//  WHAT THIS FIXES: legacy records froze ARABIC display labels
//  («تأخر متابعة», «مكتملة», «مشكلة جودة») instead of canonical keys.
//  English surfaces (reports, print, exports) rendered them raw.
//  Known semantic values now resolve to their English label
//  EVERYWHERE through this one module — no page-specific patches.
//
//  SAFETY RULES (binding):
//    • EXACT trimmed-string match only — never substring replacement,
//      never a sentence. An arbitrary user sentence never matches.
//    • A value that matches nothing is returned as null — the caller
//      renders it verbatim (it is business data). Nothing is invented.
//    • The underlying business meaning never changes: the EN label is
//      the same semantic value, only the display language differs.
//    • Pure + client-safe: no db, no React.
// ══════════════════════════════════════════════════════════════

import type { Locale } from './dictionary';
import { resolveSystemLabel, LEGACY_VALUE_LABELS } from './presentation';

/**
 * §DYNAMIC-LABELS — the LEGACY Arabic alias vocabulary now LIVES in
 * ./presentation (§3b) so the ONE shared resolver chain covers every
 * presentation path. Re-exported here for the module's existing
 * consumers (the public surface is unchanged).
 */
export { LEGACY_VALUE_LABELS };

/** [ar, en] label pair (the insights/hub house pattern). */
export type StoredLabelPair = readonly [string, string];

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Resolve ONE dynamic stored value to its locale label.
 * Returns null when the value is NOT a known semantic label — the
 * caller's signal to render the stored value verbatim (business data).
 */
export function resolveStoredLabel(
  value: string | null | undefined,
  locale: Locale,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  // 1) System-owned enum/collection/rule key.
  const system = resolveSystemLabel(trimmed, locale);
  if (system !== null) return system;
  // 2) Known legacy alias (exact).
  const legacy = LEGACY_VALUE_LABELS[trimmed];
  if (legacy) return locale === 'en' ? legacy[1] : legacy[0];
  // 3) Unknown — business data; never guessed.
  return null;
}

/**
 * Resolve-or-verbatim: known semantic values localize; anything else
 * passes through UNCHANGED (user content stays the user's content).
 */
export function resolveStoredLabelOrVerbatim(
  value: string | null | undefined,
  locale: Locale,
): string {
  if (typeof value !== 'string') return '';
  return resolveStoredLabel(value, locale) ?? value;
}

/**
 * True when the value is a KNOWN semantic label (system enum or legacy
 * alias) — i.e. it SHOULD never render raw in English. Diagnostic
 * helper for the "no known enum renders raw in EN" guarantee.
 */
export function isKnownStoredLabel(value: string | null | undefined): boolean {
  return resolveStoredLabel(value, 'en') !== null;
}

/**
 * Development/test diagnostic: Arabic text that is NOT a known label
 * is business data (names, notes, sentences) and must render verbatim.
 * Never used to translate — only to assert the boundary in tests.
 */
export function isBusinessDataLike(value: string): boolean {
  return ARABIC.test(value) && !isKnownStoredLabel(value);
}
