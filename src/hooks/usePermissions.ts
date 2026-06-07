// src/hooks/usePermissions.ts
'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PermissionLevel, APP_PAGES } from '@/config/permissions';
import { PageId } from '@/types';

export function usePermissions(pageId?: PageId) {
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

  const getPermission = (pid: string): PermissionLevel => {
    if (!user || isAdmin) return 'edit';
    return user.permissions?.[pid] || 'none';
  };

  const canView = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    return getPermission(id) !== 'none';
  };

  const canEdit = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    return getPermission(id) === 'edit';
  };

  const canRead = (pid?: string): boolean => {
    const id = pid || pageId;
    if (!id) return true;
    if (!user) return false;
    if (isAdmin) return true;
    const perm = getPermission(id);
    return perm === 'read' || perm === 'edit';
  };

  const visiblePages = useMemo(() => {
    if (!user) return [];
    if (isAdmin) return APP_PAGES;
    return APP_PAGES.filter(p => {
      const perm = user.permissions?.[p.id];
      return perm && perm !== 'none';
    });
  }, [user, isAdmin]);

  const currentPermission = pageId ? getPermission(pageId) : null;

  return {
    isAdmin,
    canView,
    canEdit,
    canRead,
    getPermission,
    visiblePages,
    currentPermission,
    permission: currentPermission,
  };
}
