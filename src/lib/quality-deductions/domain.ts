// ══════════════════════════════════════════════════════════════
//  Quality Deductions — SHARED domain vocabulary
//
//  ONE source of truth for:
//    • The stored type codes → human-readable Arabic labels
//      (exports, reports, chips and UI badges all read THIS map —
//      raw internal keys like `quality_issue` never reach a report
//      again).
//    • The approval workflow status vocabulary + the legacy-safe
//      effectiveness gate used by EVERY aggregation point (reports,
//      stats, employee-360, risk center, KPI master).
//
//  Approval doctrine (§WORKFLOW): a Quality Discount is NOT active
//  until it is APPROVED. Pending/rejected discounts must never affect
//  reports, totals, payroll or employee records.
//
//  Legacy safety: records created before the workflow have NO
//  approvalStatus field. They were all live at the time, so a missing
//  status projects to 'approved' — no data migration is REQUIRED for
//  correctness (scripts/migrate-quality-deduction-approval.ts
//  backfills anyway so new code can trust the field).
// ══════════════════════════════════════════════════════════════

import type { ApprovalEvent } from '@/lib/approvals/types';

/** The canonical RTDB table for quality discounts (payroll domain). */
export const QUALITY_DEDUCTIONS_TABLE = 'qualityDeductions';

/** Stored `type` codes → Arabic display labels. */
export const DEDUCTION_TYPE_LABELS: Record<string, string> = {
  quality_issue: 'مشكلة جودة',
  safety: 'سلامة',
  compliance: 'التزام',
};

/**
 * Human-readable label for a stored deduction type. Unknown / empty
 * codes fall back to the generic 'جودة' label — an internal key is
 * never shown to a business user.
 */
export function deductionTypeLabel(type: string | null | undefined): string {
  if (!type) return DEDUCTION_TYPE_LABELS.quality_issue;
  return DEDUCTION_TYPE_LABELS[type] ?? 'جودة';
}

/** Full discount lifecycle (UI-facing status vocabulary). */
export type DeductionApprovalStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/** Arabic labels for the approval statuses. */
export const DEDUCTION_STATUS_LABELS: Record<DeductionApprovalStatus, string> = {
  draft: 'مسودة',
  pending: 'قيد الاعتماد',
  approved: 'معتمد',
  rejected: 'مرفوض',
};

/**
 * Project the fast-query approval status of a discount.
 * A record with no status (legacy) or an empty history is APPROVED.
 */
export function projectDeductionStatus(
  record: { approvalStatus?: string | null; approvalHistory?: ApprovalEvent[] | null } | null | undefined,
): DeductionApprovalStatus {
  if (!record) return 'approved';
  const explicit = record.approvalStatus;
  if (explicit === 'draft' || explicit === 'pending' || explicit === 'approved' || explicit === 'rejected') {
    return explicit;
  }
  return 'approved';
}

/**
 * THE effectiveness gate. Every aggregation of quality discounts
 * (reports, home stats, employee-360, risk center, legacy monthly
 * report, KPI master) must pass records through this predicate so a
 * pending/rejected discount never affects any number.
 *
 * §ARCHIVE — an ARCHIVED discount is history, not an active
 * liability: it is excluded from every ACTIVE/current total and
 * KPI-affecting aggregation by default. Historical views that
 * explicitly request archived records use dedicated period-scoped
 * paths (report 'archived' filter).
 *
 * Legacy records (no approvalStatus) remain effective.
 */
export function isEffectiveDeduction(
  record: { approvalStatus?: string | null; archived?: boolean } | null | undefined,
): boolean {
  if (record?.archived === true) return false;
  return projectDeductionStatus(record) === 'approved';
}

/** §ARCHIVE — archived discounts stay auditable, never active. */
export function isArchivedDeduction(
  record: { archived?: boolean } | null | undefined,
): boolean {
  return record?.archived === true;
}

/** True when the record still awaits a decision (new workflow only). */
export function isPendingDeduction(
  record: { approvalStatus?: string | null } | null | undefined,
): boolean {
  return projectDeductionStatus(record) === 'pending';
}
