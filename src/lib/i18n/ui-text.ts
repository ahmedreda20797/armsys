// src/lib/i18n/ui-text.ts
// ══════════════════════════════════════════════════════════════
//  §I18N-BOUNDARY — THE Qnlys localization boundary engine.
//
//  CANONICAL CONTRACT (§24 of the localization milestone):
//
//    APPLICATION UI                          BUSINESS DATA
//      ↓                                        ↓
//    translateUIText()                        rendered raw
//      ↓                                        ↓
//    translated static text                   NO translation — ever
//
//  This function is the ONLY sanctioned string-translation engine.
//  It may receive ONE kind of input and one kind only:
//
//    ► APPLICATION-OWNED STATIC UI STRINGS.
//
//  Concretely — a string is UI-owned when the SOURCE COMPONENT that
//  authored it says so, by passing it through one of the claim
//  mechanisms:
//      • <T>…</T>                    (JSX text — see ./T.tsx)
//      • translateUIText(…)          (attributes, lib-level labels)
//      • t('key')                    (keyed dictionary — ./dictionary.ts)
//      • a data-i18n="true" zone     (legacy DOM regions — see
//                                     ./runtime-translator.ts)
//
//  FORBIDDEN INPUTS (never pass these, in any form):
//      • employee/customer/supplier/manager/user names
//      • team/department/branch/company names entered by admins
//      • notes, observations, comments, complaints, descriptions
//      • any free text, manual titles/labels, reasons, messages
//      • IDs, codes, references, document numbers
//      • any value read from a database record, API row or form input
//
//  This is NOT a blacklist problem: a person's name must stay intact
//  regardless of what the name is. The protection is STRUCTURAL — the
//  caller must already know, at the source, that the string is UI.
//  If you cannot prove the string is application-owned, do not call
//  this function; render the value as-is.
//
//  Mechanism: exact match against EN_MAP, then a bounded phrase pass
//  (whole-Arabic-word boundaries only) so composed UI labels such as
//  «القسم: X» translate while Latin text, numbers and emails inside
//  the SAME UI string pass through. Because the input is UI-owned by
//  contract, the phrase pass can never touch user data.
// ══════════════════════════════════════════════════════════════

import { EN_MAP } from './en-map';
import { displayLocale } from './format';
import type { Locale } from './dictionary';

const ARABIC = /[\u0600-\u06FF]/;

/** True when the string contains Arabic script (exported for DOM filters). */
export function hasArabic(s: string): boolean {
  return ARABIC.test(s);
}

/** Whole-Arabic-word boundary pattern for a phrase. */
function phraseRegex(phrase: string): RegExp {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\u0600-\\u06FF])${escaped}(?![\\u0600-\\u06FF])`, 'g');
}

/** Sorted longest-first — longer phrases win over their parts. */
const PHRASES: Array<[string, string, RegExp]> = Object.entries(EN_MAP)
  .filter(([ar]) => ar.length >= 2)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([ar, en]) => [ar, en, phraseRegex(ar)] as [string, string, RegExp]);

/** Exact-match lookup (trimmed). */
const EXACT = new Map<string, string>(Object.entries(EN_MAP));

/**
 * Translate an APPLICATION-OWNED UI string for the given locale.
 * Identity in 'ar' (Arabic is the source language) and for any string
 * that carries no mapping. NEVER pass business/user data.
 */
export function translateUIText(raw: string, locale?: Locale): string {
  if (!raw || !ARABIC.test(raw)) return raw;
  if ((locale ?? displayLocale()) !== 'en') return raw;
  const exact = EXACT.get(raw.trim());
  if (exact !== undefined) return exact;
  // Bounded phrase pass — longest first. Cheap substring gate first.
  let out: string | null = null;
  for (const [ar, en, re] of PHRASES) {
    if (!raw.includes(ar)) continue;
    if (out === null) out = raw;
    re.lastIndex = 0;
    out = out.replace(re, en);
  }
  return out ?? raw;
}
