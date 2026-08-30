// src/hooks/usePermissions.ts
'use client';

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { PermissionLevel, APP_PAGES, migratePermission, resolveFieldAccess, resolvePageScope, resolveSectionAccess, FAIL_CLOSED_SCOPE, type ActionKey, type DataScope, type PermissionsMap, type PagePermission, type FieldAccess } from '@/config/permissions';
import { PageId } from '@/types';

export function usePermissions(pageId?: PageId) {
  const { user } = useAuth();

  const isAdmin = user?.role === 'admin';

  // ── Canonical permission-key resolution ─────────────────────────
  // A page's stored permission entries are keyed by PERMISSION KEY
  // (APP_PAGES.permissionKey), while callers may pass either the page
  // id or the key itself (most pages share one value). Pages that
  // reuse another page's permission key (e.g. qualityDeductionsReport
  // → 'reports', smartQualityReport → 'kpiReports') must resolve to
  // that canonical key BEFORE any lookup — otherwise the lookup reads
  // a key that can never exist in the map and fails closed even for
  // granted roles.
  const resolvePermissionKey = (pid: string): string =>
    APP_PAGES.find((p) => p.id === pid || p.permissionKey === pid)?.permissionKey ?? pid;

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
    const raw = user.permissions?.[resolvePermissionKey(pid)];
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

  // Field-level access (Part J): hidden / read-only / editable for a
  // field within a page. Uses the same effective permission map —
  // sensitive fields (see SENSITIVE_FIELDS) additionally require
  // page-level edit to be visible at all.
  const getFieldAccess = (pid: string, field: string): FieldAccess => {
    if (!user) return 'hidden';
    if (isAdmin) return 'editable';
    return resolveFieldAccess(user.permissions, pid, field);
  };
  const canSeeField = (pid: string, field: string): boolean =>
    getFieldAccess(pid, field) !== 'hidden';
  const canEditField = (pid: string, field: string): boolean =>
    getFieldAccess(pid, field) === 'editable';

  // Data scope (M0.3): delegates to the SAME canonical resolver the
  // API routes use (resolvePageScope) — client and server can never
  // disagree. Admin is always 'all'; an unconfigured non-admin entry
  // fails closed to 'own' (empty without the employee linkage).
  const getScope = (pid: string): DataScope => {
    if (!user) return FAIL_CLOSED_SCOPE; // fail-closed for anonymous
    return resolvePageScope(user.permissions, resolvePermissionKey(pid), user.role);
  };

  // Section access (Milestone 10 foundation): same level vocabulary;
  // sections inherit the page level unless an override is stored and
  // can never exceed the page gate.
  const getSectionAccess = (pid: string, sectionId: string): PermissionLevel => {
    if (!user) return 'none';
    if (isAdmin) return 'edit';
    return resolveSectionAccess(user.permissions, pid, sectionId);
  };
  const canViewSection = (pid: string, sectionId: string): boolean =>
    getSectionAccess(pid, sectionId) !== 'none';

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
    getFieldAccess,
    canSeeField,
    canEditField,
    getScope,
    getSectionAccess,
    canViewSection,
    getPermission,
    visiblePages,
    currentPermission,
    permission: currentPermission,
  };
}