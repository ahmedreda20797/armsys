// ══════════════════════════════════════════════════════════════
//  AI Provider — z-ai platform adapter (Phase 6.2)
//
//  Uses the z-ai-web-dev-sdk already declared in package.json
//  (server-side only). The SDK is imported DYNAMICALLY so the
//  adapter degrades gracefully (AI_UNAVAILABLE) when the package
//  or its platform credentials are unavailable — never a crash.
//
//  Timeout: the SDK does not expose an AbortSignal — the adapter
//  enforces the hard timeout with Promise.race (spec §62).
//  NO automatic retry against the platform (spec §63 conservatism).
// ══════════════════════════════════════════════════════════════

import {
  AIProviderError,
  type AIProvider,
  type AIProviderCompletion,
  type AIProviderRequest,
} from './types';

interface ZaiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ZaiCompletionLike {
  choices?: Array<{ message?: { content?: unknown } }>;
  content?: unknown;
}

interface ZaiClientLike {
  chat: {
    completions: {
      create(body: {
        messages: ZaiChatMessage[];
        thinking?: { type: 'enabled' | 'disabled' };
        temperature?: number;
      }): Promise<unknown>;
    };
  };
}

export class ZaiProvider implements AIProvider {
  readonly name = 'z-ai';
  readonly model: string;
  private clientPromise: Promise<ZaiClientLike> | null = null;

  constructor(model?: string | null) {
    this.model = model?.trim() || 'glm-4.6';
  }

  private getClient(): Promise<ZaiClientLike> {
    if (!this.clientPromise) {
      this.clientPromise = import('z-ai-web-dev-sdk')
        .then((mod) => {
          // Support both interop shapes: ESM default export or CJS direct.
          const candidate = mod as unknown as {
            default?: { create(): Promise<unknown> };
            create?: () => Promise<unknown>;
          };
          const factory = candidate.default ?? candidate;
          if (!factory || typeof factory.create !== 'function') {
            throw new AIProviderError(
              'AI_PROVIDER_ERROR',
              'تعذر تهيئة مزود الذكاء الاصطناعي (بنية SDK غير متوقعة)',
            );
          }
          return factory.create() as Promise<ZaiClientLike>;
        })
        .catch((error) => {
          this.clientPromise = null;
          throw new AIProviderError(
            'AI_PROVIDER_ERROR',
            `تعذر تهيئة مزود الذكاء الاصطناعي (${error instanceof Error ? error.name : 'unknown'})`,
          );
        });
    }
    return this.clientPromise;
  }

  async analyze(request: AIProviderRequest): Promise<AIProviderCompletion> {
    const startedAt = Date.now();
    const client = await this.getClient();

    const call = client.chat.completions.create({
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      thinking: { type: 'disabled' },
      temperature: request.temperature ?? 0.2,
    });

    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new AIProviderError('AI_TIMEOUT', 'انتهت مهلة طلب المزود')),
        request.timeoutMs,
      );
      // Never keep the Node event loop alive for the timer alone.
      if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    });

    let raw: unknown;
    try {
      raw = await Promise.race([call, timeout]);
    } catch (error) {
      if (error instanceof AIProviderError) throw error;
      throw new AIProviderError(
        'AI_PROVIDER_ERROR',
        'أعاد مزود الذكاء الاصطناعي خطأ غير متوقع',
      );
    }

    const body = raw as ZaiCompletionLike;
    const content = body?.choices?.[0]?.message?.content ?? body?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AIProviderError('AI_INVALID_RESPONSE', 'بنية استجابة المزود غير صالحة');
    }
    return {
      text: content,
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - startedAt,
    };
  }
}
