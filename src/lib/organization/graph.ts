// ══════════════════════════════════════════════════════════════
//  Organization graph engine — Milestone 10 (PURE functions)
//
//  All hierarchy math lives here as pure, DB-free functions so it is
//  unit-testable and reusable by the scope engine, the notification
//  router, the impact preview and the organization UI. Nothing in
//  this file reads or writes Firebase.
//
//  HISTORICAL INTEGRITY (mandatory principle):
//    Moving a node or an employee changes the RELATIONSHIP only.
//    Historical records (month snapshots, closed months, audit
//    trails) already freeze denormalized display strings at their
//    creation time and are never rewritten by this engine. The
//    employee's free-text `department`/`position` strings are NOT
//    rewritten either — orgNodeId is the single relationship
//    pointer (see buildEmployeeMovePatch).
// ══════════════════════════════════════════════════════════════

import type {
  OrgEmployeeRef,
  OrgImpactPreview,
  OrgNode,
  OrgNodeType,
  OrgTreeNode,
} from './types';

/** Maximum hierarchy depth (root = depth 0). Guards runaway nesting. */
export const MAX_ORG_DEPTH = 10;

export interface OrgIndex {
  byId: Map<string, OrgNode>;
  /** parentId (null for roots) → ordered child ids. */
  childrenOf: Map<string | null, string[]>;
  depthOf: Map<string, number>;
  /** Stable traversal order: registry order, then `order`, then name. */
  orderedIds: string[];
}

/**
 * Build the immutable index every other helper consumes. Cycles and
 * unknown parents are quarantined (treated as roots) instead of
 * throwing — the tree must always render, even with dirty data.
 */
export function buildOrgIndex(nodes: OrgNode[]): OrgIndex {
  const sorted = [...nodes].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return (a.name || '').localeCompare(b.name || '', 'ar');
  });

  const byId = new Map<string, OrgNode>();
  const childrenOf = new Map<string | null, string[]>();
  for (const node of sorted) {
    byId.set(node.id, node);
  }
  for (const node of sorted) {
    const parentKey = node.parentId && byId.has(node.parentId) ? node.parentId : null;
    const bucket = childrenOf.get(parentKey) ?? [];
    bucket.push(node.id);
    childrenOf.set(parentKey, bucket);
  }

  // Depth via BFS from the (sanitized) roots — cycle members never
  // get a depth and are therefore unreachable through traversal.
  const depthOf = new Map<string, number>();
  const roots = childrenOf.get(null) ?? [];
  const queue: Array<{ id: string; depth: number }> = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    depthOf.set(id, depth);
    for (const childId of childrenOf.get(id) ?? []) {
      if (!depthOf.has(childId)) queue.push({ id: childId, depth: depth + 1 });
    }
  }

  const orderedIds: string[] = [];
  const walk = (parent: string | null) => {
    for (const id of childrenOf.get(parent) ?? []) {
      orderedIds.push(id);
      walk(id);
    }
  };
  walk(null);

  return { byId, childrenOf, depthOf, orderedIds };
}

/** Ids of the node's entire subtree, including itself. Missing node → empty set. */
export function subtreeIds(index: OrgIndex, nodeId: string): Set<string> {
  const out = new Set<string>();
  if (!index.byId.has(nodeId)) return out;
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (out.has(current)) continue;
    out.add(current);
    for (const childId of index.childrenOf.get(current) ?? []) stack.push(childId);
  }
  return out;
}

/** Ancestor ids from ROOT down to the node's parent (excludes self). */
export function ancestorIds(index: OrgIndex, nodeId: string): string[] {
  const chain: string[] = [];
  let current = index.byId.get(nodeId)?.parentId ?? null;
  const guard = new Set<string>([nodeId]);
  while (current && index.byId.has(current) && !guard.has(current)) {
    chain.unshift(current);
    guard.add(current);
    current = index.byId.get(current)?.parentId ?? null;
  }
  return chain;
}

/** True when `descendantId` lies inside `ancestorId`'s subtree. */
export function isDescendantOf(index: OrgIndex, descendantId: string, ancestorId: string): boolean {
  return ancestorId !== descendantId && subtreeIds(index, ancestorId).has(descendantId);
}

/**
 * Nearest node of the given type on the path root→self (the node
 * itself counts). Unknown/custom types never match — callers fall
 * back to the node itself.
 */
export function findAncestorOfType(index: OrgIndex, nodeId: string, type: OrgNodeType): OrgNode | null {
  const self = index.byId.get(nodeId);
  if (!self) return null;
  if (self.type === type) return self;
  for (const ancestorId of ancestorIds(index, nodeId)) {
    const ancestor = index.byId.get(ancestorId);
    if (ancestor && ancestor.type === type) return ancestor;
  }
  return null;
}

export type MoveValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validate a MOVE before it is applied (Organization Impact /
 * safe-mutation principle). Blocks:
 *   • moving a node into itself
 *   • moving a node into its own subtree (cycle)
 *   • moving under a missing or archived parent
 *   • exceeding MAX_ORG_DEPTH after the move
 */
export function validateMoveNode(index: OrgIndex, nodeId: string, newParentId: string | null): MoveValidation {
  const node = index.byId.get(nodeId);
  if (!node) return { ok: false, reason: 'العقدة غير موجودة' };
  if (newParentId === nodeId) return { ok: false, reason: 'لا يمكن نقل العقدة إلى نفسها' };
  if (newParentId !== null) {
    const parent = index.byId.get(newParentId);
    if (!parent) return { ok: false, reason: 'العقدة الأصل غير موجودة' };
    if (parent.status === 'archived') return { ok: false, reason: 'لا يمكن النقل إلى عقدة مؤرشفة' };
    if (isDescendantOf(index, newParentId, nodeId)) {
      return { ok: false, reason: 'لا يمكن نقل العقدة داخل مسارها الخاص (سيكل)' };
    }
  }
  const parentDepth = newParentId === null ? -1 : (index.depthOf.get(newParentId) ?? 0);
  const height = subtreeHeight(index, nodeId);
  if (parentDepth + height + 1 > MAX_ORG_DEPTH) {
    return { ok: false, reason: `العمق الأقصى للهيكل هو ${MAX_ORG_DEPTH} مستويات` };
  }
  return { ok: true };
}

/** Height of the subtree rooted at nodeId (single node = 0). */
function subtreeHeight(index: OrgIndex, nodeId: string): number {
  let max = 0;
  for (const childId of index.childrenOf.get(nodeId) ?? []) {
    max = Math.max(max, subtreeHeight(index, childId) + 1);
  }
  return max;
}

/**
 * Manager USER ids from the node UP to the root (the reporting
 * chain). Deduplicated, order = nearest manager first. This is how
 * organization-aware notification routing finds "the responsible
 * manager" without any stored duplicate list.
 */
export function resolveManagerChain(index: OrgIndex, nodeId: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const self = index.byId.get(nodeId);
  const path = self ? [...ancestorIds(index, nodeId), nodeId] : [];
  for (let i = path.length - 1; i >= 0; i--) {
    const node = index.byId.get(path[i]);
    const managerId = node?.managerUserId;
    if (managerId && !seen.has(managerId)) {
      seen.add(managerId);
      out.push(managerId);
    }
  }
  return out;
}

/** Direct membership: nodeId → employee ids assigned to that node. */
export function groupEmployeesByNode(employees: OrgEmployeeRef[]): Map<string, string[]> {
  const byNode = new Map<string, string[]>();
  for (const employee of employees) {
    if (!employee.orgNodeId) continue;
    const bucket = byNode.get(employee.orgNodeId) ?? [];
    bucket.push(employee.id);
    byNode.set(employee.orgNodeId, bucket);
  }
  return byNode;
}

/** Employees inside the node's subtree (relationship-based resolution). */
export function employeeIdsInSubtree(index: OrgIndex, nodeId: string, byNode: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const id of subtreeIds(index, nodeId)) {
    out.push(...(byNode.get(id) ?? []));
  }
  return out;
}

/**
 * Organization Impact Preview — what a reorganization would affect.
 * Pure; computed BEFORE any mutation so the UI can ask for
 * confirmation ("43 employee records will inherit a different
 * scope") and the audit trail can record it.
 *
 * managerUserIds = managers whose managed scope changes:
 *   • managers of nodes INSIDE the moved subtree (they move with it)
 *   • managers up the node's CURRENT ancestor chain (their scope
 *     loses/gains the subtree)
 */
export function previewOrgImpact(index: OrgIndex, nodeId: string, byNode: Map<string, string[]>): OrgImpactPreview | null {
  const node = index.byId.get(nodeId);
  if (!node) return null;
  const subtree = subtreeIds(index, nodeId);
  const managerUserIds: string[] = [];
  const pushManager = (managerId: string | null | undefined) => {
    if (managerId && !managerUserIds.includes(managerId)) managerUserIds.push(managerId);
  };
  for (const id of subtree) {
    pushManager(index.byId.get(id)?.managerUserId);
  }
  for (const ancestorId of ancestorIds(index, nodeId)) {
    pushManager(index.byId.get(ancestorId)?.managerUserId);
  }
  return {
    nodeId,
    nodeName: node.name,
    subtreeNodeCount: subtree.size,
    employeeCount: employeeIdsInSubtree(index, nodeId, byNode).length,
    managerUserIds,
  };
}

/** Build the nested read model (roots → children, ordered). */
export function buildOrgTree(index: OrgIndex, byNode: Map<string, string[]>): OrgTreeNode[] {
  const build = (nodeId: string): OrgTreeNode => {
    const node = index.byId.get(nodeId)!;
    const children = (index.childrenOf.get(nodeId) ?? []).map(build);
    const employeeCount = (byNode.get(nodeId) ?? []).length;
    const subtreeEmployeeCount =
      employeeCount + children.reduce((sum, child) => sum + child.subtreeEmployeeCount, 0);
    return { ...node, children, employeeCount, subtreeEmployeeCount };
  };
  return (index.childrenOf.get(null) ?? []).map(build);
}

/**
 * HISTORICAL-INTEGRITY GUARD: the ONLY field an employee move may
 * touch. Moving an employee updates the relationship pointer so
 * scope resolution follows automatically; it never rewrites the
 * employee's free-text department/position strings and never
 * touches snapshots or historical records.
 */
export function buildEmployeeMovePatch(orgNodeId: string | null): { orgNodeId: string | null } {
  return { orgNodeId };
}
