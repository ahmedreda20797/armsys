import { NextRequest, NextResponse } from 'next/server';
import { getAll, createRecord, TTL } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import type { AppNotification } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications — Fetch with server-side filtering
//  SECURITY: Users can only see their own notifications unless admin/quality/hr/manager
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
    const module = searchParams.get('module');
    const employeeId = searchParams.get('employeeId');
    const assignedTo = searchParams.get('assignedTo');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const limit = parseInt(searchParams.get('limit') || '100', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    let records = await getAll<AppNotification>('notifications', TTL.DEFAULT);

    // ─── OWNERSHIP FILTER: Non-admin users only see their own notifications ───
    const isAdmin = auth.role === 'admin';
    const isManagerOrAbove = auth.role === 'admin' || auth.role === 'manager' || auth.role === 'quality' || auth.role === 'hr';

    if (!isAdmin) {
      records = records.filter(
        (r) => r.employeeId === auth.userId || r.assignedTo === auth.userId
      );
    }

    // Server-side filters
    if (priority) records = records.filter((r) => r.priority === priority);
    if (status) records = records.filter((r) => r.status === status);
    if (category) records = records.filter((r) => r.category === category);
    if (module) records = records.filter((r) => r.sourceModule === module);
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

    // Apply pagination
    const paginated = records.slice(offset, offset + limit);

    return NextResponse.json({
      data: paginated,
      total: records.length,
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
