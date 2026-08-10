// ══════════════════════════════════════════════════════════════
//  Generic server-side audit logger
//
//  Writes audit entries to ANY caller-specified collection AND
//  provides a factory for per-record audit events. The caller
//  chooses the collection (e.g. Quality passes 'qualityAuditLog',
//  HR passes 'hrAuditLog') — this library hardcodes NO collection
//  names or entity types.
//
//  This module depends only on db.ts and its own types — it is fully
//  domain-agnostic and reusable by every module.
// ══════════════════════════════════════════════════════════════

import { createRecord, invalidateCache } from '@/lib/db';
import type { AuditEvent, AuditEntityType } from './types';

/** Input for a single audit write. */
export interface WriteAuditInput {
  /** The RTDB collection to write the audit entry to (e.g. 'qualityAuditLog'). */
  collection: string;
  /** Stable identifier of the user performing the action. */
  actorId: string;
  /** Display name of the actor (snapshotted for history readability). */
  actorName: string;
  /** Short machine key describing the action (e.g. 'create', 'update'). */
  action: string;
  /** The entity type being acted upon (plain string — the library owns no entity vocabulary). */
  entityType: AuditEntityType;
  /** Stable identifier of the entity being acted upon. */
  entityId: string;
  /** YYYY-MM month key, when relevant (null otherwise). */
  monthKey: string | null;
  /** Snapshot of the record BEFORE the change (partial). */
  before?: Record<string, unknown> | null;
  /** Snapshot of the record AFTER the change (partial). */
  after?: Record<string, unknown> | null;
  /** Free-text reason for the action (e.g. a rejection reason). */
  reason?: string;
  /** Human-readable description of the change. */
  details: string;
}

/**
 * Write a single audit entry to the caller-specified RTDB collection.
 *
 * This is fire-and-forget: failures are logged but never throw (audit
 * logging must not break the primary operation).
 *
 * @param input - The audit write parameters (see {@link WriteAuditInput}).
 *
 * @remarks
 * Side effects:
 *   - Writes one document to `arm_erp/{input.collection}`.
 *   - Invalidates the cache for that collection.
 *   - Logs a structured JSON error on failure (never throws).
 */
export async function writeAudit(input: WriteAuditInput): Promise<void> {
  try {
    await createRecord(input.collection, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      actorId: input.actorId,
      actorName: input.actorName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      monthKey: input.monthKey,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? '',
      details: input.details,
    });
  } catch (error) {
    // Structured observability log — never throw from audit writes.
    console.error(JSON.stringify({
      level: 'error',
      module: 'audit:server-audit-logger',
      op: 'writeAudit',
      message: error instanceof Error ? error.message : String(error),
      entityType: input.entityType,
      entityId: input.entityId,
    }));
  }
}

/** Input for building a per-record {@link AuditEvent}. */
export interface MakeAuditEventInput {
  /** Short machine key describing the action (e.g. 'create', 'update'). */
  action: string;
  /** Stable identifier of the user performing the action. */
  actorId: string;
  /** Display name of the actor. */
  actorName: string;
  /** Human-readable description of the change. */
  details: string;
}

/**
 * Build an {@link AuditEvent} suitable for appending to a per-record
 * `auditLog[]`. The caller is responsible for persisting this onto the
 * record — this function does NOT write to the database.
 *
 * @param input - The event fields (see {@link MakeAuditEventInput}).
 * @returns An {@link AuditEvent} stamped with the current ISO timestamp.
 *
 * @remarks
 * Side effects: none. This is a pure function.
 */
export function makeAuditEvent(input: MakeAuditEventInput): AuditEvent {
  return {
    action: input.action,
    actorId: input.actorId,
    actorName: input.actorName,
    details: input.details,
    timestamp: new Date().toISOString(),
  };
}
