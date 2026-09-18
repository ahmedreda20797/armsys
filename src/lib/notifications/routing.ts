// ══════════════════════════════════════════════════════════════
//  Notification ROUTING — Milestone 10 write-side foundation
//
//  Milestone 9 owns the READ-side rule (who may SEE a
//  notification — recipient-visibility.ts). This module owns the
//  WRITE-side question: given an EVENT, which USERS should become
//  recipients? Central routing replaces per-page hardcoded
//  recipient lists:
//
//    Event → route → recipient resolution → permission filter
//         → notification (recipientUserIds) → read-side rule
//
//  Routing dimensions (all optional, unioned, deduplicated):
//    directUserIds      — specific users
//    roles              — every user holding a role
//    orgNodeIds         — managers of those org nodes
//    managerOfEmployeeId — the employee's reporting chain
//                          (org tree, nearest manager first)
//    assignedToUserId   — an assignee
//
//  PERMISSION FILTER: when the route carries a pageKey, a
//  candidate is dropped unless their EFFECTIVE map grants non-none
//  access to that page — the same content gate the read side
//  enforces (canSeeNotification). No second permission resolver.
//
//  Delivered notifications store `recipientUserIds`; the read-side
//  directed rule matches it. Existing broadcast/directed flows are
//  untouched — this mechanism is consumed by new organization-aware
//  events (and by future modules) without changing old behavior.
// ══════════════════════════════════════════════════════════════

import { migratePermission, resolveEffectivePermissions, type ActionKey, type PermissionsMap } from '@/config/permissions';
import { buildOrgIndex, resolveManagerChain, type OrgEmployeeRef, type OrgNode } from '@/lib/organization';
import { findDuplicateByTitleOrRecord } from '@/lib/notifications/dedup';
import { createRecord, findWhere, getAll } from '@/lib/db';

/** Who should receive an event (all dimensions optional, unioned). */
export interface NotificationRoute {
  /** Content permission gate for candidates (null/undefined = no gate). */
  pageKey?: string | null;
  /**
   * ACTION-level gate: when set, a candidate must hold page level
   * 'edit' AND this action flag (e.g. 'approve' → only users who may
   * actually act on the item are notified — §APPROVAL-NOTIFY). Admin
   * role users pass through the preset map automatically.
   */
  requiredAction?: ActionKey | null;
  directUserIds?: string[];
  /** Users explicitly excluded from routing (e.g. the actor themself). */
  excludeUserIds?: string[];
  roles?: string[];
  /** Managers assigned to these organization nodes. */
  orgNodeIds?: string[];
  /** The employee's reporting chain (nearest manager first). */
  managerOfEmployeeId?: string | null;
  /** A single assignee user. */
  assignedToUserId?: string | null;
}

/** User slice needed for routing (id/role + EFFECTIVE permissions). */
export interface RoutingUser {
  id: string;
  role: string;
  permissions: PermissionsMap;
}

export interface RoutingContext {
  users: RoutingUser[];
  orgNodes: OrgNode[];
  employees: OrgEmployeeRef[];
}

function passesPageGate(user: RoutingUser, pageKey: string | null | undefined, requiredAction?: ActionKey | null): boolean {
  if (!pageKey) return true;
  const perm = migratePermission(user.permissions?.[pageKey]);
  if (perm.level === 'none') return false;
  if (requiredAction) {
    if (perm.level !== 'edit') return false;
    return perm.actions?.[requiredAction] === true;
  }
  return true;
}

/**
 * Resolve a route into a deduplicated, deterministic list of
 * recipient USER ids. Pure — safe to unit test and to reuse in a
 * future admin routing-config screen.
 */
export function resolveNotificationRecipients(route: NotificationRoute, ctx: RoutingContext): string[] {
  const candidates: string[] = [];
  const excluded = new Set(route.excludeUserIds ?? []);

  const push = (userId: string | null | undefined) => {
    if (userId && !excluded.has(userId)) candidates.push(userId);
  };

  for (const id of route.directUserIds ?? []) push(id);

  if (route.roles && route.roles.length > 0) {
    const roleSet = new Set(route.roles);
    for (const user of ctx.users) {
      if (roleSet.has(user.role)) push(user.id);
    }
  }

  if (route.orgNodeIds && route.orgNodeIds.length > 0) {
    const index = buildOrgIndex(ctx.orgNodes);
    for (const nodeId of route.orgNodeIds) {
      const node = index.byId.get(nodeId);
      if (node) push(node.managerUserId);
    }
  }

  if (route.managerOfEmployeeId) {
    const index = buildOrgIndex(ctx.orgNodes);
    const node = ctx.employees.find((e) => e.id === route.managerOfEmployeeId)?.orgNodeId ?? null;
    if (node) {
      for (const managerId of resolveManagerChain(index, node)) push(managerId);
    }
  }

  push(route.assignedToUserId);

  // Dedup (first occurrence wins) + permission gate.
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const userId of candidates) {
    if (seen.has(userId)) continue;
    seen.add(userId);
    const user = ctx.users.find((u) => u.id === userId);
    if (!user) continue; // unknown/foreign id — never route to ghosts
    if (!passesPageGate(user, route.pageKey, route.requiredAction)) continue;
    recipients.push(userId);
  }
  return recipients;
}

// ─── Server-side delivery helper ───────────────────────────────
// Mirrors quality-events.ts conventions: dedup before write, never
// throw (notification delivery must not break the primary
// operation), structured error log on failure.

const ROUTED_DEDUP_WINDOW_MS = 30 * 60 * 1000;

export interface RoutedNotificationInput {
  title: string;
  description?: string | null;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  employeeId?: string | null;
  employeeName?: string | null;
  sourceRecordId?: string | null;
  route: NotificationRoute;
  /** Notification category — drives the popover icon and default page map. */
  category?: string;
  /** Owning module (sourceModule on the record). */
  sourceModule?: string;
  /** Page the recipient lands on when opening the notification. */
  targetPage?: string | null;
}

/**
 * Resolve recipients, then write ONE notification record carrying
 * `recipientUserIds` (directed at exactly those users; every other
 * viewer is subject to the read-side rule). Fire-and-forget.
 */
export async function fireRoutedNotification(input: RoutedNotificationInput): Promise<void> {
  try {
    if (!input.title) return;
    const [users, orgNodes, employees] = await Promise.all([
      getAll<Record<string, unknown>>('users'),
      getAll<OrgNode>('orgNodes'),
      getAll<OrgEmployeeRef>('employees'),
    ]);
    const routingUsers: RoutingUser[] = (users ?? []).map((u) => ({
      id: String(u.id),
      role: String(u.role ?? 'user'),
      // SAME effective rule as requireAuth / AuthContext — role
      // preset overridden by the stored map. No second resolver.
      permissions: resolveEffectivePermissions(
        String(u.role ?? 'user'),
        parseUserPermissions(u.permissions),
      ),
    }));

    const recipients = resolveNotificationRecipients(input.route, {
      users: routingUsers,
      orgNodes: orgNodes ?? [],
      employees: employees ?? [],
    });
    if (recipients.length === 0) return;

    const existing = await findWhere('notifications', { title: input.title });
    const duplicate = findDuplicateByTitleOrRecord(
      existing as never,
      { title: input.title, sourceRecordId: input.sourceRecordId ?? null },
      Date.now(),
      ROUTED_DEDUP_WINDOW_MS,
    );
    if (duplicate) return;

    await createRecord('notifications', {
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 'medium',
      status: 'unread',
      category: input.category ?? 'system',
      sourceModule: input.sourceModule ?? 'organization',
      sourceType: 'automation',
      sourceRecordId: input.sourceRecordId ?? null,
      employeeId: input.employeeId ?? null,
      employeeName: input.employeeName ?? null,
      targetPage: input.targetPage ?? null,
      actionUrl: null,
      recipientUserIds: recipients,
    });
  } catch (error) {
    // Never break the primary operation because routing failed.
    console.error(JSON.stringify({
      level: 'error',
      module: 'notifications/routing',
      op: 'fireRoutedNotification',
      message: error instanceof Error ? error.message : String(error),
      title: input.title,
    }));
  }
}

function parseUserPermissions(raw: unknown): PermissionsMap {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as PermissionsMap;
  try {
    return JSON.parse(String(raw)) as PermissionsMap;
  } catch {
    return {};
  }
}
