// src/components/permissions/types.ts
// ══════════════════════════════════════════════════════════════
//  Permission Manager console — API contract types.
//
//  Mirrors GET /api/dashboard/users/[id]/permissions (the focused
//  Permission Manager API). The profile carries the three permission
//  tiers AND the canonical per-page explanations produced by
//  explainAuthorization — the SAME resolver the enforcement path
//  uses. The UI renders these; it never re-implements precedence.
// ══════════════════════════════════════════════════════════════

import type {
  ActionKey,
  AuthorizationExplanation,
  DataScope,
  PermissionsMap,
} from '@/config/permissions';

export interface ProfileIdentity {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  rank: string | null;
  isSuspended: boolean;
  suspendedAt: string | null;
  photoURL: string | null;
  positionId: string | null;
  positionTitle: string | null;
  linkedEmployeeId: string | null;
  linkedEmployeeName: string | null;
  linkedEmployeeCode: string | null;
}

export interface ProfilePage {
  pageKey: string;
  pageIds: string[];
  title: string;
  titleEn: string | null;
  groupId: string;
  availableActions: ActionKey[];
  sections: Array<{ id: string; title: string }>;
  sensitiveFields: string[];
  explanation: AuthorizationExplanation;
}

export interface ProfileOrganization {
  ownNode: { id: string; name: string; type: string } | null;
  department: string | null;
  team: string | null;
  managedBranches: Array<{ id: string; name: string; type: string }>;
  /** True when the user has a resolvable organization placement. */
  resolvable: boolean;
}

export interface AuthorizationProfile {
  identity: ProfileIdentity;
  authorization: {
    roleBaseline: PermissionsMap;
    positionTemplate: PermissionsMap | null;
    storedOverrides: PermissionsMap;
    effective: PermissionsMap;
    hasOverrides: boolean;
    pages: ProfilePage[];
  };
  organization: ProfileOrganization;
}

/** Minimal user slice the console list consumes (from /api/dashboard/users). */
export interface ConsoleUser {
  id: string;
  name?: string | null;
  email?: string | null;
  role: string;
  isSuspended?: boolean;
  photoURL?: string | null;
  positionTitle?: string | null;
  department?: string | null;
  team?: string | null;
  linkedEmployeeCode?: string | null;
  hasOverrides?: boolean;
}

/** Where a displayed permission value came from (readable labels live in the UI). */
export type SourceTier = 'role' | 'position' | 'stored' | 'default-deny' | 'admin';

/** The effective value of ONE facet (level / action / section / field). */
export interface FacetState<T> {
  value: T;
  allowed: boolean;
  source: SourceTier;
  overridden: boolean;
}
