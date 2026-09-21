// ══════════════════════════════════════════════════════════════
//  Employee ↔ Organization assignment helpers (Qnlys milestone)
//
//  ONE pure layer over the canonical org graph (lib/organization/
//  graph) that every employee-org assignment surface shares:
//
//    • POST /api/employees            — validate the requested node
//                                       + derive the display label
//    • /api/employees/org-nodes       — (client mirrors these rules)
//                                       department → dependent team
//                                       suggestions
//    • the employee form picker       — same derivation for rendering
//
//  The graph engine stays the ONLY hierarchy authority; nothing here
//  reads or writes Firebase and no second org model is introduced.
//
//  SEMANTICS (aligned with reports/employee-org.ts — the existing
//  read-side contract):
//    • department label of an assignment = nearest DEPARTMENT-type
//      ancestor (the node itself counts).
//    • team options under a department = the department's subtree
//      restricted to team/subteam types (any depth — nested subteams
//      are preserved, never flattened).
// ══════════════════════════════════════════════════════════════

import {
  buildOrgIndex,
  subtreeIds,
  findAncestorOfType,
  type OrgIndex,
} from './graph';
import type { OrgNode, OrgNodeType } from './types';

/**
 * Minimal org-node slice the employee form's assignment picker needs
 * (the shape /api/employees/org-nodes returns). Deliberately excludes
 * manager/description metadata — the picker is an employees-workflow
 * surface, not the organization management page. `OrgNode` satisfies
 * this structurally, so every helper below accepts BOTH the full
 * server model and the DTO slice.
 */
export interface OrgAssignmentNode {
  id: string;
  name: string;
  type: OrgNodeType;
  parentId: string | null;
  status: string;
  order: number;
}

/**
 * The graph engine only reads identity/hierarchy fields (id, name,
 * type, parentId, order, status) — everything OrgAssignmentNode
 * carries — so the DTO slice feeds it safely.
 */
function toGraphIndex(nodes: ReadonlyArray<OrgAssignmentNode>): OrgIndex {
  return buildOrgIndex(nodes as unknown as OrgNode[]);
}

/** Assignment validation outcome (Arabic reasons — user-facing). */
export type OrgAssignmentValidation =
  | { ok: true; node: OrgAssignmentNode }
  | { ok: false; reason: string };

/**
 * Validate that `nodeId` is a legal CURRENT assignment target:
 * the node must exist and be active. `null` is always legal
 * (unassigned / department-only is decided by the caller's shape,
 * not here). This is the server-side rule the move route already
 * enforces inline — extracted so employee creation validates
 * identically (server is authoritative; client labels are never
 * trusted).
 */
export function validateOrgAssignmentTarget(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  nodeId: string,
): OrgAssignmentValidation {
  const index: OrgIndex = toGraphIndex(nodes);
  const node = index.byId.get(nodeId);
  if (!node) {
    return { ok: false, reason: 'العقدة التنظيمية غير موجودة' };
  }
  if (node.status === 'archived') {
    return { ok: false, reason: 'لا يمكن إسناد موظف إلى عقدة مؤرشفة' };
  }
  return { ok: true, node };
}

/**
 * Display label of the department an assignment lands in: the
 * nearest DEPARTMENT-type node on the root→self path (self counts).
 * Falls back to the node's own name when no department ancestor
 * exists (e.g. a team hanging directly off the company root) and to
 * null when the node itself is missing.
 */
export function resolveDepartmentDisplayName(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  nodeId: string,
): string | null {
  const index: OrgIndex = toGraphIndex(nodes);
  const node = index.byId.get(nodeId);
  if (!node) return null;
  const deptNode = findAncestorOfType(index, nodeId, 'department');
  return deptNode?.name ?? node.name;
}

/**
 * Ids of the team/subteam nodes inside a department's subtree — the
 * exact candidate set for the dependent team selector. The department
 * id itself is never included; unknown department → empty set.
 */
export function teamNodeIdsInDepartment(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  departmentId: string,
): string[] {
  const index: OrgIndex = toGraphIndex(nodes);
  const department = index.byId.get(departmentId);
  if (!department) return [];
  const out: string[] = [];
  for (const id of subtreeIds(index, departmentId)) {
    if (id === departmentId) continue;
    const node = index.byId.get(id);
    if (node && (node.type === 'team' || node.type === 'subteam')) out.push(id);
  }
  return out;
}

/**
 * True when `teamNodeId` is a legal team under `departmentId` (a
 * team/subteam inside the department's subtree, or the department
 * itself for department-only assignments). Guards the dependent
 * selector: a team selected under a previous department never
 * survives a department change.
 */
export function isTeamInDepartment(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  departmentId: string,
  teamNodeId: string,
): boolean {
  if (teamNodeId === departmentId) return true;
  const index: OrgIndex = toGraphIndex(nodes);
  const team = index.byId.get(teamNodeId);
  if (!team) return false;
  return subtreeIds(index, departmentId).has(teamNodeId);
}

/**
 * Derive the (department, team) selector pair for an EXISTING
 * orgNodeId — the edit-dialog projection of the canonical pointer.
 *   • team = the node itself when it is a team/subteam
 *   • department = nearest department ancestor (self when the node
 *     IS a department — department-only assignment)
 *   • a node with no department ancestor (company / root-hung team)
 *     projects department = null: the picker shows it as
 *     "assigned outside any department" rather than inventing one.
 */
export function projectAssignmentForPicker(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  orgNodeId: string | null | undefined,
): { departmentId: string | null; teamNodeId: string | null } {
  if (!orgNodeId) return { departmentId: null, teamNodeId: null };
  const index: OrgIndex = toGraphIndex(nodes);
  const node = index.byId.get(orgNodeId);
  if (!node) return { departmentId: null, teamNodeId: null };
  if (node.type === 'team' || node.type === 'subteam') {
    const deptNode = findAncestorOfType(index, orgNodeId, 'department');
    return { departmentId: deptNode?.id ?? null, teamNodeId: orgNodeId };
  }
  if (node.type === 'department') {
    return { departmentId: orgNodeId, teamNodeId: null };
  }
  // company / unknown custom type — no department projection.
  return { departmentId: null, teamNodeId: null };
}

/** Human-readable node path for suggestion rows: "الأب › الابن". */
export function buildNodePathLabel(
  nodes: ReadonlyArray<OrgAssignmentNode>,
  nodeId: string,
  maxSegments = 3,
): string {
  const index: OrgIndex = toGraphIndex(nodes);
  const node = index.byId.get(nodeId);
  if (!node) return '';
  const chain: string[] = [];
  let current: OrgNode | undefined = node;
  const guard = new Set<string>();
  while (current && !guard.has(current.id) && chain.length < maxSegments) {
    guard.add(current.id);
    chain.unshift(current.name);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return chain.join(' › ');
}
