// ══════════════════════════════════════════════════════════════
//  Configuration audit — Milestone 10
//
//  Reuses the EXISTING generic audit primitive (writeAudit) — no
//  duplicate audit infrastructure. Security-sensitive configuration
//  changes (organization moves, position assignment, permission
//  changes, scope changes, user linking) land in a dedicated
//  collection following the qualityAuditLog / hrAuditLog precedent.
// ══════════════════════════════════════════════════════════════

import { writeAudit, type WriteAuditInput } from '@/lib/audit/server-audit-logger';

/** RTDB collection for configuration-change audit entries. */
export const CONFIG_AUDIT_LOG_TABLE = 'configAuditLog';

/**
 * Write a configuration audit entry (fire-and-forget, never throws).
 * Omits `collection` from the caller input — it is always
 * CONFIG_AUDIT_LOG_TABLE here.
 */
export function writeConfigAudit(
  input: Omit<WriteAuditInput, 'collection'>
): Promise<void> {
  return writeAudit({ ...input, collection: CONFIG_AUDIT_LOG_TABLE });
}
