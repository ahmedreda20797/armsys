// ══════════════════════════════════════════════════════════════
//  Organizational Memory — contracts (Phase 6.4, spec §14/§15/§17)
//
//  Memory belongs to ARM — never to a provider (§14/§17). The
//  lifecycle terminology EXTENDS the existing Phase 6.1 contract
//  (OrganizationalMemoryEntry in src/lib/ai/types.ts: stage chain
//  Problem → Observation → Analysis → Recommendation → Decision →
//  Action → Outcome → Learning) WITHOUT redesigning it (§14).
//
//  QUALITY LIFECYCLE (§15) — status is separate from stage:
//    PROPOSED → VALIDATED → APPROVED → (terminal ARCHIVED)
//                   ↘ REJECTED → (terminal ARCHIVED)
//    Only VALIDATED/APPROVED entries are TRUSTED organizational
//    learning. AI-generated output can only ever be PROPOSED — it
//    never becomes organizational truth automatically (§15/§19).
//
//  MODEL-INDEPENDENCE (§17): entries carry provenance but NO model
//  identity dependency — switching Gemini → Groq → any future model
//  preserves every entry untouched.
// ══════════════════════════════════════════════════════════════

import type {
  AIAnalysisSubject,
  AIAnalysisPeriod,
  AIEvidenceRef,
  AIConfidenceLevel,
  OrganizationalMemoryStage,
} from '../types';

/** Where an entry originated. AI sources can only create PROPOSED. */
export type OrganizationalMemorySource =
  | 'ai-analysis'
  | 'management-review'
  | 'manual'
  | 'incident-review'
  | 'period-close';

export type OrganizationalMemoryStatus =
  | 'PROPOSED'
  | 'VALIDATED'
  | 'APPROVED'
  | 'REJECTED'
  | 'ARCHIVED';

/** The full persistent record (RTDB node arm_erp/organizationalMemory). */
export interface OrganizationalMemoryRecord {
  schemaVersion: 1;
  id: string;
  /** Learning-chain stage (existing contract vocabulary). */
  stage: OrganizationalMemoryStage;
  subject: AIAnalysisSubject;
  title: string;
  summary: string;
  /** Organization/company scope (multi-org future). */
  organizationId: string;
  /** Department/team scope when applicable. */
  department?: string | null;
  /** Subject period when applicable. */
  period?: AIAnalysisPeriod | null;
  /** Traceability back to verifiable records (§15). */
  evidence: AIEvidenceRef[];
  /** Links to related entries (existing contract field). */
  relatedEntryIds: string[];
  source: OrganizationalMemorySource;
  createdBy: string;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt?: string | null;
  confidence: AIConfidenceLevel;
  status: OrganizationalMemoryStatus;
  /** Outcome note (what happened after the action). */
  outcome?: string | null;
  /** The distilled learning (what ARM should remember). */
  learning?: string | null;
  /** Optimistic-lock version — bumped by every transition. */
  version: number;
}

/** Allowed status transitions — explicit human decisions ONLY. */
export const MEMORY_STATUS_TRANSITIONS: Readonly<
  Record<OrganizationalMemoryStatus, readonly OrganizationalMemoryStatus[]>
> = {
  PROPOSED: ['VALIDATED', 'REJECTED', 'ARCHIVED'],
  VALIDATED: ['APPROVED', 'REJECTED', 'ARCHIVED'],
  APPROVED: ['ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Only these statuses count as TRUSTED organizational learning. */
export const TRUSTED_MEMORY_STATUSES: readonly OrganizationalMemoryStatus[] = [
  'VALIDATED',
  'APPROVED',
];

export function isTrustedMemory(
  entry: Pick<OrganizationalMemoryRecord, 'status'>,
): boolean {
  return TRUSTED_MEMORY_STATUSES.includes(entry.status);
}

export function canTransitionMemoryStatus(
  from: OrganizationalMemoryStatus,
  to: OrganizationalMemoryStatus,
): boolean {
  return MEMORY_STATUS_TRANSITIONS[from].includes(to);
}
