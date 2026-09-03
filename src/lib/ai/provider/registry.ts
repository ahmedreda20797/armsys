// ══════════════════════════════════════════════════════════════
//  AI Provider — registry (Phase 6.4, spec §5)
//
//  ONE declarative place describing every supported provider:
//  display name, capabilities, configuration requirements and the
//  adapter factory. Selection is ALWAYS explicit (AI_PROVIDER +
//  AI_MODEL) — no random selection, no hidden fallback, no
//  automatic model routing of any kind (spec §1.7: never an
//  automatic/free router that silently changes models).
//
//  Adding a future vendor = ONE adapter file + ONE registry entry.
//  Business code never changes (spec §4/§5).
//
//  NOTE (Vercel-compatibility §27): adapters are imported statically —
//  they are small, server-only modules (the z-ai SDK itself is loaded
//  dynamically INSIDE its adapter at call time), so no lazy-import
//  tricks are needed here.
// ══════════════════════════════════════════════════════════════

import type { AIProviderKind } from './config';
import type { AIProvider } from './types';
import { GeminiProvider } from './gemini-adapter';
import { ZaiProvider } from './z-ai-adapter';
import { OpenAICompatibleProvider } from './openai-adapter';

export interface AIProviderCapabilities {
  /** Single-shot text generation (the current analyze() path). */
  generate: boolean;
  /** Streaming — NOT used by any ARM feature yet (declared for future phases). */
  stream: boolean;
  /** Native provider tool-calling — ARM uses its own controlled tool
   *  layer instead (Phase 6.4 §12), so this is false everywhere. */
  nativeToolCall: boolean;
}

export interface AIProviderConfigRequirements {
  /** Server-side credential env var names (NAMES only — never values, §7). */
  credentialEnvVars: string[];
  /** Is a credential mandatory for this provider to operate? */
  requiresApiKey: boolean;
  /** Must the administrator configure AI_MODEL explicitly? */
  requiresExplicitModel: boolean;
  /** Where the effective model id comes from when not configured. */
  modelSource: 'explicit-required' | 'explicit-optional-vendor-default' | 'platform-default';
  /** Supports an endpoint base-URL override (AI_BASE_URL). */
  supportsBaseUrlOverride: boolean;
}

export interface AIProviderDefinition {
  id: AIProviderKind;
  displayName: string;
  capabilities: AIProviderCapabilities;
  requirements: AIProviderConfigRequirements;
  /** Construct the adapter. Receives ONLY what the provider needs. */
  create(options: { model: string | null; apiKey: string | null; baseUrl: string | null }): AIProvider;
}

export const AI_PROVIDER_REGISTRY: Record<AIProviderKind, AIProviderDefinition> = {
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    capabilities: { generate: true, stream: false, nativeToolCall: false },
    requirements: {
      credentialEnvVars: ['AI_API_KEY'],
      requiresApiKey: true,
      requiresExplicitModel: true,
      modelSource: 'explicit-required',
      supportsBaseUrlOverride: true,
    },
    create: (options) =>
      // Callers only reach here after the explicit-model gate has been
      // enforced (readAIProviderConfig + resolveAIProvider + route
      // validation) — gemini cannot exist without an explicit model id.
      new GeminiProvider({
        apiKey: options.apiKey as string,
        model: options.model as string,
        baseUrl: options.baseUrl,
      }),
  },
  'z-ai': {
    id: 'z-ai',
    displayName: 'z-ai Platform (GLM)',
    capabilities: { generate: true, stream: false, nativeToolCall: false },
    requirements: {
      credentialEnvVars: [],
      requiresApiKey: false,
      requiresExplicitModel: false,
      modelSource: 'platform-default',
      supportsBaseUrlOverride: false,
    },
    create: (options) => new ZaiProvider(options.model),
  },
  'openai-compatible': {
    id: 'openai-compatible',
    displayName: 'OpenAI-Compatible Endpoint',
    capabilities: { generate: true, stream: false, nativeToolCall: false },
    requirements: {
      credentialEnvVars: ['AI_API_KEY'],
      requiresApiKey: true,
      requiresExplicitModel: false,
      modelSource: 'explicit-optional-vendor-default',
      supportsBaseUrlOverride: true,
    },
    create: (options) =>
      new OpenAICompatibleProvider({
        apiKey: options.apiKey as string,
        model: options.model,
        baseUrl: options.baseUrl,
      }),
  },
};

export function getProviderDefinition(kind: string): AIProviderDefinition | null {
  if (kind === 'gemini' || kind === 'z-ai' || kind === 'openai-compatible') {
    return AI_PROVIDER_REGISTRY[kind];
  }
  return null;
}

/** Stable list for admin surfaces — metadata only, never secrets. */
export function listProviderDefinitions(): AIProviderDefinition[] {
  return [
    AI_PROVIDER_REGISTRY.gemini,
    AI_PROVIDER_REGISTRY['z-ai'],
    AI_PROVIDER_REGISTRY['openai-compatible'],
  ];
}
