// ══════════════════════════════════════════════════════════════
//  Employee lifecycle — M0.6-A
//
//  Employees are BUSINESS records (personnel), distinct from Users
//  (application accounts). Their lifecycle is therefore independent:
//  an inactive employee keeps every historical record and may or may
//  not hold a linked user account.
//
//  DEFAULT-COMPATIBLE CONTRACT (M0.6-A):
//    • New employees are created ACTIVE.
//    • Legacy employees have NO status field — they read as 'active'
//      everywhere (normalizeEmployeeStatus), so no migration and no
//      scope/report behavior change.
//    • Deactivation does NOT delete anything. Historical business
//      records stay linked to a stable employeeId.
//
//  SCOPE NOTE (documented limitation): the canonical scope engine
//  (src/lib/scope) intentionally does NOT filter on status in
//  M0.6-A — access evolution ships as its own reviewed step so it
//  cannot silently change what restricted viewers see.
// ══════════════════════════════════════════════════════════════

export type EmployeeStatus = 'active' | 'inactive' | 'archived';

/** Every value writable to employees.status. */
export const EMPLOYEE_STATUSES = ['active', 'inactive', 'archived'] as const;

/** Creation-time default — existing write paths stamp this. */
export const DEFAULT_EMPLOYEE_STATUS: EmployeeStatus = 'active';

/** Legacy employees (and absent/garbage fields) resolve to active. */
export const LEGACY_EFFECTIVE_STATUS: EmployeeStatus = 'active';

export const EMPLOYEE_STATUS_LABELS_AR: Record<EmployeeStatus, string> = {
  active: 'نشط',
  inactive: 'غير نشط',
  archived: 'مؤرشف',
};

/**
 * True when `value` is exactly one of the three lifecycle states.
 * Arbitrary client strings never reach Firebase through this check.
 */
export function isValidEmployeeStatus(value: unknown): value is EmployeeStatus {
  return (
    typeof value === 'string' &&
    (EMPLOYEE_STATUSES as readonly string[]).includes(value)
  );
}

/** Coerce any stored/client value into a valid status (legacy → active). */
export function normalizeEmployeeStatus(value: unknown): EmployeeStatus {
  return isValidEmployeeStatus(value) ? value : LEGACY_EFFECTIVE_STATUS;
}

/** True when the employee belongs in CURRENT populations (lists,
 *  selectors, current reports). Archived AND inactive employees are
 *  excluded — "not eligible now" (inactive) and "left the company"
 *  (archived) are both distinct from "active and working". */
export function isCurrentEmployee(employee: { status?: unknown } | null | undefined): boolean {
  if (!employee) return false;
  return normalizeEmployeeStatus(employee.status) === 'active';
}

/** Filter a list down to the current (active) population. */
export function filterCurrentEmployees<T extends { status?: unknown }>(employees: T[]): T[] {
  return employees.filter(isCurrentEmployee);
}

// ── Archive / Restore (M0.6-A addendum) ─────────────────────────
//
// ARCHIVE IS A LIFECYCLE STATE, NOT A DELETE. The archived employee
// keeps its stable ID, profile, relationships and every historical
// record. These builders produce the EXACT patch an archive/restore
// may write — the API layer spreads nothing else from the request
// body, so a client can never spoof archivedAt/archivedBy or resurrect
// manipulated metadata (the sanitizer below strips reserved fields).

/** Fields the client may never write directly (server-derived only). */
export const EMPLOYEE_LIFECYCLE_RESERVED_FIELDS = [
  'status',
  'archivedAt',
  'archivedBy',
  'archiveReason',
  'previousStatus',
  'restoredAt',
  'restoredBy',
] as const;

/** Strip reserved lifecycle fields from an arbitrary request body. */
export function stripEmployeeLifecycleFields<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out: Record<string, unknown> = { ...body };
  for (const field of EMPLOYEE_LIFECYCLE_RESERVED_FIELDS) delete out[field];
  return out as Partial<T>;
}

export interface EmployeeArchivePatch {
  status: 'archived';
  /** Lifecycle value immediately before archiving (retained for context). */
  previousStatus: EmployeeStatus;
  archivedAt: string;
  archivedBy: string;
  /** Optional human reason (captured from the archiving actor's input). */
  archiveReason: string | null;
}

/**
 * Build the archive patch. `archivedBy` MUST be the authenticated
 * actor id resolved server-side — never a client-supplied value.
 * The patch contains NO id: the employee identity is immutable.
 */
export function buildEmployeeArchivePatch(input: {
  currentStatus: unknown;
  archivedBy: string;
  archiveReason?: unknown;
  now?: string;
}): EmployeeArchivePatch {
  const current = normalizeEmployeeStatus(input.currentStatus);
  if (current === 'archived') {
    throw new Error('employee is already archived');
  }
  if (!input.archivedBy || typeof input.archivedBy !== 'string') {
    throw new Error('archiving requires an authenticated actor');
  }
  return {
    status: 'archived',
    previousStatus: current,
    archivedAt: input.now ?? new Date().toISOString(),
    archivedBy: input.archivedBy,
    archiveReason:
      typeof input.archiveReason === 'string' && input.archiveReason.trim()
        ? input.archiveReason.trim()
        : null,
  };
}

export interface EmployeeRestorePatch {
  status: 'active';
  restoredAt: string;
  restoredBy: string;
  // archivedAt / archiveReason / previousStatus are deliberately NOT
  // touched — the archived period must remain historically
  // identifiable after a restore (employment-period ledger holds the
  // full boundary trail).
}

/**
 * Build the restore patch (ARCHIVED → ACTIVE). Same employee record,
 * same stable id — the patch cannot change identity because it does
 * not contain one. Requires an authenticated actor.
 */
export function buildEmployeeRestorePatch(input: {
  currentStatus: unknown;
  restoredBy: string;
  now?: string;
}): EmployeeRestorePatch {
  const current = normalizeEmployeeStatus(input.currentStatus);
  if (current !== 'archived') {
    throw new Error('only archived employees can be restored');
  }
  if (!input.restoredBy || typeof input.restoredBy !== 'string') {
    throw new Error('restoring requires an authenticated actor');
  }
  return {
    status: 'active',
    restoredAt: input.now ?? new Date().toISOString(),
    restoredBy: input.restoredBy,
  };
}
