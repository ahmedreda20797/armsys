// src/app/api/connect/conversations/[conversationId]/messages/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — messages
//    GET  — bounded pagination (newest page or older-before-cursor)
//    POST — send (idempotent via clientKey; sender identity ALWAYS
//           derived from the authenticated session — never the body)
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import {
  getLatestMessagePage,
  getOlderMessagePage,
  loadSendContext,
  sendMessage,
} from '@/lib/connect/message-service';
import { notifyNewMessage, notifyMentions } from '@/lib/connect/notification-bridge';
import { isJsonObject, parseBoundedIntParam, validateMentions, validateReferences } from '@/lib/connect/validation';
import { MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE_MAX } from '@/lib/connect/constants';
import { filterMutedRecipients } from '@/lib/connect/conversation-service';
import { loadUserProfiles } from '@/lib/connect/membership';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    // §CONNECT-GATE — canonical authenticate+authorize entry (one check,
    // request-memoized; the page 'connect' view gate ties the API to the
    // same permission the sidebar uses).
    const { caller, decision } = await authorizeRequest(request, { page: 'connect', action: 'view' });
    if (!caller) {
      return NextResponse.json({ error: 'لم يتم المصادقة على المستخدم' }, { status: 401 });
    }
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }
    const { conversationId } = await params;
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedIntParam(searchParams.get('limit'), MESSAGE_PAGE_SIZE, MESSAGE_PAGE_SIZE_MAX);
    const before = searchParams.get('before');

    // Membership gate for BOTH directions (§SECURITY: nonmembers
    // cannot retrieve messages — enforced before any query).
    const { ctx } = await loadSendContext(conversationId, caller.userId);
    void ctx;

    const page = before
      ? await getOlderMessagePage(conversationId, before, limit)
      : await getLatestMessagePage(conversationId, limit);
    return NextResponse.json({ data: page });
  } catch (error) {
    return connectErrorResponse(error, 'GET /api/connect/conversations/[id]/messages');
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    // §CONNECT-GATE — canonical authenticate+authorize entry (one check,
    // request-memoized; the page 'connect' view gate ties the API to the
    // same permission the sidebar uses).
    const { caller, decision } = await authorizeRequest(request, { page: 'connect', action: 'view' });
    if (!caller) {
      return NextResponse.json({ error: 'لم يتم المصادقة على المستخدم' }, { status: 401 });
    }
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }
    const { conversationId } = await params;
    const raw = await request.json().catch(() => null);
    if (!isJsonObject(raw)) {
      return NextResponse.json({ error: 'صيغة الطلب غير صالحة' }, { status: 400 });
    }

    const mentionsCheck = validateMentions(raw.mentions);
    if (!mentionsCheck.ok) return NextResponse.json({ error: mentionsCheck.error }, { status: 400 });
    const referencesCheck = validateReferences(raw.references);
    if (!referencesCheck.ok) return NextResponse.json({ error: referencesCheck.error }, { status: 400 });

    const replyToId = typeof raw.replyToId === 'string' && raw.replyToId.length > 0 && raw.replyToId.length <= 128
      ? raw.replyToId
      : null;

    const { ctx, activeMemberIds } = await loadSendContext(conversationId, caller.userId);

    // §SECURITY — sender identity comes from the SESSION only.
    const result = await sendMessage({
      conversationId,
      senderId: caller.userId,
      senderName: null, // resolved fresh from the users table inside the service
      body: typeof raw.body === 'string' ? raw.body : '',
      clientKey: typeof raw.clientKey === 'string' ? raw.clientKey : null,
      replyToId,
      mentions: mentionsCheck.mentions,
      references: referencesCheck.references,
      activeMemberIds,
      conversation: ctx.conversation,
    });

    if (result.status === 'created') {
      // Attach the fresh display name to the response (send snapshot
      // is resolved inside the service — re-resolving here is cached).
      const profiles = await loadUserProfiles([caller.userId]);
      result.message.senderName = profiles.get(caller.userId)?.name ?? result.message.senderName;

      // ── Notification bridge (fire-and-forget, never breaks send) ──
      void (async () => {
        try {
          const otherMembers = activeMemberIds.filter((uid) => uid !== caller.userId);
          const notifyTargets = await filterMutedRecipients(conversationId, otherMembers);
          await notifyNewMessage({
            kind: 'new_message',
            conversationId,
            conversationTitle: ctx.conversation.title,
            conversationType: ctx.conversation.type,
            recipientUserIds: ctx.conversation.type === 'direct'
              ? notifyTargets
              : [],
            senderUserId: caller.userId,
            senderName: result.message.senderName,
            excerpt: (result.message.body ?? '').slice(0, 140) || null,
            messageId: result.message.id,
          });
          if (result.message.mentions && result.message.mentions.length > 0) {
            const mentionTargets = await filterMutedRecipients(conversationId, result.message.mentions);
            await notifyMentions({
              kind: 'mention',
              conversationId,
              conversationTitle: ctx.conversation.title,
              conversationType: ctx.conversation.type,
              recipientUserIds: mentionTargets,
              senderUserId: caller.userId,
              senderName: result.message.senderName,
              excerpt: (result.message.body ?? '').slice(0, 140) || null,
              messageId: result.message.id,
            });
          }
        } catch { /* bridge failures never break messaging */ }
      })();
    }

    return NextResponse.json(
      { data: result },
      { status: result.status === 'created' ? 201 : 200 },
    );
  } catch (error) {
    return connectErrorResponse(error, 'POST /api/connect/conversations/[id]/messages');
  }
}
