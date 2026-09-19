// ══════════════════════════════════════════════════════════════
//  Client-side notification merge — §DOWNLOAD-OPT / §DEDUP
//
//  Pure, DOM-free helper extracted VERBATIM from
//  NotificationContext.refresh()'s setNotifications updater so the
//  poll ↔ realtime deduplication contract is unit-testable.
//
//  Contract (canonical notification ID is the ONLY identity):
//    • A notification already in `prev` is never duplicated, no
//      matter which channel (45s poll / onChildAdded push) or how
//      many times it re-arrives.
//    • New arrivals keep their own `status` (unread stays unread)
//      and are merged newest-first.
//    • Panel history stays capped at NOTIFICATION_PANEL_CAP items.
//    • No title-based, timestamp-based, or position-based matching.
// ══════════════════════════════════════════════════════════════

import type { AppNotification } from '@/types';

/** Same cap the panel has always applied to merged history. */
export const NOTIFICATION_PANEL_CAP = 100;

export interface NotificationMergeResult {
  /** Full merged panel contents, newest first, capped. */
  merged: AppNotification[];
  /** Incoming notifications NOT already present in `prev` (by id). */
  added: AppNotification[];
}

export function mergeIncomingNotifications(
  prev: AppNotification[],
  incoming: AppNotification[],
): NotificationMergeResult {
  const existingIds = new Set(prev.map((n) => n.id));
  const added = incoming.filter((d) => !existingIds.has(d.id));
  const merged = [...added, ...prev]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, NOTIFICATION_PANEL_CAP);
  return { merged, added };
}
