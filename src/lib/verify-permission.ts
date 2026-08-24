// src/lib/verify-permission.ts
// Server-side permission verification for API routes
// Now uses JWT Bearer token authentication instead of x-user-id header

import { getById } from '@/lib/db';
import { parsePositionTemplate, POSITIONS_TABLE } from '@/lib/organization';
import type { ActionKey, PagePermission, PermissionLevel, PermissionsMap } from '@/config/permissions';
import { migratePermission, resolveEffectivePermissions } from '@/config/permissions';
import { authenticateRequestAsync } from '@/lib/auth';

export interface VerifyResult {
  allowed: boolean;
  error?: string;
  user?: {
    id: string;
    role: string;
    permissions: PermissionsMap;
    linkedEmployeeId?: string | null;
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
}

/**
 * Authenticate a request from its Bearer token and return user info.
 * This is the foundational auth check — used by verifyPermission and requireAuth.
 */
export async function authenticateFromRequest(request: Request): Promise<AuthenticatedCaller | null> {
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
  };
}

/**
 * Check if a user has permission for a specific action on a page.
 * Verifies JWT Bearer token from the Authorization header.
 */
export async function verifyPermission(
  request: Request,
  pageId: string,
  action?: ActionKey | 'view' | 'edit'
): Promise<VerifyResult> {
  // Authenticate via JWT
  const auth = await authenticateFromRequest(request);

  if (!auth) {
    return { allowed: false, error: 'لم يتم المصادقة على المستخدم' };
  }

  // Admin always has full access
  if (auth.role === 'admin') {
    return {
      allowed: true,
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions, linkedEmployeeId: auth.linkedEmployeeId ?? null },
    };
  }

  // Get permission for the specific page
  const raw = auth.permissions[pageId];
  const perm: PagePermission = migratePermission(raw);

  // Check view permission (level !== 'none')
  if (action === 'view' || !action) {
    if (perm.level === 'none') {
      return { allowed: false, error: 'صلاحية غير كافية' };
    }
    return {
      allowed: true,
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions, linkedEmployeeId: auth.linkedEmployeeId ?? null },
    };
  }

  // Check edit permission
  if (action === 'edit') {
    if (perm.level !== 'edit') {
      return { allowed: false, error: 'صلاحية غير كافية - يتطلب صلاحية تعديل' };
    }
    return {
      allowed: true,
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions, linkedEmployeeId: auth.linkedEmployeeId ?? null },
    };
  }

  // Check specific action permission (create, update, delete, etc.)
  if (perm.level !== 'edit') {
    return { allowed: false, error: `صلاحية غير كافية لتنفيذ ${action}` };
  }

  const actionAllowed = perm.actions?.[action as ActionKey] === true;
  if (!actionAllowed) {
    return { allowed: false, error: `ليس لديك صلاحية ${action} على هذه الصفحة` };
  }

  return {
    allowed: true,
    user: { id: auth.userId, role: auth.role, permissions: auth.permissions, linkedEmployeeId: auth.linkedEmployeeId ?? null },
  };
}

/**
 * Simple authentication check — ensures a valid JWT is present.
 * Use this for routes that require login but no specific permission.
 */
export async function requireAuth(request: Request): Promise<AuthenticatedCaller | null> {
  return authenticateFromRequest(request);
}
