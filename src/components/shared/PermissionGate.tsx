'use client';

// ══════════════════════════════════════════════════════════════
//  PermissionGate / FieldGate — Milestone 9 centralized guards
//
//  Thin wrappers over the EXISTING usePermissions hook (page +
//  action model) and the new field-level resolution — no second
//  permission mechanism. Frontend gating is UX only; the backend
//  remains authoritative (verifyPermission for actions,
//  stripRestrictedFields for sensitive fields).
//
//  Usage:
//    <PermissionGate page="observations" action="approve">
//      <Button>اعتماد</Button>
//    </PermissionGate>
//
//    <FieldGate page="employees" field="mobile">
//      <span>{employee.mobile}</span>
//    </FieldGate>
// ══════════════════════════════════════════════════════════════

import type { ReactNode } from 'react';
import { usePermissions } from '@/hooks/usePermissions';
import type { ActionKey } from '@/config/permissions';

interface PermissionGateProps {
  /** Page permission key (APP_PAGES permissionKey). */
  page: string;
  /** Optional action key — when omitted, requires page view access. */
  action?: ActionKey;
  /** Shown instead of children when denied (defaults to null). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only when the current user can view the page
 * (or perform the action when `action` is given).
 */
export function PermissionGate({ page, action, fallback = null, children }: PermissionGateProps) {
  const { canDoAction, canViewPage } = usePermissions();
  const allowed = action ? canDoAction(page, action) : canViewPage(page);
  return <>{allowed ? children : fallback}</>;
}

interface FieldGateProps {
  /** Page permission key governing the field. */
  page: string;
  /** Field name (must exist on the record; sensitive fields are
   *  registered in SENSITIVE_FIELDS). */
  field: string;
  /** Shown instead of children when the field is hidden. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Renders children only when the field is visible to the current
 * user (hidden → fallback). For edit affordances prefer
 * usePermissions().canEditField directly.
 */
export function FieldGate({ page, field, fallback = null, children }: FieldGateProps) {
  const { canSeeField } = usePermissions();
  return <>{canSeeField(page, field) ? children : fallback}</>;
}

interface SectionGateProps {
  /** Page permission key containing the section. */
  page: string;
  /** Section id (known ids are registered in PAGE_SECTIONS). */
  section: string;
  /** Shown instead of children when the section is denied. */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Milestone 10 — section-level guard: renders children only when
 * the user can view the SECTION (page gate → section override →
 * inherited page level). Restricting a section must never hide the
 * whole page — that is what this gate expresses.
 *
 * FOUNDATION ONLY — NOT WIRED: no page renders through this gate
 * yet; it exists so section wiring lands on one primitive.
 */
export function SectionGate({ page, section, fallback = null, children }: SectionGateProps) {
  const { canViewSection } = usePermissions();
  return <>{canViewSection(page, section) ? children : fallback}</>;
}
