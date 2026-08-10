// ══════════════════════════════════════════════════════════════
//  Generic database validation
//
//  Reusable foreign-key, entity-existence, and employee validation.
//  Every module that writes to the database should validate references
//  BEFORE persisting to prevent orphan records and invalid references.
//
//  This library depends only on db.ts and validate-employee.ts — it
//  is fully domain-agnostic. No entity names or collection names are
//  hardcoded; all are passed as parameters by the caller.
//
//  Future modules (Attendance, Sales, HR, Travel, CAPA) reuse these
//  exact functions.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';

// ─────────────────────────────────────────────────────────────
//  Result types
// ─────────────────────────────────────────────────────────────

/**
 * Result of a validation check. `valid` is true when the check
 * passes; `error` contains a human-readable message otherwise.
 */
export interface ValidationResult {
  /** True when the validation passed. */
  valid: boolean;
  /** Human-readable error message when validation fails. */
  error?: string;
}

/** Valid result shorthand — avoids allocating a new object each time. */
export const VALID: ValidationResult = { valid: true };

/**
 * Build an invalid result.
 * @internal (not exported — use the functions below)
 */
function invalid(error: string): ValidationResult {
  return { valid: false, error };
}

// ─────────────────────────────────────────────────────────────
//  Validate foreign keys
// ─────────────────────────────────────────────────────────────

/**
 * Validate a single foreign key reference exists in the given table.
 * Uses the cached getAll (TTL-cached), so repeated calls in the same
 * request are cheap.
 *
 * @param table - The RTDB collection name to check.
 * @param id    - The record ID that must exist.
 * @returns {@link VALID} if the record exists, otherwise an error.
 *
 * @remarks
 * Side effects: reads from the RTDB (cached).
 */
export async function validateForeignKey(table: string, id: string): Promise<ValidationResult> {
  if (!id) return invalid('معرف المرجع مطلوب');
  const all = await getAll<Record<string, unknown>>(table, TTL.MEDIUM);
  const exists = all.some((r) => r.id === id);
  return exists ? VALID : invalid(`السجل "${id}" غير موجود في "${table}"`);
}

/**
 * Validate multiple foreign keys in a single pass (one getAll per table).
 * Returns the FIRST invalid result, or {@link VALID} if all pass.
 * Significantly more efficient than calling {@link validateForeignKey}
 * in a loop.
 *
 * @param references - An array of { table, id, label } descriptors.
 * @returns {@link VALID} if all references exist, otherwise the first error.
 *
 * @remarks
 * Side effects: reads from the RTDB (cached).
 */
export async function validateForeignKeys(
  references: Array<{ table: string; id: string; label: string }>,
): Promise<ValidationResult> {
  // Batch tables to avoid repeated getAll calls for the same table.
  const tableIds = new Map<string, Array<{ id: string; label: string }>>();
  for (const ref of references) {
    const existing = tableIds.get(ref.table);
    if (existing) {
      existing.push({ id: ref.id, label: ref.label });
    } else {
      tableIds.set(ref.table, [{ id: ref.id, label: ref.label }]);
    }
  }

  for (const [table, refs] of tableIds) {
    const all = await getAll<Record<string, unknown>>(table, TTL.MEDIUM);
    const idSet = new Set(all.map((r) => r.id));
    for (const ref of refs) {
      if (!idSet.has(ref.id)) {
        return invalid(`${ref.label} غير موجود (${table})`);
      }
    }
  }

  return VALID;
}

// ─────────────────────────────────────────────────────────────
//  Employee validation (non-throwing)
// ─────────────────────────────────────────────────────────────

/**
 * Validate an employee exists and is active (not suspended).
 * Delegates to the existing validate-employee module.
 *
 * @param employeeId - The employee ID to validate.
 * @returns {@link VALID} if the employee exists and is active, otherwise an error.
 *
 * @remarks
 * Side effects: reads from the RTDB (via validate-employee.ts).
 */
export async function validateEmployeeActive(employeeId: string): Promise<ValidationResult> {
  if (!employeeId) return invalid('معرف الموظف مطلوب');

  // Reuse the existing validation module — it checks existence + active status.
  const { validateEmployeeId } = await import('@/lib/validate-employee');
  const result = await validateEmployeeId(employeeId, true);
  return result.valid ? VALID : invalid(result.error ?? 'الموظف غير موجود أو غير نشط');
}

// ─────────────────────────────────────────────────────────────
//  Assert functions (throwing variants for concise API routes)
// ─────────────────────────────────────────────────────────────

/**
 * Assert that a record exists in the given table. Throws with a
 * human-readable Arabic error if not found.
 *
 * @param table  - The RTDB collection name to check.
 * @param id     - The record ID that must exist.
 * @param label  - Optional human-readable label for the error message (defaults to 'السجل').
 * @returns The existing record (never null).
 * @throws Error if the record does not exist.
 *
 * @remarks
 * Side effects: reads from the RTDB (cached).
 */
export async function assertEntityExists(
  table: string,
  id: string,
  label?: string,
): Promise<Record<string, unknown>> {
  const all = await getAll<Record<string, unknown>>(table, TTL.MEDIUM);
  const record = all.find((r) => r.id === id);
  if (!record) {
    throw new Error(`${label || 'السجل'} "${id}" غير موجود في "${table}"`);
  }
  return record;
}

/**
 * Assert that an employee exists (any status). Throws if not found.
 * Delegates to {@link assertEntityExists} on the 'employees' table.
 *
 * @param employeeId - The employee ID to check.
 * @returns The employee record (never null).
 * @throws Error if the employee does not exist.
 *
 * @remarks
 * Side effects: reads from the RTDB (cached).
 */
export async function assertEmployeeExists(
  employeeId: string,
): Promise<Record<string, unknown>> {
  return assertEntityExists('employees', employeeId, 'الموظف');
}

/**
 * Assert that an employee exists AND is not suspended. Throws if
 * the employee is not found or is suspended.
 *
 * @param employeeId - The employee ID to check.
 * @returns The employee record (never null, never suspended).
 * @throws Error if the employee does not exist or is suspended.
 *
 * @remarks
 * Side effects: reads from the RTDB (cached).
 */
export async function assertEmployeeActive(employeeId: string): Promise<Record<string, unknown>> {
  const record = await assertEntityExists('employees', employeeId, 'الموظف');
  if (record.isSuspended) {
    throw new Error(`الموظف "${record.name || employeeId}" موقوف`);
  }
  return record;
}
