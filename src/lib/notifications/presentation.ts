// ══════════════════════════════════════════════════════════════
//  Notification presentation model (§UX-STRUCTURE PART 9)
//
//  PURE functions + one small severity vocabulary shared by the
//  notification popover and any notification row elsewhere. This
//  module NEVER touches the network and NEVER duplicates the
//  canonical unread logic — `status === 'unread'` from the API
//  remains the ONLY unread source (§9E).
//
//  SEVERITY (§9C) — small, consistent, derived from the existing
//  notification fields (priority + category + lifecycle status):
//    CRITICAL         priority=critical — red, sparingly
//    ACTION_REQUIRED  priority=high     — amber, needs a decision
//    WARNING          risk/complaint at medium — quiet caution
//    SUCCESS          acknowledged/resolved lifecycle — positive
//    INFO             everything else — visually quiet by default
// ══════════════════════════════════════════════════════════════

import type { AppNotification } from '@/types';

export type NotificationSeverity =
  | 'info'
  | 'success'
  | 'warning'
  | 'action_required'
  | 'critical';

export function deriveNotificationSeverity(
  notif: Pick<AppNotification, 'priority' | 'category' | 'status'>,
): NotificationSeverity {
  if (notif.priority === 'critical') return 'critical';
  if (notif.status === 'resolved' || notif.status === 'acknowledged') return 'success';
  if (notif.priority === 'high') return 'action_required';
  if ((notif.category === 'risk' || notif.category === 'complaint') && notif.priority !== 'low') {
    return 'warning';
  }
  return 'info';
}

/** Visual contract per severity — tint classes only, no glow (§PART 21). */
export const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  info: 'bg-slate-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  action_required: 'bg-amber-400',
  critical: 'bg-red-500',
};

export const SEVERITY_LABEL: Record<NotificationSeverity, { ar: string; en: string }> = {
  info: { ar: 'معلومة', en: 'Info' },
  success: { ar: 'تمت المعالجة', en: 'Resolved' },
  warning: { ar: 'تنبيه', en: 'Warning' },
  action_required: { ar: 'بحاجة لإجراء', en: 'Action required' },
  critical: { ar: 'حرج', en: 'Critical' },
};

// ══════════════════════════════════════════════════════════════
//  GROUPING (§9B) — collapse repeated instances of the SAME event
//  (same category + same title template + same source module)
//  inside one time window into a single compact row:
//    "3 ملاحظات جودة بانتظار الاعتماد"  →  expand to the records.
//
//  Unrelated notifications are NEVER grouped: category, title and
//  sourceModule must all match, and the items must be within the
//  same recency window. Any status/priority difference still
//  groups (the group shows the unread count), but differing
//  severity buckets are kept apart by the sort below.
// ══════════════════════════════════════════════════════════════

export interface NotificationGroupShape {
  kind: 'group';
  key: string;
  title: string;
  category: AppNotification['category'];
  count: number;
  unreadCount: number;
  severity: NotificationSeverity;
  newestAt: string;
  items: AppNotification[];
}

export interface NotificationSingle {
  kind: 'single';
  key: string;
  item: AppNotification;
  severity: NotificationSeverity;
}

export type NotificationRowModel = NotificationGroupShape | NotificationSingle;

/** Groups must share all three AND be created within the window. */
const GROUP_WINDOW_MS = 48 * 60 * 60 * 1000;
const GROUP_MIN_SIZE = 3;

function groupKeyOf(n: AppNotification): string {
  return `${n.category}|${n.title}|${n.sourceModule}`;
}

export function groupNotifications(
  items: readonly AppNotification[],
  now: number = Date.now(),
): NotificationRowModel[] {
  const rank: Record<NotificationSeverity, number> = { info: 0, success: 1, warning: 2, action_required: 3, critical: 4 };
  const rows: NotificationRowModel[] = [];

  // Single pass over the recency-sorted list. A "run" is a maximal
  // stretch of consecutive items sharing the group key within the
  // time window. Runs flush IN PLACE, so chronological order and
  // interleaving with unrelated notifications are both preserved.
  let run: { key: string; items: AppNotification[]; severity: NotificationSeverity; newestAt: string } | null = null;

  const flushRun = () => {
    if (!run) return;
    if (run.items.length >= GROUP_MIN_SIZE) {
      rows.push({
        kind: 'group',
        key: run.key,
        title: run.items[0]!.title,
        category: run.items[0]!.category,
        count: run.items.length,
        unreadCount: run.items.filter((n) => n.status === 'unread').length,
        severity: run.severity,
        newestAt: run.newestAt,
        items: run.items,
      });
    } else {
      for (const single of run.items) {
        rows.push({ kind: 'single', key: single.id, item: single, severity: deriveNotificationSeverity(single) });
      }
    }
    run = null;
  };

  for (const item of items) {
    const severity = deriveNotificationSeverity(item);
    const key = groupKeyOf(item);
    const createdAt = new Date(item.createdAt).getTime();

    if (
      run &&
      run.key === key &&
      now - createdAt <= GROUP_WINDOW_MS
    ) {
      run.items.push(item);
      if (rank[severity] > rank[run.severity]) run.severity = severity;
      if (createdAt > new Date(run.newestAt).getTime()) run.newestAt = item.createdAt;
      continue;
    }

    flushRun();
    run = { key, items: [item], severity, newestAt: item.createdAt };
  }
  flushRun();

  return rows;
}

/** Compact relative time — Arabic-first, matches the existing tone. */
export function timeAgo(dateStr: string, locale: 'ar' | 'en' = 'ar', now: number = Date.now()): string {
  const diff = now - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (locale === 'en') {
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `منذ ${minutes} د`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} س`;
  return `منذ ${Math.floor(hours / 24)} يوم`;
}
