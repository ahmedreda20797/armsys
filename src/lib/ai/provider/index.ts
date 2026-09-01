// ══════════════════════════════════════════════════════════════
//  AI Provider — factory (Phase 6.2, spec §33)
//
//  The ONLY place where provider configuration is read. Business
//  code calls createAIProviderFromEnv() and receives either a
//  ready provider or null (→ AI_UNAVAILABLE — the system keeps
//  working normally, spec §6). Adding a future vendor means adding
//  ONE adapter file + one case here — nothing else changes (§5).
// ══════════════════════════════════════════════════════════════

import { readAIProviderConfig, type AIProviderConfig } from './config';
import { OpenAICompatibleProvider } from './openai-adapter';
import { ZaiProvider } from './z-ai-adapter';
import type { AIProvider } from './types';

export type { AIProviderConfig } from './config';
export { readAIProviderConfig } from './config';
export { AI_DEFAULT_TIMEOUT_MS, AI_MAX_TIMEOUT_MS, AI_MIN_TIMEOUT_MS } from './config';
export { AIProviderError } from './types';
export type { AIProvider, AIProviderCompletion, AIProviderRequest } from './types';
export { OpenAICompatibleProvider } from './openai-adapter';
export { ZaiProvider } from './z-ai-adapter';

/** null ⇒ AI is not configured → callers must degrade to AI_UNAVAILABLE. */
export function createAIProviderFromEnv(env: NodeJS.ProcessEnv = process.env): AIProvider | null {
  const config: AIProviderConfig | null = readAIProviderConfig(env);
  if (!config) return null;

  switch (config.kind) {
    case 'z-ai':
      return new ZaiProvider(config.model);
    case 'openai-compatible':
      // readAIProviderConfig already guarantees a non-empty key.
      return new OpenAICompatibleProvider({
        apiKey: config.apiKey as string,
        model: config.model,
        baseUrl: config.baseUrl,
      });
    default:
      return null;
  }
}
