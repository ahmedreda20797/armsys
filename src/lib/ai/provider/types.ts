// ══════════════════════════════════════════════════════════════
//  AI Provider — abstraction contract (Phase 6.2, spec §5/§32)
//
//  The BUSINESS layer (quality AI service, API route, UI) knows
//  ONLY this interface — never a concrete vendor SDK, never HTTP
//  details, never keys (spec §32). A provider implementation owns:
//    • authentication  • request       • response parsing
//    • timeout         • safe retry    • provider errors
//
//  Server-side ONLY (spec §64): no provider code may be imported
//  by client bundles — adapters live behind the API route.
// ══════════════════════════════════════════════════════════════

/** A single provider call request. No business/domain types here —
 *  the provider is domain-agnostic (spec §32). */
export interface AIProviderRequest {
  /** Fixed system instructions (no business data inside — spec §17). */
  systemPrompt: string;
  /** One user message: the structured JSON payload, delimited. */
  userContent: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Hard timeout in ms — the adapter MUST honour it. */
  timeoutMs: number;
}

export interface AIProviderCompletion {
  /** The raw assistant text (expected to be strict JSON — validated later). */
  text: string;
  provider: string;
  /** Model identifier as reported/ configured (diagnostics only). */
  model: string;
  latencyMs: number;
}

export interface AIProvider {
  /** Stable provider name ('z-ai' | 'openai-compatible' | ...). */
  readonly name: string;
  /** Model/configuration identifier for cache keys + observability. */
  readonly model: string;
  analyze(request: AIProviderRequest): Promise<AIProviderCompletion>;
}

/** Phase 6.5-A — SAFE provider-side diagnostic (§3: observable, never
 *  secret). Machine-readable fields ONLY, normalized from the parsed
 *  provider error object ({ error: { code, message, status } }):
 *    • httpStatus     — HTTP status of the provider call
 *    • providerStatus — provider's machine-readable status string
 *                       (e.g. NOT_FOUND / INVALID_ARGUMENT / UNAVAILABLE)
 *    • providerCode   — provider's numeric error code
 *    • safeReason     — SHORT, length-capped, secret-redacted provider
 *                       reason (admin diagnostics only — NEVER sent to
 *                       end users, NEVER the raw response body)
 *  No headers, no keys, no raw bodies, no prompt content (§7/§62). */
export interface AIProviderErrorDiagnostic {
  httpStatus: number | null;
  providerStatus: string | null;
  providerCode: number | null;
  safeReason: string | null;
}

/** Structured provider failure — mapped to AI statuses by the service.
 *  NEVER carries provider raw errors / keys / response bodies (§31/§62).
 *  Phase 6.4 adds AI_MODEL_ERROR (§3/§25): the configured model id was
 *  rejected/does not exist — a CONFIGURATION problem, distinct from a
 *  generic provider outage, and must surface as MODEL_ERROR status.
 *  Phase 6.5-A adds the optional SAFE diagnostic (above) so failures
 *  are ACTIONABLE (which exact provider rejection occurred) without
 *  changing the user-facing message contract. */
export class AIProviderError extends Error {
  readonly code:
    | 'AI_TIMEOUT'
    | 'AI_AUTH_ERROR'
    | 'AI_RATE_LIMITED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_MODEL_ERROR'
    | 'AI_NETWORK_ERROR'
    | 'AI_INVALID_RESPONSE';

  /** SAFE structured provider diagnostic (null when unavailable, e.g.
   *  network failures). Consumers: health check + admin verification. */
  readonly diagnostic: AIProviderErrorDiagnostic | null;

  constructor(code: AIProviderError['code'], message: string, diagnostic: AIProviderErrorDiagnostic | null = null) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}
