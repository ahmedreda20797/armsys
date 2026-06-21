// src/lib/verify-permission.ts
// Server-side permission verification for API routes
// Now uses JWT Bearer token authentication instead of x-user-id header

import { getById } from '@/lib/db';
import type { ActionKey, PagePermission, PermissionLevel, PermissionsMap } from '@/config/permissions';
import { migratePermission } from '@/config/permissions';
import { authenticateRequestAsync } from '@/lib/auth';

export interface VerifyResult {
  allowed: boolean;
  error?: string;
  user?: {
    id: string;
    role: string;
    permissions: PermissionsMap;
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
 * Authenticate a request from its Bearer token and return user info.
 * This is the foundational auth check — used by verifyPermission and requireAuth.
 */
export async function authenticateFromRequest(request: Request): Promise<{
  userId: string;
  role: string;
  permissions: PermissionsMap;
} | null> {
  // 1. Verify JWT token
  const payload = await authenticateRequestAsync(request);
  if (!payload) return null;

  // 2. Fetch user from database to get fresh permissions
  const user = await getById('users', payload.userId);
  if (!user) return null;

  // 3. Check if suspended
  if (user.isSuspended) return null;

  // 4. Parse permissions
  const permissions = safeParsePerms(user.permissions) as PermissionsMap;

  return {
    userId: user.id,
    role: user.role,
    permissions,
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
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions },
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
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions },
    };
  }

  // Check edit permission
  if (action === 'edit') {
    if (perm.level !== 'edit') {
      return { allowed: false, error: 'صلاحية غير كافية - يتطلب صلاحية تعديل' };
    }
    return {
      allowed: true,
      user: { id: auth.userId, role: auth.role, permissions: auth.permissions },
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
    user: { id: auth.userId, role: auth.role, permissions: auth.permissions },
  };
}

/**
 * Simple authentication check — ensures a valid JWT is present.
 * Use this for routes that require login but no specific permission.
 */
export async function requireAuth(request: Request): Promise<{ userId: string; role: string; permissions: PermissionsMap } | null> {
  return authenticateFromRequest(request);
}
