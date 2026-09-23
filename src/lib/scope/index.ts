// ══════════════════════════════════════════════════════════════
//  DATA SCOPE ENGINE — Milestone 10 (PURE functions)
//                      + §ORG-BOUNDARY (WHERE × HOW-MUCH split)
//
//  Permission answers "WHAT can the user do?"
//  Organizational Boundary answers "WHERE does it apply?"
//  Data Scope answers      "HOW MUCH within that boundary?"
//
//  The scope vocabulary lives on the permission entry
//  (PagePermission.scope, src/config/permissions.ts). This module
//  resolves a configured scope against the viewer's ORGANIZATIONAL
//  ACCESS BOUNDARY (./boundary — canonical org node ids) and the
//  ORGANIZATION GRAPH into a concrete employee-id set —
//  relationship-based, never a stored duplicate list of ids. When an
//  employee moves between nodes, every scope that resolves through
//  the tree follows automatically.
//
//  DEFAULT IS FAIL-CLOSED (M0.3): the employees entry of the HR and
//  quality presets carries scope 'all', the manager preset carries
//  'subtree', and every other non-admin entry without a configured
//  scope resolves to 'own' (FAIL_CLOSED_SCOPE) — NEVER silently
//  'all'. Viewers without a linked employee therefore resolve an
//  EMPTY set for people-based scopes until an administrator
//  configures a wider scope. The admin role ALWAYS resolves 'all'
//  unrestricted — same bypass as verifyPermission.
//
//  §ORG-BOUNDARY — THE INVARIANT: the resolved employee set is
//  ALWAYS a subset of the boundary's subtree union, plus the viewer's
//  own record (and explicitly assigned pairs). No scope can escape
//  the boundary; a boundary the viewer cannot resolve fails closed.
//
//  Anchor semantics (viewer = user with optional linkedEmployeeId):
//    all        — no additional narrowing WITHIN the boundary: the
//                 union of the boundary nodes' subtrees. ALL never
//                 means "ignore the boundary" (a Company-A boundary
//                 + ALL is Company A only; General Administration +
//                 ALL is the whole organization). An UNRESOLVABLE
//                 boundary fails closed to the own-record minimum.
//    own        — only the linked employee record (EXACTLY one
//                 identity: users.linkedEmployeeId; no linkage →
//                 empty set — never a team/department fallback)
//    team       — the DIRECT members of the boundary's EXACT
//                 team/subteam-level node(s): the viewer's own org
//                 node when team/subteam-typed, and team/subteam
//                 nodes the viewer MANAGES. §TEAM-EXACT: TEAM is the
//                 exact node — it NEVER expands into descendant
//                 subteams (that is SUBTREE's meaning) and never
//                 climbs to a parent team, a department or a
//                 sibling. A boundary with no team-level node
//                 contributes no team anchor (fail-closed → own
//                 record only).
//    department — the full membership per the tree of the
//                 boundary's DEPARTMENT-level node(s) (the node
//                 itself + its teams/subteams). No department-level
//                 boundary node → no department anchor (fail-closed
//                 → own record only) — never the company/root node.
//    subtree    — the boundary nodes + ALL their descendants ∪ own
//                 (§SUBTREE = selected node + descendants — the
//                 parent-team manager's view; §MANAGED-BRANCHES
//                 resolves through the boundary's managed nodes).
//    assigned   — employees with an active assignment to the viewer
//                 (caller-supplied) ∪ own
//
//  Every non-'all' scope always includes the viewer's own linked
//  employee record. Viewers without a linked employee resolve to an
//  EMPTY set for people-based scopes (fail-closed) — they see no
//  employee rows until an administrator links or widens their scope.
// ══════════════════════════════════════════════════════════════

import {
  explainScopeResolution,
  type DataScope,
  type PermissionsMap,
  type ScopeResolutionSource,
} from '@/config/permissions';
import {
  buildOrgIndex,
  employeeIdsInSubtree,
  groupEmployeesByNode,
  subtreeIds,
  type OrgEmployeeRef,
  type OrgIndex,
  type OrgNode,
} from '@/lib/organization';
import { resolveOrgNodeLevel } from '@/lib/organization/levels';
import { resolveOrgBoundary, type OrgBoundary, type BoundaryViewer } from './boundary';

/** The viewer identity slice the engine needs (no permissions here — they arrive separately). */
export interface ScopeViewer extends BoundaryViewer {
  userId: string;
  role: string;
  /** Optional employee ↔ user linkage (users.linkedEmployeeId). */
  linkedEmployeeId?: string | null;
}

/** An assignment relationship (e.g. a follow-up assigned to a user for an employee). */
export interface ScopeAssignment {
  employeeId: string;
  assignedToUserId: string;
}

export interface ScopeInputs {
  orgNodes: OrgNode[];
  employees: OrgEmployeeRef[];
  assignments?: ScopeAssignment[];
}

/** The boundary decision carried on the scope context (§explainable). */
export interface ScopeBoundaryInfo {
  source: OrgBoundary['source'];
  nodeIds: string[];
}

/** Resolved, page-scoped employee access for one viewer. */
export interface EmployeeScopeContext {
  scope: DataScope;
  pageKey: string;
  /** Structured audit result — where the decision came from (M0.3). */
  source: ScopeResolutionSource;
  /** The organizational boundary the scope resolved against (§ORG-BOUNDARY). */
  boundary: ScopeBoundaryInfo;
  /** True for the admin bypass — every employee passes without materializing ids. */
  isUnrestricted: boolean;
  /** Employee ids the viewer may touch (empty set when unrestricted — use includes()). */
  employeeIds: ReadonlySet<string>;
  includes(employeeId: string): boolean;
}

const UNRESTRICTED = (pageKey: string, source: ScopeResolutionSource): EmployeeScopeContext => {
  const ctx: EmployeeScopeContext = {
    scope: 'all',
    pageKey,
    source,
    boundary: { source: 'admin', nodeIds: [] },
    isUnrestricted: true,
    employeeIds: new Set<string>(),
    includes: () => true,
  };
  return ctx;
};

/**
 * Resolve the viewer's employee scope for a page from the EFFECTIVE
 * permission map, the ORGANIZATIONAL BOUNDARY and the organization
 * graph. Pure — DB reads happen in the caller (API route), which
 * keeps the admin fast path (no reads at all).
 */
export function resolveEmployeeScope(
  viewer: ScopeViewer,
  pageKey: string,
  permissions: PermissionsMap | null | undefined,
  inputs: ScopeInputs,
): EmployeeScopeContext {
  // Same bypass tier as verifyPermission — admin resolves 'all'
  // unrestricted. The structured result carries the decision source
  // for auditing.
  const resolution = explainScopeResolution(permissions, pageKey, viewer.role);
  if (resolution.scope === 'all' && viewer.role === 'admin') {
    return UNRESTRICTED(pageKey, resolution.source);
  }
  const scope = resolution.scope;

  const index = buildOrgIndex(inputs.orgNodes);
  const byNode = groupEmployeesByNode(inputs.employees);
  const ownId = viewer.linkedEmployeeId || null;
  const ids = new Set<string>();
  if (ownId) ids.add(ownId);

  // §ORG-BOUNDARY — WHERE first, then HOW MUCH inside it.
  const boundary = resolveOrgBoundary(viewer, inputs);
  const boundaryInfo: ScopeBoundaryInfo = { source: boundary.source, nodeIds: [...boundary.nodeIds] };

  /** Employees in the union of the boundary nodes' subtrees. */
  const boundarySubtreeIds = (): string[] => {
    const out: string[] = [];
    for (const nodeId of boundary.nodeIds) {
      for (const id of employeeIdsInSubtree(index, nodeId, byNode)) out.push(id);
    }
    return out;
  };

  switch (scope) {
    case 'own':
      break; // linked employee only (already added)

    case 'team':
    case 'department': {
      // §TEAM-EXACT / §DEPARTMENT-EXACT — the anchors are the
      // boundary nodes THEMSELVES at the scope's level:
      //   team       → DIRECT members of team/subteam-typed boundary
      //                nodes (no descendants — a parent team's
      //                subteam members are SUBTREE territory).
      //   department → full per-tree membership of department-typed
      //                boundary nodes (their teams and subteams
      //                belong to the department by the tree).
      // Boundary nodes at OTHER levels contribute nothing (a
      // company/team boundary has no department inside it at the
      // node level; a department/company boundary has no single
      // exact team) — fail-closed to the own record. Managed
      // branches ride INSIDE the boundary: managed team/subteam
      // nodes feed TEAM, managed departments feed DEPARTMENT, and
      // every managed node is a boundary node.
      for (const nodeId of boundary.nodeIds) {
        const level = resolveOrgNodeLevel(index, nodeId);
        if (scope === 'team') {
          if (level === 'team' || level === 'subteam') {
            for (const id of byNode.get(nodeId) ?? []) ids.add(id);
          }
        } else if (level === 'department') {
          for (const id of employeeIdsInSubtree(index, nodeId, byNode)) ids.add(id);
        }
      }
      break;
    }

    case 'subtree': {
      // §SUBTREE — the boundary nodes plus ALL their descendants ∪
      // own. A user who manages no nodes and has no placement keeps
      // the fail-closed minimum (empty boundary → own only); never a
      // silent downgrade to 'own' when the boundary resolves.
      for (const id of boundarySubtreeIds()) ids.add(id);
      break;
    }

    case 'all': {
      // §ALL — "no additional organizational narrowing within the
      // boundary": the union of the boundary subtrees. ALL does NOT
      // ignore the boundary (Company A + ALL ≠ Company B) and does
      // NOT resolve when the boundary cannot (fail-closed → own
      // record only — never a silent org-wide grant).
      if (boundary.source !== 'unresolved') {
        for (const id of boundarySubtreeIds()) ids.add(id);
      }
      break;
    }

    case 'assigned': {
      for (const assignment of inputs.assignments ?? []) {
        if (assignment.assignedToUserId === viewer.userId) ids.add(assignment.employeeId);
      }
      break;
    }
  }

  return {
    scope,
    pageKey,
    source: resolution.source,
    boundary: boundaryInfo,
    isUnrestricted: false,
    employeeIds: ids,
    includes: (employeeId: string) => ids.has(employeeId),
  };
}

/** Filter an employee list down to the viewer's scope. */
export function filterEmployeesByScope<T extends { id: string }>(employees: T[], ctx: EmployeeScopeContext): T[] {
  if (ctx.isUnrestricted) return employees;
  return employees.filter((e) => ctx.employeeIds.has(e.id));
}

/** Nodes whose subtree contains the given employee (for explanations/UI). */
export function nodesContainingEmployee(index: OrgIndex, orgNodeId: string | null): string[] {
  if (!orgNodeId || !index.byId.has(orgNodeId)) return [];
  return [...subtreeIds(index, orgNodeId)];
}

const SCOPE_LABELS_AR: Record<DataScope, string> = {
  all: 'الكل (داخل الحد التنظيمي)',
  department: 'القسم المحدد',
  team: 'الفريق المحدد فقط',
  subtree: 'العقدة والفروع التابعة',
  assigned: 'المسند إليّ',
  own: 'سجلي فقط',
};

/** Arabic label for explainable UI. */
export function describeDataScope(scope: DataScope): string {
  return SCOPE_LABELS_AR[scope];
}
