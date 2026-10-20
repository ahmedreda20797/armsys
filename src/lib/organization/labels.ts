// ══════════════════════════════════════════════════════════════
//  §ORG-LABELS — canonical employee organization label resolution
//  (PURE — no Firebase, no db imports, no import cycles)
//
//  The Organization Tree is the single source of an employee's
//  CURRENT organizational identity:
//
//    Employee.orgNodeId → Organization Tree node → labels
//
//    • department = nearest DEPARTMENT node name; when the node has
//      no department ancestor, the node's OWN name (identical to the
//      creation-time rule resolveDepartmentDisplayName — a team
//      hanging off the company root IS the label). The stored
//      free-text `department` is used ONLY when the employee has no
//      orgNodeId (legacy, never organization-managed) or when the
//      tree itself is EMPTY (no organization data exists at all).
//    • team = nearest TEAM node name (subteams roll up to their
//      parent team), null when none.
//    • a DANGLING orgNodeId (node deleted from a populated tree)
//      resolves to null + orgUnavailable — a controlled "organization
//      unavailable" state, never a silent legacy-text fallback.
//
//  This module is the ONE label resolver. lib/reports/employee-org
//  re-exports it (that path remains the import surface for the
//  read-side contract); db.ts consumes it directly because the
//  reports barrel is db-bound (import cycle).
// ══════════════════════════════════════════════════════════════

import {
  ancestorIds,
  buildOrgIndex,
  findAncestorOfType,
  type OrgIndex,
} from './graph';
import { findAncestorAtLevel, resolveOrgNodeLevel, type OrgNodeLevel } from './levels';
import type { OrgNode } from './types';

/**
 * The minimal employee slice every resolver here accepts. Deliberately
 * looser than Employee: raw RTDB records (rules engine, batch loads)
 * may lack `department`/`name`/`code` — only id is truly required.
 */
export type EmployeeOrgInput = {
  id: string;
  department?: string | null;
  orgNodeId?: string | null;
  name?: string | null;
  code?: string | null;
};

/** Resolved label pair (orgUnavailable marks a dangling orgNodeId). */
export interface EmployeeOrgLabels {
  department: string | null;
  team: string | null;
  /** orgNodeId is set but the node no longer exists (needs correction). */
  orgUnavailable: boolean;
}

/** Pure label resolution for one employee against a built org index. */
export function resolveEmployeeOrgLabels(index: OrgIndex, employee: EmployeeOrgInput): EmployeeOrgLabels {
  const nodeId = employee.orgNodeId ?? null;
  if (!nodeId) {
    // Legacy employee, never organization-managed: the stored free-text
    // string is the only data that exists.
    return { department: employee.department ?? null, team: null, orgUnavailable: false };
  }
  if (index.byId.size === 0) {
    // No organization data exists at all (fresh install / legacy
    // environment): the relationship cannot resolve either way — the
    // stored string keeps the display alive. A POPULATED tree with a
    // missing node is the dangling case below.
    return { department: employee.department ?? null, team: null, orgUnavailable: false };
  }
  const node = index.byId.get(nodeId);
  if (!node) {
    // Dangling pointer inside a populated tree: controlled unavailable
    // state — NEVER a silent fallback to the legacy string (the
    // employee IS organization-managed; its tree relationship is
    // broken and must be surfaced for correction).
    return { department: null, team: null, orgUnavailable: true };
  }
  const deptNode = findAncestorOfType(index, nodeId, 'department');
  const teamNode = findAncestorOfType(index, nodeId, 'team');
  return {
    // The tree is authoritative whenever the node exists; the node's
    // own name covers assignments without a department ancestor
    // (same rule as creation-time resolveDepartmentDisplayName).
    department: deptNode?.name ?? node.name,
    team: teamNode?.name ?? null,
    orgUnavailable: false,
  };
}

/**
 * Batch label resolution for employee lists: Map<employeeId, labels>.
 * Pure over the shared index — no per-row reads, no N+1.
 */
export function resolveEmployeeOrgLabelsMap(
  index: OrgIndex,
  employees: ReadonlyArray<EmployeeOrgInput>,
): Map<string, EmployeeOrgLabels> {
  const out = new Map<string, EmployeeOrgLabels>();
  for (const employee of employees) {
    out.set(employee.id, resolveEmployeeOrgLabels(index, employee));
  }
  return out;
}

/** Canonical current-organization context of one employee. */
export interface EmployeeOrganizationContext {
  orgNodeId: string | null;
  node: OrgNode | null;
  /** Semantic level via the §ORG-LEVELS normalization layer. */
  nodeLevel: OrgNodeLevel | null;
  company: string | null;
  department: string | null;
  team: string | null;
  subteam: string | null;
  /** Nearest managing USER up the chain (self node first). */
  managerUserId: string | null;
  managerUserName: string | null;
  /** Node names, root → self. Empty when unassigned/unavailable. */
  path: string[];
  /** orgNodeId set but node missing (needs data correction). */
  orgUnavailable: boolean;
}

const EMPTY_ORG_CONTEXT: Omit<EmployeeOrganizationContext, 'department'> = {
  orgNodeId: null,
  node: null,
  nodeLevel: null,
  company: null,
  team: null,
  subteam: null,
  managerUserId: null,
  managerUserName: null,
  path: [],
  orgUnavailable: false,
};

/**
 * Rich canonical organization context for employee headers (Employee
 * 360, Performance Hub, profile). Levels come from the normalization
 * layer — never guessed from node names; the company is the nearest
 * node (self → root) whose SEMANTIC level is 'company' (legacy GA
 * roots stay General Administration, not "the company").
 */
export function resolveEmployeeOrganizationContext(
  index: OrgIndex,
  employee: EmployeeOrgInput,
): EmployeeOrganizationContext {
  const nodeId = employee.orgNodeId ?? null;
  if (!nodeId) {
    return { ...EMPTY_ORG_CONTEXT, department: employee.department ?? null };
  }
  const node = index.byId.get(nodeId);
  if (!node) {
    return { ...EMPTY_ORG_CONTEXT, orgNodeId: nodeId, orgUnavailable: true, department: null };
  }
  const labels = resolveEmployeeOrgLabels(index, employee);

  // Nearest manager: self → root, first node carrying managerUserId.
  let managerUserId: string | null = null;
  let managerUserName: string | null = null;
  const chainIds = [...ancestorIds(index, nodeId), nodeId];
  for (let i = chainIds.length - 1; i >= 0; i--) {
    const n = index.byId.get(chainIds[i]);
    if (n?.managerUserId) {
      managerUserId = n.managerUserId;
      managerUserName = n.managerUserName ?? n.managerUserId;
      break;
    }
  }

  return {
    orgNodeId: nodeId,
    node,
    nodeLevel: resolveOrgNodeLevel(index, nodeId),
    company: findAncestorAtLevel(index, nodeId, 'company')?.name ?? null,
    department: labels.department,
    team: labels.team,
    subteam: findAncestorOfType(index, nodeId, 'subteam')?.name ?? null,
    managerUserId,
    managerUserName,
    path: chainIds
      .map((id) => index.byId.get(id)?.name)
      .filter((n): n is string => typeof n === 'string'),
    orgUnavailable: false,
  };
}

/** Build the org index once for a batch of label resolutions. */
export function buildEmployeeOrgIndex(nodes: ReadonlyArray<OrgNode> | null | undefined): OrgIndex {
  return buildOrgIndex([...(nodes ?? [])]);
}
