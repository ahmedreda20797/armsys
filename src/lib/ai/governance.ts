// ══════════════════════════════════════════════════════════════
//  AI Foundation — governance & guards (Phase 6.1, spec §25)
//
//  Architectural safety rules the future AI layer MUST satisfy.
//  Enforced today by pure guards + tests; no runtime AI exists.
//
//  The AI can NEVER (spec §25):
//    modify employees / KPIs / quality observations / complaints /
//    CAPA / deals / attendance, archive or restore, change
//    permissions or company configuration — except through explicit
//    future workflows with separate approvals. Phase 1 AI is
//    READ-ONLY.
// ══════════════════════════════════════════════════════════════

import type {
  AIConfidenceLevel,
  AIEvidenceRef,
  AIInsight,
  AIRecommendation,
} from './types';

export const AI_FOUNDATION_VERSION = '1.0.0';

/** Phase 6.1 foundation: the AI layer is read-only by design. */
export const AI_READ_ONLY = true as const;

/**
 * Where the future AI may read from — verified, controlled sources
 * only (spec §21/§26). Direct Firebase access is NOT on this list.
 */
export const AI_ALLOWED_DATA_SOURCES = [
  'verifiedFacts',
  'performanceIntelligence',
  'analyticsEngine',
  'evidence',
  'globalSearch',
] as const;

/** Hard mutation boundaries — every future workflow must go through
 *  explicit approval, never direct AI writes (spec §25). */
export const AI_FORBIDDEN_MUTATIONS = [
  'employees',
  'kpis',
  'qualityObservations',
  'complaints',
  'capaCases',
  'travelDeals',
  'attendance',
  'archiveRestore',
  'permissions',
  'companyConfiguration',
] as const;

/** Evidence refs must be complete pointers to real canonical records. */
export function isEvidenceBacked(refs: readonly AIEvidenceRef[] | null | undefined): refs is AIEvidenceRef[] {
  return (
    Array.isArray(refs) &&
    refs.length > 0 &&
    refs.every(
      (ref) =>
        typeof ref === 'object' &&
        ref !== null &&
        typeof ref.collection === 'string' &&
        ref.collection.length > 0 &&
        typeof ref.recordId === 'string' &&
        ref.recordId.length > 0,
    )
  );
}

const CONFIDENCE_LEVELS: readonly AIConfidenceLevel[] = ['low', 'medium', 'high'];

function isConfidence(value: unknown): value is AIConfidenceLevel {
  return typeof value === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(value);
}

/** Structural guard — an insight is valid ONLY with evidence. */
export function validateAIInsight(insight: AIInsight): string | null {
  if (!insight || typeof insight !== 'object') return 'insight مطلوب';
  if (typeof insight.id !== 'string' || insight.id.length === 0) return 'معرف الـinsight مطلوب';
  if (typeof insight.title !== 'string' || insight.title.length === 0) return 'عنوان الـinsight مطلوب';
  if (typeof insight.summary !== 'string' || insight.summary.length === 0) return 'ملخص الـinsight مطلوب';
  if (!isEvidenceBacked(insight.evidence)) return 'الـinsight يجب أن يستند إلى أدلة';
  if (!isConfidence(insight.confidence)) return 'مستوى الثقة مطلوب';
  if (!insight.scope || typeof insight.scope !== 'object') return 'نطاق الـinsight مطلوب';
  return null;
}

/** Structural guard — a recommendation is valid ONLY with evidence,
 *  and never in an executing state by construction. */
export function validateAIRecommendation(recommendation: AIRecommendation): string | null {
  if (!recommendation || typeof recommendation !== 'object') return 'recommendation مطلوب';
  if (typeof recommendation.id !== 'string' || recommendation.id.length === 0) {
    return 'معرف التوصية مطلوب';
  }
  if (typeof recommendation.recommendation !== 'string' || recommendation.recommendation.length === 0) {
    return 'نص التوصية مطلوب';
  }
  if (!isEvidenceBacked(recommendation.supportingEvidence)) {
    return 'التوصية يجب أن تستند إلى أدلة';
  }
  if (!isConfidence(recommendation.confidence)) return 'مستوى الثقة مطلوب';
  if (!recommendation.expectedImpact || typeof recommendation.expectedImpact !== 'object') {
    return 'الأثر المتوقع مطلوب';
  }
  return null;
}

/**
 * Serializable-contract guard: the value must contain ONLY plain,
 * JSON-native data (strings, finite numbers, booleans, null, plain
 * objects, arrays). Functions, undefined, BigInt, symbols, Dates,
 * Maps and circular structures are all rejected — AI contracts
 * cross process boundaries and must survive JSON exactly.
 */
export function isSerializableContract(value: unknown): boolean {
  return isSerializableValue(value, new Set<object>());
}

function isSerializableValue(value: unknown, path: Set<object>): boolean {
  if (value === null) return true;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return true;
  if (type === 'number') return Number.isFinite(value);
  // undefined / bigint / symbol / function — never cross a JSON boundary.
  if (type !== 'object') return false;
  const obj = value as object;
  // Cycle detection along the CURRENT path — shared (DAG) references
  // are perfectly serializable and must pass.
  if (path.has(obj)) return false;
  path.add(obj);
  let ok: boolean;
  if (Array.isArray(obj)) {
    ok = obj.every((child) => isSerializableValue(child, path));
  } else {
    // Plain objects only — class instances, Dates, Maps, Sets rejected.
    const proto = Object.getPrototypeOf(obj);
    ok = (proto === Object.prototype || proto === null) &&
      Object.values(obj).every((child) => isSerializableValue(child, path));
  }
  path.delete(obj);
  return ok;
}
