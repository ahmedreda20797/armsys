// src/hooks/usePermissions.ts
'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PermissionLevel, APP_PAGES, migratePermission, type ActionKey, type PermissionsMap, type PagePermission } from '@/config/permissions';
import { PageId } from '@/types';

export function usePermissions(pageId?: PageId) {
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

  // Parse permission for a specific page
  const getPermission = (pid: string): PagePermission => {
    if (!user) return { level: 'none', actions: {} };
    if (isAdmin) {
      // Admin gets edit with all actions
      const page = APP_PAGES.find(p => p.permissionKey === pid || p.id === pid);
      const actions: Partial<Record<ActionKey, boolean>> = {};
      page?.availableActions.forEach(a => { actions[a] = true; });
      return { level: 'edit', actions };
    }
    const raw = user.permissions?.[pid];
    return migratePermission(raw);
  };

  // Page-level checks
  const canView = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    return getPermission(id).level !== 'none';
  };

  const canEdit = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    return getPermission(id).level === 'edit';
  };

  const canRead = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    const perm = getPermission(id).level;
    return perm === 'read' || perm === 'edit';
  };

  // Action-level checks (only meaningful when level is 'edit')
  const canDoAction = (pid: string, action: ActionKey): boolean => {
    if (!user) return false;
    if (isAdmin) return true;
    const perm = getPermission(pid);
    if (perm.level !== 'edit') return false;
    return perm.actions?.[action] === true;
  };

  // Shortcut functions for specific actions
  const canCreate = (pid?: string) => canDoAction(pid || pageId || '', 'create');
  const canUpdate = (pid?: string) => canDoAction(pid || pageId || '', 'update');
  const canDelete = (pid?: string) => canDoAction(pid || pageId || '', 'delete');
  const canExport = (pid?: string) => canDoAction(pid || pageId || '', 'export');
  const canApprove = (pid?: string) => canDoAction(pid || pageId || '', 'approve');
  const canUpload = (pid?: string) => canDoAction(pid || pageId || '', 'upload');
  const canOverride = (pid?: string) => canDoAction(pid || pageId || '', 'override');

  // Page-level shortcut
  const canViewPage = (pid: string) => canView(pid);
  const canEditPage = (pid: string) => canEdit(pid);

  // Visible pages for sidebar (excludes overlayOnly pages)
  const visiblePages = useMemo(() => {
    if (!user) return [];
    const base = isAdmin
      ? APP_PAGES
      : APP_PAGES.filter(p => {
          const perm = migratePermission(user.permissions?.[p.permissionKey]);
          return perm.level !== 'none';
        });
    return base.filter(p => !p.overlayOnly);
  }, [user, isAdmin]);

  const currentPermission = pageId ? getPermission(pageId) : null;

  return {
    isAdmin,
    canView: canView(),
    canEdit: canEdit(),
    canRead: canRead(),
    canCreate: canCreate(),
    canUpdate: canUpdate(),
    canDelete: canDelete(),
    canExport: canExport(),
    canApprove: canApprove(),
    canUpload: canUpload(),
    canOverride: canOverride(),
    canViewPage,
    canEditPage,
    canDoAction,
    getPermission,
    visiblePages,
    currentPermission,
    permission: currentPermission,
  };
}
