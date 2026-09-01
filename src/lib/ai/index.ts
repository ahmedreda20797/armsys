// ══════════════════════════════════════════════════════════════
//  AI Foundation — public barrel (Phase 6.1)
//
//  Contracts + governance only. NO model calls, NO provider SDKs,
//  NO runtime behavior. The future AI layer plugs in BEHIND these
//  contracts without redesigning the architecture (spec §20).
// ══════════════════════════════════════════════════════════════

export type {
  AIConfidenceLevel,
  AISeverityLevel,
  AIInsightStatus,
  AIRecommendationStatus,
  AIEvidenceRef,
  AIVerifiedFact,
  AIAnalysisSubject,
  AIAnalysisPeriod,
  AIAnalyticsSnapshot,
  AIAnalysisInput,
  AIInsight,
  AIExpectedImpact,
  AIRecommendation,
  AIAnalysisRequest,
  AIAnalysisResponse,
  OrganizationalMemoryStage,
  OrganizationalMemoryEntry,
  RecommendationOutcome,
} from './types';

export {
  AI_FOUNDATION_VERSION,
  AI_READ_ONLY,
  AI_ALLOWED_DATA_SOURCES,
  AI_FORBIDDEN_MUTATIONS,
  isEvidenceBacked,
  validateAIInsight,
  validateAIRecommendation,
  isSerializableContract,
} from './governance';
