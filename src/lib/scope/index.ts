// ══════════════════════════════════════════════════════════════
//  DATA SCOPE ENGINE — Milestone 10 (PURE functions)
//
//  Permission answers "WHAT can the user do?"
//  Data scope answers  "on WHOSE data can the user do it?"
//
//  The scope vocabulary lives on the permission entry
//  (PagePermission.scope, src/config/permissions.ts). This module
//  resolves a configured scope against the ORGANIZATION GRAPH into
//  a concrete employee-id set — relationship-based, never a stored
//  duplicate list of ids. When an employee moves between nodes,
//  every scope that resolves through the tree follows
//  automatically.
//
//  DEFAULT IS FAIL-CLOSED (M0.3): the employees entry of the HR and
//  quality presets carries scope 'all' (workforce administration /
//  org-wide monitoring), the manager preset carries 'subtree'
//  (managed org nodes ∪ own — assignment-driven, never role→data),
//  and every other non-admin entry without a configured scope
//  resolves to 'own' (FAIL_CLOSED_SCOPE) — NEVER silently 'all'.
//  Viewers without a linked employee therefore resolve an EMPTY set
//  for people-based scopes until an administrator configures a wider
//  scope. The admin role ALWAYS resolves 'all' — same bypass as
//  verifyPermission.
//
//  Anchor semantics (viewer = user with optional linkedEmployeeId):
//    all        — unrestricted
//    own        — only the linked employee record
//    team       — subtree of the viewer's canonical TEAM anchor
//                 ∪ subtrees of TEAM/SUBTEAM nodes the viewer MANAGES
//                 The anchor = nearest team-typed ancestor of the
//                 linked employee's node (the node itself when it is
//                 team-typed; else the node itself as fallback). A
//                 managed subteam is a team-level branch (the type
//                 vocabulary is "vocabulary, not structure").
//    department — subtree of the linked employee's DEPARTMENT node
//                 (nearest department-type ancestor, else the node)
//                 ∪ subtrees of DEPARTMENT nodes the viewer MANAGES
//    subtree    — subtree of the viewer's OWN organization node
//                 ∪ subtrees of nodes the viewer MANAGES
//                 (managerUserId === viewer.userId) ∪ own
//                 (§SUBTREE = own node + descendants; §MANAGED-BRANCHES
//                 = managed nodes — both resolve here)
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
  findAncestorOfType,
  groupEmployeesByNode,
  subtreeIds,
  type OrgEmployeeRef,
  type OrgIndex,
  type OrgNode,
} from '@/lib/organization';

/** The viewer identity slice the engine needs (no permissions here — they arrive separately). */
export interface ScopeViewer {
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

/** Resolved, page-scoped employee access for one viewer. */
export interface EmployeeScopeContext {
  scope: DataScope;
  pageKey: string;
  /** Structured audit result — where the decision came from (M0.3). */
  source: ScopeResolutionSource;
  /** True for 'all' — every employee passes without materializing ids. */
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
    isUnrestricted: true,
    employeeIds: new Set<string>(),
    includes: () => true,
  };
  return ctx;
};

/**
 * Resolve the viewer's employee scope for a page from the EFFECTIVE
 * permission map + the organization graph. Pure — DB reads happen
 * in the caller (API route), which should skip them entirely when
 * resolvePageScope(...) === 'all' (the 'all'-scope fast path:
 * admin bypass plus the HR/quality preset grants).
 */
export function resolveEmployeeScope(
  viewer: ScopeViewer,
  pageKey: string,
  permissions: PermissionsMap | null | undefined,
  inputs: ScopeInputs,
): EmployeeScopeContext {
  // Same bypass tier as verifyPermission — admin resolves 'all'.
  // The structured result carries the decision source for auditing.
  const resolution = explainScopeResolution(permissions, pageKey, viewer.role);
  if (resolution.scope === 'all') return UNRESTRICTED(pageKey, resolution.source);
  const scope = resolution.scope;

  const index = buildOrgIndex(inputs.orgNodes);
  const byNode = groupEmployeesByNode(inputs.employees);
  const ownId = viewer.linkedEmployeeId || null;
  const ids = new Set<string>();
  if (ownId) ids.add(ownId);

  const employeeNode = ownId
    ? inputs.employees.find((e) => e.id === ownId)?.orgNodeId ?? null
    : null;

  switch (scope) {
    case 'own':
      break; // linked employee only (already added)

    case 'team':
    case 'department': {
      const anchorType = scope === 'team' ? 'team' : 'department';

      // §ORG-SCOPE (milestone §18): a manager ASSIGNED to an org node
      // (node.managerUserId === viewer) resolves that node's subtree —
      // "assigned to Team A + scope Team → sees Team A" works through
      // the org tree assignment itself, even when the manager is not
      // an employee INSIDE that team. A managed SUBTEAM node is a
      // team-level branch (type vocabulary, not structure) and
      // matches the team anchor too.
      for (const node of index.byId.values()) {
        const typeMatches =
          node.type === anchorType || (anchorType === 'team' && node.type === 'subteam');
        if (node.managerUserId === viewer.userId && typeMatches) {
          for (const id of employeeIdsInSubtree(index, node.id, byNode)) ids.add(id);
        }
      }

      // Viewer's own org anchor: the nearest {team|department}-type
      // ancestor of the linked employee's node (subteams roll up).
      if (employeeNode) {
        const anchor =
          findAncestorOfType(index, employeeNode, anchorType) ?? index.byId.get(employeeNode) ?? null;
        if (anchor) {
          for (const id of employeeIdsInSubtree(index, anchor.id, byNode)) ids.add(id);
        }
      }
      break;
    }

    case 'subtree': {
      // §SUBTREE — the viewer's OWN organization node plus all valid
      // descendants, UNION §MANAGED-BRANCHES — every node the viewer
      // manages (their whole subtree). A user who manages no nodes
      // still resolves their own node's subtree — never a silent
      // downgrade to 'own'; a user with no resolvable node keeps the
      // fail-closed minimum.
      for (const node of index.byId.values()) {
        if (node.managerUserId === viewer.userId) {
          for (const id of employeeIdsInSubtree(index, node.id, byNode)) ids.add(id);
        }
      }
      if (employeeNode) {
        for (const id of employeeIdsInSubtree(index, employeeNode, byNode)) ids.add(id);
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
  all: 'كل البيانات',
  department: 'القسم',
  team: 'الفريق',
  subtree: 'الفروع المدارة',
  assigned: 'المسند إليّ',
  own: 'سجلي فقط',
};

/** Arabic label for explainable UI. */
export function describeDataScope(scope: DataScope): string {
  return SCOPE_LABELS_AR[scope];
}
