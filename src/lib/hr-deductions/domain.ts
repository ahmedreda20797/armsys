// ══════════════════════════════════════════════════════════════
//  HR Deductions — SHARED domain vocabulary
//
//  Mirrors quality-deductions/domain.ts: ONE effectiveness gate
//  every aggregation of hrDeductions (reports, home stats,
//  employee-360, risk center, management reporting) must use, so a
//  pending/rejected/archived deduction never affects any number.
//
//  §ARCHIVE — an archived HR deduction is historical: excluded from
//  every ACTIVE/current total by default, still auditable.
// ══════════════════════════════════════════════════════════════

/** The canonical RTDB table for HR deductions. */
export const HR_DEDUCTIONS_TABLE = 'hrDeductions';

export type HrDeductionStatus = 'pending' | 'approved' | 'rejected';

export const HR_DEDUCTION_STATUS_LABELS: Record<HrDeductionStatus, string> = {
  pending: 'قيد الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

/**
 * THE effectiveness gate for HR deductions. Legacy records without
 * an explicit status were live at the time → treated as approved.
 */
export function isEffectiveHrDeduction(
  record: { status?: string | null; archived?: boolean } | null | undefined,
): boolean {
  if (record?.archived === true) return false;
  return record?.status ? record.status === 'approved' : true;
}

/** §ARCHIVE — archived HR deductions stay auditable, never active. */
export function isArchivedHrDeduction(
  record: { archived?: boolean } | null | undefined,
): boolean {
  return record?.archived === true;
}
