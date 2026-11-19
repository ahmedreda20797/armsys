// src/app/api/connect/conversations/[conversationId]/members/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — members
//    GET  — member roster (membership-gated)
//    POST — add members (owner/admin; department relationships are
//           NEVER a substitute for an explicit member record)
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { addMembers, getConversationDetails, loadMembers } from '@/lib/connect/conversation-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { isJsonObject } from '@/lib/connect/validation';
import { GROUP_MEMBERS_MAX } from '@/lib/connect/constants';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';
import { notifyAddedToGroup } from '@/lib/connect/notification-bridge';
import { resolveSenderName } from '@/lib/connect/message-service';

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
    const ctx = await requireActiveMembership(conversationId, caller.userId);
    const details = await getConversationDetails(ctx, caller.userId);
    return NextResponse.json({ data: details.members });
  } catch (error) {
    return connectErrorResponse(error, 'GET .../members');
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
    if (!isJsonObject(raw) || !Array.isArray(raw.userIds) || raw.userIds.length === 0) {
      return NextResponse.json({ error: 'قائمة الأعضاء المطلوب إضافتهم مطلوبة' }, { status: 400 });
    }

    const ctx = await requireActiveMembership(conversationId, caller.userId);
    if (ctx.conversation.type === 'direct') {
      return NextResponse.json({ error: 'لا يمكن إضافة أعضاء لمحادثة مباشرة' }, { status: 400 });
    }
    if (ctx.member.role !== 'owner' && ctx.member.role !== 'admin') {
      return NextResponse.json({ error: 'إضافة الأعضاء متاحة لمالك أو مشرف المجموعة' }, { status: 403 });
    }
    if (ctx.conversation.memberCount + raw.userIds.length > GROUP_MEMBERS_MAX) {
      return NextResponse.json({ error: `عدد الأعضاء يتجاوز الحد (${GROUP_MEMBERS_MAX})` }, { status: 400 });
    }

    const userIds = raw.userIds.filter((id: unknown): id is string => typeof id === 'string' && id.length >= 1 && id.length <= 128);
    const activated = await addMembers(conversationId, caller.userId, userIds, ctx.conversation);

    const actorName = await resolveSenderName(caller.userId);
    void (async () => {
      try {
        await writeConnectAudit({
          action: 'member_add',
          actorId: caller.userId,
          actorName,
          conversationId,
          details: `إضافة ${activated.length} عضو إلى المجموعة`,
          after: { addedUserIds: activated },
        });
        if (activated.length > 0) {
          await notifyAddedToGroup({
            kind: 'added_to_group',
            conversationId,
            conversationTitle: ctx.conversation.title,
            conversationType: ctx.conversation.type,
            recipientUserIds: activated,
            senderUserId: caller.userId,
            senderName: actorName,
            excerpt: null,
          });
        }
      } catch { /* never break */ }
    })();

    return NextResponse.json({ data: { activated, members: await loadMembers(conversationId) } }, { status: 201 });
  } catch (error) {
    return connectErrorResponse(error, 'POST .../members');
  }
}
