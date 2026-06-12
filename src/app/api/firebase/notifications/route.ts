import { NextRequest, NextResponse } from 'next/server';
import { isFirebaseConfigured, getFirebaseAdmin } from '@/lib/firebase-server';
import { getDatabase } from 'firebase-admin/database';
import { createId } from '@paralleldrive/cuid2';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  read: boolean;
  createdAt: string;
}

// ──────────────────────────────────────────────
// GET — fetch notifications from Firebase RTDB
// ──────────────────────────────────────────────
export async function GET() {
  try {
    // If Firebase not configured, return empty array gracefully
    if (!isFirebaseConfigured()) {
      return NextResponse.json([]);
    }

    const app = getFirebaseAdmin();
    const rtdb = getDatabase(app);
    const snapshot = await rtdb.ref('erp/notifications').once('value');

    if (!snapshot.exists()) {
      return NextResponse.json([]);
    }

    const data = snapshot.val();
    // Firebase stores data as an object keyed by notification IDs
    const notifications: Notification[] = Object.entries(data).map(
      ([id, value]) => ({
        id,
        ...(value as Omit<Notification, 'id'>),
      })
    );

    // Sort by createdAt descending (newest first)
    notifications.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json(notifications);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير معروف';
    return NextResponse.json(
      { error: `فشل جلب الإشعارات: ${message}` },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// POST — create a new notification in Firebase RTDB
// ──────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // If Firebase not configured, return error
    if (!isFirebaseConfigured()) {
      return NextResponse.json(
        {
          success: false,
          error: 'Firebase غير مهيأ على الخادم',
        },
        { status: 503 }
      );
    }

    const body = await request.json();

    const { title, body: notificationBody, type } = body as {
      title?: string;
      body?: string;
      type?: string;
    };

    // Validate required fields
    if (!title || !notificationBody) {
      return NextResponse.json(
        { success: false, error: 'العنوان والمحتوى مطلوبان' },
        { status: 400 }
      );
    }

    const validTypes = ['travel', 'request', 'attendance', 'system'];
    const notificationType = type && validTypes.includes(type) ? type : 'system';

    // Build notification object
    const notification: Notification = {
      id: createId(),
      title,
      body: notificationBody,
      type: notificationType,
      read: false,
      createdAt: new Date().toISOString(),
    };

    // Write to Firebase RTDB
    const app = getFirebaseAdmin();
    const rtdb = getDatabase(app);
    await rtdb.ref(`erp/notifications/${notification.id}`).set(notification);

    return NextResponse.json({
      success: true,
      notification,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'خطأ غير معروف';
    return NextResponse.json(
      { success: false, error: `فشل إنشاء الإشعار: ${message}` },
      { status: 500 }
    );
  }
}
