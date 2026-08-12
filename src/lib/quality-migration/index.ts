// ══════════════════════════════════════════════════════════════
//  Legacy Quality Migration service — Milestone 6B
//
//  Owns the BUSINESS LOGIC for migrating legacy `qualityDeductions`
//  into the new canonical `qualityObservations`. Keeps the
//  /api/quality-observations/migrate route THIN: the route
//  authenticates, enforces admin-only, parses the body, then
//  delegates here.
//
//  Architecture:
//    API Route → THIS service → db.ts + approvals + audit
//
//  Idempotency (spec §14):
//    Every migrated observation stores the source legacy ID in its
//    `clientRequestId` field (the canonical idempotency key designed
//    for exactly this purpose). Before creating a migrated record, the
//    service scans existing observations for matching clientRequestId
//    values. Records already migrated in a prior run are skipped.
//    Additionally, observations created by the older /api/quality-migration
//    route (Milestone 1–5) used a `createdByName === '__system_migration__'`
//    convention with a `[source:<id>]` marker in notes. This service
//    recognises BOTH conventions so re-running never produces duplicates
//    regardless of which migration endpoint was used first.
//
//  Migration never deletes or modifies legacy records (spec §15).
//
//  Pure helpers (planMigration, mapDeductionToObservation) are fully
//  unit-testable without a database. The orchestrator
//  (migrateLegacyDeductions) wires the pure logic to persistence.
// ══════════════════════════════════════════════════════════════

import {
  getAll,
  createRecord,
  getEmployeeMap,
  TTL,
} from '@/lib/db';
import { makeApprovalEvent, appendApprovalEvent, projectLatestApprovalStatus } from '@/lib/approvals';
import { makeAuditEvent, writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import type { QualityObservation, ApprovalEvent } from '@/types/quality-kpi';
import type { QualityDeduction } from '@/types';

// ─────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────

/** Prefix embedded in `clientRequestId` for idempotent detection. */
export const MIGRATION_CLIENT_PREFIX = 'legacy_quality_migration:';

/** Recognised `createdByName` value from the older Milestone 1–5 route. */
const LEGACY_MIGRATION_CREATOR = '__system_migration__';

/** The RTDB collections read/written during migration. */
const SOURCE_TABLE = 'qualityDeductions';
const TARGET_TABLE = 'qualityObservations';

// ─────────────────────────────────────────────────────────────
//  Public types
// ─────────────────────────────────────────────────────────────

/** Typed migration summary (returned to the client). */
export interface MigrationSummary {
  success: boolean;
  dryRun: boolean;
  /** Total legacy records scanned. */
  scanned: number;
  /** Records successfully mapped and persisted (or that WOULD be in dry-run). */
  migrated: number;
  /** Records skipped because they are structurally invalid (missing required fields). */
  skipped: number;
  /** Records that threw an unexpected error during mapping/persist. */
  failed: number;
  /** Records already present from a prior migration run (idempotent). */
  alreadyMigrated: number;
  /** Per-record error/failure details (never silently swallowed). */
  errors: MigrationErrorEntry[];
}

/** A single per-record error entry. */
export interface MigrationErrorEntry {
  /** The legacy record's ID (when available). */
  sourceId: string;
  /** The legacy record's employeeId (when available). */
  employeeId: string;
  /** Human-readable reason for the error. */
  reason: string;
}

/** The resolved context used when mapping a legacy record. */
export interface MigrationContext {
  actorId: string;
  actorName: string;
}

/** Options for the migration orchestrator. */
export interface MigrationOptions {
  dryRun?: boolean;
  /** Injectable timestamp (deterministic for tests). */
  now?: Date;
}

// ─────────────────────────────────────────────────────────────
//  Idempotency helpers (pure)
// ─────────────────────────────────────────────────────────────

/**
 * Build the `clientRequestId` value that uniquely links a new
 * observation to its legacy source record.
 *
 * Uses the canonical `clientRequestId` field (designed for exactly this
 * purpose) rather than fuzzy matching.
 *
 * @param sourceId - The legacy `qualityDeduction` record ID.
 * @returns The idempotency key string.
 */
export function buildMigrationClientRequestId(sourceId: string): string {
  return `${MIGRATION_CLIENT_PREFIX}${sourceId}`;
}

/**
 * Extract the legacy source ID from an observation's idempotency marker.
 *
 * Recognises TWO conventions:
 *   1. `clientRequestId` starting with `legacy_quality_migration:` (new).
 *   2. `createdByName === '__system_migration__'` + notes containing
 *      `[source:<id>]` (older Milestone 1–5 route).
 *
 * Returns `null` if the observation was not migrated from legacy data.
 *
 * @param obs - A quality observation to inspect.
 */
export function extractLegacySourceId(obs: { clientRequestId: string | null; createdByName: string; notes: string }): string | null {
  // Convention 1: explicit clientRequestId prefix.
  if (obs.clientRequestId && obs.clientRequestId.startsWith(MIGRATION_CLIENT_PREFIX)) {
    return obs.clientRequestId.slice(MIGRATION_CLIENT_PREFIX.length);
  }

  // Convention 2: legacy notes-based marker from the older route.
  if (obs.createdByName === LEGACY_MIGRATION_CREATOR && obs.notes) {
    const match = obs.notes.match(/\[source:([^\]]+)\]/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Build a set of already-migrated source IDs from existing observations.
 *
 * @param existingObs - All existing quality observations.
 * @returns A set of legacy source IDs that have already been migrated.
 */
export function buildMigratedSet(existingObs: Array<{ clientRequestId: string | null; createdByName: string; notes: string }>): Set<string> {
  const result = new Set<string>();
  for (const obs of existingObs) {
    const sourceId = extractLegacySourceId(obs);
    if (sourceId) result.add(sourceId);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────
//  Mapping helpers (pure — fully testable)
// ─────────────────────────────────────────────────────────────

/**
 * Derive a YYYY-MM month key from a legacy date string.
 *
 * Handles DD/MM/YYYY (the established legacy format) and ISO-like
 * YYYY-MM-DD strings. Falls back to the observation's own `month`
 * field if available (the legacy schema stores this pre-computed).
 */
export function deriveMigrationMonth(dateStr: string, fallbackMonth?: string): string {
  if (fallbackMonth && /^\d{4}-\d{2}$/.test(fallbackMonth)) return fallbackMonth;

  const parts = dateStr.split('/');
  if (parts.length === 3) {
    const [, month, year] = parts;
    return `${year}-${month.padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  return new Date().toISOString().slice(0, 7);
}

/** Points magnitude derived from a legacy record. Never invents. */
function derivePoints(ded: QualityDeduction): number {
  if (typeof ded.deductionDays === 'number' && ded.deductionDays > 0) return ded.deductionDays;
  if (typeof ded.deductionAmount === 'number' && ded.deductionAmount > 0) return ded.deductionAmount;
  return 0;
}

/**
 * Resolve a default observation category for migrated records.
 *
 * Prefers a category whose key suggests it is a migration target;
 * otherwise uses the first available category. Returns `null` only
 * when no categories exist at all.
 */
function resolveDefaultCategory(
  categories: Array<{ id: string; name: string; weight: number; defaultPointValue: number }>,
): { id: string; name: string; weight: number } | null {
  if (categories.length === 0) return null;
  const migrationCat = categories.find((c) => c.id === 'migrated' || c.name === 'خصم مرحل');
  const cat = migrationCat ?? categories[0];
  return { id: cat.id, name: cat.name, weight: cat.weight };
}

/** Validation result for a legacy record. */
export interface DeductionValidation {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a legacy deduction record can be migrated.
 *
 * Returns `{ valid: true }` when the record has a usable employeeId and
 * date, or `{ valid: false, reason }` when a required field is missing.
 * Malformed records are skipped (not failed) — they are reported in the
 * summary under `skipped`.
 */
export function validateDeduction(ded: QualityDeduction): DeductionValidation {
  if (!ded.id) return { valid: false, reason: 'Missing legacy record ID' };
  if (!ded.employeeId) return { valid: false, reason: 'Missing employeeId' };
  if (!ded.date) return { valid: false, reason: 'Missing date' };
  return { valid: true };
}

/**
 * Map a legacy `QualityDeduction` to a new `QualityObservation` payload.
 *
 * Pure transformation — performs no I/O. The caller is responsible for
 * persistence and audit.
 *
 * Field mapping (spec §16 — do NOT invent values):
 *   • employeeId          ← ded.employeeId (real)
 *   • employeeName        ← resolved from employee map (real)
 *   • department          ← resolved from employee map (real)
 *   • positionSnapshot    ← resolved from employee map (real)
 *   • observerId          ← migration actor ID (real)
 *   • observerName        ← migration actor name (real)
 *   • observationDate     ← ded.date (real)
 *   • month               ← ded.month (real) or derived
 *   • type                ← ded.type (real)
 *   • severity            ← 'medium' (safe default; legacy has no severity;
 *                            documented mapping decision)
 *   • categoryId          ← resolved default category (real)
 *   • categoryName        ← from resolved category (real)
 *   • categoryWeight      ← from resolved category (real)
 *   • notes               ← ded.description (real legacy content)
 *   • evidence            ← ded.evidence || '' (real, empty string default)
 *   • status              ← 'closed' (legacy deductions are historical;
 *                            documented mapping decision)
 *   • relatedCapaId       ← ded.relatedCapaId || null (real)
 *   • applyPointDeduction ← true (per spec §16)
 *   • points              ← ded.deductionDays or ded.deductionAmount or 0
 *                           (documented: legacy magnitude maps 1:1)
 *   • isBonus             ← false (per spec §16)
 *   • approvalStatus      ← 'approved' (per spec §16/§17)
 *   • approvalHistory     ← [approve event with migration note]
 *   • clientRequestId     ← explicit idempotency marker
 *   • resolvedDate        ← ded.createdAt
 *
 * @param ded              - The legacy deduction record.
 * @param employeeName      - Resolved employee display name.
 * @param department        - Resolved employee department.
 * @param position          - Resolved employee position.
 * @param category          - Resolved default observation category.
 * @param context           - Migration actor context.
 * @param now               - Injectable timestamp.
 * @returns A complete observation payload (without `id` — assigned by DB).
 */
export function mapDeductionToObservation(
  ded: QualityDeduction,
  employeeName: string,
  department: string,
  position: string,
  category: { id: string; name: string; weight: number } | null,
  context: MigrationContext,
  now: Date,
): Omit<QualityObservation, 'id'> {
  const month = deriveMigrationMonth(ded.date, ded.month);
  const points = derivePoints(ded);
  const catId = category?.id ?? '_migrated';
  const catName = category?.name ?? 'خصم مرحل';
  const catWeight = category?.weight ?? 1;

  // Build auto-approved history — historical data, no manager review needed.
  const approveEvent = makeApprovalEvent({
    action: 'approve',
    actorId: context.actorId,
    actorName: context.actorName,
    notes: 'Migrated from legacy qualityDeductions',
    now,
  });
  const approvalHistory: ApprovalEvent[] = appendApprovalEvent([], approveEvent);

  // Per-record audit event.
  const auditEvent = makeAuditEvent({
    action: 'create',
    actorId: context.actorId,
    actorName: context.actorName,
    details: `ترحيل خصم جودة: ${ded.description || ded.type}`,
    now,
  });

  return {
    schemaVersion: 1,
    employeeId: ded.employeeId,
    employeeName,
    department,
    positionSnapshot: position,
    observerId: context.actorId,
    observerName: context.actorName,
    observationDate: ded.date,
    month,
    type: ded.type || 'deduction',
    severity: 'medium',
    categoryId: catId,
    categoryName: catName,
    categoryWeight: catWeight,
    notes: ded.description || '',
    evidence: ded.evidence || '',
    status: 'closed',
    relatedCapaId: ded.relatedCapaId || null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: ded.createdAt,
    applyPointDeduction: true,
    points,
    isBonus: false,
    approvalStatus: projectLatestApprovalStatus(approvalHistory),
    approvalHistory,
    auditLog: [auditEvent],
    createdById: context.actorId,
    createdByName: context.actorName,
    clientRequestId: buildMigrationClientRequestId(ded.id),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────
//  Pure batch planner (no DB — fully unit-testable)
// ─────────────────────────────────────────────────────────────

/** The result of planning a migration batch. */
export interface MigrationPlan {
  /** Observations that should be created (or would be in dry-run). */
  toCreate: Array<Omit<QualityObservation, 'id'>>;
  /** Final summary counts. */
  summary: MigrationSummary;
}

/**
 * Plan a migration batch over a set of legacy deductions.
 *
 * PURE: takes all inputs as parameters, returns the plan without any I/O.
 * Used by the orchestrator to decide what to persist and by unit tests to
 * verify idempotency, mapping correctness, and summary accuracy.
 *
 * Invariant: scanned = migrated + alreadyMigrated + skipped + failed.
 *
 * @param deductions  - Legacy records to process.
 * @param migratedSet - Set of source IDs already present (idempotency).
 * @param empMap      - Employee lookup map (for name/dept/position).
 * @param categories  - Available observation categories.
 * @param context     - Migration actor context.
 * @param options     - Migration options (dryRun, now).
 * @returns The migration plan and summary.
 */
export function planMigration(
  deductions: QualityDeduction[],
  migratedSet: Set<string>,
  empMap: Map<string, { name: string; department: string | null; position: string | null }>,
  categories: Array<{ id: string; name: string; weight: number; defaultPointValue: number }>,
  context: MigrationContext,
  options: MigrationOptions = {},
): MigrationPlan {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();
  const defaultCategory = resolveDefaultCategory(categories);

  const toCreate: Array<Omit<QualityObservation, 'id'>> = [];
  const errors: MigrationErrorEntry[] = [];
  let scanned = 0;
  let alreadyMigrated = 0;
  let skipped = 0;
  let failed = 0;
  let migrated = 0;

  for (const ded of deductions) {
    scanned++;

    // Idempotency: already migrated in a prior run.
    if (migratedSet.has(ded.id)) {
      alreadyMigrated++;
      continue;
    }

    // Validate the legacy record has required fields.
    const validation = validateDeduction(ded);
    if (!validation.valid) {
      skipped++;
      errors.push({
        sourceId: ded.id || 'unknown',
        employeeId: ded.employeeId || 'unknown',
        reason: validation.reason ?? 'Invalid legacy record',
      });
      continue;
    }

    try {
      const emp = empMap.get(ded.employeeId);
      const employeeName = emp?.name || 'غير معروف';
      const department = emp?.department || 'غير محدد';
      const position = emp?.position || '';

      const observation = mapDeductionToObservation(
        ded,
        employeeName,
        department,
        position,
        defaultCategory,
        context,
        now,
      );
      toCreate.push(observation);
      migrated++;
    } catch (error) {
      failed++;
      errors.push({
        sourceId: ded.id,
        employeeId: ded.employeeId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary: MigrationSummary = {
    success: true,
    dryRun,
    scanned,
    migrated,
    skipped,
    failed,
    alreadyMigrated,
    errors,
  };

  return { toCreate, summary };
}

// ─────────────────────────────────────────────────────────────
//  ORCHESTRATOR (wires pure plan to DB + audit)
// ─────────────────────────────────────────────────────────────

/**
 * Migrate legacy `qualityDeductions` into `qualityObservations`.
 *
 * Idempotent: running multiple times never creates duplicate observations.
 * Legacy records are NEVER deleted or modified (spec §15).
 *
 * On failure of an individual record, the error is captured in the summary
 * and processing continues — a single bad record does not abort the batch
 * (spec §21).
 *
 * Every run writes an audit entry to the quality audit log (spec §18).
 *
 * @param context - The admin actor performing the migration.
 * @param options - Migration options (dryRun, injectable timestamp).
 * @returns The typed migration summary.
 */
export async function migrateLegacyDeductions(
  context: MigrationContext,
  options: MigrationOptions = {},
): Promise<MigrationSummary> {
  const dryRun = options.dryRun ?? false;
  const now = options.now ?? new Date();

  // Load all legacy deductions.
  const deductions = await getAll<QualityDeduction>(SOURCE_TABLE, TTL.STATIC);
  if (deductions.length === 0) {
    const emptySummary: MigrationSummary = {
      success: true,
      dryRun,
      scanned: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      alreadyMigrated: 0,
      errors: [],
    };
    // Write audit for empty run.
    await writeAudit({
      collection: AUDIT_LOG_TABLE,
      actorId: context.actorId,
      actorName: context.actorName,
      action: 'migration',
      entityType: 'observation',
      entityId: 'batch_migration',
      monthKey: null,
      after: { totalSource: 0, migrated: 0 } as Record<string, unknown>,
      details: 'ترحيل خصومات الجودة: لا توجد خصومات للترحيل',
    });
    return emptySummary;
  }

  // Build the idempotency set from existing observations.
  const existingObs = await getAll<QualityObservation>(TARGET_TABLE, TTL.MEDIUM);
  const migratedSet = buildMigratedSet(existingObs);

  // Load employee map for name/dept resolution.
  const empMap = await getEmployeeMap();

  // Load observation categories for default category resolution.
  const categories = await getAll<{ id: string; name: string; weight: number; defaultPointValue: number }>(
    'observationCategories',
    TTL.STATIC,
  );

  // Plan the batch (pure — no I/O).
  const { toCreate, summary } = planMigration(
    deductions,
    migratedSet,
    empMap,
    categories,
    context,
    { dryRun, now },
  );

  // Persist each planned observation (skip in dry-run).
  let persistFailures = 0;
  if (!dryRun) {
    for (const payload of toCreate) {
      try {
        await createRecord<QualityObservation>(TARGET_TABLE, payload as Record<string, unknown>);
      } catch (error) {
        persistFailures++;
        const sourceId = payload.clientRequestId
          ? payload.clientRequestId.slice(MIGRATION_CLIENT_PREFIX.length)
          : 'unknown';
        summary.errors.push({
          sourceId,
          employeeId: payload.employeeId,
          reason: `Persist failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    if (persistFailures > 0) {
      summary.failed += persistFailures;
      summary.migrated -= persistFailures;
    }
  }

  // Write a single audit entry for the entire migration run (spec §18).
  await writeAudit({
    collection: AUDIT_LOG_TABLE,
    actorId: context.actorId,
    actorName: context.actorName,
    action: 'migration',
    entityType: 'observation',
    entityId: 'batch_migration',
    monthKey: null,
    after: {
      totalSource: deductions.length,
      migrated: summary.migrated,
      skipped: summary.skipped,
      failed: summary.failed,
      alreadyMigrated: summary.alreadyMigrated,
      dryRun,
    } as Record<string, unknown>,
    details: `ترحيل خصومات الجودة: ${summary.migrated} تم ترحيلها، ${summary.alreadyMigrated} تم تخطيها (مرحلة مسبقاً)، ${summary.skipped} بيانات غير صالحة، ${summary.failed} أخطاء`,
  });

  return summary;
}
