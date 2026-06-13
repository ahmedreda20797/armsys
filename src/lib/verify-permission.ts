// src/lib/verify-permission.ts
// Server-side permission verification for API routes

import { getById } from '@/lib/db';
import type { ActionKey, PagePermission, PermissionLevel, PermissionsMap } from '@/config/permissions';
import { migratePermission } from '@/config/permissions';

/** Safely parse permissions — handles both string (JSON) and object from Firebase */
function safeParsePerms(permissions: any): Record<string, any> {
  if (!permissions) return {};
  if (typeof permissions === 'object') return permissions;
  try { return JSON.parse(permissions); } catch { return {}; }
}

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
 * Check if a user has permission for a specific action on a page.
 * Reads user ID from the `x-user-id` header.
 */
export async function verifyPermission(
  request: Request,
  pageId: string,
  action?: ActionKey | 'view' | 'edit'
): Promise<VerifyResult> {
  // Get user ID from header
  const userId = request.headers.get('x-user-id');

  if (!userId) {
    return { allowed: false, error: 'لم يتم تحديد المستخدم' };
  }

  // Fetch user from database
  const user = await getById('users', userId);
  if (!user) {
    return { allowed: false, error: 'المستخدم غير موجود' };
  }

  // Check if suspended
  if (user.isSuspended) {
    return { allowed: false, error: 'هذا الحساب موقوف' };
  }

  const permissions = safeParsePerms(user.permissions) as PermissionsMap;

  // Admin always has full access
  if (user.role === 'admin') {
    return {
      allowed: true,
      user: { id: user.id, role: user.role, permissions },
    };
  }

  // Get permission for the specific page
  const raw = permissions[pageId];
  const perm: PagePermission = migratePermission(raw);

  // Check view permission (level !== 'none')
  if (action === 'view' || !action) {
    if (perm.level === 'none') {
      return { allowed: false, error: 'صلاحية غير كافية' };
    }
    return {
      allowed: true,
      user: { id: user.id, role: user.role, permissions },
    };
  }

  // Check edit permission
  if (action === 'edit') {
    if (perm.level !== 'edit') {
      return { allowed: false, error: 'صلاحية غير كافية - يتطلب صلاحية تعديل' };
    }
    return {
      allowed: true,
      user: { id: user.id, role: user.role, permissions },
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
    user: { id: user.id, role: user.role, permissions },
  };
}

/**
 * Create a fetch wrapper that automatically includes the user ID header.
 * This should be called from client components to ensure all API calls
 * include the current user's ID for server-side permission checking.
 */
export function withAuth(headers?: Record<string, string>): Record<string, string> {
  if (typeof window === 'undefined') return headers || {};

  try {
    const stored = localStorage.getItem('erp_user');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.id) {
        return {
          ...headers,
          'x-user-id': parsed.id,
        };
      }
    }
  } catch {
    // ignore parse errors
  }

  return headers || {};
}
