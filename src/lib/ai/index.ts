// ══════════════════════════════════════════════════════════════
//  AI Foundation — public barrel (Phase 6.1, extended Phase 6.4)
//
//  Contracts + governance + the Phase 6.4 gateway/memory/conversation/
//  tool foundations. NO direct model calls happen through this barrel —
//  provider adapters live behind the API routes (server-side only).
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

// ── Phase 6.4 — gateway, status, classification, audit ─────────
export {
  AI_STATUSES,
  aiStatusFromProviderErrorCode,
  aiStatusFromLegacyQualityStatus,
  isAIFailureStatus,
  type AIStatus,
} from './gateway/status';
export {
  CLASSIFICATION_ORDER,
  AI_DATA_POLICIES,
  classificationAllowedByPolicy,
  findRestrictedDataMarkers,
  assertNoRestrictedData,
  classificationRank,
  RestrictedDataViolationError,
  type DataClassification,
} from './gateway/classification';
export type { AIAuditInput } from './gateway/audit';
export { AI_AUDIT_COLLECTION, writeAIAudit } from './gateway/audit';
export {
  ARM_FENCE_BEGIN,
  ARM_FENCE_END,
  sanitizeUntrustedText,
  sanitizeUntrustedPayload,
  detectInjectionSignals,
} from './gateway/fencing';
export {
  scanOutputForSecrets,
  extractNumericClaims,
  numericClaimsGrounded,
  type OutputSecurityScan,
} from './gateway/output-security';
export { resolveAIProvider, type AIProviderResolution } from './gateway/core';

// ── Phase 6.4 — organizational memory (§14-17) ──────────────────
export {
  isTrustedMemory,
  canTransitionMemoryStatus,
  MEMORY_STATUS_TRANSITIONS,
  TRUSTED_MEMORY_STATUSES,
  type OrganizationalMemoryRecord,
  type OrganizationalMemoryStatus,
  type OrganizationalMemorySource,
} from './memory/types';
export {
  createMemoryEntry,
  transitionMemoryStatus,
  getAllMemoryEntries,
  ORGANIZATIONAL_MEMORY_TABLE,
  type CreateMemoryEntryInput,
  type MemoryMutationOutcome,
} from './memory/store';
export {
  retrieveRelevantMemories,
  type MemoryRetrievalQuery,
  type MemoryRetrievalResult,
} from './memory/retrieval';

// ── Phase 6.4 — conversation foundation (§18/§19) ───────────────
export type {
  AIConversation,
  AIConversationMessage,
  AIConversationRole,
  AIMessageValidationState,
} from './conversation/types';
export {
  createConversation,
  getConversationForUser,
  listConversationsForUser,
  appendMessage,
  listMessagesForUser,
  setConversationArchived,
  listConversationsForAdmin,
  AI_CONVERSATIONS_TABLE,
  AI_MESSAGES_TABLE,
} from './conversation/store';

// ── Phase 6.4 — controlled tool layer (§12/§13) ─────────────────
export type {
  AIToolCategory,
  AIToolCaller,
  AIToolDefinition,
  AIToolExecutionOutcome,
} from './tools/types';
export { ENABLED_TOOL_CATEGORIES } from './tools/types';
export { AI_TOOLS, getAITool, listAITools } from './tools/registry';
export { executeAITool } from './tools/runtime';
export { verifyPermissionForUser } from './tools/permission-check';
