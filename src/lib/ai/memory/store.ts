// ══════════════════════════════════════════════════════════════
//  Organizational Memory — persistence (Phase 6.4, spec §14/§15/§38)
//
//  Additive RTDB node arm_erp/organizationalMemory via the EXISTING
//  cached db layer — zero migration, zero deletion of anything
//  (§38). Persistence is INJECTABLE so unit tests run against
//  in-memory maps with no Firebase (the Phase 6.3 test doctrine).
//
//  LIFECYCLE ENFORCEMENT (§15):
//    • AI-source entries are ALWAYS created PROPOSED — enforced by
//      createMemoryEntry, not by caller discipline;
//    • status changes ONLY through transitionMemoryStatus, which
//      validates the transition against MEMORY_STATUS_TRANSITIONS
//      and stamps actor/time/version;
//    • there is NO API by which an AI response becomes trusted
//      knowledge automatically (§15/§19 — conversations and memory
//      are separate stores and never write each other).
// ══════════════════════════════════════════════════════════════

import { createRecord, updateRecord, getAll, TTL } from '@/lib/db';
import type { AIAnalysisSubject, AIConfidenceLevel, OrganizationalMemoryStage, AIEvidenceRef, AIAnalysisPeriod } from '../types';
import {
  canTransitionMemoryStatus,
  type OrganizationalMemoryRecord,
  type OrganizationalMemorySource,
  type OrganizationalMemoryStatus,
} from './types';

export const ORGANIZATIONAL_MEMORY_TABLE = 'organizationalMemory';

/** Injectable persistence — defaults to the cached db layer. */
export interface MemoryPersistence {
  getAll(): Promise<Record<string, unknown>[]>;
  create(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>): Promise<unknown>;
}

export const defaultMemoryPersistence: MemoryPersistence = {
  getAll: () => getAll<Record<string, unknown>>(ORGANIZATIONAL_MEMORY_TABLE, TTL.MEDIUM),
  create: (data) => createRecord(ORGANIZATIONAL_MEMORY_TABLE, data),
  update: (id, data) => updateRecord(ORGANIZATIONAL_MEMORY_TABLE, id, data),
};

export interface CreateMemoryEntryInput {
  stage: OrganizationalMemoryStage;
  subject: AIAnalysisSubject;
  title: string;
  summary: string;
  organizationId?: string;
  department?: string | null;
  period?: AIAnalysisPeriod | null;
  evidence: AIEvidenceRef[];
  relatedEntryIds?: string[];
  source: OrganizationalMemorySource;
  createdBy: string;
  confidence: AIConfidenceLevel;
  /** Only 'manual'/'management-review' human sources may open past PROPOSED. */
  initialStatus?: OrganizationalMemoryStatus;
  outcome?: string | null;
  learning?: string | null;
}

export type MemoryMutationOutcome =
  | { ok: true; entry: OrganizationalMemoryRecord }
  | { ok: false; reason: 'INVALID_INPUT' | 'NOT_FOUND' | 'INVALID_TRANSITION' | 'VERSION_CONFLICT' | 'PERSISTENCE_ERROR'; error: string };

const VALID_STAGES: readonly string[] = [
  'problem', 'observation', 'analysis', 'recommendation', 'decision', 'action', 'outcome', 'learning',
];
const VALID_SOURCES: readonly string[] = [
  'ai-analysis', 'management-review', 'manual', 'incident-review', 'period-close',
];
const VALID_CONFIDENCE: readonly string[] = ['low', 'medium', 'high'];
const HUMAN_SOURCES: readonly string[] = ['management-review', 'manual'];

function normalizeRecord(row: Record<string, unknown>): OrganizationalMemoryRecord | null {
  if (!row || typeof row !== 'object') return null;
  if (typeof row.id !== 'string' || typeof row.summary !== 'string') return null;
  return row as unknown as OrganizationalMemoryRecord;
}

export async function createMemoryEntry(
  input: CreateMemoryEntryInput,
  persistence: MemoryPersistence = defaultMemoryPersistence,
): Promise<MemoryMutationOutcome> {
  // ── structural validation (fail-closed) ──
  if (!VALID_STAGES.includes(input.stage)) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'مرحلة الذاكرة غير صالحة' };
  }
  if (!input.title?.trim() || !input.summary?.trim()) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'العنوان والملخص مطلوبان' };
  }
  if (!VALID_SOURCES.includes(input.source)) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'مصدر الذاكرة غير صالح' };
  }
  if (!VALID_CONFIDENCE.includes(input.confidence)) {
    return { ok: false, reason: 'INVALID_INPUT', error: 'مستوى الثقة غير صالح' };
  }
  if (!input.evidence || input.evidence.length === 0) {
    // §15: traceability to evidence whenever possible — enforced as
    // a hard requirement for every entry.
    return { ok: false, reason: 'INVALID_INPUT', error: 'يجب ربط الذاكرة بأدلة' };
  }

  // ── LIFECYCLE ENFORCEMENT (§15): AI sources start PROPOSED, period. ──
  const initialStatus: OrganizationalMemoryStatus =
    input.source === 'ai-analysis' || input.source === 'incident-review' || input.source === 'period-close'
      ? 'PROPOSED'
      : input.initialStatus && HUMAN_SOURCES.includes(input.source) && input.initialStatus !== 'PROPOSED'
        ? input.initialStatus
        : 'PROPOSED';

  const now = new Date().toISOString();
  const record: Omit<OrganizationalMemoryRecord, 'id'> = {
    schemaVersion: 1,
    stage: input.stage,
    subject: input.subject,
    title: input.title.trim(),
    summary: input.summary.trim(),
    organizationId: input.organizationId?.trim() || 'default',
    department: input.department ?? null,
    period: input.period ?? null,
    evidence: input.evidence,
    relatedEntryIds: input.relatedEntryIds ?? [],
    source: input.source,
    createdBy: input.createdBy,
    createdAt: now,
    updatedBy: null,
    updatedAt: null,
    confidence: input.confidence,
    status: initialStatus,
    outcome: input.outcome ?? null,
    learning: input.learning ?? null,
    version: 1,
  };

  try {
    const created = await persistence.create(record as Record<string, unknown>);
    const normalized = normalizeRecord(created);
    if (!normalized) {
      return { ok: false, reason: 'PERSISTENCE_ERROR', error: 'تعذر حفظ سجل الذاكرة' };
    }
    return { ok: true, entry: normalized };
  } catch (error) {
    return {
      ok: false,
      reason: 'PERSISTENCE_ERROR',
      error: error instanceof Error ? error.name : ' persistence failure',
    };
  }
}

export interface TransitionMemoryStatusInput {
  entryId: string;
  to: OrganizationalMemoryStatus;
  actorId: string;
  /** Optimistic lock — the version the actor based their decision on. */
  expectedVersion: number;
  note?: string;
}

export async function transitionMemoryStatus(
  input: TransitionMemoryStatusInput,
  persistence: MemoryPersistence = defaultMemoryPersistence,
): Promise<MemoryMutationOutcome> {
  let rows: Record<string, unknown>[];
  try {
    rows = await persistence.getAll();
  } catch (error) {
    return {
      ok: false,
      reason: 'PERSISTENCE_ERROR',
      error: error instanceof Error ? error.name : 'persistence failure',
    };
  }

  const row = rows.find((r) => r.id === input.entryId);
  const entry = row ? normalizeRecord(row) : null;
  if (!entry) return { ok: false, reason: 'NOT_FOUND', error: 'سجل الذاكرة غير موجود' };

  if (!canTransitionMemoryStatus(entry.status, input.to)) {
    return {
      ok: false,
      reason: 'INVALID_TRANSITION',
      error: `انتقال حالة غير مسموح: ${entry.status} → ${input.to}`,
    };
  }
  if (entry.version !== input.expectedVersion) {
    return { ok: false, reason: 'VERSION_CONFLICT', error: 'تعارض في الإصدار — أعد التحميل وأعد المحاولة' };
  }

  const updated = {
    status: input.to,
    version: entry.version + 1,
    updatedBy: input.actorId,
    updatedAt: new Date().toISOString(),
    ...(input.note ? { outcome: input.note } : {}),
  };

  try {
    await persistence.update(entry.id, updated);
  } catch (error) {
    return {
      ok: false,
      reason: 'PERSISTENCE_ERROR',
      error: error instanceof Error ? error.name : 'persistence failure',
    };
  }
  return { ok: true, entry: { ...entry, ...updated } as OrganizationalMemoryRecord };
}

export async function getAllMemoryEntries(
  persistence: MemoryPersistence = defaultMemoryPersistence,
): Promise<OrganizationalMemoryRecord[]> {
  const rows = await persistence.getAll();
  return rows
    .map(normalizeRecord)
    .filter((r): r is OrganizationalMemoryRecord => r !== null);
}
