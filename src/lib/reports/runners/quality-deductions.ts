// ══════════════════════════════════════════════════════════════
//  Report Runner — Quality Deductions (Milestone 8 reference report)
//
//  Spec §10 business rules (binding):
//    • Quality Deductions are primarily DAY deductions; the monetary
//      amount is OPTIONAL. Days are never derived from money and
//      money is never derived from days — each is aggregated from
//      its own stored field.
//    • Financial impact and performance impact remain SEPARATE: a
//      monetary deduction must NOT automatically become a KPI
//      deduction. This runner computes NO KPI values whatsoever —
//      it is a pure consumer of stored qualityDeductions records.
//
//  Data source: the existing `qualityDeductions` collection (same
//  store the legacy monthly report and Employee 360 HR stats read).
//  No new persistence, no schema change, no write-on-read sync.
// ══════════════════════════════════════════════════════════════

import { getAll } from '@/lib/db';
import type { QualityDeduction } from '@/types';
import {
  isEffectiveDeduction, isArchivedDeduction, deductionTypeLabel, DEDUCTION_STATUS_LABELS,
  type DeductionApprovalStatus,
} from '@/lib/quality-deductions/domain';
import { applyEmployeeScope } from '../scope';
import type { ResolvedReportRequest } from '../scope';
import { loadEmployeeOrgRefs, employeeMatchesSearch, type EmployeeOrgRef } from '../employee-org';
import type { ReportDataModeInfo, ReportRunnerResult } from '../types';

/** The canonical store this report reads (echoed in response meta). */
export const QUALITY_DEDUCTIONS_SOURCE = 'qualityDeductions';

/** One report row: one stored deduction, employee-annotated. */
export interface QualityDeductionReportRow {
  id: string;
  employeeId: string;
  employeeName: string;
  /** Real org department label (org tree authority, stored fallback). */
  department: string | null;
  /** Real org team label (nearest team node), null when unassigned. */
  team: string | null;
  date: string;
  month: string;
  /** Human-readable category label (Arabic) — never the raw code. */
  category: string;
  /** Raw stored type code (kept for the category FILTER only). */
  typeCode: string;
  description: string;
  /** Primary impact: deducted DAYS (day-first rule). */
  deductionDays: number;
  /** OPTIONAL financial impact (EGP) — independent of days. */
  monetaryAmount: number;
  /** Evidence URL / text when stored on the discount. */
  evidence: string | null;
  /** Approval status (Arabic label; legacy = معتمد). */
  status: string;
  /** §ARCHIVE — true when the deduction is archived (historical only). */
  archived: boolean;
  relatedCapaId: string | null;
  createdAt: string;
}

/**
 * Pure aggregation over report rows. Summary keys are exactly the
 * declared availableMetrics ids of the report definition:
 *   deductionCount / totalDeductionDays / totalMonetaryAmount
 *
 * Rows with zero monetary amount still count their days; rows with
 * zero days still count their money. Nothing is invented: a missing
 * numeric field contributes 0.
 */
export function summarizeQualityDeductions(
  rows: ReadonlyArray<Pick<QualityDeductionReportRow, 'deductionDays' | 'monetaryAmount'>>,
): Record<string, number> {
  let totalDeductionDays = 0;
  let totalMonetaryAmount = 0;
  for (const r of rows) {
    totalDeductionDays += typeof r.deductionDays === 'number' ? r.deductionDays : 0;
    totalMonetaryAmount += typeof r.monetaryAmount === 'number' ? r.monetaryAmount : 0;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    deductionCount: rows.length,
    totalDeductionDays: round(totalDeductionDays),
    totalMonetaryAmount: round(totalMonetaryAmount),
  };
}

/**
 * Pure in-memory filtering of stored records against the resolved
 * request (scope, period, category filter). Malformed legacy dates
 * are excluded exactly like the canonical attendance adapters do
 * (isValidLegacyDate) — they can never match a calendar key.
 */
export function filterQualityDeductionRecords(
  records: ReadonlyArray<QualityDeduction>,
  employees: ReadonlyArray<EmployeeOrgRef>,
  resolved: ResolvedReportRequest,
): QualityDeductionReportRow[] {
  // §ARCHIVE — archived deductions appear ONLY when the filter
  // explicitly asks for them ('archived' | 'all'). Default = active.
  const archivedFilter =
    resolved.filters.archived === 'archived' || resolved.filters.archived === 'all'
      ? String(resolved.filters.archived)
      : 'active';

  // Scope + department + TEAM + SEARCH in one canonical mechanism
  // (applyEmployeeScope). The employee list is org-annotated by
  // loadEmployeeOrgRefs — department/team are the REAL assignments.
  const scopedEmployees = applyEmployeeScope(
    employees.filter((e) => employeeMatchesSearch(e, resolved.search)),
    resolved.employeeScope,
    resolved.department,
    resolved.team,
  );
  const byId = new Map(scopedEmployees.map((e) => [e.id, e]));

  const monthKeys = resolved.period.monthKeys ? new Set(resolved.period.monthKeys) : null;
  const categoryFilter =
    typeof resolved.filters.category === 'string' && resolved.filters.category.length > 0
      ? resolved.filters.category.toLowerCase()
      : null;

  const rows: QualityDeductionReportRow[] = [];
  for (const rec of records) {
    // §WORKFLOW — pending/rejected discounts are excluded from the
    // report entirely (legacy records without a status stay visible).
    // §ARCHIVE — archived records follow the archived filter.
    if (archivedFilter === 'active' && !isEffectiveDeduction(rec)) continue;
    if (archivedFilter !== 'active' && !isApprovedIgnoringArchive(rec)) continue;
    if (archivedFilter === 'archived' && !isArchivedDeduction(rec)) continue;

    // Employee scope + department + team + search.
    const emp = byId.get(rec.employeeId);
    if (!emp) continue;

    // Period: day range when supplied (operational semantics),
    // otherwise month keys (month-scoped semantics).
    if (resolved.period.range) {
      // Month-level filter via the reliable `month` field;
      // day-level refinement only for comparable YYYY-MM-DD dates.
      const recMonth = typeof rec.month === 'string' ? rec.month : '';
      if (monthKeys && !monthKeys.has(recMonth)) continue;
      const d = rec.date;
      if (d.length === 10) {
        if (d < resolved.period.range.fromDate || d > resolved.period.range.toDate) continue;
      } else {
        // Non-comparable date format in a day-range context:
        // cannot verify day-level inclusion → exclude.
        continue;
      }
    } else if (monthKeys) {
      if (typeof rec.month !== 'string' || !monthKeys.has(rec.month)) continue;
    }

    // Category/reason filter — matches the raw stored code OR its
    // Arabic label (the filter input is free text; both are legitimate).
    if (categoryFilter) {
      const recCategory = typeof rec.type === 'string' ? rec.type.toLowerCase() : '';
      const recLabel = deductionTypeLabel(rec.type).toLowerCase();
      if (!recCategory.includes(categoryFilter) && !recLabel.includes(categoryFilter)) continue;
    }

    rows.push({
      id: rec.id,
      employeeId: rec.employeeId,
      employeeName: emp.name,
      department: emp.department ?? null,
      team: emp.team ?? null,
      date: rec.date,
      month: typeof rec.month === 'string' ? rec.month : '',
      // §EXPORT-MAPPING — the human-readable label, never the raw key.
      category: deductionTypeLabel(rec.type),
      typeCode: typeof rec.type === 'string' ? rec.type : '',
      description: typeof rec.description === 'string' ? rec.description : '',
      deductionDays: typeof rec.deductionDays === 'number' ? rec.deductionDays : 0,
      monetaryAmount: typeof rec.deductionAmount === 'number' ? rec.deductionAmount : 0,
      evidence: typeof rec.evidence === 'string' && rec.evidence.trim() !== '' ? rec.evidence : null,
      status: DEDUCTION_STATUS_LABELS[
        (rec.approvalStatus as DeductionApprovalStatus) ?? 'approved'
      ] ?? 'معتمد',
      archived: isArchivedDeduction(rec),
      relatedCapaId: rec.relatedCapaId ?? null,
      createdAt: rec.createdAt,
    });
  }

  // Deterministic order: newest first, then employee name (Arabic
  // collation, matching the legacy report sort convention).
  rows.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.employeeName.localeCompare(b.employeeName, 'ar');
  });
  return rows;
}

/**
 * Approval-only gate for the archived/'all' report modes: archive
 * state must not filter here (the mode decided that), but the
 * approval workflow still applies. Mirrors projectDeductionStatus's
 * legacy rule (missing status = approved).
 */
function isApprovedIgnoringArchive(
  rec: Pick<QualityDeduction, 'approvalStatus'>,
): boolean {
  return (
    rec.approvalStatus === 'approved' ||
    (rec.approvalStatus !== 'draft' && rec.approvalStatus !== 'pending' && rec.approvalStatus !== 'rejected')
  );
}

/**
 * Thin orchestrator: batched canonical reads (one collection read +
 * the shared employee map — no N+1), then pure filtering/summary.
 * LIVE data mode: quality deductions have no monthly snapshot
 * store; this is current operational data by definition.
 */
export async function runQualityDeductionsReport(resolved: ResolvedReportRequest): Promise<ReportRunnerResult<QualityDeductionReportRow>> {
  const [records, employees] = await Promise.all([
    getAll<QualityDeduction>(QUALITY_DEDUCTIONS_SOURCE),
    loadEmployeeOrgRefs(),
  ]);

  const rows = filterQualityDeductionRecords(records, employees, resolved);
  const summary = summarizeQualityDeductions(rows);

  const dataMode: ReportDataModeInfo = {
    dataMode: 'live',
    scopeLabel: resolved.period.label,
    source: QUALITY_DEDUCTIONS_SOURCE,
  };

  return { rows, summary, hasData: rows.length > 0, dataMode };
}
