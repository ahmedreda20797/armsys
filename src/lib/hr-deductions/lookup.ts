// ══════════════════════════════════════════════════════════════
//  HR Deductions — REQUEST-SCOPED LOOKUP (§HR-LOOKUP)
//
//  One read of the hrDeductions collection, grouped ONCE into an
//  employeeId → month index that every consumer in the SAME request
//  shares. Replaces the per-employee pattern:
//
//      for (const employee of employees) {
//        const all = await getAll(HR_DEDUCTIONS_TABLE);   // full table
//        const own  = all.filter((r) => r.employeeId === employee.id);
//      }
//
//  which re-downloaded (cache miss) and re-scanned (cache hit) the
//  WHOLE table once per employee — O(N×M) row visits for N employees
//  and M rows — with O(M) visits plus O(1) per employee here.
//
//  Deliberately NOT a cache:
//    • The lookup lives for ONE request (the caller holds it in a
//      local variable and passes it down) — no global or TTL state,
//      so permission-sensitive HR rows can never leak across requests
//      or viewers.
//    • The returned rows are the RAW stored records grouped by
//      reference — no status/archived/eligibility filtering happens
//      here. Every consumer keeps its EXISTING gate (the Hub counts
//      all statuses with a per-status breakdown; insights applies
//      isEffectiveHrDeduction). Zero semantic drift by construction.
//    • Rows are grouped in table-read order — the sequence each
//      consumer saw before is preserved exactly (no reordering, no
//      dedup, no zero-filling of missing months).
// ══════════════════════════════════════════════════════════════

import 'server-only';
import { getAll } from '@/lib/db';
import { HR_DEDUCTIONS_TABLE } from './domain';

/**
 * The raw hrDeductions row shape the lookup hands back: the stored
 * record with its synthetic id (lib/db injects it), plus the fields
 * downstream consumers read (aggregation, timeline, eligibility).
 * Extra stored fields ride along through the index signature — the
 * lookup never strips data.
 */
export interface HrDeductionRow {
  id: string;
  employeeId?: string | null;
  /** YYYY-MM — the canonical monthly identity of an HR deduction. */
  month?: string | null;
  amount?: number | null;
  unit?: string | null;
  status?: string | null;
  type?: string;
  deductionDate?: string | null;
  [field: string]: unknown;
}

export interface HrDeductionLookup {
  /** ALL rows for one employee (table-read order preserved). */
  forEmployee(employeeId: string): HrDeductionRow[];
  /** Rows for one employee + month (table-read order preserved). */
  forEmployeeMonth(employeeId: string, monthKey: string): HrDeductionRow[];
  /** Distinct employee ids present in the loaded rows. */
  employeeIds(): string[];
  /** Total rows indexed (diagnostics). */
  size(): number;
}

/**
 * PURE — group raw hrDeductions rows into the employee/month index.
 * Rows without a resolvable employeeId can never match any employee
 * query (every caller queries a concrete non-empty id) and are
 * dropped from the index — an absent index entry means "no rows",
 * never "zero-filled data".
 */
export function buildHrDeductionLookup(rows: ReadonlyArray<HrDeductionRow>): HrDeductionLookup {
  const byEmployee = new Map<string, HrDeductionRow[]>();
  for (const row of rows) {
    if (!row || typeof row.employeeId !== 'string' || row.employeeId.length === 0) continue;
    const list = byEmployee.get(row.employeeId) ?? [];
    list.push(row);
    byEmployee.set(row.employeeId, list);
  }

  return {
    forEmployee(employeeId: string): HrDeductionRow[] {
      return byEmployee.get(employeeId) ?? [];
    },
    forEmployeeMonth(employeeId: string, monthKey: string): HrDeductionRow[] {
      return (byEmployee.get(employeeId) ?? []).filter((r) => r.month === monthKey);
    },
    employeeIds(): string[] {
      return [...byEmployee.keys()];
    },
    size(): number {
      let count = 0;
      for (const list of byEmployee.values()) count += list.length;
      return count;
    },
  };
}

/**
 * DB-backed loader — ONE cached collection read (lib/db TTL) grouped
 * once. Callers building a MULTI-EMPLOYEE report load this ONCE per
 * request and pass it down; single-employee callers may keep loading
 * per call (the read itself is TTL-cached by lib/db either way).
 */
export async function loadHrDeductionLookup(): Promise<HrDeductionLookup> {
  const rows = await getAll<HrDeductionRow>(HR_DEDUCTIONS_TABLE);
  return buildHrDeductionLookup(rows);
}
