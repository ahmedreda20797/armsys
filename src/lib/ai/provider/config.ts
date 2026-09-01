// ══════════════════════════════════════════════════════════════
//  AI Provider — server-side configuration (Phase 6.2, spec §6/§33)
//
//  Environment variables (SERVER ONLY — never NEXT_PUBLIC, never
//  sent to the browser, spec §64):
//
//    AI_ENABLED=true            master switch (anything else = off)
//    AI_PROVIDER=z-ai           'z-ai' | 'openai-compatible'
//    AI_MODEL=                  optional model id override
//    AI_API_KEY=                key for openai-compatible (server only)
//    AI_BASE_URL=               optional base URL override
//                               (default https://api.openai.com/v1)
//    AI_TIMEOUT_MS=30000        hard timeout per provider call
//    AI_PROMPT_VERSION=quality-analysis-v1   (see quality/prompt.ts)
//
//  NO configuration (or AI_ENABLED!=true) → readAIProviderConfig()
//  returns null → every caller degrades to AI_UNAVAILABLE and the
//  system keeps working normally (spec §6/§33/§60).
// ══════════════════════════════════════════════════════════════

export const AI_DEFAULT_TIMEOUT_MS = 30_000;
export const AI_MIN_TIMEOUT_MS = 5_000;
export const AI_MAX_TIMEOUT_MS = 120_000;

export type AIProviderKind = 'z-ai' | 'openai-compatible';

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
  if (kind !== 'z-ai' && kind !== 'openai-compatible') return null;

  // openai-compatible REQUIRES a server-side key — no key, no provider.
  if (kind === 'openai-compatible' && !(env.AI_API_KEY ?? '').trim()) return null;

  const rawTimeout = Number(env.AI_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
    ? Math.min(Math.max(Math.trunc(rawTimeout), AI_MIN_TIMEOUT_MS), AI_MAX_TIMEOUT_MS)
    : AI_DEFAULT_TIMEOUT_MS;

  return {
    kind,
    model: (env.AI_MODEL ?? '').trim() || null,
    apiKey: kind === 'openai-compatible' ? (env.AI_API_KEY ?? '').trim() : null,
    baseUrl: (env.AI_BASE_URL ?? '').trim() || null,
    timeoutMs,
  };
}
