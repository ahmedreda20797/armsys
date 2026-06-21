import { NextRequest, NextResponse } from 'next/server';
import { getAll, countWhere, TTL } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

// ══════════════════════════════════════════════════════════════
//  GET /api/notification-stats — Aggregated notification stats
//  SECURITY: Admin/Manager/Quality/HR only. Regular users get personal stats.
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'notifications', 'view');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const user = permCheck.user!;

    // Load notifications and rule execution logs in parallel
    const [allNotifications, ruleLogs] = await Promise.all([
      getAll<any>('notifications', TTL.DEFAULT),
      getAll<any>('ruleExecutionLogs', TTL.DEFAULT),
    ]);

    // Non-admin users only see their own notification stats
    const isAdmin = user.role === 'admin';
    const notifications = isAdmin
      ? allNotifications
      : allNotifications.filter(
          (n) => n.employeeId === user.id || n.assignedTo === user.id
        );

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
    const rulesTriggeredToday = isAdmin
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
