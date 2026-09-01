// ══════════════════════════════════════════════════════════════
//  Quality AI — output contracts (Phase 6.2, spec §13/§14/§15)
//
//  WHAT THE AI MAY RETURN — strictly validated before anything
//  reaches the browser (spec §27). Internal enums stay STABLE
//  ENGLISH values (spec §46); Arabic labels live ONLY in the UI
//  label maps (smart-report/ai-view.ts).
//
//  Evidence refs deliberately reuse the Analytics evidence shape
//  { collection, recordIds, completeRecordList } (spec §12) so the
//  existing Evidence Preview / navigation machinery consumes them
//  unchanged (spec §44/§45 — no second evidence system).
// ══════════════════════════════════════════════════════════════

import type { AnalyticsEvidenceRef } from '@/lib/analytics/types';

/** §12 — evidence refs reuse the Analytics evidence shape EXACTLY
 *  { collection, recordIds, completeRecordList }. */
export type QualityAIEvidenceRef = AnalyticsEvidenceRef;

/** §14 — the ONLY allowed insight types. */
export const AI_INSIGHT_TYPES = [
  'TREND',
  'PATTERN',
  'RISK',
  'OPPORTUNITY',
  'PROCESS_GAP',
  'REPEATED_ISSUE',
  'PERFORMANCE_SIGNAL',
  'DATA_QUALITY',
] as const;
export type AIInsightType = (typeof AI_INSIGHT_TYPES)[number];

/** §14 — severity / confidence vocabularies. */
export const AI_SEVERITIES = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type AISeverity = (typeof AI_SEVERITIES)[number];

export const AI_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AIConfidence = (typeof AI_CONFIDENCES)[number];

/** §37 — the ONLY allowed recommendation categories. */
export const AI_RECOMMENDATION_CATEGORIES = [
  'PROCESS',
  'TRAINING',
  'FOLLOW_UP',
  'QUALITY',
  'CUSTOMER_EXPERIENCE',
  'WORKFLOW',
  'DATA_QUALITY',
  'MANAGEMENT_REVIEW',
] as const;
export type AIRecommendationCategory = (typeof AI_RECOMMENDATION_CATEGORIES)[number];

/** §38 — priority is evidence-driven, never a vibe. */
export const AI_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type AIPriority = (typeof AI_PRIORITIES)[number];

/** §15/§16 — recommendations START at PROPOSED; the AI can never
 *  emit any other status (validated — anything else is invalid). */
export const AI_RECOMMENDATION_STATUS = 'PROPOSED' as const;
export type AIRecommendationStatus = typeof AI_RECOMMENDATION_STATUS;

export interface QualityAIInsight {
  id: string;
  type: AIInsightType;
  title: string;
  /** §11 — WHAT THE DATA SUPPORTS (facts/numbers from the input only). */
  factBasis: string;
  /** §11 — what it MIGHT mean; interpretation is never presented as fact. */
  interpretation: string;
  summary: string;
  severity: AISeverity;
  confidence: AIConfidence;
  /** §12 — REQUIRED, non-empty, every ref must exist in the input catalog. */
  supportingEvidence: QualityAIEvidenceRef[];
  limitations: string[];
}

export interface QualityAIRecommendation {
  id: string;
  category: AIRecommendationCategory;
  title: string;
  recommendation: string;
  /** §39 — "لماذا يقترح النظام هذا؟" */
  reason: string;
  supportingEvidence: QualityAIEvidenceRef[];
  confidence: AIConfidence;
  expectedImpact: {
    direction: 'IMPROVEMENT' | 'RISK_REDUCTION' | 'NEUTRAL';
    description: string;
  };
  priority: AIPriority;
  status: AIRecommendationStatus;
}

/** §13 — the full validated result envelope (status OK). */
export interface QualityAIAnalysisResult {
  schemaVersion: 1;
  status: 'OK';
  generatedAt: string;
  period: {
    from: string;
    to: string;
    label: string;
    /** §21 — MTD is NEVER presented as a finalized month. */
    mtd: boolean;
    finalized: boolean;
  };
  dataSufficiency: 'SUFFICIENT_DATA' | 'LIMITED_DATA';
  insights: QualityAIInsight[];
  recommendations: QualityAIRecommendation[];
  limitations: string[];
  confidence: AIConfidence;
  /** Flattened unique evidence actually cited by insights/recommendations. */
  evidenceReferences: QualityAIEvidenceRef[];
  /** §47 — provenance of EVERY result. */
  promptVersion: string;
  provider: string;
  model: string;
}

// ── API envelope (route → browser) — §24 states ────────────────
export type QualityAIApiResponse =
  | { status: 'OK'; result: QualityAIAnalysisResult; cached: boolean }
  | { status: 'NO_DATA'; message: string }
  | { status: 'INSUFFICIENT_DATA'; message: string }
  | { status: 'AI_UNAVAILABLE'; message: string }
  | { status: 'AI_TIMEOUT'; message: string }
  | { status: 'AI_ERROR'; reason: string; message: string }
  | { status: 'AI_INVALID_RESPONSE'; message: string }
  | { status: 'AI_RATE_LIMITED'; message: string };
