// ══════════════════════════════════════════════════════════════
//  Quality AI — REAL-DATA verification helpers (Phase 6.5-A §2/§4/§5)
//
//  PURE, DB-FREE utilities shared by the manual verification script
//  (scripts/phase65-verify-gemini.ts, real-Firebase mode) and its
//  unit tests. They are NOT part of any request path — they exist so
//  the verification can:
//    • resolve the CANONICAL employee id behind the UI selection
//      (the UI may show a code like EMP-040 while the API pipeline
//      keys on the internal record id — guessing is forbidden);
//    • produce a SAFE parity summary of the real dataset (aggregate
//      counts/scores — never customer PII, never raw records);
//    • measure the AI input (sizes/counts — never its content);
//    • classify a terminal envelope into the §10 failure taxonomy
//      using MEASURED evidence, not guesses.
// ══════════════════════════════════════════════════════════════

import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence/types';

// ── §2: real employee resolution (UI context → canonical id) ────

export interface EmployeeRowLike {
  id: string;
  code?: string | null;
  name?: string | null;
  department?: string | null;
  status?: unknown;
}

export interface UiEmployeeContext {
  /** What the UI displays (e.g. EMP-040) — may be the code OR the id. */
  code: string;
  /** The employee's displayed name (e.g. أحمد الطبيبي). */
  name: string;
}

export interface ResolvedRealEmployee {
  /** The CANONICAL internal id every API/loader call must use. */
  employeeId: string;
  matchedBy: 'id' | 'code' | 'name';
  code: string | null;
  name: string;
  department: string | null;
  status: unknown;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Resolves the canonical employee record behind a UI selection.
 * Match order (deterministic, first hit wins):
 *   1. exact internal id — in case the UI value IS the record id;
 *   2. exact employee code (trimmed, case-insensitive);
 *   3. exact employee name (trimmed).
 * Returns null when nothing matches — the caller must NOT guess.
 */
export function resolveRealEmployee(
  rows: readonly EmployeeRowLike[],
  ui: UiEmployeeContext,
): ResolvedRealEmployee | null {
  const code = normalize(ui.code);
  const name = normalize(ui.name);
  if (!code && !name) return null;

  if (code) {
    const byId = rows.find((r) => r.id === ui.code.trim());
    if (byId) return toResolved(byId, 'id');
    const byCode = rows.find((r) => normalize(r.code) === code);
    if (byCode) return toResolved(byCode, 'code');
  }
  if (name) {
    const byName = rows.find((r) => normalize(r.name) === name);
    if (byName) return toResolved(byName, 'name');
  }
  return null;
}

function toResolved(row: EmployeeRowLike, matchedBy: ResolvedRealEmployee['matchedBy']): ResolvedRealEmployee {
  return {
    employeeId: row.id,
    matchedBy,
    code: row.code ?? null,
    name: row.name ?? '',
    department: row.department ?? null,
    status: row.status,
  };
}

// ── §4: SAFE dataset parity summary (aggregates only) ───────────

export interface RealDatasetParitySummary {
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  period: string;
  finalized: boolean;
  qualityObservationCount: number;
  observationApproved: number;
  observationPending: number;
  qualityDeductionCount: number;
  totalDeductionDays: number;
  travelDealCount: number;
  complaintCount: number;
  capaCount: number;
  followUpCount: number;
  repeatedIssueGroupsCount: number;
  evidenceCount: number;
  hasKpiSnapshot: boolean;
  hasKpiScheme: boolean;
  rawQualityScore: number | null;
  qualityWeight: number;
  qualityContribution: number | null;
  qualityMaxContribution: number;
  attendanceStatus: string;
}

/** Aggregate, PII-free summary of the REAL dataset — the same
 *  numbers the Smart Quality Report UI renders, safe to print. */
export function buildRealDatasetParitySummary(dataset: EmployeePerformanceDataset): RealDatasetParitySummary {
  const kpi = dataset.kpi.quality;
  const evidenceRefs = [
    ...dataset.evidence.kpi,
    dataset.evidence.observations,
    dataset.evidence.deductions,
    dataset.evidence.complaints,
    dataset.evidence.capa,
    dataset.evidence.followUps,
    dataset.evidence.deals,
    ...(dataset.evidence.attendance ? [dataset.evidence.attendance] : []),
  ];
  return {
    employeeId: dataset.employee.employeeId,
    employeeName: dataset.employee.employeeName,
    employeeCode: dataset.employee.employeeCode,
    department: dataset.employee.department,
    period: dataset.period.monthKey,
    finalized: dataset.period.finalized,
    qualityObservationCount: dataset.quality.observations.total,
    observationApproved: dataset.quality.observations.approved,
    observationPending: dataset.quality.observations.pending,
    qualityDeductionCount: dataset.quality.deductions.count,
    totalDeductionDays: dataset.quality.deductions.totalDays,
    travelDealCount: dataset.deals.total,
    complaintCount: dataset.complaints.total,
    capaCount: dataset.capa.total,
    followUpCount: dataset.followUps.total,
    repeatedIssueGroupsCount: dataset.quality.repeatedIssues.byCategory.length,
    evidenceCount: evidenceRefs.reduce((sum, ref) => sum + (ref?.recordIds?.length ?? 0), 0),
    hasKpiSnapshot: dataset.evidence.kpi.some((ref) => ref.collection === 'monthSnapshots'),
    hasKpiScheme: dataset.evidence.kpi.some((ref) => ref.collection !== 'monthSnapshots'),
    rawQualityScore: kpi?.rawScore ?? null,
    qualityWeight: kpi?.weight ?? 0,
    qualityContribution: kpi?.weightedContribution ?? null,
    qualityMaxContribution: kpi?.maxContribution ?? 0,
    attendanceStatus: dataset.attendance.status,
  };
}

/** Per-field parity of the measured dataset against the values the
 *  UI actually showed (STEP 16) — booleans only, never invented. */
export interface UiObservedValues {
  rawQualityScore?: number;
  qualityContribution?: number;
  qualityDeductionCount?: number;
  totalDeductionDays?: number;
}

export function compareWithUiObservation(
  summary: RealDatasetParitySummary,
  ui: UiObservedValues,
): Record<string, boolean> {
  const approx = (a: number | null | undefined, b: number | undefined): boolean =>
    a !== null && a !== undefined && b !== undefined && Math.abs(a - b) < 1e-6;
  return {
    rawQualityScore: approx(summary.rawQualityScore, ui.rawQualityScore),
    qualityContribution: approx(summary.qualityContribution, ui.qualityContribution),
    qualityDeductionCount: ui.qualityDeductionCount === undefined
      ? false
      : summary.qualityDeductionCount === ui.qualityDeductionCount,
    totalDeductionDays: approx(summary.totalDeductionDays, ui.totalDeductionDays),
  };
}

// ── §5: SAFE AI-input measurements (sizes/counts only) ──────────

export interface PayloadMetricsInput {
  payloadJson: string;
  systemPrompt: string;
  userContent: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface PayloadMetrics {
  factsCount: number;
  evidenceCatalogEntries: number;
  evidenceRecordRefs: number;
  analyticsDigestChars: number;
  payloadChars: number;
  payloadBytes: number;
  systemPromptChars: number;
  userContentChars: number;
  userContentBytes: number;
  totalInputBytes: number;
  totalInputKb: number;
  generation: { temperature: number; maxOutputTokens: number; timeoutMs: number };
}

const utf8Bytes = (text: string): number => Buffer.byteLength(text, 'utf8');

/** Measurements of the ACTUAL provider input — aggregate numbers
 *  only; no payload content ever enters the result. `payload` is the
 *  structured object (typed loosely here to stay decoupled). */
export function buildPayloadMetrics(
  payload: { verifiedFacts?: unknown[]; evidenceCatalog?: Array<{ recordIds?: unknown[] }> ; analytics?: unknown },
  input: PayloadMetricsInput,
): PayloadMetrics {
  const payloadBytes = utf8Bytes(input.payloadJson);
  const systemBytes = utf8Bytes(input.systemPrompt);
  const userBytes = utf8Bytes(input.userContent);
  return {
    factsCount: Array.isArray(payload.verifiedFacts) ? payload.verifiedFacts.length : 0,
    evidenceCatalogEntries: Array.isArray(payload.evidenceCatalog) ? payload.evidenceCatalog.length : 0,
    evidenceRecordRefs: Array.isArray(payload.evidenceCatalog)
      ? payload.evidenceCatalog.reduce((sum, e) => sum + (Array.isArray(e?.recordIds) ? e.recordIds.length : 0), 0)
      : 0,
    analyticsDigestChars: utf8Bytes(JSON.stringify(payload.analytics ?? null)),
    payloadChars: input.payloadJson.length,
    payloadBytes,
    systemPromptChars: input.systemPrompt.length,
    userContentChars: input.userContent.length,
    userContentBytes: userBytes,
    totalInputBytes: systemBytes + userBytes,
    totalInputKb: Math.round((systemBytes + userBytes) / 102.4) / 10,
    generation: {
      temperature: input.temperature,
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs,
    },
  };
}

// ── §10: measured failure taxonomy ──────────────────────────────

export interface RealDataOutcomeClassification {
  /** The §10 layer letter (A..K) + short label. */
  layer: string;
  conclusion: string;
}

/** Classifies a terminal envelope using MEASURED stage timings —
 *  never defaults everything to AI_TIMEOUT. */
export function classifyRealDataOutcome(args: {
  envelopeStatus: string;
  errorCategory?: string | null;
  wallClockMs: number;
  providerMs?: number | null;
  preProviderMs?: number | null;
  firebaseLoadMs?: number | null;
}): RealDataOutcomeClassification {
  const { envelopeStatus, errorCategory, wallClockMs, providerMs, preProviderMs } = args;
  if (envelopeStatus === 'OK') {
    return { layer: 'NONE', conclusion: 'pipeline succeeded end-to-end' };
  }
  if (envelopeStatus === 'NO_DATA' || envelopeStatus === 'INSUFFICIENT_DATA') {
    return { layer: 'B', conclusion: 'no analyzable data for this employee/month in the real data source' };
  }
  if (envelopeStatus === 'AI_RATE_LIMITED') {
    return { layer: 'F', conclusion: 'provider quota (429 RESOURCE_EXHAUSTED) or per-user rate protection' };
  }
  if (envelopeStatus === 'AI_TIMEOUT') {
    const providerDominates = providerMs === null || providerMs === undefined
      ? (preProviderMs ?? 0) < wallClockMs * 0.5
      : providerMs > (preProviderMs ?? 0);
    return providerDominates
      ? { layer: 'E/H', conclusion: `provider generation exceeded the bounded timeout (wall=${wallClockMs}ms, providerMs=${providerMs ?? 'n/a'}, pre-provider=${preProviderMs ?? 'n/a'}ms)` }
      : { layer: 'K', conclusion: `pre-provider stages consumed the wall clock (pre=${preProviderMs}ms of ${wallClockMs}ms)` };
  }
  switch (errorCategory) {
    case 'AI_AUTH_ERROR': return { layer: 'K', conclusion: 'provider credential rejected — configuration, not data' };
    case 'AI_MODEL_ERROR': return { layer: 'K', conclusion: 'configured model rejected/unavailable — configuration' };
    case 'AI_PROVIDER_ERROR': return { layer: 'G', conclusion: 'provider answered with a failure (e.g. 503 UNAVAILABLE)' };
    case 'RESTRICTED_DATA_BLOCKED': return { layer: 'J', conclusion: 'output/input security gate blocked the request' };
    case 'SECRET_LEAK': return { layer: 'J', conclusion: 'output security rejected the response' };
    default: break;
  }
  if (envelopeStatus === 'AI_INVALID_RESPONSE') {
    return { layer: 'I', conclusion: 'response parsing/strict validation rejected the provider output' };
  }
  if (envelopeStatus === 'AI_UNAVAILABLE') {
    return { layer: 'K', conclusion: 'gateway provider resolution returned no provider (configuration)' };
  }
  return { layer: 'K', conclusion: `application-level failure (status=${envelopeStatus}, category=${errorCategory ?? 'n/a'})` };
}

// ── safe configuration flags (booleans only — never values) ─────

export function safeBooleanFlags(
  env: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const name of names) {
    flags[name] = Boolean((env[name] ?? '').trim());
  }
  return flags;
}
