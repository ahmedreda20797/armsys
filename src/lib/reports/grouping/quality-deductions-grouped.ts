// ══════════════════════════════════════════════════════════════
//  Quality Deductions — EMPLOYEE-GROUPED projection (§11)
//
//  The report page previously rendered one FLAT row per stored
//  deduction, which forced managers to mentally re-aggregate per
//  employee. This module groups the SAME verified flat rows (the
//  output of filterQualityDeductionRecords — no second data path)
//  into one row per employee, with the deductions nested and a
//  readable multi-line "reasons" cell for Excel:
//
//     • 05/09/2026 — Late Response — 500 EGP
//     • 12/09/2026 — Quality Observation — 1.5 days
//
//  Pure functions only — unit-tested, ordering deterministic
//  (employees by total impact desc, deductions oldest→newest).
// ══════════════════════════════════════════════════════════════

import type { QualityDeductionReportRow } from '../runners/quality-deductions';

/** One nested deduction inside an employee group. */
export interface QualityDeductionGroupEntry {
  id: string;
  date: string;
  category: string;
  description: string;
  deductionDays: number;
  monetaryAmount: number;
  relatedCapaId: string | null;
}

/** One report row per EMPLOYEE (§11 master-row semantics). */
export interface QualityDeductionGroupRow {
  employeeId: string;
  employeeName: string;
  department: string | null;
  deductionCount: number;
  totalDeductionDays: number;
  totalMonetaryAmount: number;
  /** Excel cell: bulleted, chronological, one deduction per line. */
  reasons: string;
  details: QualityDeductionGroupEntry[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Build the bulleted multi-line reasons cell. Chronological
 * (oldest → newest), one line per deduction:
 *   • DD/MM/YYYY — category — amount/days
 */
export function buildReasonsCell(entries: ReadonlyArray<QualityDeductionGroupEntry>): string {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted
    .map((e) => {
      const impacts: string[] = [];
      if (e.monetaryAmount > 0) impacts.push(`${round(e.monetaryAmount)} EGP`);
      if (e.deductionDays > 0) impacts.push(`${round(e.deductionDays)} ${e.deductionDays === 1 ? 'day' : 'days'}`);
      const impactText = impacts.length > 0 ? ` — ${impacts.join(' / ')}` : '';
      return `• ${e.date} — ${e.category || 'خصم'}${impactText}`;
    })
    .join('\n');
}

/**
 * Group flat deduction rows by employee. Employees are ordered by
 * total impact: days first (the primary impact), then monetary
 * amount, then name (Arabic collation) — so the heaviest cases
 * surface at the top of the report.
 */
export function groupQualityDeductionsByEmployee(
  rows: ReadonlyArray<QualityDeductionReportRow>,
): QualityDeductionGroupRow[] {
  const byEmployee = new Map<string, QualityDeductionGroupRow>();

  for (const row of rows) {
    let group = byEmployee.get(row.employeeId);
    if (!group) {
      group = {
        employeeId: row.employeeId,
        employeeName: row.employeeName,
        department: row.department,
        deductionCount: 0,
        totalDeductionDays: 0,
        totalMonetaryAmount: 0,
        reasons: '',
        details: [],
      };
      byEmployee.set(row.employeeId, group);
    }
    group.deductionCount += 1;
    group.totalDeductionDays = round(group.totalDeductionDays + (row.deductionDays || 0));
    group.totalMonetaryAmount = round(group.totalMonetaryAmount + (row.monetaryAmount || 0));
    group.details.push({
      id: row.id,
      date: row.date,
      category: row.category,
      description: row.description,
      deductionDays: row.deductionDays,
      monetaryAmount: row.monetaryAmount,
      relatedCapaId: row.relatedCapaId,
    });
  }

  const groups = [...byEmployee.values()];
  for (const g of groups) {
    g.reasons = buildReasonsCell(g.details);
  }

  groups.sort((a, b) => {
    if (a.totalDeductionDays !== b.totalDeductionDays) return b.totalDeductionDays - a.totalDeductionDays;
    if (a.totalMonetaryAmount !== b.totalMonetaryAmount) return b.totalMonetaryAmount - a.totalMonetaryAmount;
    return a.employeeName.localeCompare(b.employeeName, 'ar');
  });
  return groups;
}
