// ══════════════════════════════════════════════════════════════
//  AI Foundation — contracts (Phase 6.1, spec §20/§21/§22)
//
//  TYPE-ONLY foundation for a FUTURE AI layer. This module:
//    • makes NO model calls, holds NO provider integrations,
//    • sends NO data outside the system,
//    • defines how Verified Data + Deterministic Analytics +
//      Evidence + Confidence will reach the future AI — never a raw
//      database dump (spec §21).
//
//  Direction (spec §43):
//    Raw Business Data → Verified Facts → Performance Intelligence
//    → Deterministic Analytics → Evidence → (future) AI
// ══════════════════════════════════════════════════════════════

// ── shared vocabulary ───────────────────────────────────────────

export type AIConfidenceLevel = 'low' | 'medium' | 'high';
export type AISeverityLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';
export type AIInsightStatus = 'new' | 'reviewed' | 'accepted' | 'dismissed';

/**
 * Recommendation lifecycle — starts at 'proposed' and moves ONLY
 * through explicit human decisions. There is no automatic execution
 * path anywhere in ARM (spec §22/§25).
 */
export type AIRecommendationStatus = 'proposed' | 'accepted' | 'rejected' | 'executed' | 'superseded';

/** Pointer to a verifiable source record — every AI statement must carry these. */
export interface AIEvidenceRef {
  /** Canonical collection/table name (e.g. 'qualityObservations'). */
  collection: string;
  /** Canonical RTDB record id. */
  recordId: string;
  /** Optional field-level attribution. */
  field?: string;
  /** Optional short note (why this evidence supports the statement). */
  note?: string;
}

/** A fact the future AI may rely on — always traceable to evidence. */
export interface AIVerifiedFact {
  id: string;
  statement: string;
  value?: string | number | boolean;
  source: AIEvidenceRef;
}

// ── subject & period ────────────────────────────────────────────

export type AIAnalysisSubject =
  | { kind: 'employee'; employeeId: string }
  | { kind: 'department'; department: string }
  | { kind: 'team'; orgNodeId: string }
  | { kind: 'organization' }
  | { kind: 'month'; month: string };

export interface AIAnalysisPeriod {
  /** 'YYYY-MM' (inclusive). */
  from: string;
  /** 'YYYY-MM' (inclusive). */
  to: string;
  label?: string;
}

// ── INPUT contract (spec §21) ───────────────────────────────────

/** Deterministic analytics snapshot — produced by the TS engine / PI, never by the AI. */
export interface AIAnalyticsSnapshot {
  /** e.g. 'typescript-analytics-engine'. */
  engine: string;
  generatedAt: string;
  metrics: Array<{ key: string; label?: string; value: number | string }>;
  notes?: string[];
}

/**
 * THE AI INPUT CONTRACT. The future AI layer receives verified
 * facts + deterministic analytics + evidence + confidence — never
 * raw database rows (spec §21).
 */
export interface AIAnalysisInput {
  schemaVersion: 1;
  subject: AIAnalysisSubject;
  period: AIAnalysisPeriod;
  verifiedFacts: AIVerifiedFact[];
  analytics: AIAnalyticsSnapshot | null;
  /** Every verifiedFact.source must appear here (guard: isEvidenceBacked). */
  evidence: AIEvidenceRef[];
  confidence: AIConfidenceLevel;
  context?: Record<string, string>;
}

// ── OUTPUT contracts (spec §22) ─────────────────────────────────

export interface AIInsight {
  id: string;
  type: 'trend' | 'anomaly' | 'pattern' | 'risk' | 'summary';
  title: string;
  summary: string;
  /** REQUIRED non-empty — insights without evidence are invalid. */
  evidence: AIEvidenceRef[];
  confidence: AIConfidenceLevel;
  severity: AISeverityLevel;
  scope: AIAnalysisSubject;
  createdAt: string;
  status: AIInsightStatus;
}

export interface AIExpectedImpact {
  direction: 'improvement' | 'risk_reduction' | 'neutral';
  description: string;
}

export interface AIRecommendation {
  id: string;
  category: 'quality' | 'attendance' | 'hr' | 'operations' | 'process';
  recommendation: string;
  reason: string;
  supportingEvidence: AIEvidenceRef[];
  confidence: AIConfidenceLevel;
  expectedImpact: AIExpectedImpact;
  /** Always starts 'proposed' — never auto-executed (spec §22/§25). */
  status: AIRecommendationStatus;
}

// ── request / response ──────────────────────────────────────────

export interface AIAnalysisRequest {
  schemaVersion: 1;
  subject: AIAnalysisSubject;
  period: AIAnalysisPeriod;
  requestedAt: string;
  requestedBy: string;
  kinds?: Array<'insights' | 'recommendations'>;
}

export interface AIAnalysisResponse {
  schemaVersion: 1;
  insights: AIInsight[];
  recommendations: AIRecommendation[];
  generatedAt: string;
  confidence: AIConfidenceLevel;
}

// ── organizational memory (spec §23) ────────────────────────────

/**
 * The learning chain contract: Problem → Observation → Analysis →
 * Recommendation → Management Decision → Action → Outcome →
 * Learning. Entries are linked, evidence-backed records. NOTHING
 * here learns or acts automatically — entries are created by
 * explicit future workflows only (spec §23).
 */
export type OrganizationalMemoryStage =
  | 'problem'
  | 'observation'
  | 'analysis'
  | 'recommendation'
  | 'decision'
  | 'action'
  | 'outcome'
  | 'learning';

export interface OrganizationalMemoryEntry {
  id: string;
  stage: OrganizationalMemoryStage;
  subject: AIAnalysisSubject;
  summary: string;
  evidence: AIEvidenceRef[];
  relatedEntryIds: string[];
  createdAt: string;
  actorId?: string;
}

/**
 * Feedback / outcome loop contract (spec §24): did management accept
 * the recommendation, execute it, and did it help? Filled by
 * explicit future workflows — never by automatic learning.
 */
export interface RecommendationOutcome {
  id: string;
  recommendationId: string;
  status: Exclude<AIRecommendationStatus, 'proposed'>;
  decidedBy: string;
  decidedAt: string;
  notes?: string;
  /** Measured effect AFTER execution — only from explicit workflows. */
  measuredImpact?: {
    metric: string;
    before: number;
    after: number;
    unit?: string;
  };
}
