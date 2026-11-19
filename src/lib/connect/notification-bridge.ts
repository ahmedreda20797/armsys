// src/lib/connect/notification-bridge.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — NOTIFICATION BRIDGE
//
//  Integrates with the EXISTING QNALYS notification system (the
//  shared `notifications` table consumed by the bell popover) — NO
//  second notification engine.
//
//  Volume policy (§SPEC-12 "avoid excessive notifications"):
//    • Direct conversation message → ONE "رسالة جديدة من {sender}"
//      notification per conversation per CONNECT_NOTIFY_DEDUP_WINDOW_MS
//      (the window dedup keeps a busy DM from flooding the bell; the
//      conversation list badge still counts every message).
//    • Group/department message → NO broadcast notification. Members
//      see the unread badge in Connect. Only @mentions notify.
//    • Mention → one notification per mentioned member (explicit
//      call-out — bypasses the window dedup, per-message).
//    • Added to group → one notification.
//
//  Delivery model mirrors lib/notifications/routing: a directed
//  record with `recipientUserIds` + targetPage 'connect' +
//  navParams.conversationId (the deep link the Connect page consumes).
//  Fire-and-forget: notification failures never break messaging.
// ══════════════════════════════════════════════════════════════

import 'server-only';

import { findWhere, createRecord } from '@/lib/db';
import {
  CONNECT_NOTIFY_DEDUP_WINDOW_MS,
  CONNECT_SOURCE_MODULE,
} from './constants';

interface ConnectNotificationOptions {
  kind: 'new_message' | 'mention' | 'added_to_group';
  conversationId: string;
  conversationTitle: string | null;
  conversationType: 'direct' | 'group' | 'department';
  recipientUserIds: string[];
  /** Excluded implicitly: recipients are resolved by the caller. */
  senderUserId: string;
  senderName: string | null;
  /** Preview excerpt (already length-bounded by the caller). */
  excerpt: string | null;
  messageId?: string | null;
}

function buildTitle(kind: ConnectNotificationOptions['kind'], senderName: string, opts: ConnectNotificationOptions): string {
  switch (kind) {
    case 'new_message':
      return `رسالة جديدة من ${senderName}`;
    case 'mention':
      return `${senderName} أشار إليك في ${opts.conversationTitle ?? 'محادثة'}`;
    case 'added_to_group':
      return `تمت إضافتك إلى مجموعة «${opts.conversationTitle ?? 'بدون عنوان'}»`;
  }
}

/**
 * Write one directed notification. Internal — callers resolve the
 * dedup policy; this only persists. Never throws.
 */
async function writeConnectNotification(options: ConnectNotificationOptions): Promise<void> {
  const title = buildTitle(options.kind, options.senderName ?? 'مستخدم', options);
  const description = options.kind === 'added_to_group'
    ? 'لديك محادثة جديدة في وحدة تواصل'
    : options.excerpt
      ? options.excerpt
      : 'رسالة جديدة في وحدة تواصل';

  await createRecord('notifications', {
    title,
    description,
    priority: options.kind === 'mention' ? 'high' : 'medium',
    status: 'unread',
    // 'system' — the AppNotification category union is a CLOSED set in
    // src/types (extending it would touch every consumer); Connect
    // rides 'system' + sourceModule 'connect' for routing/filtering.
    category: 'system',
    sourceModule: CONNECT_SOURCE_MODULE,
    sourceType: 'automation',
    sourceRecordId: options.conversationId,
    employeeId: null,
    employeeName: null,
    assignedTo: null,
    assignedToName: null,
    ruleId: null,
    ruleName: null,
    actionUrl: null,
    targetPage: 'connect',
    recipientUserIds: options.recipientUserIds,
    navParams: {
      conversationId: options.conversationId,
      ...(options.messageId ? { messageId: options.messageId } : {}),
    },
  });
}

/** Is there an UNREAD new-message notification for this conversation inside the dedup window? */
async function hasRecentUnreadNotificationForConversation(conversationId: string, nowMs: number): Promise<boolean> {
  try {
    const existing = await findWhere<Record<string, any>>('notifications', {
      sourceModule: CONNECT_SOURCE_MODULE,
      sourceRecordId: conversationId,
    });
    return existing.some((n) => {
      if (n.status !== 'unread') return false;
      const createdAtMs = new Date(n.createdAt ?? '').getTime();
      if (!Number.isFinite(createdAtMs)) return false;
      return nowMs - createdAtMs < CONNECT_NOTIFY_DEDUP_WINDOW_MS;
    });
  } catch {
    // Dedup probe failure → fail CLOSED toward silence (no duplicate flood).
    return true;
  }
}

/**
 * Notify recipients about a NEW message according to the volume
 * policy above. `recipientUserIds` must be resolved + filtered by
 * the caller (active members, excluding the sender, excluding muted).
 */
export async function notifyNewMessage(options: ConnectNotificationOptions): Promise<void> {
  try {
    if (options.recipientUserIds.length === 0) return;

    // Direct conversations: window-deduped "new message" notification.
    // Group/department: silent (badge-driven), EXCEPT mentions which
    // the caller sends separately.
    if (options.kind === 'new_message' && options.conversationType === 'direct') {
      const nowMs = Date.now();
      if (await hasRecentUnreadNotificationForConversation(options.conversationId, nowMs)) return;
    } else if (options.kind === 'new_message') {
      return;
    }

    await writeConnectNotification(options);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      module: 'connect/notification-bridge',
      op: 'notifyNewMessage',
      message: error instanceof Error ? error.message : String(error),
      conversationId: options.conversationId,
    }));
  }
}

/**
 * Mention notifications — one per mentioned member, per message
 * (no window dedup: an explicit mention is a direct call-out).
 */
export async function notifyMentions(options: ConnectNotificationOptions): Promise<void> {
  try {
    if (options.recipientUserIds.length === 0) return;
    await writeConnectNotification({ ...options, kind: 'mention' });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      module: 'connect/notification-bridge',
      op: 'notifyMentions',
      message: error instanceof Error ? error.message : String(error),
      conversationId: options.conversationId,
    }));
  }
}

/** Notify users they were added to a group. Never throws. */
export async function notifyAddedToGroup(options: ConnectNotificationOptions): Promise<void> {
  try {
    if (options.recipientUserIds.length === 0) return;
    await writeConnectNotification({ ...options, kind: 'added_to_group' });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      module: 'connect/notification-bridge',
      op: 'notifyAddedToGroup',
      message: error instanceof Error ? error.message : String(error),
      conversationId: options.conversationId,
    }));
  }
}
