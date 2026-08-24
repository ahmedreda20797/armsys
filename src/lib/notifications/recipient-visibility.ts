// ══════════════════════════════════════════════════════════════
//  Notification Recipient & Permission Visibility — Milestone 9
//
//  The SINGLE server-side rule that decides which notifications a
//  user may see. Replaces the triplicated ownership filters that
//  previously lived in:
//    • GET /api/notifications
//    • /api/notifications/[id] (canAccessNotification)
//    • /api/notification-stats
//
//  Pipeline (conceptual):
//    Event → Notification → Recipient Resolution →
//    Permission/Visibility Check → User Inbox
//
//  Resolution rules (grounded in the audited data model):
//    1. ADMIN bypass — unchanged, defined at verifyPermission.
//    2. DIRECTED — notification.employeeId or .assignedTo equals the
//       caller's userId (exact match, preserved from the previous
//       behavior; rules-engine `assign_user` stores real user IDs).
//       Milestone 10 adds two directed dimensions:
//         • recipientUserIds — the write-side routing target list
//           (src/lib/notifications/routing.ts).
//         • employeeId === viewer.linkedEmployeeId — subject
//           employees receive their own notifications through the
//           optional user ↔ employee linkage (users.linkedEmployeeId).
//    3. BROADCAST — no directed fields. Staff roles (manager /
//       quality / hr) that ALSO pass the content permission check.
//    4. CONTENT PERMISSION — Part B: a user must never receive a
//       notification exposing an entity/page they cannot access.
//       Each notification's targetPage (or category fallback) maps to
//       a page permission key; a 'none' level hides the notification
//       entirely. Resolution uses the SAME effective permission map
//       the rest of the system uses (resolveEffectivePermissions) —
//       there is no second permission resolver here.
//
//  RESOLVED DATA-MODEL GAP (was documented in Milestone 9): the
//    optional linkage users.linkedEmployeeId now exists (Milestone
//    10 foundation). It is created ONLY by an administrator linking
//    an existing user to an existing employee — no employee login
//    accounts are ever created automatically.
// ══════════════════════════════════════════════════════════════

import { migratePermission, type PermissionsMap } from '@/config/permissions';
import type { AppNotification } from '@/types';

/** Identity + effective permissions of the caller (from requireAuth). */
export interface NotificationViewer {
  userId: string;
  role: string;
  permissions: PermissionsMap;
  /** Optional linked employee (users.linkedEmployeeId) — enables
   * subject-employee directed matching. */
  linkedEmployeeId?: string | null;
}

// ─── Notification routing registry ────────────────────────────
// Maps a notification to the page permission key that governs its
// content. Resolution order mirrors the existing frontend conventions
// (Header.resolveNotificationPage / rules-engine TARGET_PAGE_MAP):
// explicit targetPage first, then category/module fallbacks.
//
// FUTURE EXTENSION POINT (Admin Notification Configuration, Part M):
// this registry is the seed of the future admin screen — each entry
// can eventually carry audience rules, priority overrides, enabled/
// disabled flags and retention. Keep it serializable for that purpose.

/** Category → governing page permission key. `null` = no page check. */
const CATEGORY_PAGE_KEY: Record<string, string | null> = {
  attendance: 'attendance',
  biometric: 'biometric',
  requests: 'requests',
  quality: 'observations',
  hr: 'hrDeductions',
  risk: 'riskCenter',
  followUp: 'followUps',
  employee: 'employees',
  travel: 'travel',
  system: null,
  automation: 'rulesEngine',
  complaint: 'complaints',
  capa: 'capa',
};

/** sourceModule → governing page permission key (used when the
 *  notification carries no explicit targetPage). */
const MODULE_PAGE_KEY: Record<string, string | null> = {
  observations: 'observations',
  followUps: 'followUps',
  riskCenter: 'riskCenter',
  hrDeductions: 'hrDeductions',
  rulesEngine: 'rulesEngine',
};

/**
 * Resolve the page permission key that governs a notification's
 * content, or null when the notification is not page-bound.
 */
export function resolveNotificationPageKey(notif: Partial<AppNotification>): string | null {
  if (notif.targetPage) return notif.targetPage;
  if (notif.category && notif.category in CATEGORY_PAGE_KEY) {
    return CATEGORY_PAGE_KEY[notif.category];
  }
  if (notif.sourceModule && notif.sourceModule in MODULE_PAGE_KEY) {
    return MODULE_PAGE_KEY[notif.sourceModule];
  }
  return null;
}

/** Staff roles eligible for broadcast notifications (the audience the
 *  old dead `isManagerOrAbove` variable described). */
const STAFF_ROLES = new Set(['manager', 'quality', 'hr']);

/**
 * Does the viewer have read access to the page governing this
 * notification's content? Page keys are permission keys (APP_PAGES
 * uses the same string for id and permissionKey for every page the
 * registry can return).
 */
function hasContentAccess(notif: Partial<AppNotification>, viewer: NotificationViewer): boolean {
  const pageKey = resolveNotificationPageKey(notif);
  if (!pageKey) return true; // not page-bound → no content restriction
  const perm = migratePermission(viewer.permissions?.[pageKey]);
  return perm.level !== 'none';
}

/**
 * Whether a notification is DIRECTED at specific recipients
 * (employeeId/assignedTo/recipientUserIds set) versus BROADCAST.
 */
export function isDirectedNotification(notif: Partial<AppNotification>): boolean {
  return Boolean(
    notif.employeeId ||
    notif.assignedTo ||
    (notif.recipientUserIds && notif.recipientUserIds.length > 0)
  );
}

/**
 * THE single recipient-visibility rule (server-authoritative).
 *
 * @returns true when the viewer may see this notification.
 */
export function canSeeNotification(
  notif: Partial<AppNotification>,
  viewer: NotificationViewer
): boolean {
  // 1. Admin bypass — preserved exactly as before.
  if (viewer.role === 'admin') return true;

  // 2. Content permission gate applies to EVERYONE below admin —
  //    a notification about a page the user cannot access must not
  //    reach them, even if they are the named recipient.
  if (!hasContentAccess(notif, viewer)) return false;

  // 3. DIRECTED: exact recipient match — user id, routed recipient
  //    list, or the viewer's LINKED EMPLOYEE (subject-employee
  //    delivery via the Milestone 10 optional linkage).
  if (isDirectedAtViewer(notif, viewer)) {
    return true;
  }

  // 4. BROADCAST: staff audience only. Regular users do not receive
  //    broadcast operational alerts.
  if (!isDirectedNotification(notif) && STAFF_ROLES.has(viewer.role)) {
    return true;
  }

  return false;
}

/** Directed-recipient match for a specific viewer (user id, routed
 * recipient list, or linked employee id). */
export function isDirectedAtViewer(
  notif: Partial<AppNotification>,
  viewer: NotificationViewer
): boolean {
  if (notif.employeeId === viewer.userId || notif.assignedTo === viewer.userId) {
    return true;
  }
  if (Array.isArray(notif.recipientUserIds) && notif.recipientUserIds.includes(viewer.userId)) {
    return true;
  }
  if (notif.employeeId && notif.employeeId === viewer.linkedEmployeeId) {
    return true;
  }
  return false;
}

/**
 * Filter a notification list down to what the viewer may see.
 * (List route helper — same rule as canSeeNotification.)
 */
export function filterVisibleNotifications<T extends Partial<AppNotification>>(
  notifications: T[],
  viewer: NotificationViewer
): T[] {
  return notifications.filter((n) => canSeeNotification(n, viewer));
}

// ══════════════════════════════════════════════════════════════
//  EXTENSION POINTS (documented)
// ══════════════════════════════════════════════════════════════
//  1. EMPLOYEE ↔ USER LINKAGE: RESOLVED in Milestone 10 —
//     users.linkedEmployeeId is matched above; it is assigned only
//     by an administrator (no automatic employee accounts).
//  2. DATA SCOPE (Part K): implemented in Milestone 10 as
//     PagePermission.scope + src/lib/scope. Read-side notification
//     filtering by employee scope is a future extension (currently
//     directed/broadcast matching governs).
//  3. ADMIN CONFIG (Part M): the routing registries above can be
//     promoted to persisted config (per-type enable/disable,
//     priority, retention, deep-link behavior) without touching the
//     callers — canSeeNotification stays the single rule. The
//     write-side routing module (routing.ts) is the seed.
