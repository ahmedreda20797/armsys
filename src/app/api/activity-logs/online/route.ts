import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';

// GET: Return list of users currently "online" (active in last 60 seconds)
export async function GET() {
  try {
    const logs = await getAll<any>('activityLogs', 3000);

    const now = Date.now();
    const sixtySecondsAgo = now - 60 * 1000;

    // Find the latest activity for each user within last 60 seconds
    const userActivityMap = new Map<string, { userName: string; userEmail: string; lastActivity: string }>();

    for (const log of logs) {
      if (!log.timestamp) continue;
      const logTime = new Date(log.timestamp).getTime();
      if (logTime >= sixtySecondsAgo) {
        const existing = userActivityMap.get(log.userId);
        if (!existing || logTime > new Date(existing.lastActivity).getTime()) {
          userActivityMap.set(log.userId, {
            userName: log.userName || 'غير معروف',
            userEmail: log.userEmail || '',
            lastActivity: log.timestamp,
          });
        }
      }
    }

    const onlineUsers = Array.from(userActivityMap.entries()).map(([userId, data]) => ({
      userId,
      ...data,
    }));

    return NextResponse.json(onlineUsers);
  } catch (error) {
    console.error('Error fetching online users:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
