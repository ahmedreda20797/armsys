// ══════════════════════════════════════════════════════════════
//  Quality AI — orchestrator service (Phase 6.2, gateway-integrated
//  by Phase 6.4 §8/§10/§20/§21/§22/§25/§29)
//
//  Pipeline (spec §7/§70):
//    dataset (already permission + scope checked by the route)
//      → deterministic TypeScript analytics (unchanged engine)
//      → AI input builder (structured, minimized, evidence-cataloged)
//      → data-sufficiency gate (NO_DATA / INSUFFICIENT short-circuit
//        WITHOUT any provider call — spec §56)
//      → gateway provider resolution (explicit provider/model,
//        settings override → env — NO auto-selection, §4/§5)
//      → RESTRICTED-data gate (§10 — last-line classification check)
//      → untrusted-text fencing (§20 — injection protection)
//      → provider abstraction (AIProvider.analyze — nothing else
//        knows the vendor)
//      → strict output validation + hallucination guard
//      → output-security scan (§21 — credential-leak rejection)
//      → validated result (never a raw provider response)
//
//  FAILURE ISOLATION (spec §53): this service NEVER throws — every
//  outcome is an explicit QualityAIApiResponse status. Facts,
//  analytics and evidence of the Smart Report are untouched by any
//  AI failure (the section is rendered independently).
//
//  AUDIT (§22): every terminal outcome writes ONE aiAuditLog record
//  (safe fields only) fire-and-forget.
//
//  READ-ONLY (spec §3/§16): zero writes anywhere except the audit
//  node; recommendations are PROPOSED-only; no Organizational Memory
//  writes (§14/§19 — AI output never becomes trusted knowledge
//  automatically).
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';
import { runEmployeeAnalytics } from '@/lib/analytics/service';
import {
  AIProviderError,
  AI_DEFAULT_TIMEOUT_MS,
  type AIProvider,
} from '../provider';
import { resolveAIProvider } from '../gateway/core';
import type { AIProviderSettings } from '../gateway/provider-settings';
import { aiStatusFromProviderErrorCode } from '../gateway/status';
import { assertNoRestrictedData, RestrictedDataViolationError } from '../gateway/classification';
import { sanitizeUntrustedPayload } from '../gateway/fencing';
import { scanOutputForSecrets } from '../gateway/output-security';
import { writeAIAudit } from '../gateway/audit';
import { buildQualityAIAnalysisInput } from './input-builder';
import { QUALITY_AI_SYSTEM_PROMPT, buildQualityAIUserContent } from './prompt';
import { AI_PROMPT_VERSION } from './version';
import { validateQualityAIOutput } from './validate';
import {
  qualityAICacheKey,
  getCachedQualityAI,
  setCachedQualityAI,
} from './cache';
import type { QualityAIApiResponse, QualityAIAnalysisResult, QualityAIDiagnostic } from './contracts';

/** Phase 6.5-A §7 (root cause proven by real-data measurement):
 *  thinking-capable Gemini models (3.x) spend maxOutputTokens on
 *  internal thoughts BEFORE the visible JSON — a real 1600-budget
 *  request finished MAX_TOKENS with 1534 thought tokens + 62 visible
 *  tokens, truncating the JSON mid-stream (INVALID_JSON). The
 *  adapter itself is UNCHANGED; the caller budget now leaves room
 *  for thinking (~1.5-3k tokens observed) plus the bounded schema
 *  output (max 5 insights + 4 recommendations). Generation stays
 *  bounded by AI_TIMEOUT_MS regardless of this budget. */
export const QUALITY_AI_MAX_OUTPUT_TOKENS = 8192;

export interface RunQualityAIAnalysisInput {
  dataset: EmployeePerformanceDataset;
  userId: string;
  /** Injected provider (tests / future workflows). null ⇒ AI disabled. */
  provider?: AIProvider | null;
  /** Admin settings override fetched by the route (non-secret, §6/§7). */
  settings?: AIProviderSettings | null;
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

/** Fire-and-forget audit write (§22) — never awaited, never throws. */
function auditRequest(fields: {
  userId: string;
  feature: string;
  provider: string | null;
  model: string | null;
  dataClassification: 'CONFIDENTIAL';
  status: QualityAIDiagnostic['status'];
  errorCategory?: string | null;
  durationMs: number;
  success: boolean;
}): void {
  void writeAIAudit({
    userId: fields.userId,
    userName: fields.userId, // display-name enrichment arrives with the admin control center (Phase 6.10)
    feature: fields.feature,
    provider: fields.provider,
    model: fields.model,
    toolNames: [],
    dataClassification: fields.dataClassification,
    status: fields.status,
    errorCategory: fields.errorCategory ?? null,
    durationMs: fields.durationMs,
    conversationId: null,
    success: fields.success,
  });
}

/** Phase 6.5-A §6 — attaches the per-stage AGGREGATE timings (ms,
 *  numbers only — never content) to a diagnostic. Additive: every
 *  envelope keeps its exact historical shape (§37 compatibility). */
function withTiming(
  timing: Record<string, number>,
  startedAt: number,
  diagnostic: QualityAIDiagnostic,
): QualityAIDiagnostic {
  return { ...diagnostic, timingMs: { ...timing, totalMs: Date.now() - startedAt } };
}

export async function runQualityAIAnalysis(
  input: RunQualityAIAnalysisInput,
): Promise<QualityAIApiResponse> {
  const startedAt = Date.now();
  const timing: Record<string, number> = {};
  try {
    // ── 1) Deterministic analytics (unchanged engine, spec §65) ──
    const analyticsStartedAt = Date.now();
    const analyticsOutcome = await runEmployeeAnalytics(input.dataset);
    timing.analyticsMs = Date.now() - analyticsStartedAt;
    if (!analyticsOutcome.ok) {
      logObservability({ status: 'AI_ERROR', reason: `ANALYTICS_${analyticsOutcome.reason}` });
      return {
        status: 'AI_ERROR',
        reason: `ANALYTICS_${analyticsOutcome.reason}`,
        message: 'تعذر تشغيل التحليل الإحصائي الحتمي — التحليل الذكي يحتاجه كمصدر للأرقام. باقي التقرير يعمل بشكل طبيعي.',
        diagnostic: withTiming(timing, startedAt, { status: 'PROVIDER_ERROR', errorCategory: `ANALYTICS_${analyticsOutcome.reason}` }),
      };
    }
    const analytics = analyticsOutcome.result;

    // ── 2) Structured input + deterministic sufficiency gate (§2/§56) ──
    const inputBuildStartedAt = Date.now();
    const built = buildQualityAIAnalysisInput(input.dataset, analytics, null);
    timing.inputBuildMs = Date.now() - inputBuildStartedAt;
    if (built.kind === 'NO_DATA') return { status: 'NO_DATA', message: built.message };
    if (built.kind === 'INSUFFICIENT_DATA') return { status: 'INSUFFICIENT_DATA', message: built.message };
    if (built.kind === 'ANALYTICS_ERROR') {
      return { status: 'AI_ERROR', reason: built.reason, message: 'تعذر بناء مدخلات التحليل الذكي.' };
    }
    const payload = built.payload;
    const dataSufficiency = built.dataSufficiency;

    // ── 3) Gateway provider resolution (§8/§4/§5: explicit, layered,
    //       NO auto-selection; null ⇒ AI_UNAVAILABLE with diagnostics) ──
    const resolveStartedAt = Date.now();
    const resolution = resolveAIProvider(process.env, { settings: input.settings });
    timing.providerResolveMs = Date.now() - resolveStartedAt;
    const provider = input.provider !== undefined ? input.provider : resolution.provider;
    if (!provider) {
      const diagnostic: QualityAIDiagnostic = {
        status: resolution.diagnostics.aiEnabled ? 'MISCONFIGURED' : 'DISABLED',
        problems: resolution.diagnostics.configurationProblems,
        errorCategory: resolution.diagnostics.configurationProblems[0] ?? null,
        providerSource: resolution.providerSource,
      };
      logObservability({ status: 'AI_UNAVAILABLE', diagnosticStatus: diagnostic.status, problems: diagnostic.problems?.join(',') ?? '' });
      return {
        status: 'AI_UNAVAILABLE',
        message: 'التحليل الذكي غير مُهيأ على هذه البيئة — الحقائق والتحليل الإحصائي والأدلة تبقى متاحة بشكل طبيعي.',
        diagnostic: withTiming(timing, startedAt, diagnostic),
      };
    }

    // ── 4) Cache lookup (§26 — content-addressed, failures never cached) ──
    const cacheStartedAt = Date.now();
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
    timing.cacheLookupMs = Date.now() - cacheStartedAt;
    if (cached) {
      return { status: 'OK', result: cached, cached: true, diagnostic: withTiming(timing, startedAt, { status: 'OPERATIONAL' }) };
    }

    // ── 5) Classification gate (§10 — RESTRICTED data never leaves ARM;
    //       last-line defense over the minimized input builder) ──
    // ── 6) Untrusted-text fencing (§20 — neutralize fence-breakout) ──
    const gatesStartedAt = Date.now();
    const sanitizedPayload = sanitizeUntrustedPayload(payload);
    let restrictedViolation: RestrictedDataViolationError | null = null;
    try {
      assertNoRestrictedData(JSON.stringify(sanitizedPayload), 'quality-analysis');
    } catch (error) {
      if (error instanceof RestrictedDataViolationError) {
        restrictedViolation = error;
      } else {
        throw error;
      }
    }
    timing.securityGatesMs = Date.now() - gatesStartedAt;
    if (restrictedViolation) {
      logObservability({ status: 'AI_ERROR', reason: 'RESTRICTED_DATA_BLOCKED', markers: restrictedViolation.markers.join(',') });
      auditRequest({
        userId: input.userId, feature: 'quality-analysis', provider: provider.name, model: provider.model,
        dataClassification: 'CONFIDENTIAL', status: 'VALIDATION_ERROR', errorCategory: 'RESTRICTED_DATA_BLOCKED',
        durationMs: Date.now() - startedAt, success: false,
      });
      return {
        status: 'AI_ERROR',
        reason: 'RESTRICTED_DATA_BLOCKED',
        message: 'تم إيقاف الطلب حمايةً للبيانات المصنفة — لن يُرسل أي محتوى محظور خارج النظام.',
        diagnostic: withTiming(timing, startedAt, { status: 'VALIDATION_ERROR', errorCategory: 'RESTRICTED_DATA_BLOCKED' }),
      };
    }

    // ── 7) Provider call (single attempt — no retry loops, §63) ──
    const providerStartedAt = Date.now();
    const completion = await provider.analyze({
      systemPrompt: QUALITY_AI_SYSTEM_PROMPT,
      userContent: buildQualityAIUserContent(JSON.stringify(sanitizedPayload)),
      temperature: 0.2,
      maxOutputTokens: QUALITY_AI_MAX_OUTPUT_TOKENS,
      timeoutMs: resolution.config?.timeoutMs ?? AI_DEFAULT_TIMEOUT_MS,
    }).finally(() => {
      timing.providerMs = Date.now() - providerStartedAt;
    });

    // ── 8) Strict validation + hallucination guard (§27/§28) ──
    const validationStartedAt = Date.now();
    const validated = validateQualityAIOutput(completion.text, payload);
    timing.validationMs = Date.now() - validationStartedAt;
    if (!validated.ok) {
      logObservability({ status: 'AI_INVALID_RESPONSE', reason: validated.reason, provider: provider.name, model: provider.model });
      auditRequest({
        userId: input.userId, feature: 'quality-analysis', provider: provider.name, model: provider.model,
        dataClassification: 'CONFIDENTIAL', status: 'VALIDATION_ERROR', errorCategory: validated.reason,
        durationMs: Date.now() - startedAt, success: false,
      });
      return {
        status: 'AI_INVALID_RESPONSE',
        message: 'لم تجتز استجابة التحليل الذكي التحقق الصارم (المخطط/الأدلة/الأرقام) — لن تُعرض أي نتيجة غير موثوقة.',
        diagnostic: withTiming(timing, startedAt, { status: 'VALIDATION_ERROR', errorCategory: validated.reason }),
      };
    }

    // ── 9) Output security (§21 — credential-leak rejection) ──
    const scanStartedAt = Date.now();
    const secretScan = scanOutputForSecrets(
      completion.text,
      resolution.config?.apiKey ? [resolution.config.apiKey] : [],
    );
    timing.outputSecurityMs = Date.now() - scanStartedAt;
    if (!secretScan.clean) {
      logObservability({ status: 'AI_INVALID_RESPONSE', reason: 'SECRET_LEAK', violations: secretScan.violations.join(',') });
      auditRequest({
        userId: input.userId, feature: 'quality-analysis', provider: provider.name, model: provider.model,
        dataClassification: 'CONFIDENTIAL', status: 'VALIDATION_ERROR', errorCategory: 'SECRET_LEAK',
        durationMs: Date.now() - startedAt, success: false,
      });
      return {
        status: 'AI_INVALID_RESPONSE',
        message: 'تم رفض استجابة التحليل الذكي لأسباب أمنية — لن يُعرض أي محتوى.',
        diagnostic: withTiming(timing, startedAt, { status: 'VALIDATION_ERROR', errorCategory: 'SECRET_LEAK' }),
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

    // ── 10) Cache the VALIDATED success only (§26) ──
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
    auditRequest({
      userId: input.userId, feature: 'quality-analysis', provider: provider.name, model: provider.model,
      dataClassification: 'CONFIDENTIAL', status: 'OPERATIONAL',
      durationMs: Date.now() - startedAt, success: true,
    });
    return { status: 'OK', result, cached: false, diagnostic: withTiming(timing, startedAt, { status: 'OPERATIONAL' }) };
  } catch (error) {
    // ── Failure isolation (§53): structured statuses, never a throw ──
    if (error instanceof AIProviderError) {
      const status = aiStatusFromProviderErrorCode(error.code);
      logObservability({ status: error.code, latencyMs: Date.now() - startedAt });
      auditRequest({
        userId: input.userId, feature: 'quality-analysis', provider: null, model: null,
        dataClassification: 'CONFIDENTIAL', status, errorCategory: error.code,
        durationMs: Date.now() - startedAt, success: false,
      });
      if (error.code === 'AI_TIMEOUT') {
        return { status: 'AI_TIMEOUT', message: 'انتهت مهلة التحليل الذكي — لم تُعرض أي نتائج جزئية. باقي التقرير يعمل بشكل طبيعي.', diagnostic: withTiming(timing, startedAt, { status: 'TIMEOUT', errorCategory: error.code }) };
      }
      return {
        status: 'AI_ERROR',
        reason: error.code,
        message: 'تعذر إتمام التحليل الذكي — باقي التقرير يعمل بشكل طبيعي.',
        diagnostic: withTiming(timing, startedAt, { status, errorCategory: error.code }),
      };
    }
    logObservability({ status: 'AI_ERROR', reason: 'INTERNAL', latencyMs: Date.now() - startedAt });
    auditRequest({
      userId: input.userId, feature: 'quality-analysis', provider: null, model: null,
      dataClassification: 'CONFIDENTIAL', status: 'PROVIDER_ERROR', errorCategory: 'INTERNAL',
      durationMs: Date.now() - startedAt, success: false,
    });
    return {
      status: 'AI_ERROR',
      reason: 'INTERNAL',
      message: 'حدث خطأ داخلي في التحليل الذكي — باقي التقرير يعمل بشكل طبيعي.',
      diagnostic: withTiming(timing, startedAt, { status: 'PROVIDER_ERROR', errorCategory: 'INTERNAL' }),
    };
  }
}
