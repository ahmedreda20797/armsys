// ══════════════════════════════════════════════════════════════
//  Positions — Milestone 10
//
//  A Position is a REUSABLE job-title template (Quality
//  Specialist, HR Manager, ...) that may carry a permission
//  template. It is a distinct concept from Employee (personnel
//  data), User (login account) and Role (system preset).
//
//  Layering when a USER holds a position (optional, via
//  users.positionId):
//
//    role preset  <  position template  <  stored user override
//
//  The overlay happens inside resolveEffectivePermissions — the
//  single resolver. No existing user has a positionId today, so
//  resolution is unchanged until an administrator assigns one.
//
//  Employees keep their free-text `position` string for display;
//  linking employees to Position records is a FUTURE flow (when
//  employee accounts arrive) and is intentionally NOT implemented.
// ══════════════════════════════════════════════════════════════

import { migratePermission, type PermissionsMap } from '@/config/permissions';
import type { OrgNodeType } from './types';

export type PositionStatus = 'active' | 'archived';

export interface Position {
  id: string;
  title: string;
  description: string | null;
  /** Permission template — stored as JSON string or object (users convention). */
  permissions: string | Record<string, unknown> | null;
  /** Optional org hint: which node type this position typically leads/staffs. */
  orgTypeHint: OrgNodeType | null;
  status: PositionStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Parse a position's stored permission template into a map, or null
 * when the position carries no usable template. Mirrors the users'
 * safeParsePerms convention (JSON-string or object).
 */
export function parsePositionTemplate(raw: unknown): PermissionsMap | null {
  if (!raw) return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const map = parsed as Record<string, unknown>;
  if (Object.keys(map).length === 0) return null;
  return map as PermissionsMap;
}

/**
 * Structural validation for a stored template: every entry must be
 * a known permission shape (string level or { level }). Returns the
 * list of invalid keys (empty = valid). Used by the positions API
 * so a corrupt template can never enter the resolver chain.
 */
export function findInvalidTemplateKeys(map: Record<string, unknown>): string[] {
  const invalid: string[] = [];
  for (const [key, value] of Object.entries(map)) {
    if (typeof value === 'string') {
      if (value !== 'none' && value !== 'read' && value !== 'edit') invalid.push(key);
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      invalid.push(key);
      continue;
    }
    const level = (value as Record<string, unknown>).level;
    if (level !== 'none' && level !== 'read' && level !== 'edit') invalid.push(key);
  }
  return invalid;
}

/** Normalize a template for SAFE display/effective-merge: drops junk entries. */
export function normalizePositionTemplate(map: Record<string, unknown>): PermissionsMap {
  const out: PermissionsMap = {};
  for (const [key, value] of Object.entries(map)) {
    try {
      out[key] = migratePermission(value as never);
    } catch {
      // unreachable — migratePermission is total; kept for safety
    }
  }
  return out;
}
