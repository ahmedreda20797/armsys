/**
 * Workflow Permission Guard
 * Reuses ARM permission system. Workflow never bypasses permissions.
 * Every action checks authorization before execution.
 */

import type { WorkflowContext, WorkflowPermissions } from '../types';
import type { PermissionsMap } from '@/config/permissions';
import { migratePermission } from '@/config/permissions';

export type WorkflowPermissionAction = 'view' | 'execute' | 'edit' | 'publish';

export function canPerformWorkflowAction(
  userRole: string | null,
  permissions: WorkflowPermissions,
  action: WorkflowPermissionAction
): boolean {
  if (!userRole) return false;
  if (userRole === 'admin') return true;

  switch (action) {
    case 'view':    return permissions.canView.includes(userRole);
    case 'execute': return permissions.canExecute.includes(userRole);
    case 'edit':    return permissions.canEdit.includes(userRole);
    case 'publish': return permissions.canPublish.includes(userRole);
    default:        return false;
  }
}

export function assertWorkflowPermission(
  ctx: WorkflowContext,
  permissions: WorkflowPermissions,
  action: WorkflowPermissionAction
): void {
  if (!canPerformWorkflowAction(ctx.userRole, permissions, action)) {
    throw new Error(
      `[WorkflowPermissionGuard] User role "${ctx.userRole}" cannot perform "${action}" on workflow "${ctx.workflowId}"`
    );
  }
}

/** Check ARM page-level permission from context (reuses existing ARM permission map) */
export function checkArmPermission(
  ctx: WorkflowContext,
  pageId: string,
  action?: string
): boolean {
  if (ctx.userRole === 'admin') return true;
  const permsMap = ctx.userPermissions as PermissionsMap;
  const raw = permsMap?.[pageId];
  if (!raw) return false;
  const perm = migratePermission(raw as any);
  if (!action || action === 'view') return perm.level !== 'none';
  if (action === 'edit') return perm.level === 'edit';
  return perm.level === 'edit' && perm.actions?.[action as any] === true;
}
