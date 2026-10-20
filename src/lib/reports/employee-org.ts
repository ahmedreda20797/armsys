// ══════════════════════════════════════════════════════════════
//  Report employee context — ORG-AWARE labels (Qnalys milestone)
//
//  THE canonical read-side import surface for employee organization
//  resolution. The PURE label/context logic lives in lib/organization/
//  labels (cycle-free, unit-tested) and is re-exported here — the
//  historical import path every report consumer already uses:
//
//    resolveEmployeeOrgLabels / resolveEmployeeOrgLabelsMap
//    resolveEmployeeOrganizationContext / buildEmployeeOrgIndex
//
//  DB-bound helpers (kept here, the only db-coupled part):
//    • loadOrgIndex() — ONE cached orgNodes read → shared index
//    • loadEmployeeOrgRefs() — annotated refs for report filtering
//
//  Semantics (mirrors lib/organization/labels):
//    • department = nearest DEPARTMENT node name → the node's own
//      name (creation-time rule); stored free-text string ONLY for
//      employees without a node (or an empty tree).
//    • team = nearest TEAM node name (subteams roll up), null else.
//    • dangling orgNodeId (populated tree, missing node) → null +
//      orgUnavailable — controlled unavailable, never legacy text.
//    • searchKey = normalized "name + code" blob for name search.
//
//  Batched reads only — no N+1, no duplicated org logic.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import type { Employee } from '@/types';
import {
  buildEmployeeOrgIndex,
  resolveEmployeeOrgLabels,
  type EmployeeOrgInput,
} from '@/lib/organization/labels';
import type { OrgIndex } from '@/lib/organization/graph';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization/types';
import { normalizeForSearch } from '@/lib/search/search-normalize';

// ── ONE resolver: the pure implementations are the canonical ones ──
export {
  resolveEmployeeOrgLabels,
  resolveEmployeeOrgLabelsMap,
  resolveEmployeeOrganizationContext,
  buildEmployeeOrgIndex,
} from '@/lib/organization/labels';
export type {
  EmployeeOrgInput,
  EmployeeOrgLabels,
  EmployeeOrganizationContext,
} from '@/lib/organization/labels';

/** An employee annotated with its real org labels for report filters. */
export interface EmployeeOrgRef {
  id: string;
  name: string;
  code: string | null;
  /** Org-tree department label, falling back to the stored string. */
  department: string | null;
  /** Nearest team node label (subteams roll up), null when none. */
  team: string | null;
  orgNodeId: string | null;
  /** Normalized "name code" blob for name search. */
  searchKey: string;
}

/**
 * Load the org tree index ONCE (one cached batched read) — the shared
 * entry point for every list/route that resolves employee labels.
 * Tolerates a missing table result (mocked/legacy environments) by
 * yielding an EMPTY index, for which the resolver keeps legacy labels.
 */
export async function loadOrgIndex(): Promise<OrgIndex> {
  const nodes = await getAll<OrgNode>(ORG_NODES_TABLE, TTL.MEDIUM);
  return buildEmployeeOrgIndex(nodes);
}

/**
 * Load employees + org nodes canonically (two batched reads) and
 * annotate every employee with its real org labels + search key.
 */
export async function loadEmployeeOrgRefs(): Promise<EmployeeOrgRef[]> {
  const [employees, nodes] = await Promise.all([
    getAll<Employee>('employees'),
    getAll<OrgNode>(ORG_NODES_TABLE),
  ]);
  const index = buildEmployeeOrgIndex(nodes);
  return employees.map((e) => {
    const labels = resolveEmployeeOrgLabels(index, e as EmployeeOrgInput);
    const code = e.code ?? null;
    return {
      id: e.id,
      name: e.name,
      code,
      department: labels.department,
      team: labels.team,
      orgNodeId: e.orgNodeId ?? null,
      searchKey: normalizeForSearch(`${e.name} ${code ?? ''}`),
    };
  });
}

/**
 * Substring match against the normalized name+code blob. Diacritic
 * and Alef-variant insensitive via the shared search normalizer.
 */
export function employeeMatchesSearch(
  employee: Pick<EmployeeOrgRef, 'searchKey'>,
  search: string | null | undefined,
): boolean {
  if (typeof search !== 'string' || search.trim().length === 0) return true;
  const needle = normalizeForSearch(search.trim());
  if (needle.length === 0) return true;
  return employee.searchKey.includes(needle);
}

/** Unique sorted department labels from the given employees. */
export function uniqueDepartments(employees: ReadonlyArray<EmployeeOrgRef>): string[] {
  return [...new Set(employees.map((e) => e.department).filter((d): d is string => !!d && d.trim() !== ''))].sort((a, b) => a.localeCompare(b, 'ar'));
}

/** Unique sorted team labels from the given employees. */
export function uniqueTeams(employees: ReadonlyArray<EmployeeOrgRef>): string[] {
  return [...new Set(employees.map((e) => e.team).filter((t): t is string => !!t && t.trim() !== ''))].sort((a, b) => a.localeCompare(b, 'ar'));
}
