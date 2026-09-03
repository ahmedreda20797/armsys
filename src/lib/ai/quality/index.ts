// ══════════════════════════════════════════════════════════════
//  Quality AI — public barrel (Phase 6.2)
//
//  Server consumers: import { runQualityAIAnalysis } from here.
//  Client consumers: import TYPES from './contracts' ONLY (type-only
//  imports are erased — no server code ever reaches the browser).
// ══════════════════════════════════════════════════════════════

export type {
  QualityAIApiResponse,
  QualityAIAnalysisResult,
  QualityAIInsight,
  QualityAIRecommendation,
  QualityAIEvidenceRef,
  AIInsightType,
  AISeverity,
  AIConfidence,
  AIRecommendationCategory,
  AIPriority,
} from './contracts';
export {
  AI_INSIGHT_TYPES,
  AI_SEVERITIES,
  AI_CONFIDENCES,
  AI_RECOMMENDATION_CATEGORIES,
  AI_PRIORITIES,
  AI_RECOMMENDATION_STATUS,
} from './contracts';
export { AI_PROMPT_VERSION } from './version';
export { runQualityAIAnalysis, QUALITY_AI_MAX_OUTPUT_TOKENS, type RunQualityAIAnalysisInput } from './service';
export type { QualityAIAnalysisPayload, QualityAIInputOutcome } from './input-builder';
export { buildQualityAIAnalysisInput } from './input-builder';
