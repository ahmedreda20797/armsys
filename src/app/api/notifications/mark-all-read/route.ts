import { NextRequest, NextResponse } from 'next/server';
import { getAll, TTL, updateRecord } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import { canSeeNotification } from '@/lib/notifications/recipient-visibility';
import type { AppNotification } from '@/types';

// ══════════════════════════════════════════════════════════════
//  POST /api/notifications/mark-all-read — bulk "تعليم الكل كمقروء"
//
//  ROOT CAUSE: the old client-side flow fanned out ONE PATCH per
//  unread notification (N sequential requests). This endpoint marks
//  EVERY notification the caller is currently allowed to SEE (same
//  recipient-visibility rule as GET) in one round-trip. Only
//  status/readAt are touched — no other fields are writable here.
// ══════════════════════════════════════════════════════════════

export async function POST(request: NextRequest) {
  try {
    const permCheck = await verifyPermission(request, 'notifications', 'update');
    if (!permCheck.allowed || !permCheck.user) {
      return NextResponse.json({ error: permCheck.error ?? 'Forbidden' }, { status: 403 });
    }

    const viewer = {
      userId: permCheck.user.id,
      role: permCheck.user.role,
      permissions: permCheck.user.permissions,
      linkedEmployeeId: permCheck.user.linkedEmployeeId ?? null,
    };

    const all = await getAll<AppNotification>('notifications', TTL.DEFAULT);
    const now = new Date().toISOString();
    let updated = 0;

    for (const notif of all) {
      if (!notif || notif.status !== 'unread') continue;
      // Visibility re-checked per record — a user only ever marks what
      // they are allowed to see (same rule as the list route).
      if (!canSeeNotification(notif, viewer)) continue;
      await updateRecord('notifications', notif.id, {
        status: 'read',
        readAt: now,
        updatedBy: viewer.userId,
        updatedAt: now,
      });
      updated += 1;
    }

    return NextResponse.json({ success: true, updated });
  } catch (error) {
    console.error('[POST /api/notifications/mark-all-read] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
