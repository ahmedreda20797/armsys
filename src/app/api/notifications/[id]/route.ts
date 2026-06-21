import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { verifyPermission, requireAuth } from '@/lib/verify-permission';
import type { AppNotification } from '@/types';

/**
 * Check if a user owns a notification or has admin-level access.
 * Ownership: notification.employeeId === userId OR notification.assignedTo === userId
 */
function canAccessNotification(
  notification: AppNotification,
  userId: string,
  role: string
): boolean {
  if (role === 'admin') return true;
  return (
    notification.employeeId === userId ||
    notification.assignedTo === userId
  );
}

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications/[id] — Fetch single notification
//  SECURITY: Ownership check — users can only view their own
// ══════════════════════════════════════════════════════════════
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const notification = await getById<AppNotification>('notifications', id);

    if (!notification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Ownership check
    if (!canAccessNotification(notification, auth.userId, auth.role)) {
      console.warn(
        `[SECURITY] Unauthorized notification access attempt. ` +
        `User: ${auth.userId}, Notification: ${id}, Time: ${new Date().toISOString()}`
      );
      return NextResponse.json(
        { error: 'You do not have permission to view this notification' },
        { status: 403 }
      );
    }

    return NextResponse.json(notification);
  } catch (error) {
    console.error('[GET /api/notifications/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  PATCH /api/notifications/[id] — Update notification
//  SECURITY: Ownership + RBAC — users can only update their own
// ══════════════════════════════════════════════════════════════
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // RBAC check
    const permCheck = await verifyPermission(request, 'notifications', 'update');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getById('notifications', id) as AppNotification | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Ownership check
    if (!canAccessNotification(existing, permCheck.user!.id, permCheck.user!.role)) {
      console.warn(
        `[SECURITY] Unauthorized notification update attempt. ` +
        `User: ${permCheck.user!.id}, Notification: ${id}, Time: ${new Date().toISOString()}`
      );
      return NextResponse.json(
        { error: 'You do not have permission to update this notification' },
        { status: 403 }
      );
    }

    const updateData: Record<string, any> = {};
    const now = new Date().toISOString();
    const { status, assignedTo, assignedToName } = body;

    // Validate status transition
    const validStatuses = ['unread', 'read', 'acknowledged', 'resolved', 'archived', 'dismissed'];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    if (status !== undefined) {
      updateData.status = status;

      // Auto-set timestamps based on status
      switch (status) {
        case 'read':
          updateData.readAt = now;
          break;
        case 'acknowledged':
          updateData.acknowledgedAt = now;
          if (!existing.readAt) updateData.readAt = now;
          break;
        case 'resolved':
          updateData.resolvedAt = now;
          if (!existing.readAt) updateData.readAt = now;
          if (!existing.acknowledgedAt) updateData.acknowledgedAt = now;
          break;
      }
    }

    if (assignedTo !== undefined) {
      updateData.assignedTo = assignedTo || null;
    }
    if (assignedToName !== undefined) {
      updateData.assignedToName = assignedToName || null;
    }

    // Track who made the change
    updateData.updatedBy = permCheck.user?.id || null;
    updateData.updatedAt = now;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const updated = await updateRecord('notifications', id, updateData);

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[PATCH /api/notifications/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// ══════════════════════════════════════════════════════════════
//  DELETE /api/notifications/[id] — Delete notification
//  SECURITY: Ownership + RBAC — users can only delete their own
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // RBAC check
    const permCheck = await verifyPermission(request, 'notifications', 'delete');
    if (!permCheck.allowed) {
      return NextResponse.json({ error: permCheck.error }, { status: 403 });
    }

    const { id } = await params;

    const existing = await getById('notifications', id) as AppNotification | undefined;
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Ownership check
    if (!canAccessNotification(existing, permCheck.user!.id, permCheck.user!.role)) {
      console.warn(
        `[SECURITY] Unauthorized notification delete attempt. ` +
        `User: ${permCheck.user!.id}, Notification: ${id}, Time: ${new Date().toISOString()}`
      );
      return NextResponse.json(
        { error: 'You do not have permission to delete this notification' },
        { status: 403 }
      );
    }

    await deleteRecord('notifications', id);

    return NextResponse.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('[DELETE /api/notifications/:id] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
