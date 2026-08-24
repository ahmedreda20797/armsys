// ══════════════════════════════════════════════════════════════
//  SERVER-SIDE DATA SCOPE GUARDS — M0.4 (Scoped Write Paths)
//                       + M0.5 (Scoped Read / List Adoption)
//
//  Thin DB-loading wrapper around the CANONICAL scope engine
//  (src/lib/scope — resolvePageScope + resolveEmployeeScope). It
//  contains NO scope logic of its own: it performs the two list
//  reads the M0.3 route wiring did inline (orgNodes + employee
//  refs) and hands them to the same pure engine, so the ~25 M0.4
//  routes share one loading path instead of duplicating it.
//
//  M0.4 WRITE-SCOPE DOCTRINE (see the M0.4 report):
//    • Permission answers "may you run this action on this page?"
//      — the resource page's own verifyPermission gate, unchanged.
//    • Data scope answers "on WHOSE employee records may you run
//      it?" — resolved from the 'employees' permission entry
//      (EMPLOYEE_SCOPE_PAGE_KEY), the only entry M0.3 configured
//      with evidence-based scopes (HR 'all', Quality 'all',
//      Manager 'subtree', generic fail-closed). A permission to
//      act NEVER implies the right to act on every record.
//    • Scope is resolved BEFORE the mutation, from the org graph —
//      never from client-supplied ids/roles/departments/teams.
//    • Admin and configured-'all' viewers take the fast path: the
//      engine short-circuits unrestricted WITHOUT any DB read.
//
//  M0.5 READ-SCOPE DOCTRINE (same engine, read boundary):
//    • LIST/DETAIL/SEARCH/EXPORT responses expose employee-linked
//      records — the browser must NEVER receive a record whose
//      employee is outside the caller's authorized scope. Scope is
//      applied at the server-side retrieval boundary, BEFORE
//      search/filter/sort/pagination/count — client-side filtering
//      is UX only, never authorization.
//    • The stored record is the authorization relationship: rows
//      are scoped on their STORED employeeId, never on a
//      client-supplied one. A query parameter can only NARROW the
//      authorized set (AUTHORITY = AUTHORIZED_SCOPE ∩ FILTER).
//    • Employee-mandatory tables (attendance, requests, biometrics,
//      travel, follow-ups, HR/quality deductions, observations)
//      FAIL CLOSED on rows without a resolvable employee link.
//      Optionally-linked records (complaints, CAPA — organizational
//      by design) follow the M0.4 optional-link rule: no link →
//      visible; any present link (incl. CAPA relatedEmployeeIds)
//      must be in scope.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { resolvePageScope, type PermissionsMap } from '@/config/permissions';
import { resolveEmployeeScope, filterEmployeesByScope, type EmployeeScopeContext, type ScopeViewer } from '@/lib/scope';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';

/**
 * The permission entry whose configured data scope defines a
 * viewer's authorized EMPLOYEE set for employee-linked operations
 * (M0.4). Employee-linked records (attendance, requests, biometric,
 * travel, follow-ups, deductions, observations…) all describe an
 * employee, so the employees-page scope is the single authorization
 * scope for them; the resource's OWN page permission stays the
 * action gate.
 */
export const EMPLOYEE_SCOPE_PAGE_KEY = 'employees';

/** Viewer slice carried by VerifyResult.user — adapt it to ScopeViewer. */
export interface PermCheckUser {
  id: string;
  role: string;
  permissions: PermissionsMap;
  linkedEmployeeId?: string | null;
}

export function asScopeViewer(user: PermCheckUser): ScopeViewer {
  return {
    userId: user.id,
    role: user.role,
    linkedEmployeeId: user.linkedEmployeeId ?? null,
  };
}

/**
 * Resolve the viewer's employee scope context against the LIVE
 * database. Pure resolution stays in the canonical engine; this
 * wrapper only loads its inputs. The 'all' fast path (admin bypass
 * + configured 'all' entries — the majority of write-path viewers)
 * never touches the database: the engine is invoked with empty
 * inputs and short-circuits unrestricted.
 */
export async function resolveEmployeeScopeFromDb(
  viewer: ScopeViewer,
  pageKey: string = EMPLOYEE_SCOPE_PAGE_KEY,
  permissions?: PermissionsMap | null,
): Promise<EmployeeScopeContext> {
  const effectivePermissions = permissions ?? null;
  const scope = resolvePageScope(effectivePermissions, pageKey, viewer.role);
  if (scope === 'all') {
    return resolveEmployeeScope(viewer, pageKey, effectivePermissions, {
      orgNodes: [],
      employees: [],
    });
  }
  const [orgNodes, employees] = await Promise.all([
    getAll<OrgNode>(ORG_NODES_TABLE, TTL.MEDIUM),
    getAll<{ id: string; orgNodeId?: string | null }>('employees', TTL.MEDIUM),
  ]);
  return resolveEmployeeScope(viewer, pageKey, effectivePermissions, {
    orgNodes,
    employees,
  });
}

/**
 * May the viewer operate on THIS employee's records? The single
 * target-employee check for M0.4 mutation routes. An absent/empty
 * employee id is NOT in scope (fail-closed) — routes over optionally
 * linked resources gate on presence themselves.
 */
export async function employeeInScope(
  viewer: ScopeViewer,
  permissions: PermissionsMap | null | undefined,
  employeeId: string | null | undefined,
  pageKey: string = EMPLOYEE_SCOPE_PAGE_KEY,
): Promise<boolean> {
  if (!employeeId) return false;
  const ctx = await resolveEmployeeScopeFromDb(viewer, pageKey, permissions);
  return ctx.includes(employeeId);
}

/**
 * True when the viewer's employee scope is unrestricted ('all' /
 * admin). Bulk operations that CREATE employee records or touch
 * ARBITRARY employees (spreadsheet uploads, workforce-wide creates)
 * require an unrestricted scope: their output records cannot be
 * confined to a restricted employee set, so a scoped viewer is
 * denied fail-closed.
 */
export async function hasUnrestrictedEmployeeScope(
  viewer: ScopeViewer,
  permissions: PermissionsMap | null | undefined,
  pageKey: string = EMPLOYEE_SCOPE_PAGE_KEY,
): Promise<boolean> {
  const ctx = await resolveEmployeeScopeFromDb(viewer, pageKey, permissions);
  return ctx.isUnrestricted;
}

// ══════════════════════════════════════════════════════════════
//  M0.5 — READ / LIST adoption helpers
//
//  Pure row filters over an ALREADY-RESOLVED EmployeeScopeContext
//  (resolve once per request, reuse everywhere — no repeated scope
//  resolution, no extra DB reads). The canonical engine remains
//  the only membership authority; these helpers only transport its
//  decision onto employee-linked rows.
// ══════════════════════════════════════════════════════════════

/** Structural slice of AuthenticatedCaller — no import cycle. */
export interface AuthCallerLike {
  userId: string;
  role: string;
  permissions: PermissionsMap;
  linkedEmployeeId?: string | null;
}

/** Adapt an authenticateFromRequest()/requireAuth() caller to ScopeViewer. */
export function authScopeViewer(auth: AuthCallerLike): ScopeViewer {
  return {
    userId: auth.userId,
    role: auth.role,
    linkedEmployeeId: auth.linkedEmployeeId ?? null,
  };
}

/** How a row's employee link authorizes (M0.5 read doctrine). */
export interface RowScopeOptions {
  /**
   * True for optionally employee-linked records (complaints, CAPA):
   * a row WITHOUT an employee link is organizational and passes on
   * permission alone; a present link must be in scope (mirrors the
   * M0.4 optional-link write rule). Default false — employee-
   * mandatory tables fail closed on a missing/unresolvable link.
   */
  optionalLink?: boolean;
  /**
   * Field carrying ADDITIONAL employee links (CAPA
   * `relatedEmployeeIds`): every present id must be in scope.
   */
  relatedEmployeeIdsField?: string;
}

/**
 * May this employee-linked RECORD be shown to the viewer? The
 * single membership decision for detail/read routes — resolved from
 * the STORED link(s), never from client-supplied ids.
 */
export function linkedRecordInScope(
  record: { employeeId?: string | null; [key: string]: unknown },
  ctx: EmployeeScopeContext,
  options: RowScopeOptions = {},
): boolean {
  if (ctx.isUnrestricted) return true;
  const { optionalLink = false, relatedEmployeeIdsField } = options;

  if (record.employeeId) {
    if (!ctx.includes(record.employeeId)) return false;
  } else if (!optionalLink) {
    return false; // fail closed: no resolvable employee link
  }

  if (relatedEmployeeIdsField) {
    const related = record[relatedEmployeeIdsField];
    if (Array.isArray(related)) {
      for (const id of related) {
        if (typeof id === 'string' && id.length > 0 && !ctx.includes(id)) return false;
      }
    }
  }
  return true;
}

/**
 * Filter employee-linked ROWS down to the viewer's authorized set —
 * the list-route counterpart of linkedRecordInScope. Runs at the
 * retrieval boundary: BEFORE search/status filters, sorting,
 * pagination and count computation, so no unauthorized record (or
 * side-channel count) can reach the response.
 */
export function filterRowsByEmployeeScope<T extends { employeeId?: string | null; [key: string]: unknown }>(
  rows: T[],
  ctx: EmployeeScopeContext,
  options: RowScopeOptions = {},
): T[] {
  if (ctx.isUnrestricted) return rows;
  return rows.filter((row) => linkedRecordInScope(row, ctx, options));
}

/**
 * M0.5 employee-ARRAY variant for aggregate routes (home/stats,
 * risk-center, reports/generate) that iterate the employees table
 * itself: restricts the array — whose records carry their OWN id —
 * to the authorized scope. Thin wrapper over the canonical pure
 * filter so every post-M0.3 adoption consumes exactly ONE layer:
 * this server guard module (the M0.3/M0.4 architecture invariant).
 */
export function filterEmployeesInScope<T extends { id: string }>(
  employees: T[],
  ctx: EmployeeScopeContext,
): T[] {
  return filterEmployeesByScope(employees, ctx);
}
