import { NextRequest, NextResponse } from 'next/server';
import { getAll, countWhere, TTL } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { filterVisibleNotifications } from '@/lib/notifications/recipient-visibility';

// ══════════════════════════════════════════════════════════════
//  GET /api/notification-stats — Aggregated notification stats
//  SECURITY: Recipient + permission visibility (same rule as the
//  list route — see lib/notifications/recipient-visibility)
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'notifications', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const user = permCheck.user!;

    // Load notifications and rule execution logs in parallel
    // §DOWNLOAD-OPT — TTL.POLL (30s): same shared-cache rationale as the
    // list route; AOCC polls this every 30s while visible. Writes via
    // db.ts invalidate immediately, so freshness is unchanged.
    const [allNotifications, ruleLogs] = await Promise.all([
      getAll<any>('notifications', TTL.POLL),
      getAll<any>('ruleExecutionLogs', TTL.POLL),
    ]);

    // Recipient + permission visibility (same rule as the list route)
    const notifications = filterVisibleNotifications(allNotifications, {
      userId: user.id,
      role: user.role,
      permissions: user.permissions,
      linkedEmployeeId: user.linkedEmployeeId ?? null,
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    // Total notifications
    const total = notifications.length;

    // Unread count
    const unread = notifications.filter((n) => n.status === 'unread').length;

    // Critical unread count
    const critical = notifications.filter(
      (n) => n.priority === 'critical' && n.status === 'unread'
    ).length;

    // Notifications created today
    const todayCount = notifications.filter(
      (n) => n.createdAt && n.createdAt >= todayStart
    ).length;

    // Overdue: unresolved high/critical notifications older than 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const overdueCount = notifications.filter(
      (n) =>
        n.priority === 'high' || n.priority === 'critical'
    ).filter(
      (n) =>
        n.status !== 'resolved' &&
        n.status !== 'archived' &&
        n.status !== 'dismissed' &&
        n.createdAt < twentyFourHoursAgo
    ).length;

    // Escalated: notifications assigned to someone (not the original employee)
    const escalatedCount = notifications.filter(
      (n) => n.assignedTo && n.assignedTo !== n.employeeId
    ).length;

    // Notifications generated today (by automation rules)
    const todayGenerated = notifications.filter(
      (n) => n.ruleId && n.createdAt && n.createdAt >= todayStart
    ).length;

    // Rules triggered today (successful executions today) — only for admin
    const rulesTriggeredToday = user.role === 'admin'
      ? ruleLogs.filter(
          (l) => l.result === 'success' && l.createdAt && l.createdAt >= todayStart
        ).length
      : 0;

    return NextResponse.json({
      total,
      unread,
      critical,
      todayCount,
      overdueCount,
      escalatedCount,
      todayGenerated,
      rulesTriggeredToday,
    });
  } catch (error) {
    console.error('[GET /api/notification-stats] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
