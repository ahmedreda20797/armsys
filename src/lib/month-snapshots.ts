// ══════════════════════════════════════════════════════════════
//  Monthly Snapshot service — Close / Reopen / Detail lifecycle
//
//  This module owns the BUSINESS LOGIC for the monthly snapshot
//  lifecycle (Milestone 5). It keeps API routes THIN: the routes
//  authenticate, validate input, then delegate here.
//
//  Architecture (binding — spec §2):
//    API Route → this service → canonical KPI engine (kpiMetrics) → Database
//
//  No score/trend/ranking/deduction/bonus formula is defined here.
//  The canonical KPI engine (src/lib/metrics/kpiMetrics.ts) remains
//  the single source of truth; this service only orchestrates it.
//
//  The pure builders below are split out so they can be unit-tested
//  without a database. The orchestrator helpers (closeMonth /
//  reopenMonth / getMonthDetail) wire those builders to the DB layer.
//
//  Lifecycle guarantees (spec §3, §12, §13):
//    • Close is idempotent — a duplicate close returns the existing
//      frozen snapshot unchanged (no regenerate, no re-stamp).
//    • Reopen never deletes the frozen document — only status flips.
//    • Re-close archives the previous frozen version into
//      `snapshotHistory` before replacing the active fields.
// ══════════════════════════════════════════════════════════════

import {
  getAll,
  getEmployeeMap,
  createRecordWithId,
  updateRecord,
  invalidateCache,
  TTL,
} from '@/lib/db';
import { getKpiSettings } from '@/lib/kpi-settings';
import { computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import type { EmployeeLike, ObservationLike } from '@/lib/metrics/kpiMetrics';
import { getMonthSnapshot, MONTH_SNAPSHOTS_TABLE } from '@/lib/month-lock';
import { makeAuditEvent } from '@/lib/audit';
import type { AuditEvent } from '@/lib/audit/types';
import type {
  MonthSnapshot,
  MonthSnapshotStatus,
  QualityObservation,
  SnapshotHistoryEntry,
} from '@/types/quality-kpi';
import type { Employee } from '@/types';

// ─────────────────────────────────────────────────────────────
//  Shared types for the service layer
// ─────────────────────────────────────────────────────────────

/** A snapshot of the fields that identify the actor of a lifecycle op. */
export interface SnapshotActor {
  id: string;
  name: string;
}

/** Discriminator for the close result (idempotent vs. freshly generated). */
export type CloseMonthResult =
  | { kind: 'existing'; snapshot: MonthSnapshot }
  | { kind: 'created'; snapshot: MonthSnapshot };

/** Discriminator for the reopen result (genuine reopen vs. no-op). */
export type ReopenMonthResult =
  | { kind: 'reopened'; snapshot: MonthSnapshot }
  | { kind: 'already_open'; snapshot: MonthSnapshot };

// ─────────────────────────────────────────────────────────────
//  PURE BUILDERS (no DB, fully unit-testable)
// ─────────────────────────────────────────────────────────────

/**
 * The subset of a frozen snapshot that must be archived into history
 * before a re-close replaces the active fields (spec §12/§13).
 */
function toHistoryEntry(snap: MonthSnapshot): SnapshotHistoryEntry {
  return {
    closedAt: snap.closedAt ?? snap.generatedAt,
    closedBy: snap.closedBy,
    closedByName: snap.closedByName,
    generatedAt: snap.generatedAt,
    settingsSnapshot: snap.settingsSnapshot,
    employeeScores: snap.employeeScores,
    departmentScores: snap.departmentScores,
    topEmployees: snap.topEmployees,
    bottomEmployees: snap.bottomEmployees,
    categoryTotals: snap.categoryTotals,
    approvalStats: snap.approvalStats,
  };
}

/**
 * Build the closed snapshot document from a freshly computed payload.
 *
 * Pure transformation: combines the canonical engine output with the
 * close metadata, preserving any pre-existing reopen history and audit
 * trail. Used for the FIRST close of a month (no prior closed version).
 *
 * @param computed   - Output of `computeMonthSnapshot` (no `id`).
 * @param monthKey   - The YYYY-MM key.
 * @param previous   - The prior document (open status), if any — its
 *                     reopenCount/reopenReason/auditLog are preserved.
 * @param actor      - Who is closing.
 * @param now        - Injectable timestamp (deterministic for tests).
 */
export function buildClosedSnapshot(
  computed: Omit<MonthSnapshot, 'id'>,
  monthKey: string,
  previous: MonthSnapshot | null,
  actor: SnapshotActor,
  now: Date,
): MonthSnapshot {
  const auditEvent = makeAuditEvent({
    action: previous?.status === 'closed' ? 'close_refresh' : 'close',
    actorId: actor.id,
    actorName: actor.name,
    details: `إغلاق شهر ${monthKey}`,
  });

  return {
    id: monthKey,
    schemaVersion: 1,
    monthKey,
    status: 'closed',
    closedAt: now.toISOString(),
    closedBy: actor.id,
    closedByName: actor.name,
    reopenCount: previous?.reopenCount ?? 0,
    reopenReason: previous?.reopenReason ?? '',
    auditLog: [...(previous?.auditLog || []), auditEvent],
    generatedAt: now.toISOString(),
    settingsSnapshot: computed.settingsSnapshot,
    employeeScores: computed.employeeScores,
    departmentScores: computed.departmentScores,
    topEmployees: computed.topEmployees,
    bottomEmployees: computed.bottomEmployees,
    categoryTotals: computed.categoryTotals,
    approvalStats: computed.approvalStats,
    snapshotHistory: previous?.snapshotHistory ?? [],
  };
}

/**
 * Build a RE-CLOSED snapshot that archives the previous frozen version
 * before replacing the active fields (spec §13).
 *
 * The previous closed version is appended to `snapshotHistory` so the
 * full audit trail of every close remains recoverable. The new computed
 * values become the active frozen snapshot.
 *
 * @param computed   - Fresh output of `computeMonthSnapshot`.
 * @param previous   - The prior CLOSED document to archive.
 * @param actor      - Who is re-closing.
 * @param now        - Injectable timestamp.
 */
export function buildReclosedSnapshot(
  computed: Omit<MonthSnapshot, 'id'>,
  previous: MonthSnapshot,
  actor: SnapshotActor,
  now: Date,
): MonthSnapshot {
  // Archive the superseded closed version BEFORE replacing active fields.
  const priorHistory = previous.snapshotHistory ?? [];
  const archivedHistory = [...priorHistory, toHistoryEntry(previous)];

  const auditEvent = makeAuditEvent({
    action: 'reclose',
    actorId: actor.id,
    actorName: actor.name,
    details: `إعادة إغلاق شهر ${previous.monthKey} بعد تعديلات`,
  });

  return {
    id: previous.id,
    schemaVersion: 1,
    monthKey: previous.monthKey,
    status: 'closed',
    closedAt: now.toISOString(),
    closedBy: actor.id,
    closedByName: actor.name,
    // Reopen count/reason persist across the re-close cycle.
    reopenCount: previous.reopenCount,
    reopenReason: previous.reopenReason,
    auditLog: [...(previous.auditLog || []), auditEvent],
    generatedAt: now.toISOString(),
    settingsSnapshot: computed.settingsSnapshot,
    employeeScores: computed.employeeScores,
    departmentScores: computed.departmentScores,
    topEmployees: computed.topEmployees,
    bottomEmployees: computed.bottomEmployees,
    categoryTotals: computed.categoryTotals,
    approvalStats: computed.approvalStats,
    snapshotHistory: archivedHistory,
  };
}

/**
 * Build the reopened state by flipping status to 'open'.
 *
 * Pure transformation: NEVER deletes the frozen snapshot data — only
 * the `status` field changes. Increments `reopenCount`, stores the
 * latest `reopenReason`, and appends a reopen audit event. The previous
 * frozen values remain fully recoverable (spec §11/§12).
 *
 * @param existing - The prior CLOSED document.
 * @param reason   - Non-empty reopen reason.
 * @param actor    - Who is reopening.
 * @param now      - Injectable timestamp.
 */
export function buildReopenedSnapshot(
  existing: MonthSnapshot,
  reason: string,
  actor: SnapshotActor,
  now: Date,
): MonthSnapshot {
  const auditEvent = makeAuditEvent({
    action: 'reopen',
    actorId: actor.id,
    actorName: actor.name,
    details: `إعادة فتح شهر ${existing.monthKey}: ${reason}`,
  });

  return {
    ...existing,
    status: 'open' as MonthSnapshotStatus,
    reopenCount: (existing.reopenCount || 0) + 1,
    reopenReason: reason,
    // closedAt/closedBy/closedByName are INTENTIONALLY preserved so the
    // previous close metadata stays in the audit trail (spec §11).
    auditLog: [...(existing.auditLog || []), auditEvent],
    // Note: frozen score fields are preserved as-is; they simply become
    // superseded once the month is closed again.
  };
}

/**
 * Project a live (open) preview snapshot from the canonical engine
 * output, without persisting it (spec §7 — open month returns live
 * data but the stored snapshot remains open).
 */
export function buildLivePreview(
  computed: Omit<MonthSnapshot, 'id'>,
  monthKey: string,
): MonthSnapshot {
  return {
    ...computed,
    id: monthKey,
    status: 'open',
  } as MonthSnapshot;
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATOR HELPERS (wire pure builders to the DB + engine)
// ─────────────────────────────────────────────────────────────

/**
 * Load the employee lookup map in the shape the canonical KPI engine
 * expects (`EmployeeLike`). Reuses `getEmployeeMap` from db.ts (single
 * cached read) — no extra Firebase scan.
 */
export async function loadEmployeeMapForEngine(): Promise<Map<string, EmployeeLike>> {
  const empMap = await getEmployeeMap();
  const out = new Map<string, EmployeeLike>();
  for (const [id, e] of empMap) {
    out.set(id, { id: e.id, name: e.name, department: e.department, position: e.position });
  }
  return out;
}

/**
 * Compute a fresh snapshot for a month via the canonical KPI engine.
 *
 * Gathers the month's observations and active employee records, then
 * delegates entirely to `computeMonthSnapshot`. No scoring logic lives
 * here (spec §2/§9).
 *
 * @param monthKey - The YYYY-MM key.
 * @returns The computed snapshot payload (without `id`).
 */
export async function computeFreshMonthSnapshot(
  monthKey: string,
): Promise<Omit<MonthSnapshot, 'id'>> {
  const settings = await getKpiSettings();
  const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
  const monthObs = allObs.filter((o) => o.month === monthKey) as unknown as ObservationLike[];

  const empMap = await loadEmployeeMapForEngine();
  // Supervisor map is not stored on the Employee record today; the engine
  // accepts null entries, which is the documented current behavior.
  const supervisorMap = new Map<string, string | null>();

  return computeMonthSnapshot(monthObs, monthKey, empMap, supervisorMap, settings);
}

/**
 * Close (freeze) a month. IDEMPOTENT (spec §3):
 *
 *   • If the month is already closed → return the existing frozen
 *     snapshot unchanged (no regenerate, no re-stamp).
 *   • If the month is open (or has no snapshot yet) → compute a fresh
 *     snapshot via the canonical engine, archive any prior closed
 *     version, persist, and return it.
 *
 * Concurrency note (spec §17): the read-then-write sequence relies on
 * the existing repository pattern. RTDB does not expose a true
 * compare-and-set through the current db.ts helper layer, so two
 * simultaneous closes on a freshly-open month could both compute. The
 * idempotent guard ensures a duplicate close on an already-closed
 * month is always safe; the worst case for a true race on an open
 * month is one redundant compute, after which the document is closed
 * and all subsequent closes short-circuit. This limitation is
 * documented in the Milestone 5 report.
 *
 * @param monthKey - A pre-validated YYYY-MM key.
 * @param actor    - The authenticated actor performing the close.
 */
export async function closeMonth(
  monthKey: string,
  actor: SnapshotActor,
): Promise<CloseMonthResult> {
  const previous = await getMonthSnapshot(monthKey);

  // ── IDEMPOTENT: already closed → return frozen snapshot unchanged ──
  if (previous && previous.status === 'closed') {
    return { kind: 'existing', snapshot: previous };
  }

  // ── Fresh close (or re-close after reopen) ──
  const computed = await computeFreshMonthSnapshot(monthKey);
  const now = new Date();

  // A re-close (previous existed and was 'open' but had been closed
  // before) archives the prior frozen version into snapshotHistory.
  const snapshot =
    previous && (previous.snapshotHistory?.length || previous.reopenCount > 0)
      ? buildReclosedSnapshot(computed, previous, actor, now)
      : buildClosedSnapshot(computed, monthKey, previous, actor, now);

  await createRecordWithId(MONTH_SNAPSHOTS_TABLE, monthKey, snapshot as unknown as Record<string, unknown>);
  invalidateCache(MONTH_SNAPSHOTS_TABLE);

  return { kind: 'created', snapshot };
}

/**
 * Reopen a closed month. Safe / idempotent on an already-open month
 * (spec §11): returns the existing open document unchanged.
 *
 * NEVER deletes the frozen snapshot — only `status` flips to 'open'.
 *
 * @param monthKey - A pre-validated YYYY-MM key.
 * @param reason   - A non-empty reopen reason (validated by the route).
 * @param actor    - The authenticated actor performing the reopen.
 * @returns A discriminated result — `reopened` for a genuine reopen,
 *          `already_open` for the idempotent no-op. `null` if no
 *          snapshot document exists for the month.
 */
export async function reopenMonth(
  monthKey: string,
  reason: string,
  actor: SnapshotActor,
): Promise<ReopenMonthResult | null> {
  const existing = await getMonthSnapshot(monthKey);
  if (!existing) return null;

  // Idempotent: already open — return as-is (no second audit/notify).
  if (existing.status === 'open') {
    return { kind: 'already_open', snapshot: existing };
  }

  const reopened = buildReopenedSnapshot(existing, reason, actor, new Date());
  await updateRecord(
    MONTH_SNAPSHOTS_TABLE,
    monthKey,
    reopened as unknown as Record<string, unknown>,
  );
  invalidateCache(MONTH_SNAPSHOTS_TABLE);
  return { kind: 'reopened', snapshot: reopened };
}

/**
 * Resolve the month detail (spec §7):
 *   • CLOSED → return the stored frozen snapshot (no recalculation).
 *   • OPEN   → return a live-computed preview (not persisted).
 *
 * @param monthKey - A pre-validated YYYY-MM key.
 */
export async function getMonthDetail(monthKey: string): Promise<MonthSnapshot | null> {
  const existing = await getMonthSnapshot(monthKey);

  // Closed → frozen immutable snapshot, never recalculated.
  if (existing && existing.status === 'closed') {
    return existing;
  }

  // Open → live preview via the canonical engine (not persisted).
  const computed = await computeFreshMonthSnapshot(monthKey);
  return buildLivePreview(computed, monthKey);
}
