// ══════════════════════════════════════════════════════════════
//  Responsible-team view model (§PROFILE-TEAM — pure, DB-free)
//
//  ONE canonical collection behind the profile page's "الفريق
//  المسؤول عنه" section. The old implementation kept a deduped flat
//  list NEXT TO independently recomputed per-team subtree counts,
//  and the UI rendered the whole flat list under EVERY team — the
//  displayed numbers and the rendered rows could never agree.
//
//  Canonical pipeline (all counts derive from the SAME final array):
//    raw relationships → canonical employee ids (deduplicated) →
//    ONE org group per employee (deepest managed ancestor) →
//    deterministic sort → capped → groups/counts derived from it.
//
//  DIRECT means the employee is attached to a node the user manages
//  THEMSELVES (the canonical manager relationship: orgNode's
//  managerUserId) — never inferred from department, team, branch or
//  subtree co-membership.
// ══════════════════════════════════════════════════════════════

import { subtreeIds, type OrgIndex } from './graph';
import { normalizeEmployeeStatus } from './employee-status';
import type { OrgNode } from './types';

/** Minimal employee slice the builder needs. Structural — the full
 *  Employee record satisfies it; keeps the org core decoupled. */
export interface ResponsibleEmployeeRef {
  id: string;
  name?: string | null;
  code?: string | null;
  orgNodeId?: string | null;
  status?: unknown;
}

/** One deduplicated employee placed in its canonical managed group. */
export interface ResponsibleTeamMember<T extends ResponsibleEmployeeRef = ResponsibleEmployeeRef> {
  /** The canonical employee record (render/label source). */
  ref: T;
  /** Id of the managed node this employee is grouped under. */
  nodeId: string;
  /** Attached directly to a node managed by the user themselves. */
  isDirect: boolean;
}

/** Managed org node with its member counts derived from the SAME
 *  canonical member array (Σ memberCount === members.length). */
export interface ResponsibleTeamGroup {
  node: OrgNode;
  memberCount: number;
  directCount: number;
}

export interface ResponsibleTeamViewModel<T extends ResponsibleEmployeeRef = ResponsibleEmployeeRef> {
  /** The authoritative collection — render EXACTLY these rows. */
  members: ResponsibleTeamMember<T>[];
  /** Groups in canonical Organization Tree order (zero-member nodes included). */
  groups: ResponsibleTeamGroup[];
  totalCount: number;
  totalDirectCount: number;
}

/**
 * Build the deduplicated, deterministically ordered responsible-team
 * view model. `managedNodes` must be pre-filtered by the caller to
 * the user's ACTIVE managed nodes (status/scope stays the caller's
 * concern); everything else is derived here. Pure — no reads.
 *
 * @param maxMembers hard bound applied AFTER dedup/grouping/sorting;
 *   every count is derived from the capped array so numbers always
 *   match the rendered rows.
 */
export function buildResponsibleTeamViewModel<T extends ResponsibleEmployeeRef>(
  orgIndex: OrgIndex,
  managedNodes: readonly OrgNode[],
  employees: readonly T[],
  maxMembers = Number.MAX_SAFE_INTEGER,
): ResponsibleTeamViewModel<T> {
  // Canonical tree order (depth-first traversal order of the graph
  // index). Nodes unreachable from a root (dirty data) keep a stable
  // name-ordered fallback after the reachable ones.
  const treeOrder = new Map(orgIndex.orderedIds.map((id, i) => [id, i]));
  const managedNodesOrdered = [...managedNodes].sort((a, b) => {
    const posA = treeOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const posB = treeOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (posA !== posB) return posA - posB;
    return (a.name || '').localeCompare(b.name || '', 'ar');
  });
  const managedNodeIds = new Set(managedNodesOrdered.map((n) => n.id));

  // Direct membership per org node. Archived employees are out of
  // the org (mirroring the archived-NODE filter on managedNodes).
  const employeesByNode = new Map<string, T[]>();
  for (const e of employees) {
    if (!e.orgNodeId) continue;
    if (normalizeEmployeeStatus(e.status) === 'archived') continue;
    const bucket = employeesByNode.get(e.orgNodeId) ?? [];
    bucket.push(e);
    employeesByNode.set(e.orgNodeId, bucket);
  }

  // Canonical group per employee: the DEEPEST managed node whose
  // subtree reaches the employee's own node (ties → tree order).
  // An employee reachable through several managed relationships
  // (department + managed branch + nested subtree) lands in exactly
  // ONE group — the most specific managed one — and appears exactly
  // once in the whole result set.
  const assignment = new Map<string, { nodeId: string; depth: number; treePos: number }>();
  for (const node of managedNodesOrdered) {
    const depth = orgIndex.depthOf.get(node.id) ?? 0;
    const treePos = treeOrder.get(node.id) ?? Number.MAX_SAFE_INTEGER;
    for (const subId of subtreeIds(orgIndex, node.id)) {
      for (const e of employeesByNode.get(subId) ?? []) {
        const prev = assignment.get(e.id);
        if (!prev || depth > prev.depth || (depth === prev.depth && treePos < prev.treePos)) {
          assignment.set(e.id, { nodeId: node.id, depth, treePos });
        }
      }
    }
  }

  const nameCompare = (a: T, b: T) =>
    (a.name || '').localeCompare(b.name || '', 'ar') ||
    (a.code ?? '').localeCompare(b.code ?? '', 'ar');

  const employeeById = new Map(employees.map((e) => [e.id, e]));
  const members = Array.from(assignment.entries())
    .map(([id, a]) => {
      const ref = employeeById.get(id);
      if (!ref) return null;
      const isDirect = ref.orgNodeId != null && managedNodeIds.has(ref.orgNodeId);
      return { ref, nodeId: a.nodeId, isDirect };
    })
    .filter((x): x is ResponsibleTeamMember<T> => x !== null)
    .sort((a, b) => {
      if (a.nodeId !== b.nodeId) {
        return (
          (treeOrder.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) -
          (treeOrder.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER)
        );
      }
      if (a.isDirect !== b.isDirect) return a.isDirect ? -1 : 1; // direct first
      return nameCompare(a.ref, b.ref);
    })
    .slice(0, maxMembers);

  // Group metadata derives from the SAME capped, sorted member array.
  const groups = managedNodesOrdered.map((node) => {
    const membersOfNode = members.filter((m) => m.nodeId === node.id);
    return {
      node,
      memberCount: membersOfNode.length,
      directCount: membersOfNode.filter((m) => m.isDirect).length,
    };
  });

  return {
    members,
    groups,
    totalCount: members.length,
    totalDirectCount: members.filter((m) => m.isDirect).length,
  };
}
