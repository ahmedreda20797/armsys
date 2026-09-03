// ══════════════════════════════════════════════════════════════
//  AI Gateway — data classification (Phase 6.4, spec §10)
//
//  Classification bands:
//    PUBLIC        — nothing sensitive (org name, period labels)
//    INTERNAL      — operational data (attendance counts, deal stats)
//    CONFIDENTIAL  — evaluations, complaints, HR-sensitive context
//    RESTRICTED    — passwords, secrets, API keys, tokens, credentials
//
//  ENFORCEMENT (spec §10):
//    • RESTRICTED information NEVER leaves ARM — it is never placed
//      in any AI payload, and the gateway re-checks every payload
//      with assertNoRestrictedData() before a provider call;
//    • CONFIDENTIAL data may be included ONLY when the feature's
//      policy allows it, the caller is authorized (already enforced
//      by the route/scope layer), and the data is minimized (§9);
//    • being an administrator is NOT an excuse to bypass classification
//      (§10: "Do not create an excuse to send all data").
//
//  This module is PURE — no Firebase, no I/O — so enforcement is
//  cheap enough to run on EVERY AI request.
// ══════════════════════════════════════════════════════════════

export type DataClassification = 'PUBLIC' | 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED';

export const CLASSIFICATION_ORDER: readonly DataClassification[] = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
];

/** Field-name patterns that mark RESTRICTED content wherever it appears
 *  in a payload (spec §10 examples + the ARM user model). */
const RESTRICTED_FIELD_PATTERNS: readonly string[] = [
  'password',
  'passwordhash',
  'hashedpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'apikey',
  'secret',
  'privatekey',
  'clientemail',
  'databaseurl',
  'credential',
  'otp',
  'pincode',
];

/** Value patterns that indicate a leaked secret regardless of field name.
 *  NOTE: unanchored — these scan INSIDE arbitrary payload text. */
const RESTRICTED_VALUE_PATTERNS: readonly RegExp[] = [
  /\$2[aby]\$\d{2}\$/,            // bcrypt hash (cost prefix)
  /sk-[A-Za-z0-9]{16,}/,          // OpenAI-style key
  /AIza[A-Za-z0-9_-]{20,}/,       // Google API key
  /gsk_[A-Za-z0-9]{16,}/,         // Groq-style key
  /ey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\./, // JWT-shaped token
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, // PEM key
];

/** Higher number = more sensitive. */
export function classificationRank(classification: DataClassification): number {
  return CLASSIFICATION_ORDER.indexOf(classification);
}

/** The classification policy for one AI feature: the MAXIMUM band the
 *  feature's context builder may include in a provider payload. */
export interface AIDataPolicy {
  feature: string;
  maxClassification: Exclude<DataClassification, 'RESTRICTED'>;
}

/** Current feature policies. RESTRICTED is absent by construction —
 *  it is never allowed anywhere (§10). */
export const AI_DATA_POLICIES: Record<string, AIDataPolicy> = {
  // The Smart Quality Report already shows evaluations/deductions to
  // authorized callers — the AI interpretation operates at the same
  // CONFIDENTIAL ceiling (never above the caller's own access).
  'quality-analysis': { feature: 'quality-analysis', maxClassification: 'CONFIDENTIAL' },
};

/** Pure check — does a serialized payload contain RESTRICTED markers?
 *  Used as a LAST-LINE defense before any provider call (§10/§36-E). */
export function findRestrictedDataMarkers(payloadText: string): string[] {
  const markers: string[] = [];
  const lowered = payloadText.toLowerCase();

  for (const pattern of RESTRICTED_FIELD_PATTERNS) {
    // Match field-name occurrences like "password": … / passwordHash …
    const regex = new RegExp(`"${pattern}"\\s*:`, 'i');
    if (regex.test(lowered)) markers.push(`field:${pattern}`);
  }
  for (const regex of RESTRICTED_VALUE_PATTERNS) {
    // Scan raw text for value-shaped secrets (bcrypt/JWT/PEM/keys).
    if (regex.test(payloadText)) markers.push(`value-shape:${regex.source}`);
  }
  return markers;
}

/** Enforcement wrapper — throws a structured, secret-free rejection
 *  when RESTRICTED content is detected. The marker list is safe to
 *  surface (field names / shapes only). */
export function assertNoRestrictedData(payloadText: string, feature: string): void {
  const markers = findRestrictedDataMarkers(payloadText);
  if (markers.length > 0) {
    throw new RestrictedDataViolationError(feature, markers);
  }
}

export class RestrictedDataViolationError extends Error {
  readonly feature: string;
  readonly markers: string[];
  constructor(feature: string, markers: string[]) {
    super('RESTRICTED data detected in AI payload — request blocked');
    this.name = 'RestrictedDataViolationError';
    this.feature = feature;
    this.markers = markers;
  }
}

/** Whether a feature may include a given classification per policy. */
export function classificationAllowedByPolicy(
  feature: string,
  classification: DataClassification,
): boolean {
  const policy = AI_DATA_POLICIES[feature];
  if (!policy) return classification === 'PUBLIC' || classification === 'INTERNAL';
  if (classification === 'RESTRICTED') return false;
  return classificationRank(classification) <= classificationRank(policy.maxClassification);
}
