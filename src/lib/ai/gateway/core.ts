// ══════════════════════════════════════════════════════════════
//  AI Gateway — core resolution & orchestration (Phase 6.4, §8)
//
//  THE single server-side AI pathway:
//
//    User → Authentication (route) → Authorization (route)
//      → AI Gateway (THIS module + feature pipelines)
//          → Context Builder (feature — minimized, classified)
//          → Tool/Memory access (controlled, READ_ONLY today)
//          → Provider Adapter (registry-resolved, explicit)
//          → AI Provider (never sees Firebase credentials)
//          → Response Validator (+ output security)
//      → User
//
//  Guarantees enforced here or by the modules this composes:
//    • identity is ALWAYS server-derived (route-level requireAuth, §30)
//    • permissions/scope are ALWAYS enforced outside the model (§11)
//    • provider/model selection is ALWAYS explicit (§4/§5)
//    • RESTRICTED data can never enter a provider payload (§10)
//    • every request is audited with safe fields only (§22)
//
//  PURITY: this module performs NO database access. The admin
//  settings override is INJECTED by the calling route (which already
//  runs inside a DB context) — unit tests and Firebase-free
//  environments resolve env-only, deterministically.
// ══════════════════════════════════════════════════════════════

import {
  readAIProviderConfig,
  readAISafeDiagnostics,
  type AIProviderConfig,
  type AISafeDiagnostics,
} from '../provider/config';
import { getProviderDefinition } from '../provider/registry';
import type { AIProvider } from '../provider/types';
import type { AIProviderSettings } from './provider-settings';

export interface AIProviderResolution {
  /** Ready provider — null when AI is disabled/misconfigured. */
  provider: AIProvider | null;
  config: AIProviderConfig | null;
  diagnostics: AISafeDiagnostics;
  /** The injected settings override state (null when none supplied). */
  settings: AIProviderSettings | null;
  /** Which layer supplied provider/model (observability). */
  providerSource: 'env' | 'settings' | 'none';
}

export interface ResolveAIProviderOptions {
  /** Admin runtime override fetched by the calling route (non-secret:
   *  provider id + model id ONLY — credentials NEVER travel here, §7). */
  settings?: AIProviderSettings | null;
}

/**
 * Resolves the ACTIVE provider through the layered configuration:
 * injected settings override (when present) → env vars. The master
 * switch (AI_ENABLED) always stays env-level. There is NO automatic
 * fallback to another provider/model — if the resolved combination
 * is incomplete the result is null plus explicit diagnostics
 * (§4/§5: configuration errors must be clear).
 */
export function resolveAIProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveAIProviderOptions = {},
): AIProviderResolution {
  const diagnostics = readAISafeDiagnostics(env);
  const settings = options.settings ?? null;

  if (env.AI_ENABLED !== 'true') {
    return { provider: null, config: null, diagnostics, settings, providerSource: 'none' };
  }

  // Effective provider/model: settings override when set, else env.
  const effectiveProviderId = settings?.provider ?? env.AI_PROVIDER;
  const effectiveModel = settings?.model ?? (env.AI_MODEL ?? '');

  const definition = getProviderDefinition(effectiveProviderId ?? '');
  if (!definition) {
    return { provider: null, config: null, diagnostics, settings, providerSource: 'none' };
  }

  // Credential gate — env-level, never settings-level (§7).
  const apiKey = (env.AI_API_KEY ?? '').trim();
  if (definition.requirements.requiresApiKey && !apiKey) {
    return { provider: null, config: null, diagnostics, settings, providerSource: 'none' };
  }

  // Explicit-model gate for providers that require it (§4/§5).
  const model = (effectiveModel ?? '').trim();
  if (definition.requirements.requiresExplicitModel && !model) {
    return { provider: null, config: null, diagnostics, settings, providerSource: 'none' };
  }

  const config: AIProviderConfig = {
    kind: definition.id,
    model: model || null,
    apiKey: definition.requirements.requiresApiKey ? apiKey : null,
    baseUrl: (env.AI_BASE_URL ?? '').trim() || null,
    timeoutMs: diagnostics.timeoutMs,
  };

  const providerSource = settings?.provider || settings?.model ? 'settings' : 'env';
  return {
    provider: definition.create({ model: config.model, apiKey: config.apiKey, baseUrl: config.baseUrl }),
    config,
    diagnostics,
    settings,
    providerSource,
  };
}
