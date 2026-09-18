// ══════════════════════════════════════════════════════════════
//  Report employee context — ORG-AWARE labels (Qnlys milestone)
//
//  ONE mechanism that resolves every employee's REAL organization
//  assignment for report filtering:
//    • department = nearest DEPARTMENT org-node name (org tree is
//      the authority) with the employee's stored free-text
//      `department` as fallback for legacy records.
//    • team = nearest TEAM org-node name (subteam employees roll up
//      to their parent team), null when unassigned.
//    • searchKey = normalized "name + code" blob for name search.
//
//  Pure resolution over canonically loaded records — no N+1 reads,
//  no duplicated org logic (reuses lib/organization/graph).
// ══════════════════════════════════════════════════════════════

import { getAll } from '@/lib/db';
import type { Employee } from '@/types';
import { buildOrgIndex, findAncestorOfType, type OrgIndex } from '@/lib/organization/graph';
import type { OrgNode } from '@/lib/organization/types';
import { normalizeForSearch } from '@/lib/search/search-normalize';

const ORG_NODES_TABLE = 'orgNodes';

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

/** Pure label resolution for one employee against a built org index. */
export function resolveEmployeeOrgLabels(
  index: OrgIndex,
  employee: Pick<Employee, 'id' | 'name' | 'code' | 'department' | 'orgNodeId'>,
): { department: string | null; team: string | null } {
  const nodeId = employee.orgNodeId ?? null;
  if (!nodeId) {
    return { department: employee.department ?? null, team: null };
  }
  const deptNode = findAncestorOfType(index, nodeId, 'department');
  const teamNode = findAncestorOfType(index, nodeId, 'team');
  return {
    // The org tree is authoritative when present; the stored string
    // remains the fallback so legacy records keep their label.
    department: deptNode?.name ?? employee.department ?? null,
    team: teamNode?.name ?? null,
  };
}

/** Build the org index once for a batch of label resolutions. */
export function buildEmployeeOrgIndex(nodes: ReadonlyArray<OrgNode>): OrgIndex {
  return buildOrgIndex([...nodes]);
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
    const labels = resolveEmployeeOrgLabels(index, e);
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
