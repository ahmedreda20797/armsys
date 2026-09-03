// ══════════════════════════════════════════════════════════════
//  AI Gateway — output security (Phase 6.4, spec §21)
//
//  ALL AI output passes through validation BEFORE it is shown:
//    1. SECRET-LEAK scan — the completion must never contain the
//       configured credential, any credential-shaped value, or
//       credential-probing success text (§21: secrets/API keys/tokens/
//       passwords). A violation REJECTS the whole output.
//    2. NUMERIC-CLAIM GROUNDING — numeric claims in AI text must be
//       traceable to supplied verified facts. The quality feature
//       already enforces this strictly in validate.ts (§27/§28:
//       hallucinated numbers → the item is DROPPED). The generic
//       extractor here exists for tests and future features.
//
//  Failure mapping: any leak → VALIDATION_ERROR (nothing is shown).
// ══════════════════════════════════════════════════════════════

export interface OutputSecurityScan {
  clean: boolean;
  /** Stable violation categories — safe to log/audit. */
  violations: string[];
}

const SECRET_VALUE_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['openai-style-key', /\bsk-[A-Za-z0-9]{16,}\b/],
  ['google-api-key', /\bAIza[A-Za-z0-9_-]{20,}\b/],
  ['groq-style-key', /\bgsk_[A-Za-z0-9]{16,}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._-]{24,}\b/],
  ['jwt-shape', /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\./],
  ['pem-private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['bcrypt-hash', /\$2[aby]\$\d{2}\$/],
  ['assigned-secret-field', /(\bapi[_-]?key\b|\bpassword\b|\bsecret\b|\btoken\b)\s*[:=]\s*\S{8,}/i],
];

/** Scans an AI completion for credential material. `apiKeyFragments`
 *  are distinctive substrings (≥8 chars) of the CONFIGURED credential —
 *  if the provider ever echoed it, the output is rejected wholesale. */
export function scanOutputForSecrets(text: string, apiKeyFragments: string[] = []): OutputSecurityScan {
  const violations: string[] = [];
  if (typeof text !== 'string' || text.length === 0) {
    return { clean: true, violations };
  }

  for (const [name, regex] of SECRET_VALUE_PATTERNS) {
    if (regex.test(text)) violations.push(name);
  }
  for (const fragment of apiKeyFragments) {
    if (typeof fragment === 'string' && fragment.length >= 8 && text.includes(fragment)) {
      violations.push('configured-credential-echo');
      break;
    }
  }
  return { clean: violations.length === 0, violations };
}

/** Numeric-claim extraction (spec §21: "Quality Score = 87%" must have
 *  a verified ARM source). Returns the distinct numeric literals found
 *  in the text (integers/decimals/percentages). Grounding against the
 *  allowed set is the caller's policy — for the quality feature this
 *  is enforced item-by-item in validate.ts (§36-L covers it there). */
export function extractNumericClaims(text: string): number[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches) return [];
  const distinct = new Set<number>();
  for (const raw of matches) {
    const value = Number(raw);
    if (Number.isFinite(value)) distinct.add(value);
  }
  return [...distinct];
}

/** Grounding check used by tests and future features: are ALL numeric
 *  claims present in the allowed set (exact match OR inside any
 *  allowed [min,max] range)? */
export function numericClaimsGrounded(
  text: string,
  allowedValues: readonly number[],
  allowedRanges: ReadonlyArray<{ min: number; max: number }> = [],
): boolean {
  const claims = extractNumericClaims(text);
  if (claims.length === 0) return true;
  return claims.every((claim) =>
    allowedValues.includes(claim) ||
    allowedRanges.some((r) => claim >= r.min && claim <= r.max),
  );
}
