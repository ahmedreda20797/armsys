// ══════════════════════════════════════════════════════════════
//  AI Provider — factory (Phase 6.2 §33, extended Phase 6.4 §4/§5)
//
//  The ONLY place where provider configuration is read. Business
//  code calls createAIProviderFromEnv() and receives either a
//  ready provider or null (→ AI_UNAVAILABLE — the system keeps
//  working normally). Adding a future vendor means adding
//  ONE adapter file + ONE registry entry — nothing else changes (§5).
//
//  Phase 6.4 additions (all server-side only):
//    • gemini adapter (the official initial primary provider)
//    • declarative provider REGISTRY (explicit selection doctrine)
//    • SAFE configuration diagnostics (readAISafeDiagnostics)
//    • provider health check (runProviderHealthCheck)
//    • layered resolution honoring admin settings (resolveAIProvider)
// ══════════════════════════════════════════════════════════════

import { readAIProviderConfig, type AIProviderConfig } from './config';
import { OpenAICompatibleProvider } from './openai-adapter';
import { ZaiProvider } from './z-ai-adapter';
import { GeminiProvider } from './gemini-adapter';
import { getProviderDefinition } from './registry';
import type { AIProvider } from './types';

export type { AIProviderConfig, AIProviderKind, AISafeDiagnostics, AIConfigurationProblemCode } from './config';
export {
  readAIProviderConfig,
  readAISafeDiagnostics,
  AI_DEFAULT_TIMEOUT_MS,
  AI_MAX_TIMEOUT_MS,
  AI_MIN_TIMEOUT_MS,
} from './config';
export { AIProviderError } from './types';
export type { AIProvider, AIProviderCompletion, AIProviderRequest, AIProviderErrorDiagnostic } from './types';
export { OpenAICompatibleProvider } from './openai-adapter';
export { ZaiProvider } from './z-ai-adapter';
export { GeminiProvider } from './gemini-adapter';
export {
  AI_PROVIDER_REGISTRY,
  getProviderDefinition,
  listProviderDefinitions,
  type AIProviderDefinition,
  type AIProviderCapabilities,
  type AIProviderConfigRequirements,
} from './registry';
export { runProviderHealthCheck, type AIProviderHealthResult } from './health';
export { discoverGeminiModels, type GeminiModelInfo, type GeminiModelDiscoveryResult } from './models';
export { resolveAIProvider, type AIProviderResolution } from '../gateway/core';

/** null ⇒ AI is not configured → callers must degrade to AI_UNAVAILABLE. */
export function createAIProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AIProvider | null {
  const config: AIProviderConfig | null = readAIProviderConfig(env);
  if (!config) return null;

  const definition = getProviderDefinition(config.kind);
  if (!definition) return null;

  // readAIProviderConfig already guarantees the per-kind requirements
  // (explicit model for gemini, server-side key for credentialed kinds).
  return definition.create({
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}
