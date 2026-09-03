// ══════════════════════════════════════════════════════════════
//  AI Provider — health check (Phase 6.4, spec §24)
//
//  Server-side ONLY. Verifies, in order:
//    1. configuration present (provider/model/credential)
//    2. provider reachable
//    3. model accepted
//    4. a MINIMAL SAFE request succeeds
//
//  The probe prompt contains NO ARM data — a single neutral token.
//  The result exposes SAFE fields only (booleans + error category +
//  latency + Phase 6.5-A safe provider diagnostics: httpStatus /
//  providerStatus / bounded secret-redacted safeReason). Secrets,
//  headers and raw provider bodies are never returned, logged or
//  stored (§3/§7/§62).
// ══════════════════════════════════════════════════════════════

import { readAIProviderConfig, type AIProviderConfig } from './config';
import { AIProviderError } from './types';
import { getProviderDefinition } from './registry';
import type { AIStatus } from '../gateway/status';
import { aiStatusFromProviderErrorCode } from '../gateway/status';

export interface AIProviderHealthResult {
  /** Configuration is complete enough to attempt a call. */
  providerConfigured: boolean;
  modelConfigured: boolean;
  apiKeyConfigured: boolean;
  /** A live round-trip was attempted (false when config is incomplete). */
  attempted: boolean;
  providerReachable: boolean;
  modelAccepted: boolean;
  /** Minimal safe request completed end-to-end. */
  operational: boolean;
  /** Phase 6.5-A §7: the completion contained the requested echo
   *  token (ARM_AI_HEALTH_OK) — a STRONGER liveness signal than
   *  non-empty text alone. null when not attempted. */
  echoMatched: boolean | null;
  /** Stable error category when not operational (AI_* code or null). */
  errorCategory: string | null;
  /** The bounded timeout this probe honours — exactly the resolved
   *  Gateway boundary (AI_TIMEOUT_MS, clamped 5s–120s by
   *  readAIProviderConfig; 30s default when missing/invalid). Null
   *  only when no provider call is possible (unconfigured). */
  effectiveTimeoutMs: number | null;
  /** Phase 6.5-A §3 — SAFE provider-side diagnostics (booleans/numbers/
   *  bounded reason only; never headers, keys or raw bodies). Null when
   *  not attempted / not provided by the provider error. */
  providerHttpStatus: number | null;
  /** Provider machine-readable error status (e.g. NOT_FOUND). */
  providerStatus: string | null;
  /** Short, secret-redacted, length-capped provider reason. */
  safeReason: string | null;
  /** Gateway-level status per spec §25 (OPERATIONAL when healthy). */
  status: AIStatus;
  latencyMs: number | null;
  /** Provider/model provenance (names only — never secrets). */
  provider: string | null;
  model: string | null;
}

/** Minimal neutral probe — no business data, no PII.
 *  Phase 6.5-A §7: the spec's conceptual echo request.
 *  TIMEOUT POLICY: the probe honours the CONFIGURED AI timeout
 *  boundary (AI_TIMEOUT_MS) resolved + clamped centrally by
 *  readAIProviderConfig — never a second hard-coded value and never
 *  unbounded. (The earlier separate 10s probe cap terminated slower
 *  real Gemini responses and misreported them as AI_TIMEOUT.)
 *  Token budget: thinking-capable Gemini models (2.5+/3.x) spend
 *  output tokens on internal thoughts first — a 32-token budget
 *  returned finishReason=MAX_TOKENS with EMPTY text against the real
 *  API, which would misreport a healthy provider. 512 keeps the probe
 *  tiny while leaving room for the fixed echo answer. */
const HEALTH_PROBE_SYSTEM = 'أنت فاحص صحة للنظام. أجب بالعبارة المطلوبة فقط دون أي إضافات.';
const HEALTH_PROBE_USER = 'Respond with exactly: ARM_AI_HEALTH_OK';
const HEALTH_PROBE_MAX_TOKENS = 512;

export async function runProviderHealthCheck(
  env: NodeJS.ProcessEnv = process.env,
): Promise<AIProviderHealthResult> {
  const startedAt = Date.now();
  const config: AIProviderConfig | null = readAIProviderConfig(env);

  const base: AIProviderHealthResult = {
    providerConfigured: config !== null,
    modelConfigured: Boolean(config?.model),
    apiKeyConfigured: Boolean(config?.apiKey) || config?.kind === 'z-ai',
    attempted: false,
    providerReachable: false,
    modelAccepted: false,
    operational: false,
    echoMatched: null,
    errorCategory: null,
    effectiveTimeoutMs: config?.timeoutMs ?? null,
    providerHttpStatus: null,
    providerStatus: null,
    safeReason: null,
    status: 'OPERATIONAL',
    latencyMs: null,
    provider: config?.kind ?? null,
    model: config?.model ?? null,
  };

  if (!config) {
    const { readAISafeDiagnostics } = await import('./config');
    const diag = readAISafeDiagnostics(env);
    return {
      ...base,
      status: diag.aiEnabled ? 'MISCONFIGURED' : 'DISABLED',
      errorCategory: diag.configurationProblems[0] ?? null,
    };
  }

  const definition = getProviderDefinition(config.kind);
  if (!definition) {
    return { ...base, status: 'MISCONFIGURED', errorCategory: 'PROVIDER_UNKNOWN' };
  }

  const provider = definition.create({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });

  try {
    const completion = await provider.analyze({
      systemPrompt: HEALTH_PROBE_SYSTEM,
      userContent: HEALTH_PROBE_USER,
      temperature: 0,
      maxOutputTokens: HEALTH_PROBE_MAX_TOKENS,
      // The CONFIGURED Gateway boundary (AI_TIMEOUT_MS, clamped) — the
      // probe is bounded by exactly the same configuration as every
      // other provider call (never a separate hard cap, never unbounded).
      timeoutMs: config.timeoutMs,
    });
    return {
      ...base,
      attempted: true,
      providerReachable: true,
      modelAccepted: true,
      operational: typeof completion.text === 'string' && completion.text.length > 0,
      echoMatched: /ARM_AI_HEALTH_OK/.test(completion.text),
      status: 'OPERATIONAL',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const category = error instanceof AIProviderError ? error.code : 'AI_PROVIDER_ERROR';
    const status = aiStatusFromProviderErrorCode(category);
    // A model rejection still proves the PROVIDER was reachable.
    const reachable = category !== 'AI_NETWORK_ERROR' && category !== 'AI_TIMEOUT';
    // Phase 6.5-A §3: keep the SAFE provider diagnostic so the exact
    // rejection (e.g. NOT_FOUND + reason) is observable/admin-actionable.
    const diagnostic = error instanceof AIProviderError ? error.diagnostic : null;
    return {
      ...base,
      attempted: true,
      providerReachable: reachable,
      modelAccepted: category !== 'AI_MODEL_ERROR' && reachable,
      operational: false,
      echoMatched: null,
      errorCategory: category,
      providerHttpStatus: diagnostic?.httpStatus ?? null,
      providerStatus: diagnostic?.providerStatus ?? null,
      safeReason: diagnostic?.safeReason ?? null,
      status,
      latencyMs: Date.now() - startedAt,
    };
  }
}
