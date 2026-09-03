// ══════════════════════════════════════════════════════════════
//  AI Tool layer — pure permission check (Phase 6.4, spec §11)
//
//  MIRROR of verifyPermission's decision semantics (src/lib/
//  verify-permission.ts lines 107–155) as a PURE function over an
//  already-resolved effective permission map. This is deliberately
//  the SAME vocabulary, SAME levels, SAME admin bypass and SAME
//  fail-closed behavior — NOT a parallel permission architecture
//  (spec §6). The request-based verifyPermission remains the
//  canonical gate for HTTP routes; tools re-check with this because
//  tool execution is decoupled from the HTTP layer.
// ══════════════════════════════════════════════════════════════

import type { ActionKey, PagePermission, PermissionsMap } from '@/config/permissions';
import { migratePermission } from '@/config/permissions';

export interface ToolPermissionCheck {
  allowed: boolean;
  error?: string;
}

export function verifyPermissionForUser(
  permissions: PermissionsMap,
  role: string,
  pageId: string,
  action?: ActionKey | 'view' | 'edit',
): ToolPermissionCheck {
  // Admin always has full access — same doctrine as verifyPermission.
  if (role === 'admin') return { allowed: true };

  const perm: PagePermission = migratePermission(permissions[pageId]);

  if (action === 'view' || !action) {
    if (perm.level === 'none') return { allowed: false, error: 'صلاحية غير كافية' };
    return { allowed: true };
  }

  if (action === 'edit') {
    if (perm.level !== 'edit') {
      return { allowed: false, error: 'صلاحية غير كافية - يتطلب صلاحية تعديل' };
    }
    return { allowed: true };
  }

  if (perm.level !== 'edit') {
    return { allowed: false, error: `صلاحية غير كافية لتنفيذ ${action}` };
  }
  const actionAllowed = perm.actions?.[action as ActionKey] === true;
  if (!actionAllowed) {
    return { allowed: false, error: `ليس لديك صلاحية ${action} على هذه الصفحة` };
  }
  return { allowed: true };
}
