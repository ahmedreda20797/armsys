import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import { filterVisibleNotifications } from '@/lib/notifications/recipient-visibility';
import type { AppNotification } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications — Fetch with server-side filtering
//  SECURITY: Recipient + permission visibility (single rule in
//  lib/notifications/recipient-visibility — shared with the [id]
//  route and notification-stats)
// ══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);

    const priority = searchParams.get('priority');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const moduleName = searchParams.get('module');
    const employeeId = searchParams.get('employeeId');
    const assignedTo = searchParams.get('assignedTo');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // §DOWNLOAD-OPT — TTL.POLL (30s): this route is polled every 45s per
    // client, and every cache miss re-downloads the FULL notifications
    // table. The long window is correctness-safe because every write
    // path (create/PATCH/mark-all-read/delete) goes through db.ts and
    // invalidates this table's cache immediately, so a new notification
    // or a read-status change is visible on the first poll after the
    // write — only unchanged history is shared between pollers.
    let records = await getAll<AppNotification>('notifications', TTL.POLL);

    // ─── RECIPIENT + PERMISSION VISIBILITY ───
    // Single rule (admin bypass; directed exact-match; broadcast for
    // eligible staff; page-content permission gate) — see recipient-visibility.
    records = filterVisibleNotifications(records, {
      userId: auth.userId,
      role: auth.role,
      permissions: auth.permissions,
      linkedEmployeeId: auth.linkedEmployeeId ?? null,
    });
    // Snapshot AFTER visibility (the authorization boundary) and
    // BEFORE any narrowing filters — the count covers everything
    // this viewer may see, regardless of the query's filters.
    const visibleForCount = records;

    // Server-side filters
    if (priority) records = records.filter((r) => r.priority === priority);
    if (status) records = records.filter((r) => r.status === status);
    if (category) records = records.filter((r) => r.category === category);
    if (moduleName) records = records.filter((r) => r.sourceModule === moduleName);
    if (employeeId) records = records.filter((r) => r.employeeId === employeeId);
    if (assignedTo) records = records.filter((r) => r.assignedTo === assignedTo);
    if (search) {
      const lowerSearch = search.toLowerCase();
      records = records.filter(
        (r) =>
          r.title.toLowerCase().includes(lowerSearch) ||
          r.description.toLowerCase().includes(lowerSearch)
      );
    }
    if (dateFrom) records = records.filter((r) => r.createdAt >= dateFrom);
    if (dateTo) records = records.filter((r) => r.createdAt <= dateTo + 'T23:59:59.999Z');

    // Sort by createdAt descending (newest first)
    records.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    // §16 — the TRUE unread count (over ALL visible notifications,
    // before the date/limit windows) so the bell badge can never
    // disagree with the panel.
    const unreadCount = visibleForCount.filter((r) => r.status === 'unread').length;

    // Apply pagination
    const paginated = records.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      total: records.length,
      unreadCount,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[GET /api/notifications] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/notifications — Create manual notification
//  SECURITY: Requires 'create' permission on 'notifications'
// ══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    // RBAC check: require 'create' permission
    const permCheck = await verifyPermission(request, 'notifications', 'create');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const body = await request.json();

    const {
      title,
      description,
      priority,
      category,
      sourceModule,
      sourceRecordId,
      employeeId,
      assignedTo,
      sourceType,
      targetPage,
    } = body;

    if (!title) {
      return NextResponse.json(
        { error: 'title is required' },
        { status: 400 }
      );
    }

    // Validate employee exists if provided (optional field)
    if (employeeId) {
      const { validateEmployeeId } = await import('@/lib/validate-employee');
      const empValidation = await validateEmployeeId(employeeId, false);
      if (!empValidation.valid) {
        return NextResponse.json({ error: empValidation.error }, { status: 400 });
      }
    }

    const validPriorities = ['low', 'medium', 'high', 'critical'];
    const validCategories = [
      'attendance', 'biometric', 'requests', 'quality', 'hr', 'risk',
      'followUp', 'employee', 'travel', 'system', 'automation', 'complaint', 'capa',
    ];

    const notification = await createRecord<AppNotification>('notifications', {
      title,
      description: description || '',
      priority: validPriorities.includes(priority) ? priority : 'medium',
      status: 'unread',
      category: validCategories.includes(category) ? category : 'system',
      sourceModule: sourceModule || 'manual',
      sourceRecordId: sourceRecordId || null,
      employeeId: employeeId || null,
      employeeName: body.employeeName || null,
      assignedTo: assignedTo || null,
      assignedToName: body.assignedToName || null,
      createdBy: permCheck.user?.id || null,
      ruleId: null,
      ruleName: null,
      actionUrl: body.actionUrl || null,
      sourceType: sourceType || null,
      targetPage: targetPage || null,
    });

    return NextResponse.json(notification, { status: 201 });
  } catch (error) {
    console.error('[POST /api/notifications] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
