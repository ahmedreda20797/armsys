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

/** Structured provider failure — mapped to AI statuses by the service.
 *  NEVER carries provider raw errors / keys / response bodies (§31/§62). */
export class AIProviderError extends Error {
  readonly code:
    | 'AI_TIMEOUT'
    | 'AI_AUTH_ERROR'
    | 'AI_RATE_LIMITED'
    | 'AI_PROVIDER_ERROR'
    | 'AI_NETWORK_ERROR'
    | 'AI_INVALID_RESPONSE';

  constructor(code: AIProviderError['code'], message: string) {
    super(message);
    this.name = 'AIProviderError';
    this.code = code;
  }
}
