import { NextRequest, NextResponse } from 'next/server';
import { getAll, countWhere, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';

// ══════════════════════════════════════════════════════════════
//  GET /api/notification-stats — Aggregated notification stats
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load notifications and rule execution logs in parallel
    const [notifications, ruleLogs] = await Promise.all([
      getAll<any>('notifications', TTL.DEFAULT),
      getAll<any>('ruleExecutionLogs', TTL.DEFAULT),
    ]);

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

    // Rules triggered today (successful executions today)
    const rulesTriggeredToday = ruleLogs.filter(
      (l) => l.result === 'success' && l.createdAt && l.createdAt >= todayStart
    ).length;

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