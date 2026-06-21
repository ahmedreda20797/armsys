import { NextRequest, NextResponse } from 'next/server';
import { getById, updateRecord, deleteRecord } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import type { AppNotification } from '@/types';

// ══════════════════════════════════════════════════════════════
//  GET /api/notifications/[id] — Fetch single notification
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
//  Supports: mark read, acknowledge, resolve, archive, dismiss, assign
// ══════════════════════════════════════════════════════════════
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await getById<AppNotification>('notifications', id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
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
// ══════════════════════════════════════════════════════════════
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await getById('notifications', id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
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