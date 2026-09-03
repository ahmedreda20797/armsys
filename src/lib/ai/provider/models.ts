// ══════════════════════════════════════════════════════════════
//  Gemini model discovery (Phase 6.5-A, spec §3)
//
//  Answers ONE question safely: which Gemini models does the
//  CONFIGURED account/endpoint actually support — right now?
//
//  HARD RULES (spec §3):
//    • this is a LISTING service for the administrator — it NEVER
//      selects, configures or returns a "chosen" model;
//    • the admin must explicitly set AI_MODEL=<real-model-id>;
//    • no key/secret ever appears in the result;
//    • provider error bodies are never propagated — only safe
//      categories (shared adapter mapping).
//
//  Uses the same endpoint family and credential-header doctrine as
//  the generation adapter (no duplicate transport logic).
// ══════════════════════════════════════════════════════════════

import { AIProviderError } from './types';
import {
  mapGeminiFailure,
  readGeminiErrorStatus,
} from './gemini-adapter';
import type { AIStatus } from '../gateway/status';
import { aiStatusFromProviderErrorCode } from '../gateway/status';

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

export interface GeminiModelInfo {
  /** Normalized model id WITHOUT the 'models/' prefix — exactly the
   *  value the administrator may set as AI_MODEL. */
  id: string;
  displayName: string | null;
  /** True only when the model supports generateContent (what ARM uses). */
  supportsGenerate: boolean;
}

export interface GeminiModelDiscoveryResult {
  /** A discovery HTTP attempt was made (false when unconfigured). */
  attempted: boolean;
  reachable: boolean;
  /** The configured credential was accepted (boolean only). */
  authenticated: boolean;
  /** SAFE model metadata — ids/names only, never secrets. */
  models: GeminiModelInfo[];
  status: AIStatus;
  errorCategory: string | null;
  latencyMs: number | null;
}

interface ListModelsResponse {
  models?: Array<{
    name?: unknown;
    displayName?: unknown;
    supportedGenerationMethods?: unknown;
  }>;
}

const DISCOVERY_TIMEOUT_MS = 10_000;

/** Defense-in-depth (§7/§16): a hostile/misbehaving endpoint could echo
 *  the credential through metadata fields — strip any occurrence of the
 *  configured key substring from every string we return. */
function redactSecret(text: string, apiKey: string): string {
  if (!apiKey || text.indexOf(apiKey) === -1) return text;
  return text.split(apiKey).join('[REDACTED]');
}

export async function discoverGeminiModels(
  env: NodeJS.ProcessEnv = process.env,
): Promise<GeminiModelDiscoveryResult> {
  const startedAt = Date.now();
  const base: GeminiModelDiscoveryResult = {
    attempted: false,
    reachable: false,
    authenticated: false,
    models: [],
    status: 'OPERATIONAL',
    errorCategory: null,
    latencyMs: null,
  };

  const apiKey = (env.AI_API_KEY ?? '').trim();
  if (!apiKey) {
    return {
      ...base,
      status: 'MISCONFIGURED',
      errorCategory: 'API_KEY_MISSING',
    };
  }

  const baseUrl = (env.AI_BASE_URL ?? '').trim().replace(/\/+$/, '') || GEMINI_DEFAULT_BASE_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/v1beta/models?pageSize=1000`, {
      method: 'GET',
      headers: {
        // Credential in a HEADER — never in the URL (§7 doctrine).
        'x-goog-api-key': apiKey,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const parsed = await readGeminiErrorStatus(response);
      const error = mapGeminiFailure(response.status, parsed.apiStatus, parsed.looksLikeApiKeyError, {
        providerCode: parsed.apiCode,
        providerMessage: parsed.apiMessage,
        redactSecrets: [apiKey],
      });
      const status = aiStatusFromProviderErrorCode(error.code);
      return {
        ...base,
        attempted: true,
        reachable: error.code !== 'AI_NETWORK_ERROR' && error.code !== 'AI_TIMEOUT',
        authenticated: error.code !== 'AI_AUTH_ERROR',
        status,
        errorCategory: error.code,
        latencyMs: Date.now() - startedAt,
      };
    }

    const body = (await response.json().catch(() => null)) as ListModelsResponse | null;
    if (!body || !Array.isArray(body.models)) {
      return {
        ...base,
        attempted: true,
        reachable: true,
        status: 'VALIDATION_ERROR',
        errorCategory: 'AI_INVALID_RESPONSE',
        latencyMs: Date.now() - startedAt,
      };
    }

    const models: GeminiModelInfo[] = [];
    for (const raw of body.models) {
      const name = typeof raw.name === 'string' ? raw.name : '';
      if (!name) continue;
      const methods = Array.isArray(raw.supportedGenerationMethods)
        ? raw.supportedGenerationMethods.filter((m): m is string => typeof m === 'string')
        : [];
      models.push({
        id: redactSecret(name.replace(/^models\//, ''), apiKey),
        displayName: redactSecret(typeof raw.displayName === 'string' ? raw.displayName : '', apiKey) || null,
        supportsGenerate: methods.includes('generateContent'),
      });
    }

    return {
      ...base,
      attempted: true,
      reachable: true,
      authenticated: true,
      models,
      status: 'OPERATIONAL',
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ...base,
      attempted: true,
      status: isAbort ? 'TIMEOUT' : 'UNAVAILABLE',
      errorCategory: isAbort ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR',
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}
