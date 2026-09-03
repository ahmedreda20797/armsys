// ══════════════════════════════════════════════════════════════
//  AI Provider — Google Gemini adapter (Phase 6.4, spec §4)
//
//  The OFFICIAL initial primary provider. Plain server-side fetch to
//  the Generative Language API — no new SDK dependency, no Python,
//  no long-running process (Vercel-compatible, spec §27).
//
//  SECURITY (spec §7/§62):
//    • the credential travels ONLY in the x-goog-api-key HEADER —
//      never in a URL/query string (URLs end up in access logs);
//    • raw provider error bodies NEVER leave this file — every
//      failure becomes a structured AIProviderError;
//    • the adapter never receives or returns Firebase credentials.
//
//  MODEL POLICY (spec §4/§5): the model id is injected explicitly by
//  the registry/factory from AI_MODEL. There is NO default model and
//  NO automatic fallback — an invalid/unavailable model id maps to
//  AI_MODEL_ERROR so the admin gets a clear configuration signal.
//
//  Error mapping (mirrors the OpenAI-compatible doctrine §62):
//    401/403               → AI_AUTH_ERROR
//    404 / NOT_FOUND       → AI_MODEL_ERROR  (model does not exist)
//    429 / RESOURCE_EXHAUSTED → AI_RATE_LIMITED
//    5xx / UNAVAILABLE     → AI_PROVIDER_ERROR
//    network / abort       → AI_NETWORK_ERROR / AI_TIMEOUT
//    bad body              → AI_INVALID_RESPONSE
//
//  Phase 6.5-A §3: every mapped failure additionally carries a SAFE
//  structured diagnostic (httpStatus / providerStatus / providerCode /
//  bounded secret-redacted safeReason) consumed by the health check +
//  admin verification — so the EXACT provider rejection (e.g. a model
//  no longer served to the account) is observable, never hidden behind
//  a bare category.
//
//  Retry (spec §63): AT MOST one retry, ONLY for transient failures
//  (network drop / 429 / 5xx), never for auth/model errors.
// ══════════════════════════════════════════════════════════════

import {
  AIProviderError,
  type AIProvider,
  type AIProviderCompletion,
  type AIProviderErrorDiagnostic,
  type AIProviderRequest,
} from './types';

const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Phase 6.5-A §3: the safe reason is BOUNDED (a provider message can be
 *  arbitrarily large/hostile) and is never the raw response body. */
const SAFE_REASON_MAX_LENGTH = 240;

interface GeminiGenerationResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    finishReason?: unknown;
  }>;
  promptFeedback?: { blockReason?: unknown };
  error?: { code?: unknown; status?: unknown; message?: unknown };
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string | null }) {
    this.apiKey = options.apiKey;
    this.model = options.model.trim();
    this.baseUrl = (options.baseUrl?.trim() || GEMINI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async analyze(request: AIProviderRequest): Promise<AIProviderCompletion> {
    const startedAt = Date.now();
    let retriedTransient = false;

    // ── At most ONE retry for transient failures (spec §63) ──
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(
          `${this.baseUrl}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Credential in a HEADER — never in the URL (§7).
              'x-goog-api-key': this.apiKey,
            },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: request.systemPrompt }] },
              contents: [{ role: 'user', parts: [{ text: request.userContent }] }],
              generationConfig: {
                temperature: request.temperature ?? 0.2,
                maxOutputTokens: request.maxOutputTokens ?? 1600,
              },
            }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const parsed = await readGeminiErrorStatus(response);
          if (!retriedTransient && isTransientStatus(response.status)) {
            retriedTransient = true;
            continue; // single safe retry
          }
          throw mapGeminiFailure(
            response.status,
            parsed.apiStatus,
            parsed.looksLikeApiKeyError,
            {
              providerCode: parsed.apiCode,
              providerMessage: parsed.apiMessage,
              redactSecrets: [this.apiKey],
            },
          );
        }

        const body = (await response.json().catch(() => null)) as GeminiGenerationResponse | null;
        const text = extractText(body);
        if (typeof text !== 'string' || text.length === 0) {
          throw new AIProviderError('AI_INVALID_RESPONSE', 'بنية استجابة المزود غير صالحة');
        }
        return {
          text,
          provider: this.name,
          model: this.model,
          latencyMs: Date.now() - startedAt,
        };
      } catch (error) {
        if (error instanceof AIProviderError) throw error;
        if (isAbort(error)) throw new AIProviderError('AI_TIMEOUT', 'انتهت مهلة طلب المزود');
        if (!retriedTransient) {
          retriedTransient = true;
          continue; // single safe retry for network drops
        }
        throw new AIProviderError('AI_NETWORK_ERROR', 'تعذر الاتصال بمزود الذكاء الاصطناعي');
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

// ── internals (shared with the model-discovery helper — Phase 6.5-A) ─

/** Parsed SAFE fields of a Gemini error body ({ error: { code, message,
 *  status } }) — Phase 6.5-A §3. The message is used ONLY for credential
 *  classification and the bounded safeReason; the raw body itself is
 *  never propagated into errors, logs or responses (§62/§7). */
export interface GeminiErrorFields {
  apiStatus: string | null;
  apiCode: number | null;
  apiMessage: string | null;
  looksLikeApiKeyError: boolean;
}

/** Extracts ONLY the machine-readable error fields — never the raw body.
 *  Every field is type-guarded: a hostile/malformed body degrades to
 *  nulls instead of throwing or leaking (§16-L). */
export async function readGeminiErrorStatus(response: Response): Promise<GeminiErrorFields> {
  try {
    const body = (await response.json()) as GeminiGenerationResponse | null;
    const error = body?.error;
    const status = typeof error?.status === 'string' ? error.status : null;
    const code = typeof error?.code === 'number' && Number.isFinite(error.code) ? error.code : null;
    // The raw message is used ONLY for classification + the bounded
    // safeReason — never propagated verbatim into errors/logs (§62/§7).
    const message = typeof error?.message === 'string' ? error.message : '';
    return {
      apiStatus: status,
      apiCode: code,
      apiMessage: message || null,
      looksLikeApiKeyError: /api\s*key/i.test(message),
    };
  } catch {
    return { apiStatus: null, apiCode: null, apiMessage: null, looksLikeApiKeyError: false };
  }
}

/** Builds the SAFE diagnostic reason: secret-redacted, length-capped,
 *  newlines collapsed. Returns null when the provider gave no usable
 *  message — a missing reason is safer than an unbounded one. */
function buildSafeReason(
  providerMessage: string | null,
  redactSecrets: readonly string[],
): string | null {
  if (!providerMessage) return null;
  let reason = providerMessage.replace(/\s+/g, ' ').trim();
  for (const secret of redactSecrets) {
    if (secret && reason.includes(secret)) {
      reason = reason.split(secret).join('[REDACTED]');
    }
  }
  if (reason.length > SAFE_REASON_MAX_LENGTH) {
    reason = `${reason.slice(0, SAFE_REASON_MAX_LENGTH)}…`;
  }
  return reason || null;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Shared failure mapping for every Gemini endpoint call (generation
 *  + model discovery). Raw provider bodies NEVER leak (§62/§16-L).
 *  Phase 6.5-A §3: each mapped failure now carries a SAFE structured
 *  diagnostic (httpStatus/providerStatus/providerCode/safeReason) so
 *  the admin sees WHAT exactly Google rejected — e.g. a 404 NOT_FOUND
 *  with "no longer available to new users" — instead of a bare
 *  MODEL_ERROR. The user-facing message stays exactly as before. */
export function mapGeminiFailure(
  httpStatus: number,
  apiStatus: string | null,
  looksLikeApiKeyError: boolean,
  providerDetail?: {
    providerCode?: number | null;
    providerMessage?: string | null;
    redactSecrets?: readonly string[];
  },
): AIProviderError {
  const diagnostic = (): AIProviderErrorDiagnostic => ({
    httpStatus,
    providerStatus: apiStatus,
    providerCode: providerDetail?.providerCode ?? null,
    safeReason: buildSafeReason(providerDetail?.providerMessage ?? null, providerDetail?.redactSecrets ?? []),
  });

  if (httpStatus === 404 || apiStatus === 'NOT_FOUND') {
    return new AIProviderError('AI_MODEL_ERROR', 'الموديل المُهيأ غير متاح لدى المزود — راجع إعداد AI_MODEL', diagnostic());
  }
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    apiStatus === 'PERMISSION_DENIED' ||
    (httpStatus === 400 && looksLikeApiKeyError) // Gemini reports an invalid key as 400
  ) {
    return new AIProviderError('AI_AUTH_ERROR', 'رفض مزود الذكاء الاصطناعي بيانات الاعتماد', diagnostic());
  }
  if (httpStatus === 429 || apiStatus === 'RESOURCE_EXHAUSTED') {
    return new AIProviderError('AI_RATE_LIMITED', 'تجاوز حد معدل طلبات مزود الذكاء الاصطناعي', diagnostic());
  }
  if (httpStatus === 400) {
    return new AIProviderError('AI_MODEL_ERROR', 'رفض المزود إعداد الموديل الحالي — راجع إعداد AI_MODEL', diagnostic());
  }
  return new AIProviderError('AI_PROVIDER_ERROR', `أعاد مزود الذكاء الاصطناعي خطأ (HTTP ${httpStatus})`, diagnostic());
}

function extractText(body: GeminiGenerationResponse | null): string | null {
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const texts = parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .filter((t) => t.length > 0);
  if (texts.length === 0) return null;
  return texts.join('');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
