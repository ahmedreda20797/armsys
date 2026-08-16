// ══════════════════════════════════════════════════════════════
//  Admin approved-observation override policy — PURE functions
//
//  Governs the Phase 1 hardening rule: an Admin may edit/delete an
//  APPROVED observation ONLY when its month is OPEN.
//
//    • Non-KPI edits (notes, evidence, corrective action, …) keep the
//      approval intact — the KPI contribution is unchanged.
//    • KPI-affecting edits (points, applyPointDeduction, isBonus,
//      categoryId, employeeId, observationDate/month) INVALIDATE the
//      approval: the previous approval stays in history, a new event
//      describing the admin modification is appended, and the projected
//      status resets to 'pending' so the canonical KPI engine stops
//      counting the observation until a fresh Manager/Admin approval.
//
//  The closed-month lock is ABSOLUTE and enforced by the API route via
//  isMonthClosed() BEFORE this policy is consulted — no role bypasses it.
//
//  No I/O here: the route wires these pure decisions to the DB.
// ══════════════════════════════════════════════════════════════

import {
  makeApprovalEvent,
  appendApprovalEvent,
  projectLatestApprovalStatus,
} from '@/lib/approvals';
import type { ApprovalEvent } from '@/lib/approvals/types';
import type { ApprovalStatus, QualityObservation } from '@/types/quality-kpi';

/** Fields that change an observation's KPI contribution when modified. */
export const KPI_AFFECTING_FIELDS = [
  'applyPointDeduction',
  'points',
  'isBonus',
  'categoryId',
  'employeeId',
  'observationDate',
] as const;

export type KpiAffectingField = (typeof KPI_AFFECTING_FIELDS)[number];

/** Only the admin role may modify an approved observation. */
export function canModifyApprovedObservation(role: string | null | undefined): boolean {
  return role === 'admin';
}

/** Coerce a patch value for comparison with the stored value. */
function normalizeForCompare(field: KpiAffectingField, value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  switch (field) {
    case 'points':
      return Number(value);
    case 'applyPointDeduction':
    case 'isBonus':
      return Boolean(value);
    default:
      return String(value);
  }
}

/**
 * List the KPI-affecting fields present in the patch whose value actually
 * DIFFERS from the stored observation. A patch that repeats identical
 * values is not a KPI-affecting change.
 */
export function changedKpiFields(
  existing: Pick<QualityObservation, KpiAffectingField | 'month'>,
  patch: Record<string, unknown>,
): KpiAffectingField[] {
  const changed: KpiAffectingField[] = [];
  for (const field of KPI_AFFECTING_FIELDS) {
    if (patch[field] === undefined) continue;
    const before = normalizeForCompare(field, (existing as Record<string, unknown>)[field]);
    const after = normalizeForCompare(field, patch[field]);
    if (before !== after) changed.push(field);
  }
  // A date change only affects KPI attribution when it moves the month.
  if (changed.includes('observationDate')) {
    const before = normalizeForCompare('observationDate', (existing as Record<string, unknown>).observationDate);
    const after = normalizeForCompare('observationDate', patch.observationDate);
    const sameMonth =
      String(before ?? '').slice(0, 7) === String(after ?? '').slice(0, 7) ||
      deriveMonthSafe(String(before)) === deriveMonthSafe(String(after));
    if (sameMonth) {
      // Same month → date is not KPI-affecting; drop it from the list.
      return changed.filter((f) => f !== 'observationDate');
    }
  }
  return changed;
}

/** Derive a YYYY-MM month key from DD/MM/YYYY or ISO-ish input; '' on failure. */
function deriveMonthSafe(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length === 3) return `${parts[2]}-${parts[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}/.test(dateStr)) return dateStr.slice(0, 7);
  return '';
}

/** Human-readable summary of the changed KPI values (before → after). */
export function describeKpiChanges(
  existing: QualityObservation,
  patch: Record<string, unknown>,
  changed: KpiAffectingField[],
): string {
  if (changed.length === 0) return '';
  const parts = changed.map((field) => {
    const before = (existing as unknown as Record<string, unknown>)[field];
    const after = patch[field];
    return `${field}: ${String(before)} ← ${String(after)}`;
  });
  return parts.join('، ');
}

/** Result of applying the admin edit policy to an approved observation. */
export interface AdminEditPolicyResult {
  /** True when KPI-affecting values changed and the approval must reset. */
  kpiReset: boolean;
  /** Projected approval status after the policy ('pending' when reset). */
  approvalStatus: ApprovalStatus;
  /** New append-only history (previous events always preserved). */
  approvalHistory: ApprovalEvent[];
  /** KPI fields that changed (empty for non-KPI edits). */
  changedFields: KpiAffectingField[];
  /** Human-readable before → after summary for audit trails. */
  changeSummary: string;
}

/**
 * Decide how an ADMIN edit affects an approved observation.
 *
 * Non-KPI patch  → approval stays 'approved', history untouched.
 * KPI patch      → append a 'reopen' approval event (projects to 'pending')
 *                  carrying the admin actor, the change summary, and the
 *                  points magnitude when points changed. The previous
 *                  approve/reject events remain in the history verbatim.
 */
export function applyAdminEditPolicy(
  existing: QualityObservation,
  patch: Record<string, unknown>,
  actor: { id: string; name: string },
  now: Date = new Date(),
): AdminEditPolicyResult {
  const changedFields = changedKpiFields(existing, patch);

  if (changedFields.length === 0) {
    return {
      kpiReset: false,
      approvalStatus: existing.approvalStatus,
      approvalHistory: existing.approvalHistory || [],
      changedFields: [],
      changeSummary: '',
    };
  }

  const changeSummary = describeKpiChanges(existing, patch, changedFields);
  const pointsChanged = changedFields.includes('points');

  const resetEvent = makeApprovalEvent({
    action: 'reopen',
    actorId: actor.id,
    actorName: actor.name,
    notes: `إبطال الاعتماد بواسطة مدير النظام بعد تعديل قيم مؤثرة على المؤشر (${changeSummary}) — يتطلب اعتماداً جديداً`,
    ...(pointsChanged
      ? {
          pointsBefore: Number((existing as unknown as Record<string, unknown>).points),
          pointsAfter: Number(patch.points),
        }
      : {}),
    now,
  });

  const approvalHistory = appendApprovalEvent(existing.approvalHistory || [], resetEvent);

  return {
    kpiReset: true,
    approvalStatus: projectLatestApprovalStatus(approvalHistory), // → 'pending'
    approvalHistory,
    changedFields,
    changeSummary,
  };
}
