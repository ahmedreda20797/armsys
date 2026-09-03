// ══════════════════════════════════════════════════════════════
//  AI Gateway — status taxonomy (Phase 6.4, spec §25)
//
//  The system must NEVER collapse every AI failure into
//  "AI unavailable". The USER-facing message may stay friendly, but
//  the SYSTEM preserves the real diagnostic category:
//
//    DISABLED          AI master switch off (AI_ENABLED != true)
//    MISCONFIGURED     provider/model/credential configuration broken
//    UNAVAILABLE       provider unreachable (network-level)
//    RATE_LIMITED      per-user or provider quota protection tripped
//    PROVIDER_ERROR    the provider answered with a failure
//    MODEL_ERROR       the configured model was rejected/missing
//    TIMEOUT           hard timeout hit
//    VALIDATION_ERROR  response failed strict validation
//    OPERATIONAL       healthy
//
//  The existing Phase 6.2 quality-AI envelope statuses stay STABLE
//  (§37 — existing tests keep passing); this taxonomy is the
//  gateway-level category carried alongside them (additive field)
//  and used by diagnostics/health/audit.
// ══════════════════════════════════════════════════════════════

export const AI_STATUSES = [
  'DISABLED',
  'MISCONFIGURED',
  'UNAVAILABLE',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'MODEL_ERROR',
  'TIMEOUT',
  'VALIDATION_ERROR',
  'OPERATIONAL',
] as const;

export type AIStatus = (typeof AI_STATUSES)[number];

/** Maps a structured provider error code to its gateway status. */
export function aiStatusFromProviderErrorCode(code: string): AIStatus {
  switch (code) {
    case 'AI_TIMEOUT': return 'TIMEOUT';
    case 'AI_AUTH_ERROR': return 'MISCONFIGURED';
    case 'AI_RATE_LIMITED': return 'RATE_LIMITED';
    case 'AI_MODEL_ERROR': return 'MODEL_ERROR';
    case 'AI_NETWORK_ERROR': return 'UNAVAILABLE';
    case 'AI_INVALID_RESPONSE': return 'VALIDATION_ERROR';
    case 'AI_PROVIDER_ERROR': return 'PROVIDER_ERROR';
    default: return 'PROVIDER_ERROR';
  }
}

/** Gateway status for the LEGACY Phase 6.2 quality-AI envelope statuses.
 *  Used wherever the additive diagnostic category must accompany the
 *  historical envelope without changing it (§37 compatibility). */
export function aiStatusFromLegacyQualityStatus(legacyStatus: string): AIStatus {
  switch (legacyStatus) {
    case 'OK': return 'OPERATIONAL';
    case 'AI_UNAVAILABLE': return 'MISCONFIGURED';
    case 'AI_TIMEOUT': return 'TIMEOUT';
    case 'AI_RATE_LIMITED': return 'RATE_LIMITED';
    case 'AI_INVALID_RESPONSE': return 'VALIDATION_ERROR';
    case 'AI_ERROR': return 'PROVIDER_ERROR';
    case 'NO_DATA':
    case 'INSUFFICIENT_DATA':
      // Data-sufficiency outcomes are NOT AI failures — the AI was
      // never needed. They are informational; report them as the
      // pipeline being operational (the report itself works).
      return 'OPERATIONAL';
    default: return 'PROVIDER_ERROR';
  }
}

/** True when the status represents an AI-layer failure (used by audit
 *  and monitoring — sufficiency outcomes are not failures). */
export function isAIFailureStatus(status: AIStatus): boolean {
  return status !== 'OPERATIONAL' && status !== 'DISABLED';
}
