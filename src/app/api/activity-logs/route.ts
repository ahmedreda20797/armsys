import { NextRequest, NextResponse } from 'next/server';
import { createRecord, getAll } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';

// POST: Create a new audit log entry
export async function POST(request: NextRequest) {
  try {
    // Server-side permission check: any authenticated user can create activity logs
    const check = await verifyPermission(request, 'home', 'view');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }
    const body = await request.json();
    const {
      userId, userName, userEmail, action, page, details, metadata,
      module: mod, beforeValue, afterValue, ipAddress, browser, device,
    } = body;

    if (!userId || !action || !details) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const record = await createRecord('activityLogs', {
      userId,
      userName: userName || 'غير معروف',
      userEmail: userEmail || '',
      action,
      page: page || mod || '',
      details,
      metadata: metadata || null,
      beforeValue: beforeValue ?? null,
      afterValue: afterValue ?? null,
      ipAddress: ipAddress || request.headers.get('x-forwarded-for') || '',
      browser: browser || '',
      device: device || '',
    });

    return NextResponse.json(record, { status: 201 });
  } catch (error) {
    console.error('Error creating activity log:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: Fetch audit logs with advanced filters
export async function GET(request: NextRequest) {
  try {
    // Server-side permission check: only admin can view activity logs
    const check = await verifyPermission(request, 'controlPanel', 'view');
    if (!check.allowed) {
      return NextResponse.json({ error: check.error }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId');
    const action = searchParams.get('action');
    const module_ = searchParams.get('module');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const keyword = searchParams.get('keyword');
    const limit = parseInt(searchParams.get('limit') || '500', 10);

    let logs = await getAll<any>('activityLogs', 3000);

    // Apply filters
    if (userId) logs = logs.filter((l: any) => l.userId === userId);
    if (action) logs = logs.filter((l: any) => l.action === action);
    if (module_) logs = logs.filter((l: any) => l.page === module_);
    if (keyword) {
      const kw = keyword.toLowerCase();
      logs = logs.filter((l: any) =>
        (l.details || '').toLowerCase().includes(kw) ||
        (l.userName || '').toLowerCase().includes(kw) ||
        (l.userEmail || '').toLowerCase().includes(kw) ||
        (l.ipAddress || '').toLowerCase().includes(kw)
      );
    }
    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      logs = logs.filter((l: any) => {
        const t = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        return t >= from;
      });
    }
    if (dateTo) {
      const to = new Date(dateTo).getTime();
      logs = logs.filter((l: any) => {
        const t = l.createdAt ? new Date(l.createdAt).getTime() : 0;
        return t <= to;
      });
    }

    // Sort by createdAt desc
    logs.sort((a: any, b: any) => {
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

    logs = logs.slice(0, limit);

    return NextResponse.json(logs);
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
