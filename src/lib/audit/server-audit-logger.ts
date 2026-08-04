// ══════════════════════════════════════════════════════════════
//  Server-side audit logger
//
//  Writes to the queryable `qualityAuditLog` collection AND
//  appends to the per-record `auditLog[]` field (via the returned
//  AuditEvent). The API route persists the record-level update.
//
//  Uses the existing db.ts helpers — no new database layer.
//  All writes carry schemaVersion for forward-compatible evolution.
// ══════════════════════════════════════════════════════════════

import { createRecord, invalidateCache } from '@/lib/db';
import type { AuditEvent, QualityAuditEntityType } from '@/types/quality-kpi';

/** Input for a single audit write. */
export interface WriteAuditInput {
  actorId: string;
  actorName: string;
  action: string;
  entityType: QualityAuditEntityType;
  entityId: string;
  /** YYYY-MM month key, when relevant (null otherwise). */
  monthKey: string | null;
  /** Snapshot of the record BEFORE the change (partial). */
  before?: Record<string, unknown> | null;
  /** Snapshot of the record AFTER the change (partial). */
  after?: Record<string, unknown> | null;
  reason?: string;
  details: string;
}

/**
 * Write a single audit entry to the global `qualityAuditLog` collection.
 *
 * This is a fire-and-forget helper — failures are logged but never
 * throw (audit logging must not break the primary operation).
 */
export async function writeQualityAudit(input: WriteAuditInput): Promise<void> {
  try {
    await createRecord('qualityAuditLog', {
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
      module: 'server-audit-logger',
      op: 'writeQualityAudit',
      message: error instanceof Error ? error.message : String(error),
      entityType: input.entityType,
      entityId: input.entityId,
    }));
  }
}

/**
 * Build an AuditEvent suitable for appending to a per-record auditLog[].
 *
 * The caller is responsible for persisting this onto the record.
 * This function does NOT write to the database.
 */
export function makeRecordAuditEvent(input: {
  action: string;
  actorId: string;
  actorName: string;
  details: string;
}): AuditEvent {
  return {
    action: input.action,
    actorId: input.actorId,
    actorName: input.actorName,
    details: input.details,
    timestamp: new Date().toISOString(),
  };
}
