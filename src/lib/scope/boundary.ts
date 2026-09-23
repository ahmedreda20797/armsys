// ══════════════════════════════════════════════════════════════
//  §ORG-BOUNDARY — the Organizational Access Boundary (WHERE)
//
//  The authorization model keeps two EXPLICIT, separate concepts:
//
//    Organizational Boundary — WHERE the user's permissions apply
//                              (a set of canonical org node ids).
//    Data Scope              — HOW MUCH within that boundary
//                              (own/assigned/team/department/
//                              subtree/all — resolved in ./index).
//
//  The boundary is a set of org NODE ids from the ONE canonical
//  Organization Tree (never names, never a parallel hierarchy) and
//  supports MULTIPLE nodes for one user — Company A, Company B or
//  the General Administration root — without duplicate accounts.
//
//  RESOLUTION TIERS (mirrors the permission tiers):
//
//    admin      — the System Owner bypass: every root of the tree.
//    override   — explicit per-user boundary (users.
//                 orgBoundaryNodeIds) configured in the Permission
//                 Manager. Authoritative when present: ids that no
//                 longer resolve to nodes are DROPPED, and an
//                 override whose ids all vanished resolves EMPTY
//                 (fail-closed) — it never falls through to the
//                 assignment tier, which would silently broaden.
//    assignment — derived from the user's Organization Tree
//                 placement: nodes the user MANAGES
//                 (OrgNode.managerUserId) ∪ the linked employee's
//                 own node. Exact nodes — never a typed ancestor
//                 (a subteam manager's boundary is that subteam,
//                 not its parent team).
//    unresolved — no override, no placement, manages nothing:
//                 EMPTY boundary → every bounded scope fails
//                 closed to the own-record minimum.
//
//  This module is PURE (no DB, no Firebase) — the server wrapper
//  (./server) loads the inputs from the canonical tables.
// ══════════════════════════════════════════════════════════════

import { buildOrgIndex, type OrgEmployeeRef, type OrgNode } from '@/lib/organization';
import { resolveOrgNodeLevel, type OrgNodeLevel } from '@/lib/organization/levels';

/** Where the effective boundary came from (§boundary must show its source). */
export type OrgBoundarySource = 'admin' | 'override' | 'assignment' | 'unresolved';

/** The resolved organizational access boundary for one viewer. */
export interface OrgBoundary {
  source: OrgBoundarySource;
  /** Canonical org node ids (empty for the unresolved boundary). */
  nodeIds: string[];
}

/** The viewer slice the boundary resolver needs. */
export interface BoundaryViewer {
  userId: string;
  role: string;
  linkedEmployeeId?: string | null;
  /**
   * Explicit per-user boundary override (users.orgBoundaryNodeIds).
   * null/undefined/empty = INHERIT ("تلقائي — من التعيين التنظيمي"):
   * the assignment tier decides.
   */
  orgBoundaryNodeIds?: string[] | null;
}

/** The inputs the boundary resolver needs (already loaded). */
export interface BoundaryInputs {
  orgNodes: OrgNode[];
  employees: OrgEmployeeRef[];
}

/**
 * Resolve the viewer's organizational access boundary. Pure.
 * Fails closed: an unresolvable boundary is EMPTY — it never falls
 * back to "the whole tree" for a non-admin viewer.
 */
export function resolveOrgBoundary(viewer: BoundaryViewer, inputs: BoundaryInputs): OrgBoundary {
  const index = buildOrgIndex(inputs.orgNodes);

  // Tier 0 — the single admin bypass (same tier as verifyPermission).
  if (viewer.role === 'admin') {
    return { source: 'admin', nodeIds: [...(index.childrenOf.get(null) ?? [])] };
  }

  // Tier 1 — explicit override. Present-but-unresolvable stays
  // explicit (and empty): falling through to the assignment tier
  // would silently WIDEN access.
  if (Array.isArray(viewer.orgBoundaryNodeIds) && viewer.orgBoundaryNodeIds.length > 0) {
    const valid = [...new Set(viewer.orgBoundaryNodeIds.filter((id) => index.byId.has(id)))];
    return { source: 'override', nodeIds: valid };
  }

  // Tier 2 — assignment-derived: managed nodes ∪ the linked
  // employee's own node (EXACT nodes, no ancestor climbing).
  const ids = new Set<string>();
  for (const node of inputs.orgNodes) {
    if (node.managerUserId === viewer.userId && index.byId.has(node.id)) ids.add(node.id);
  }
  if (viewer.linkedEmployeeId) {
    const ownNodeId = inputs.employees.find((e) => e.id === viewer.linkedEmployeeId)?.orgNodeId;
    if (ownNodeId && index.byId.has(ownNodeId)) ids.add(ownNodeId);
  }
  if (ids.size === 0) return { source: 'unresolved', nodeIds: [] };
  return { source: 'assignment', nodeIds: [...ids] };
}

/** Boundary explanation row for explainable UI (Permission Manager). */
export interface OrgBoundaryNodeSummary {
  id: string;
  name: string;
  level: OrgNodeLevel;
}

export interface OrgBoundaryExplanation {
  source: OrgBoundarySource;
  /** Resolved nodes with their semantic level + display name. */
  nodes: OrgBoundaryNodeSummary[];
}

/**
 * Explain the effective boundary — the same resolution the scope
 * engine enforces, plus display facts. Pure; the Permission Manager
 * consumes this so display can never diverge from enforcement.
 */
export function explainOrgBoundary(viewer: BoundaryViewer, inputs: BoundaryInputs): OrgBoundaryExplanation {
  const boundary = resolveOrgBoundary(viewer, inputs);
  const index = buildOrgIndex(inputs.orgNodes);
  const nodes: OrgBoundaryNodeSummary[] = [];
  for (const id of boundary.nodeIds) {
    const node = index.byId.get(id);
    const level = resolveOrgNodeLevel(index, id);
    if (node && level) nodes.push({ id, name: node.name, level });
  }
  return { source: boundary.source, nodes };
}

/** Arabic label of a boundary source (§boundary source display). */
export function describeBoundarySource(source: OrgBoundarySource): string {
  const labels: Record<OrgBoundarySource, string> = {
    admin: 'مالك النظام — كامل الهيكل',
    override: 'تجاوز مباشر (محدد في مدير الصلاحيات)',
    assignment: 'تلقائي — من التعيين التنظيمي',
    unresolved: 'تعذر الحل — مقيد',
  };
  return labels[source];
}
