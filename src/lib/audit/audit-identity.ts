// ══════════════════════════════════════════════════════════════
//  Audit identity — §2 CORRECTION MILESTONE (single source of truth)
//
//  WHO registered/updated a quality record (discount, observation) is
//  AUDIT METADATA. The rule is identical for every quality module:
//
//    Visible ONLY to:
//      • the System Owner (admin bypass), and
//      • users granted the canonical audit-identity permission — the
//        'qualityAuditLog' page key in the centralized permission
//        system (managers / quality staff hold it by role preset;
//        regular employees resolve to 'none').
//
//    Enforcement is SERVER-SIDE: the fields never leave the API for
//    unauthorized viewers — hiding in the UI is not a gate. The
//    stored records are untouched (audit trail preserved in the
//    database; this is a response-shaping rule, not a data rule).
//
//    Legacy rows without identity fields pass through safely.
// ══════════════════════════════════════════════════════════════

import { migratePermission, type PermissionsMap } from '@/config/permissions';

/**
 * The canonical audit-identity permission: the 'qualityAuditLog' page
 * key. NOT a hardcoded email, NOT a role string — the same
 * page-permission vocabulary every other gate uses.
 */
export const AUDIT_IDENTITY_PAGE_KEY = 'qualityAuditLog';

/** Audit/identity fields stripped from responses for unauthorized viewers. */
const AUDIT_IDENTITY_FIELDS = [
  'createdById',
  'createdByUserId',
  'createdByName',
  'createdByEmail',
  'updatedBy',
  'updatedByName',
  // Quality observations carry the author as "observer":
  'observerName',
  'observerId',
  // The approval trail names the deciders — same sensitivity.
  'approvalHistory',
] as const;

/**
 * May THIS viewer see who registered/decided on quality records?
 * Admin bypass + the centralized page-permission lookup — identical
 * resolution to every other server gate.
 */
export function maySeeAuditIdentity(
  role: string | null | undefined,
  permissions: PermissionsMap | null | undefined,
): boolean {
  if (role === 'admin') return true;
  return migratePermission(permissions?.[AUDIT_IDENTITY_PAGE_KEY]).level !== 'none';
}

/**
 * Response-shaping strip: returns a NEW object without the audit
 * identity fields. Business values (approvalStatus, points, dates,
 * descriptions…) are untouched, so unauthorized viewers still get the
 * operational record — only the WHO is withheld. Safe on legacy rows
 * (missing fields are simply absent from the result).
 */
export function stripAuditIdentity<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = { ...record };
  let stripped = false;
  for (const field of AUDIT_IDENTITY_FIELDS) {
    if (field in out) {
      delete out[field];
      stripped = true;
    }
  }
  return (stripped ? out : record) as T;
}

/** Convenience: gate + strip in one call for list endpoints. */
export function shapeAuditIdentityForViewer<T extends Record<string, unknown>>(
  records: T[],
  role: string | null | undefined,
  permissions: PermissionsMap | null | undefined,
): T[] {
  if (maySeeAuditIdentity(role, permissions)) return records;
  return records.map(stripAuditIdentity);
}
