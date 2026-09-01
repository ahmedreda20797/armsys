// ══════════════════════════════════════════════════════════════
//  AI Provider — OpenAI-compatible HTTPS adapter (Phase 6.2)
//
//  One generic HTTPS adapter covering every OpenAI-compatible
//  endpoint (OpenAI, Gemini-compat, vLLM, ... — spec §5). The ONLY
//  transport is a server-side fetch (spec §61: Vercel-compatible —
//  no Python, no Docker, no persistent process).
//
//  Error mapping (spec §62) — raw provider errors NEVER leave this
//  file; every failure becomes a structured AIProviderError:
//    401/403 → AI_AUTH_ERROR      429 → AI_RATE_LIMITED
//    5xx     → AI_PROVIDER_ERROR  network → AI_NETWORK_ERROR
//    abort   → AI_TIMEOUT         bad body → AI_INVALID_RESPONSE
//
//  Retry (spec §63): AT MOST one retry, ONLY for transient failures
//  (network drop / 429 / 5xx) and only when nothing was consumed.
// ══════════════════════════════════════════════════════════════

import {
  AIProviderError,
  type AIProvider,
  type AIProviderCompletion,
  type AIProviderRequest,
} from './types';

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: unknown;
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = 'openai-compatible';
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: { apiKey: string; model?: string | null; baseUrl?: string | null }) {
    this.apiKey = options.apiKey;
    this.model = options.model?.trim() || 'gpt-4o-mini';
    this.baseUrl = (options.baseUrl?.trim() || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  async analyze(request: AIProviderRequest): Promise<AIProviderCompletion> {
    const startedAt = Date.now();
    let retriedTransient = false;

    // ── At most ONE retry for transient failures (spec §63) ──
    for (;;) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: 'system', content: request.systemPrompt },
              { role: 'user', content: request.userContent },
            ],
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxOutputTokens ?? 1600,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (!retriedTransient && isTransientStatus(response.status)) {
            retriedTransient = true;
            continue; // single safe retry
          }
          throw mapStatusToError(response.status);
        }

        const body = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
        const text = body?.choices?.[0]?.message?.content;
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

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function mapStatusToError(status: number): AIProviderError {
  if (status === 401 || status === 403) {
    return new AIProviderError('AI_AUTH_ERROR', 'رفض مزود الذكاء الاصطناعي بيانات الاعتماد');
  }
  if (status === 429) {
    return new AIProviderError('AI_RATE_LIMITED', 'تجاوز حد معدل طلبات مزود الذكاء الاصطناعي');
  }
  return new AIProviderError('AI_PROVIDER_ERROR', `أعاد مزود الذكاء الاصطناعي خطأ (HTTP ${status})`);
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
