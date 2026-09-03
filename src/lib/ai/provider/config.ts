// ══════════════════════════════════════════════════════════════
//  AI Provider — server-side configuration (Phase 6.2 §6/§33,
//  extended by Phase 6.4 §4/§5/§26 — AI Gateway foundation)
//
//  Environment variables (SERVER ONLY — never NEXT_PUBLIC, never
//  sent to the browser):
//
//    AI_ENABLED=true            master switch (anything else = off)
//    AI_PROVIDER=gemini         'gemini' | 'z-ai' | 'openai-compatible'
//    AI_MODEL=                  EXPLICIT model id (REQUIRED for gemini —
//                               never auto-selected, §4/§5 of Phase 6.4)
//    AI_API_KEY=                server-side credential (never stored in
//                               Firebase, never returned to any client §7)
//    AI_BASE_URL=               optional endpoint override (openai-compatible)
//    AI_TIMEOUT_MS=30000        hard timeout per provider call
//    AI_PROMPT_VERSION          see quality/prompt.ts
//
//  NO configuration (or AI_ENABLED!=true) → readAIProviderConfig()
//  returns null → every caller degrades gracefully and the system
//  keeps working normally.
//
//  Phase 6.4 §3/§25: readAISafeDiagnostics() exposes WHY the AI is
//  not operational using SAFE fields only (booleans + stable problem
//  codes) — never secret values, never raw env content. This is the
//  structured diagnostic the admin surface and tests rely on.
// ══════════════════════════════════════════════════════════════

export const AI_DEFAULT_TIMEOUT_MS = 30_000;
export const AI_MIN_TIMEOUT_MS = 5_000;
export const AI_MAX_TIMEOUT_MS = 120_000;

export type AIProviderKind = 'z-ai' | 'openai-compatible' | 'gemini';

const KNOWN_PROVIDER_KINDS: readonly string[] = ['z-ai', 'openai-compatible', 'gemini'];

export interface AIProviderConfig {
  kind: AIProviderKind;
  model: string | null;
  apiKey: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

export function readAIProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AIProviderConfig | null {
  if (env.AI_ENABLED !== 'true') return null;

  const kind = env.AI_PROVIDER;
  if (kind !== 'z-ai' && kind !== 'openai-compatible' && kind !== 'gemini') return null;

  // Server-side key REQUIRED for credential-based providers — no key, no provider.
  if (kind === 'openai-compatible' && !(env.AI_API_KEY ?? '').trim()) return null;
  if (kind === 'gemini' && !(env.AI_API_KEY ?? '').trim()) return null;

  // Phase 6.4 §4/§5: the model must be EXPLICIT for gemini — the system
  // never auto-selects a model and never silently falls back to another.
  if (kind === 'gemini' && !(env.AI_MODEL ?? '').trim()) return null;

  const rawTimeout = Number(env.AI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(Math.trunc(rawTimeout), AI_MIN_TIMEOUT_MS), AI_MAX_TIMEOUT_MS)
    : AI_DEFAULT_TIMEOUT_MS;

  return {
    kind,
    model: (env.AI_MODEL ?? '').trim() || null,
    apiKey: kind === 'z-ai' ? null : (env.AI_API_KEY ?? '').trim(),
    baseUrl: (env.AI_BASE_URL ?? '').trim() || null,
    timeoutMs,
  };
}

// ── Phase 6.4 §3/§25 — SAFE structured diagnostics ─────────────

/** Stable, non-secret configuration problem codes. */
export type AIConfigurationProblemCode =
  | 'AI_DISABLED'
  | 'PROVIDER_UNKNOWN'
  | 'PROVIDER_NOT_SET'
  | 'API_KEY_MISSING'
  | 'MODEL_MISSING_REQUIRED';

export interface AISafeDiagnostics {
  /** AI_ENABLED === 'true' (master switch). */
  aiEnabled: boolean;
  /** A provider id was configured (value is a NAME, never a secret). */
  providerId: string | null;
  /** The configured provider id is registered in the provider registry. */
  providerKnown: boolean;
  /** An explicit model id was configured. */
  modelConfigured: boolean;
  /** A credential was configured (boolean ONLY — never the value). */
  apiKeyConfigured: boolean;
  /** An endpoint override is present (boolean ONLY). */
  baseUrlOverridden: boolean;
  /** Effective hard timeout (safe number). */
  timeoutMs: number;
  /** Coarse configuration state — DISABLED | MISCONFIGURED | CONFIGURED. */
  configurationState: 'DISABLED' | 'MISCONFIGURED' | 'CONFIGURED';
  /** Stable problem codes explaining a DISABLED/MISCONFIGURED state. */
  configurationProblems: AIConfigurationProblemCode[];
}

/** Structured, secret-free explanation of the current AI configuration.
 *  Safe for admin UI, logs and audit records (§3: only safe diagnostics
 *  such as providerConfigured/modelConfigured/apiKeyConfigured). */
export function readAISafeDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
): AISafeDiagnostics {
  const aiEnabled = env.AI_ENABLED === 'true';
  const providerRaw = (env.AI_PROVIDER ?? '').trim();
  const providerId = providerRaw || null;
  const providerKnown = KNOWN_PROVIDER_KINDS.includes(providerRaw);
  const modelConfigured = Boolean((env.AI_MODEL ?? '').trim());
  const apiKeyConfigured = Boolean((env.AI_API_KEY ?? '').trim());
  const baseUrlOverridden = Boolean((env.AI_BASE_URL ?? '').trim());

  const rawTimeout = Number(env.AI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(Math.trunc(rawTimeout), AI_MIN_TIMEOUT_MS), AI_MAX_TIMEOUT_MS)
    : AI_DEFAULT_TIMEOUT_MS;

  const problems: AIConfigurationProblemCode[] = [];
  if (!aiEnabled) {
    problems.push('AI_DISABLED');
  } else if (!providerRaw) {
    problems.push('PROVIDER_NOT_SET');
  } else if (!providerKnown) {
    problems.push('PROVIDER_UNKNOWN');
  } else if (!apiKeyConfigured && providerRaw !== 'z-ai') {
    problems.push('API_KEY_MISSING');
  } else if (providerRaw === 'gemini' && !modelConfigured) {
    problems.push('MODEL_MISSING_REQUIRED');
  }

  const configurationState = !aiEnabled
    ? 'DISABLED'
    : problems.length > 0
      ? 'MISCONFIGURED'
      : 'CONFIGURED';

  return {
    aiEnabled,
    providerId,
    providerKnown,
    modelConfigured,
    apiKeyConfigured,
    baseUrlOverridden,
    timeoutMs,
    configurationState,
    configurationProblems: problems,
  };
}
