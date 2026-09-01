// ══════════════════════════════════════════════════════════════
//  Quality AI — strict output validation (Phase 6.2, spec §27/§28)
//
//  NEVER TRUST THE AI RESPONSE. Every response passes through:
//    1. JSON extraction (code fences / prose tolerated, then parsed)
//    2. Schema + enum validation (only the defined vocabularies)
//    3. Evidence-reference validation — every cited refId MUST exist
//       in the input evidence catalog (spec §12/§27)
//    4. HALLUCINATED-NUMBER guard (spec §28/§29) — every number in
//       AI text must exist in the input payload; otherwise the item
//       is DROPPED (reject path of spec §28 — no infinite regen)
//    5. Safety scan — execution-claiming text is rejected;
//       recommendation status is forced to PROPOSED (spec §15/§16)
//
//  Invalid items are dropped WITH an audit limitation line; the
//  whole response is invalid only when the structure itself is
//  broken or nothing survives (→ AI_INVALID_RESPONSE).
// ══════════════════════════════════════════════════════════════

import type {
  QualityAIAnalysisResult,
  QualityAIInsight,
  QualityAIRecommendation,
  QualityAIEvidenceRef,
} from './contracts';
import {
  AI_INSIGHT_TYPES,
  AI_SEVERITIES,
  AI_CONFIDENCES,
  AI_RECOMMENDATION_CATEGORIES,
  AI_PRIORITIES,
  AI_RECOMMENDATION_STATUS,
} from './contracts';
import type { QualityAIAnalysisPayload, QualityAIEvidenceCatalogEntry } from './input-builder';

/** §12 batch-evidence guard — refs use the Analytics batch shape
 *  { collection, recordIds[], completeRecordList } (NOT the Phase 6.1
 *  singular recordId shape — that one is for single-record contracts). */
function isBatchEvidenceBacked(refs: QualityAIEvidenceRef[]): boolean {
  return (
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every(
      (ref) =>
        typeof ref.collection === 'string' &&
        ref.collection.length > 0 &&
        Array.isArray(ref.recordIds) &&
        ref.recordIds.length > 0 &&
        ref.recordIds.every((id) => typeof id === 'string' && id.length > 0),
    )
  );
}

export type QualityAIValidationOutcome =
  | { ok: true; result: Omit<QualityAIAnalysisResult, 'provider' | 'model'>; audit: QualityAIValidationAudit }
  | { ok: false; reason: 'INVALID_JSON' | 'INVALID_SCHEMA' | 'NO_VALID_CONTENT'; detail: string };

export interface QualityAIValidationAudit {
  droppedInsights: string[];
  droppedRecommendations: string[];
}

// ── entry point ─────────────────────────────────────────────────

export function validateQualityAIOutput(
  rawText: string,
  payload: QualityAIAnalysisPayload,
): QualityAIValidationOutcome {
  const parsed = extractJson(rawText);
  if (!parsed.ok) return { ok: false, reason: 'INVALID_JSON', detail: parsed.error };

  const body = parsed.value as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'INVALID_SCHEMA', detail: 'الجسم ليس كائن JSON' };
  }

  const allowedNumbers = collectAllowedNumberTokens(payload);
  const catalog = new Map(payload.evidenceCatalog.map((e) => [e.refId, e]));
  const audit: QualityAIValidationAudit = { droppedInsights: [], droppedRecommendations: [] };

  // ── insights ──────────────────────────────────────────────────
  const rawInsights = Array.isArray(body.insights) ? body.insights : null;
  if (!rawInsights) {
    return { ok: false, reason: 'INVALID_SCHEMA', detail: 'insights مفقودة أو ليست مصفوفة' };
  }
  const insights: QualityAIInsight[] = [];
  const seenInsightIds = new Set<string>();
  for (const raw of rawInsights.slice(0, 8)) {
    const res = validateInsight(raw, catalog, allowedNumbers, seenInsightIds, audit.droppedInsights);
    if (res && insights.length < 5) {
      seenInsightIds.add(res.id);
      insights.push(res);
    }
  }

  // ── recommendations ───────────────────────────────────────────
  const rawRecs = body.recommendations;
  const recommendations: QualityAIRecommendation[] = [];
  if (rawRecs !== undefined && rawRecs !== null) {
    if (!Array.isArray(rawRecs)) {
      return { ok: false, reason: 'INVALID_SCHEMA', detail: 'recommendations ليست مصفوفة' };
    }
    const seenRecIds = new Set<string>();
    for (const raw of (rawRecs as unknown[]).slice(0, 8)) {
      const res = validateRecommendation(raw, catalog, allowedNumbers, seenRecIds, audit.droppedRecommendations);
      if (res && recommendations.length < 4) {
        seenRecIds.add(res.id);
        recommendations.push(res);
      }
    }
  }

  if (insights.length === 0 && recommendations.length === 0) {
    return {
      ok: false,
      reason: 'NO_VALID_CONTENT',
      detail: 'لم ينجُ أي استنتاج صالح من التحقق',
    };
  }

  const overallConfidence = toEnum(body.confidence, AI_CONFIDENCES) ?? 'LOW';
  const topLimitations = Array.isArray(body.limitations)
    ? (body.limitations as unknown[]).filter((s): s is string => typeof s === 'string').slice(0, 10)
    : [];

  // Flattened unique evidence actually cited (spec §13 evidenceReferences).
  const evidenceReferences = dedupeRefs([
    ...insights.flatMap((i) => i.supportingEvidence),
    ...recommendations.flatMap((r) => r.supportingEvidence),
  ]);

  return {
    ok: true,
    audit,
    result: {
      schemaVersion: 1,
      status: 'OK',
      generatedAt: new Date().toISOString(),
      period: { ...payload.period },
      dataSufficiency: 'SUFFICIENT_DATA', // service overrides from builder outcome
      insights,
      recommendations,
      limitations: topLimitations,
      confidence: overallConfidence,
      evidenceReferences,
      promptVersion: '', // service fills (single source of truth)
    },
  };
}

// ── item validators ─────────────────────────────────────────────

function validateInsight(
  raw: unknown,
  catalog: Map<string, QualityAIEvidenceCatalogEntry>,
  allowedNumbers: Set<string>,
  seenIds: Set<string>,
  dropped: string[],
): QualityAIInsight | null {
  const label = describeItem(raw, 'insight');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    dropped.push(`${label}: بنية غير صالحة`);
    return null;
  }
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  if (!id || seenIds.has(id)) { dropped.push(`${label}: معرف مفقود أو مكرر`); return null; }

  const type = toEnum(o.type, AI_INSIGHT_TYPES);
  if (!type) { dropped.push(`${id}: نوع غير معرف`); return null; }

  const title = requireText(o.title);
  const factBasis = requireText(o.factBasis);
  const interpretation = requireText(o.interpretation);
  const summary = requireText(o.summary);
  if (!title || !factBasis || !interpretation || !summary) {
    dropped.push(`${id}: حقول نصية مطلوبة مفقودة (title/factBasis/interpretation/summary)`);
    return null;
  }

  const severity = toEnum(o.severity, AI_SEVERITIES) ?? 'LOW';
  const confidence = toEnum(o.confidence, AI_CONFIDENCES);
  if (!confidence) { dropped.push(`${id}: ثقة غير صالحة`); return null; }

  const evidence = resolveEvidenceRefs(o.supportingEvidence, catalog);
  if (!isBatchEvidenceBacked(evidence)) {
    dropped.push(`${id}: أدلة مفقودة أو تشير لمراجع غير موجودة في الكتالوج`);
    return null;
  }

  const limitations = stringArray(o.limitations, 5);

  // §28: hallucinated numbers → the item is rejected outright.
  const texts = [title, factBasis, interpretation, summary, ...limitations];
  const badNumber = firstUntraceableNumber(texts, allowedNumbers);
  if (badNumber !== null) {
    dropped.push(`${id}: رقم غير موجود في المصدر (${badNumber}) — استبعاد`);
    return null;
  }

  return { id, type, title, factBasis, interpretation, summary, severity, confidence, supportingEvidence: evidence, limitations };
}

function validateRecommendation(
  raw: unknown,
  catalog: Map<string, QualityAIEvidenceCatalogEntry>,
  allowedNumbers: Set<string>,
  seenIds: Set<string>,
  dropped: string[],
): QualityAIRecommendation | null {
  const label = describeItem(raw, 'recommendation');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    dropped.push(`${label}: بنية غير صالحة`);
    return null;
  }
  const o = raw as Record<string, unknown>;

  const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : null;
  if (!id || seenIds.has(id)) { dropped.push(`${label}: معرف مفقود أو مكرر`); return null; }

  const category = toEnum(o.category, AI_RECOMMENDATION_CATEGORIES);
  if (!category) { dropped.push(`${id}: تصنيف غير معرف`); return null; }

  const title = requireText(o.title);
  const recommendation = requireText(o.recommendation);
  const reason = requireText(o.reason);
  if (!title || !recommendation || !reason) {
    dropped.push(`${id}: حقول نصية مطلوبة مفقودة (title/recommendation/reason)`);
    return null;
  }

  // §15: status is ALWAYS PROPOSED — anything else is tampering.
  if (o.status !== undefined && o.status !== AI_RECOMMENDATION_STATUS) {
    dropped.push(`${id}: حالة غير مسموحها (${String(o.status)}) — التوصيات تبدأ PROPOSED فقط`);
    return null;
  }

  const confidence = toEnum(o.confidence, AI_CONFIDENCES);
  if (!confidence) { dropped.push(`${id}: ثقة غير صالحة`); return null; }

  const priority = toEnum(o.priority, AI_PRIORITIES) ?? 'LOW';

  const impact = (o.expectedImpact ?? null) as Record<string, unknown> | null;
  const impactDirection = toEnum(impact?.direction, ['IMPROVEMENT', 'RISK_REDUCTION', 'NEUTRAL'] as const);
  const impactDescription = impact && typeof impact.description === 'string' && impact.description.trim()
    ? impact.description.trim() : null;
  if (!impactDirection || !impactDescription) {
    dropped.push(`${id}: الأثر المتوقع مفقود أو غير صالح`);
    return null;
  }

  const evidence = resolveEvidenceRefs(o.supportingEvidence, catalog);
  if (!isBatchEvidenceBacked(evidence)) {
    dropped.push(`${id}: أدلة مفقودة أو تشير لمراجع غير موجودة في الكتالوج`);
    return null;
  }

  const texts = [title, recommendation, reason, impactDescription];
  const badNumber = firstUntraceableNumber(texts, allowedNumbers);
  if (badNumber !== null) {
    dropped.push(`${id}: رقم غير موجود في المصدر (${badNumber}) — استبعاد`);
    return null;
  }
  if (texts.some(claimsExecution)) {
    dropped.push(`${id}: نص يدّعي تنفيذ إجراء — استبعاد`);
    return null;
  }

  return {
    id,
    category,
    title,
    recommendation,
    reason,
    supportingEvidence: evidence,
    confidence,
    expectedImpact: { direction: impactDirection, description: impactDescription },
    priority,
    status: AI_RECOMMENDATION_STATUS,
  };
}

// ── evidence refs (§12 — catalog-scoped) ────────────────────────

function resolveEvidenceRefs(
  raw: unknown,
  catalog: Map<string, QualityAIEvidenceCatalogEntry>,
): QualityAIEvidenceRef[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const refs: QualityAIEvidenceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return []; // malformed → all refs rejected
    const refId = (item as Record<string, unknown>).refId;
    if (typeof refId !== 'string') return [];
    const entry = catalog.get(refId);
    if (!entry) return []; // unknown refId → rejected wholesale (§27)
    refs.push({
      collection: entry.collection,
      recordIds: entry.recordIds,
      completeRecordList: true,
    });
  }
  return refs;
}

function dedupeRefs(refs: QualityAIEvidenceRef[]): QualityAIEvidenceRef[] {
  const seen = new Set<string>();
  const out: QualityAIEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.collection}::${[...ref.recordIds].sort().join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

// ── hallucinated-number guard (§28/§29) ─────────────────────────

/** Normalizes Arabic-Indic digits + Arabic decimal separator. */
function normalizeDigits(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/\u066B/g, '.');
}

const NUMBER_TOKEN_RE = /\d+(?:\.\d+)?/g;

function collectAllowedNumberTokens(value: unknown, into: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 12 || value === null || value === undefined) return into;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      into.add(String(value));
      into.add(String(Math.round(value)));
    }
    return into;
  }
  if (typeof value === 'string') {
    const normalized = normalizeDigits(value);
    for (const token of normalized.matchAll(NUMBER_TOKEN_RE)) into.add(token[0]);
    return into;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectAllowedNumberTokens(child, into, depth + 1);
    return into;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) {
      collectAllowedNumberTokens(child, into, depth + 1);
    }
  }
  return into;
}

function firstUntraceableNumber(texts: string[], allowed: Set<string>): string | null {
  for (const text of texts) {
    const normalized = normalizeDigits(text);
    for (const match of normalized.matchAll(NUMBER_TOKEN_RE)) {
      const token = match[0];
      if (!allowed.has(token)) return token;
    }
  }
  return null;
}

// ── helpers ─────────────────────────────────────────────────────

function extractJson(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const withoutFences = raw
    .replace(/```(?:json)?/gi, '')
    .trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    return { ok: false, error: 'لا يوجد كائن JSON في الاستجابة' };
  }
  try {
    return { ok: true, value: JSON.parse(withoutFences.slice(start, end + 1)) };
  } catch {
    return { ok: false, error: 'JSON غير قابل للتحليل' };
  }
}

function toEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function requireText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function stringArray(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, cap);
}

function describeItem(raw: unknown, kind: string): string {
  if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).id === 'string') {
    return String((raw as Record<string, unknown>).id);
  }
  return kind;
}

// NOTE: data-description phrases like "تم تسجيل 8 ملاحظات" are LEGITIMATE
// fact statements (describing stored data) and MUST NOT be flagged.
// The guard targets SELF-EXECUTION claims only (spec §16) — the binding
// control is structural: the validator forces status PROPOSED and no
// execution capability exists anywhere in the AI layer (proven by tests).
const EXECUTION_CLAIM_RE = /(تم\s*تنفيذ|سيتم\s*تنفيذ|سأقوم\s*ب?تنفيذ|نفذت\s*(هذه|التوصية)|auto-?executed?\b)/i;

function claimsExecution(text: string): boolean {
  return EXECUTION_CLAIM_RE.test(text);
}
