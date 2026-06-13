import { NextRequest, NextResponse } from 'next/server';
import { createRecord, getAll, invalidateCache } from '@/lib/db';

// POST: Create a new activity log
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, userName, userEmail, action, page, details, metadata } = body;

    if (!userId || !action || !page || !details) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const record = await createRecord('activityLogs', {
      userId,
      userName: userName || 'غير معروف',
      userEmail: userEmail || '',
      action,
      page,
      details,
      metadata: metadata || null,
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Error creating activity log:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: Fetch activity logs with optional filters
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const action = searchParams.get('action');

    let logs = await getAll<any>('activityLogs', 3000); // 3s TTL for activity logs

    // Apply filters
    if (userId) {
      logs = logs.filter((l: any) => l.userId === userId);
    }
    if (action) {
      logs = logs.filter((l: any) => l.action === action);
    }

    // Sort by timestamp desc
    logs.sort((a: any, b: any) => {
      const dateA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const dateB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return dateB - dateA;
    });

    // Limit to last 500
    logs = logs.slice(0, 500);

    return NextResponse.json(logs);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
