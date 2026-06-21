import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

// GET: Return list of users currently "online" (active in last 120 seconds)
export async function GET(request: NextRequest) {
  try {
    // Server-side permission check: only admin can view sessions
    const check = await verifyPermission(request, 'controlPanel', 'view');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const minutesAgo = parseInt(searchParams.get('minutes') || '2', 10);
    const now = Date.now();
    const threshold = now - minutesAgo * 60 * 1000;

    const logs = await getAll<any>('activityLogs', 3000);

    // Find the latest activity for each user within threshold
    const userActivityMap = new Map<string, {
      userName: string;
      userEmail: string;
      lastActivity: string;
      currentPage: string;
      lastAction: string;
      ipAddress: string;
      browser: string;
      device: string;
      sessionStart: string;
    }>();

    for (const log of logs) {
      const ts = log.createdAt || log.timestamp;
      if (!ts) continue;
      const logTime = new Date(ts).getTime();
      if (logTime >= threshold) {
        const existing = userActivityMap.get(log.userId);
        if (!existing || logTime > new Date(existing.lastActivity).getTime()) {
          userActivityMap.set(log.userId, {
            userName: log.userName || 'غير معروف',
            userEmail: log.userEmail || '',
            lastActivity: ts,
            currentPage: log.page || '',
            lastAction: log.action || '',
            ipAddress: log.ipAddress || '',
            browser: log.browser || '',
            device: log.device || '',
            sessionStart: ts,
          });
        }
      }
    }

    const onlineUsers = Array.from(userActivityMap.entries()).map(([userId, data]) => {
      const lastMs = new Date(data.lastActivity).getTime();
      const durationMs = now - lastMs;
      const durationMin = Math.floor(durationMs / 60000);
      return {
        userId,
        ...data,
        status: durationMin < 2 ? 'active' : durationMin < 5 ? 'idle' : 'away',
        durationLabel: durationMin < 1 ? 'الآن' : `منذ ${durationMin} دقيقة`,
      };
    });

    // Sort: active first, then by last activity
    onlineUsers.sort((a, b) => {
      const order = { active: 0, idle: 1, away: 2 };
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
    });

    return NextResponse.json(onlineUsers);
  } catch (error) {
    console.error('Error fetching online users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
