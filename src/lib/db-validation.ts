// ══════════════════════════════════════════════════════════════
//  Foreign-key validation — server-side (Security rule)
//
//  Every write must verify that referenced entities exist (and are
//  in an acceptable state) BEFORE persisting. This prevents orphan
//  records and invalid references.
//
//  All functions return a simple { valid, error? } result. They
//  are reusable by any module that needs FK integrity checks.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/** Valid result shorthand. */
export const VALID: ValidationResult = { valid: true };

/** Invalid result shorthand. */
function invalid(error: string): ValidationResult {
  return { valid: false, error };
}

/**
 * Validate a single foreign key reference exists in the given table.
 * Uses the cached getAll (TTL-cached), so repeated calls in the same
 * request are cheap.
 */
export async function validateForeignKey(table: string, id: string): Promise<ValidationResult> {
  if (!id) return invalid('معرف المرجع مطلوب');
  const all = await getAll<Record<string, unknown>>(table, TTL.MEDIUM);
  const exists = all.some((r) => r.id === id);
  return exists ? VALID : invalid(`السجل "${id}" غير موجود في "${table}"`);
}

/**
 * Validate multiple foreign keys in a single pass (one getAll per table).
 * Returns the FIRST invalid result, or VALID if all pass.
 * Significantly more efficient than calling validateForeignKey in a loop.
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

/**
 * Validate an employee exists and is active (not suspended).
 * Reuses the existing validate-employee module where possible.
 *
 * @returns VALID if the employee is in good standing.
 */
export async function validateEmployeeActive(employeeId: string): Promise<ValidationResult> {
  if (!employeeId) return invalid('معرف الموظف مطلوب');

  // Reuse the existing validation module — it checks existence + active status.
  const { validateEmployeeId } = await import('@/lib/validate-employee');
  const result = await validateEmployeeId(employeeId, true);
  return result.valid ? VALID : invalid(result.error ?? 'الموظف غير موجود أو غير نشط');
}
