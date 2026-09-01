// ══════════════════════════════════════════════════════════════
//  Global Search — normalization (Phase 6.1, spec §15)
//
//  Normalization is applied to the QUERY and to in-memory copies of
//  field values AT MATCH TIME ONLY. Stored records are never
//  rewritten (non-destructive by construction — this module is pure
//  and returns new strings).
//
//  Handles the common Arabic variance: tashkeel/diacritics, tatweel,
//  hamza/alef variants, taa marbuta, alef maqsura, and Arabic-Indic
//  digits — plus case-insensitivity for Latin text.
// ══════════════════════════════════════════════════════════════

/** Diacritics (tashkeel), dagger alef and tatweel. */
const TASHKEEL_TATWEEL = /[\u064B-\u0652\u0670\u0640]/g;
/** Hamza-carrying alef variants + alef wasla → bare alef. */
const ALEF_VARIANTS = /[\u0623\u0625\u0622\u0671]/g;
/** Arabic-Indic digits ٠-٩ → 0-9. */
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/g;
/** Extended Arabic-Indic digits ۰-۹ → 0-9. */
const EXTENDED_ARABIC_INDIC_DIGITS = /[\u06F0-\u06F9]/g;

/** Queries shorter than this are ignored (avoids flooding results). */
export const MIN_QUERY_LENGTH = 2;
/** Upper bound of AND-terms taken from one query. */
export const MAX_QUERY_TERMS = 6;

/**
 * Normalize ONE text value for matching (query or field copy):
 * lowercase, strip tashkeel/tatweel, unify hamza/alef, ة→ه, ى→ي,
 * ؤ→و, ئ→ي, Arabic digits → Latin, collapse whitespace.
 */
export function normalizeForSearch(input: string): string {
  return input
    .toLowerCase()
    .replace(TASHKEEL_TATWEEL, '')
    .replace(ALEF_VARIANTS, '\u0627')
    .replace(/\u0629/g, '\u0647')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064A')
    .replace(ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(EXTENDED_ARABIC_INDIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a normalized query into AND terms. Long queries are capped
 * defensively; empty terms are dropped.
 */
export function splitQueryTerms(normalizedQuery: string): string[] {
  return normalizedQuery
    .split(' ')
    .filter((term) => term.length > 0)
    .slice(0, MAX_QUERY_TERMS);
}
