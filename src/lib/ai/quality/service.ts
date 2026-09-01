// ══════════════════════════════════════════════════════════════
//  Quality AI — orchestrator service (Phase 6.2)
//
//  Pipeline (spec §7/§70):
//    dataset (already permission + scope checked by the route)
//      → deterministic TypeScript analytics (unchanged engine)
//      → AI input builder (structured, minimized, evidence-cataloged)
//      → data-sufficiency gate (NO_DATA / INSUFFICIENT short-circuit
//        WITHOUT any provider call — spec §56)
//      → provider abstraction (AIProvider.analyze — nothing else
//        knows the vendor)
//      → strict output validation + hallucination guard
//      → validated result (never a raw provider response)
//
//  FAILURE ISOLATION (spec §53): this service NEVER throws — every
//  outcome is an explicit QualityAIApiResponse status. Facts,
//  analytics and evidence of the Smart Report are untouched by any
//  AI failure (the section is rendered independently).
//
//  READ-ONLY (spec §3/§16): zero writes anywhere; recommendations
//  are PROPOSED-only; no Organizational Memory writes (§41).
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';
import { runEmployeeAnalytics } from '@/lib/analytics/service';
import {
  createAIProviderFromEnv,
  AIProviderError,
  AI_DEFAULT_TIMEOUT_MS,
  type AIProvider,
} from '../provider';
import { readAIProviderConfig } from '../provider/config';
import { buildQualityAIAnalysisInput } from './input-builder';
import { QUALITY_AI_SYSTEM_PROMPT, buildQualityAIUserContent } from './prompt';
import { AI_PROMPT_VERSION } from './version';
import { validateQualityAIOutput } from './validate';
import {
  qualityAICacheKey,
  getCachedQualityAI,
  setCachedQualityAI,
} from './cache';
import type { QualityAIApiResponse, QualityAIAnalysisResult } from './contracts';

export interface RunQualityAIAnalysisInput {
  dataset: EmployeePerformanceDataset;
  userId: string;
  /** Injected provider (tests / future workflows). null ⇒ AI disabled. */
  provider?: AIProvider | null;
}

/** Observability (§58): status/provider/model/latency ONLY — never
 *  prompt content, never response content, never keys. */
function logObservability(fields: Record<string, string | number | boolean>): void {
  try {
    console.info('[ai-quality]', JSON.stringify(fields));
  } catch {
    // Logging must never break the response path.
  }
}

export async function runQualityAIAnalysis(
  input: RunQualityAIAnalysisInput,
): Promise<QualityAIApiResponse> {
  const startedAt = Date.now();
  try {
    // ── 1) Deterministic analytics (unchanged engine, spec §65) ──
    const analyticsOutcome = await runEmployeeAnalytics(input.dataset);
    if (!analyticsOutcome.ok) {
      logObservability({ status: 'AI_ERROR', reason: `ANALYTICS_${analyticsOutcome.reason}` });
      return {
        status: 'AI_ERROR',
        reason: `ANALYTICS_${analyticsOutcome.reason}`,
        message: 'تعذر تشغيل التحليل الإحصائي الحتمي — التحليل الذكي يحتاجه كمصدر للأرقام. باقي التقرير يعمل بشكل طبيعي.',
      };
    }
    const analytics = analyticsOutcome.result;

    // ── 2) Structured input + deterministic sufficiency gate (§2/§56) ──
    const built = buildQualityAIAnalysisInput(input.dataset, analytics, null);
    if (built.kind === 'NO_DATA') return { status: 'NO_DATA', message: built.message };
    if (built.kind === 'INSUFFICIENT_DATA') return { status: 'INSUFFICIENT_DATA', message: built.message };
    if (built.kind === 'ANALYTICS_ERROR') {
      return { status: 'AI_ERROR', reason: built.reason, message: 'تعذر بناء مدخلات التحليل الذكي.' };
    }
    const payload = built.payload;
    const dataSufficiency = built.dataSufficiency;

    // ── 3) Provider resolution (§6/§33: null config ⇒ AI_UNAVAILABLE) ──
    const envConfig = readAIProviderConfig();
    const provider = input.provider !== undefined ? input.provider : createAIProviderFromEnv();
    if (!provider) {
      return {
        status: 'AI_UNAVAILABLE',
        message: 'التحليل الذكي غير مُهيأ على هذه البيئة — الحقائق والتحليل الإحصائي والأدلة تبقى متاحة بشكل طبيعي.',
      };
    }

    // ── 4) Cache lookup (§26 — content-addressed, failures never cached) ──
    const cacheKey = qualityAICacheKey({
      employeeId: input.dataset.employee.employeeId,
      month: input.dataset.period.monthKey,
      windowMonths: 6, // route clamp mirrors the analytics route default
      minOccurrences: 2,
      payload,
      analyticsEngineVersion: analytics.analyticsEngineVersion,
      promptVersion: AI_PROMPT_VERSION,
      provider: provider.name,
      model: provider.model,
    });
    const cached = getCachedQualityAI(cacheKey);
    if (cached) {
      return { status: 'OK', result: cached, cached: true };
    }

    // ── 5) Provider call (single attempt — no retry loops, §63) ──
    const completion = await provider.analyze({
      systemPrompt: QUALITY_AI_SYSTEM_PROMPT,
      userContent: buildQualityAIUserContent(JSON.stringify(payload)),
      temperature: 0.2,
      maxOutputTokens: 1600,
      timeoutMs: envConfig?.timeoutMs ?? AI_DEFAULT_TIMEOUT_MS,
    });

    // ── 6) Strict validation + hallucination guard (§27/§28) ──
    const validated = validateQualityAIOutput(completion.text, payload);
    if (!validated.ok) {
      logObservability({ status: 'AI_INVALID_RESPONSE', reason: validated.reason, provider: provider.name, model: provider.model });
      return {
        status: 'AI_INVALID_RESPONSE',
        message: 'لم تجتز استجابة التحليل الذكي التحقق الصارم (المخطط/الأدلة/الأرقام) — لن تُعرض أي نتيجة غير موثوقة.',
      };
    }

    const result: QualityAIAnalysisResult = {
      ...validated.result,
      dataSufficiency,
      promptVersion: AI_PROMPT_VERSION,
      provider: provider.name,
      model: provider.model,
    };
    if (validated.audit.droppedInsights.length > 0 || validated.audit.droppedRecommendations.length > 0) {
      result.limitations = [
        ...result.limitations,
        `تم استبعاد ${validated.audit.droppedInsights.length} استنتاج و${validated.audit.droppedRecommendations.length} توصية لم تجتز التحقق (أرقام غير مدعومة / مراجع غير موجودة).`,
      ];
    }

    // ── 7) Cache the VALIDATED success only (§26) ──
    setCachedQualityAI(cacheKey, result);
    logObservability({
      status: 'OK',
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      employeeId: input.dataset.employee.employeeId,
      promptVersion: AI_PROMPT_VERSION,
      insights: result.insights.length,
      recommendations: result.recommendations.length,
    });
    return { status: 'OK', result, cached: false };
  } catch (error) {
    // ── Failure isolation (§53): structured statuses, never a throw ──
    if (error instanceof AIProviderError) {
      logObservability({ status: error.code, latencyMs: Date.now() - startedAt });
      if (error.code === 'AI_TIMEOUT') {
        return { status: 'AI_TIMEOUT', message: 'انتهت مهلة التحليل الذكي — لم تُعرض أي نتائج جزئية. باقي التقرير يعمل بشكل طبيعي.' };
      }
      return {
        status: 'AI_ERROR',
        reason: error.code,
        message: 'تعذر إتمام التحليل الذكي — باقي التقرير يعمل بشكل طبيعي.',
      };
    }
    logObservability({ status: 'AI_ERROR', reason: 'INTERNAL', latencyMs: Date.now() - startedAt });
    return {
      status: 'AI_ERROR',
      reason: 'INTERNAL',
      message: 'حدث خطأ داخلي في التحليل الذكي — باقي التقرير يعمل بشكل طبيعي.',
    };
  }
}
