// src/lib/verify-permission.ts
// Server-side permission verification for API routes
// Now uses JWT Bearer token authentication instead of x-user-id header

// §SERVER-ONLY BOUNDARY — reaches the DB layer and the Firebase ADMIN
// SDK through @/lib/db + @/lib/auth. Client code uses the canonical
// resolvers in @/config/permissions instead (same decision logic).
import 'server-only';

import { getById } from '@/lib/db';
import { parsePositionTemplate, POSITIONS_TABLE } from '@/lib/organization';
import type {
  ActionKey, DataScope, FieldAccess, PagePermission, PermissionLevel,
  PermissionsMap, ScopeResolutionSource, AccessSource,
} from '@/config/permissions';
import {
  FAIL_CLOSED_SCOPE,
  explainAuthorization, explainScopeResolution,
  migratePermission, resolveFieldAccess, resolveSectionAccess,
  resolveEffectivePermissions,
} from '@/config/permissions';
import { authenticateRequestAsync } from '@/lib/auth';

export interface VerifyResult {
  allowed: boolean;
  error?: string;
  user?: {
    id: string;
    role: string;
    permissions: PermissionsMap;
    linkedEmployeeId?: string | null;
    /** §ORG-BOUNDARY explicit per-user override (loaded server-side). */
    orgBoundaryNodeIds?: string[] | null;
  };
}

/**
 * Safely parse permissions — handles both string (JSON) and object from Firebase
 */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

/**
 * §ORG-BOUNDARY — shape-only sanitization of the stored boundary
 * override (users.orgBoundaryNodeIds). Non-arrays / junk entries
 * degrade to null (= INHERIT from the organization assignment);
 * node EXISTENCE is validated by the boundary resolver itself (an
 * override whose ids all vanished stays explicit and fails closed —
 * it never falls through to the assignment tier).
 */
function sanitizeBoundaryIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0);
  return ids.length > 0 ? ids : null;
}

/**
 * The authenticated caller identity resolved by authenticateFromRequest.
 *
 * Milestone 10 additions (all optional, absent for legacy users):
 *   • linkedEmployeeId — the optional user ↔ employee linkage,
 *     consumed by the data-scope engine ('own' scope) and by
 *     notification directed matching.
 *   • positionId — the user's optional Position; its permission
 *     template is overlaid INSIDE resolveEffectivePermissions (the
 *     single resolver — role < position < stored override).
 */
export interface AuthenticatedCaller {
  userId: string;
  role: string;
  permissions: PermissionsMap;
  linkedEmployeeId?: string | null;
  positionId?: string | null;
  /**
   * §ORG-BOUNDARY — the user's EXPLICIT organizational access
   * boundary override (users.orgBoundaryNodeIds): canonical org node
   * ids, optionally multiple (Company A + Company B, or the General
   * Administration root). Loaded from the user record — never
   * client-supplied. Absent/null = INHERIT: the boundary derives
   * from the user's organization-tree assignment (managed nodes ∪
   * linked employee's node), resolved by lib/scope/boundary.
   */
  orgBoundaryNodeIds?: string[] | null;
  /**
   * RAW permission tiers the effective map was resolved from — kept
   * (optional, additive) so authorize() can produce a TRUE tier trace
   * instead of guessing from the merged map. Never used for the
   * decision itself: the decision reads only the effective map.
   */
  storedPermissions?: Record<string, unknown> | null;
  positionTemplate?: Record<string, unknown> | null;
}

// ══════════════════════════════════════════════════════════════
//  §AUTH-REQUEST-MEMO — request-scoped authentication memoization.
//
//  WHY: routes commonly authenticate more than once per HTTP request
//  (requireAuth for the caller identity + verifyPermission per gate,
//  verifyAnyAction per candidate action). Each pass used to re-run
//  the full lookup — an uncached getById('users') RTDB read (plus a
//  positions read for positioned users) — so one browser request
//  could pay the same user read 2+ times.
//
//  MECHANISM: the resolved caller is memoized ON THE REQUEST OBJECT
//  (WeakMap keyed by the Request instance). Lifecycle semantics:
//    • Same Request instance = same HTTP request → the lookup runs
//      once and every later authenticate call on it reuses the
//      settled result (authenticate once, authorize many times).
//    • A new HTTP request is a NEW Request instance → no entry →
//      a fresh lookup. Suspension / role / permission / position /
//      linkage changes stay observable across requests, exactly as
//      before; nothing here caches across requests and no TTL or
//      process-global user state exists.
//    • WeakMap: entries are collected with the request object — no
//      growth, no leakage between concurrent users (each concurrent
//      request carries its own Request instance).
//    • A REJECTED lookup (transient RTDB failure) evicts itself so a
//      later call within the same request re-attempts — preserving
//      the pre-memo retry-per-call behavior. Successful memoized
//      lookups are never re-validated mid-request, matching the old
//      semantics (a single request observed one consistent snapshot).
// ══════════════════════════════════════════════════════════════

const requestAuthMemo = new WeakMap<object, Promise<AuthenticatedCaller | null>>();

function authenticateFromRequestUncached(request: Request): Promise<AuthenticatedCaller | null> {
  const promise = (async () => {
    // 1. Verify JWT token
    const payload = await authenticateRequestAsync(request);
    if (!payload) return null;

    // 2. Fetch user from database to get fresh permissions
    const user = await getById('users', payload.userId);
    if (!user) return null;

    // 3. Check if suspended
    if (user.isSuspended) return null;

    // 4. Resolve EFFECTIVE permissions: role preset overridden by the
    //    optional POSITION template, overridden by the user's stored
    //    per-user map (same rule the client AuthContext uses). Without
    //    this, users whose stored map predates a page key would be denied
    //    pages their role grants — the stored map is an OVERRIDE, not a
    //    replacement for the role preset.
    //    The position lookup only runs when the user actually holds a
    //    position — no legacy user does, so nothing changes for them.
    const stored = safeParsePerms(user.permissions) as PermissionsMap;
    let positionTemplate: Record<string, unknown> | null = null;
    if (user.positionId) {
      const position = await getById(POSITIONS_TABLE, user.positionId);
      positionTemplate = position ? parsePositionTemplate(position.permissions) : null;
    }
    const permissions = resolveEffectivePermissions(user.role, stored, positionTemplate ?? undefined);

    return {
      userId: user.id,
      role: user.role,
      permissions,
      linkedEmployeeId: user.linkedEmployeeId ?? null,
      positionId: user.positionId ?? null,
      // §ORG-BOUNDARY — sanitized canonical ids only (strings that
      // exist in the array); shape junk degrades to null = inherit.
      orgBoundaryNodeIds: sanitizeBoundaryIds(user.orgBoundaryNodeIds),
      storedPermissions: stored,
      positionTemplate,
    };
  })();

  // Failure isolation — see §AUTH-REQUEST-MEMO bullet above.
  promise.catch(() => requestAuthMemo.delete(request));

  return promise;
}

/**
 * Authenticate a request from its Bearer token and return user info.
 * This is the foundational auth check — used by verifyPermission and requireAuth.
 *
 * Request-scoped memoized (§AUTH-REQUEST-MEMO): repeated calls with the
 * SAME Request instance share one user lookup; separate requests always
 * perform independent lookups.
 */
export function authenticateFromRequest(request: Request): Promise<AuthenticatedCaller | null> {
  const memoized = requestAuthMemo.get(request);
  if (memoized) return memoized;

  const promise = authenticateFromRequestUncached(request);
  requestAuthMemo.set(request, promise);
  return promise;
}

// ══════════════════════════════════════════════════════════════
//  CANONICAL AUTHORIZATION — authorize()
//
//  THE single decision function of the authorization architecture:
//
//    authenticate → effective permissions → page → section →
//    action → field → (data scope / record checks stay with the
//    canonical scope engine at the route layer) → allow/deny
//
//  Every gate composes from ONE vocabulary (PermissionLevel,
//  ActionKey, PagePermission.sections) and ONE resolver
//  (resolveEffectivePermissions). There is no second permission
//  engine and no role-name logic: the admin bypass is the only
//  role-based rule and it lives HERE (and in the scope engine's
//  explainScopeResolution — the same single tier, mirrored).
//
//  PRECEDENCE (documented contract, §deny-beats-grant): the stored
//  per-user override tier always wins — an explicit stored 'none'
//  level or an explicit actions flag of false is a valid RESTRICTION
//  that outranks broader position/role grants. A narrower direct
//  restriction is never accidentally overridden by a broader
//  inherited grant, because the entry (including its actions map)
//  is replaced wholesale by the winning tier.
//
//  DATA SCOPE is reported on the decision (scope + scopeSource) but
//  is NOT an allow/deny gate here: scope filters WHICH records a
//  granted operation may touch, and its canonical resolver is
//  resolveEmployeeScope / resolvePageScope (src/lib/scope) — a
//  second scope decision here would fork the architecture.
// ══════════════════════════════════════════════════════════════

/** What is being authorized — any combination of page/section/action/field. */
export interface AuthorizeInput {
  /** Page permission key (APP_PAGES.permissionKey). */
  page: string;
  /** 'view' | 'edit' pseudo-actions or a concrete ActionKey. */
  action?: ActionKey | 'view' | 'edit';
  /** Section id (PAGE_SECTIONS) — gates the whole request when denied. */
  section?: string;
  /** Field name — hidden sensitive fields deny the request. */
  field?: string;
}

/** Machine-readable decision of the canonical authorizer. */
export interface AuthorizationDecision {
  allowed: boolean;
  /** Human-readable Arabic reason (also the API error text on denial). */
  reason: string;
  /** Stable machine key of the deciding rule (e.g. 'page:none'). */
  matchedRule: string;
  page: string;
  request: AuthorizeInput;
  effectiveLevel: PermissionLevel;
  /** Configured scope for the page + where it came from. */
  scope: DataScope;
  scopeSource: ScopeResolutionSource;
  /** The tier that produced the effective level. */
  source: AccessSource;
  isAdminBypass: boolean;
  /** Present when input.section was requested. */
  sectionLevel?: PermissionLevel;
  /** Present when input.field was requested. */
  fieldAccess?: FieldAccess;
  /** Full tier-traced explanation from the SAME resolver (no divergence). */
  explanation: ReturnType<typeof explainAuthorization>;
}

/**
 * Authorize an ALREADY-AUTHENTICATED caller against a page (+
 * optional section/action/field). Pure over the loaded effective
 * map — no database reads, safe to call per-element. The raw tiers
 * on the caller (optional) feed the explanation trace; absent tiers
 * degrade only the TRACE, never the decision.
 */
export function authorize(caller: AuthenticatedCaller, input: AuthorizeInput): AuthorizationDecision {
  const pageKey = input.page;
  const isAdmin = caller.role === 'admin';

  // The explanation runs through the SAME resolver chain the decision
  // reads (resolveEffectivePermissions → explainPageAccess →
  // explainScopeResolution → resolveSectionAccess → canDoAction).
  const explanation = explainAuthorization(
    caller.role,
    caller.storedPermissions ?? null,
    pageKey,
    caller.positionTemplate ?? null,
  );

  const perm: PagePermission = migratePermission(caller.permissions[pageKey]);
  const scopeResolution = explainScopeResolution(caller.permissions, pageKey, caller.role);
  const base = {
    page: pageKey,
    request: input,
    effectiveLevel: perm.level,
    scope: scopeResolution.scope,
    scopeSource: scopeResolution.source,
    source: explanation.winner,
    isAdminBypass: isAdmin,
    explanation,
  };

  // Admin bypass — the ONE role-based rule in the architecture.
  if (isAdmin) {
    return { allowed: true, reason: 'مسموح — مدير النظام', matchedRule: 'admin-bypass', ...base };
  }

  // 1. PAGE gate: level 'none' denies everything on the page.
  if (perm.level === 'none') {
    return { allowed: false, reason: 'صلاحية غير كافية', matchedRule: 'page:none', ...base };
  }

  // 2. SECTION gate: a denied section withholds the request. When an
  //    action accompanies the section, the section must ALSO be at
  //    page-edit ceiling (mutations are never implied by page edit on
  //    a section restricted to read).
  let sectionLevel: PermissionLevel | undefined;
  if (input.section !== undefined) {
    sectionLevel = resolveSectionAccess(caller.permissions, pageKey, input.section);
    if (sectionLevel === 'none') {
      return {
        allowed: false, reason: 'صلاحية غير كافية لهذا القسم',
        matchedRule: 'section:none', sectionLevel, ...base,
      };
    }
  }

  // 3. ACTION gate. 'view' passes on the page/section gates; 'edit'
  //    requires page level edit; a concrete ActionKey requires page
  //    level edit AND the explicit flag in the effective actions map
  //    (absent flag = denied — fail-closed).
  if (input.action === 'edit') {
    if (perm.level !== 'edit') {
      return {
        allowed: false, reason: 'صلاحية غير كافية - يتطلب صلاحية تعديل',
        matchedRule: 'edit:page-not-edit', sectionLevel, ...base,
      };
    }
  } else if (input.action !== undefined && input.action !== 'view') {
    const action = input.action;
    if (perm.level !== 'edit') {
      return {
        allowed: false, reason: `صلاحية غير كافية لتنفيذ ${action}`,
        matchedRule: 'action:page-not-edit', sectionLevel, ...base,
      };
    }
    if (sectionLevel !== undefined && sectionLevel !== 'edit') {
      return {
        allowed: false, reason: `صلاحية غير كافية لتنفيذ ${action} على هذا القسم`,
        matchedRule: 'section:not-edit', sectionLevel, ...base,
      };
    }
    if (perm.actions?.[action as ActionKey] !== true) {
      return {
        allowed: false, reason: `ليس لديك صلاحية ${action} على هذه الصفحة`,
        matchedRule: 'action:flag-denied', sectionLevel, ...base,
      };
    }
  }

  // 4. FIELD gate: a hidden sensitive field denies the request —
  //    client-side hiding is UX, never authorization.
  let fieldAccess: FieldAccess | undefined;
  if (input.field !== undefined) {
    fieldAccess = resolveFieldAccess(caller.permissions, pageKey, input.field);
    if (fieldAccess === 'hidden') {
      return {
        allowed: false, reason: 'ليس لديك صلاحية لعرض هذا الحقل',
        matchedRule: 'field:hidden', sectionLevel, fieldAccess, ...base,
      };
    }
  }

  const actionLabel = input.action === undefined || input.action === 'view'
    ? 'العرض'
    : input.action === 'edit' ? 'التعديل' : input.action;
  return {
    allowed: true,
    reason: `مسموح (${perm.level}) — ${actionLabel} عبر ${explanation.reason}`,
    matchedRule: 'allow',
    sectionLevel,
    fieldAccess,
    ...base,
  };
}

/**
 * Canonical request-level authorization: authenticate from the Bearer
 * token, then run the single authorize() decision. Routes that need
 * page/section/action/field composition in ONE check use this;
 * verifyPermission remains the compatible adapter for existing gates.
 */
export async function authorizeRequest(
  request: Request,
  input: AuthorizeInput,
): Promise<{ caller: AuthenticatedCaller | null; decision: AuthorizationDecision }> {
  const caller = await authenticateFromRequest(request);
  if (!caller) {
    const explanation = explainAuthorization(null, null, input.page, null);
    return {
      caller: null,
      decision: {
        allowed: false,
        reason: 'لم يتم المصادقة على المستخدم',
        matchedRule: 'unauthenticated',
        page: input.page,
        request: input,
        effectiveLevel: 'none',
        scope: FAIL_CLOSED_SCOPE,
        scopeSource: 'fail-closed',
        source: 'default-deny',
        isAdminBypass: false,
        explanation,
      },
    };
  }
  return { caller, decision: authorize(caller, input) };
}

/**
 * Check if a user has permission for a specific action on a page.
 * Verifies JWT Bearer token from the Authorization header.
 *
 * COMPATIBLE ADAPTER over authorize() — the canonical decision. The
 * denial messages are the exact strings this gate has always
 * returned, so every existing route and UI keeps its behavior.
 */
export async function verifyPermission(
  request: Request,
  pageId: string,
  action?: ActionKey | 'view' | 'edit'
): Promise<VerifyResult> {
  const auth = await authenticateFromRequest(request);

  if (!auth) {
    return { allowed: false, error: 'لم يتم المصادقة على المستخدم' };
  }

  const decision = authorize(auth, { page: pageId, action });
  if (!decision.allowed) {
    return { allowed: false, error: decision.reason };
  }

  return {
    allowed: true,
    user: {
      id: auth.userId,
      role: auth.role,
      permissions: auth.permissions,
      linkedEmployeeId: auth.linkedEmployeeId ?? null,
      orgBoundaryNodeIds: auth.orgBoundaryNodeIds ?? null,
    },
  };
}

/**
 * Action-ALTERNATIVE check: allowed when the caller holds ANY of the
 * listed actions on the page (e.g. quality reject accepts 'reject'
 * OR the legacy 'approve' grant so pre-existing approver maps keep
 * working — §WORKFLOW). Same authentication contract as
 * verifyPermission; the first listed action wins for the error text.
 *
 * §AUTH-REQUEST-MEMO: the caller is authenticated ONCE here and every
 * candidate action is evaluated against that already-authenticated
 * caller via the pure authorize() decision — identical results and
 * denial messages to the previous per-action verifyPermission loop,
 * without re-paying the user lookup per action.
 */
export async function verifyAnyAction(
  request: Request,
  pageId: string,
  actions: ActionKey[],
): Promise<VerifyResult> {
  const auth = await authenticateFromRequest(request);

  if (!auth) {
    return { allowed: false, error: 'لم يتم المصادقة على المستخدم' };
  }

  let last: VerifyResult = { allowed: false, error: 'صلاحية غير كافية' };
  for (const action of actions) {
    const decision = authorize(auth, { page: pageId, action });
    if (decision.allowed) {
      return {
        allowed: true,
        user: {
          id: auth.userId,
          role: auth.role,
          permissions: auth.permissions,
          linkedEmployeeId: auth.linkedEmployeeId ?? null,
          orgBoundaryNodeIds: auth.orgBoundaryNodeIds ?? null,
        },
      };
    }
    last = { allowed: false, error: decision.reason };
  }
  return last;
}

/**
 * Simple authentication check — ensures a valid JWT is present.
 * Use this for routes that require login but no specific permission.
 */
export async function requireAuth(request: Request): Promise<AuthenticatedCaller | null> {
  return authenticateFromRequest(request);
}
