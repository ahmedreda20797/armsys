// src/app/api/connect/conversations/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — /api/connect/conversations
//    GET  — the caller's conversation list (bounded, newest first)
//    POST — create: direct (get-or-create, race-safe) / group /
//           department (explicit membership materialization)
//  AUTH: every call authenticates + requires page 'connect' view.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/verify-permission';
import { getById } from '@/lib/db';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import {
  createGroupConversation,
  getOrCreateDirectConversation,
  listUserConversations,
} from '@/lib/connect/conversation-service';
import { CONVERSATION_LIST_POLL_MS, GROUP_MEMBERS_MAX, MESSAGE_PAGE_SIZE_MAX } from '@/lib/connect/constants';
import { isJsonObject, parseBoundedIntParam, validateConversationDescription, validateConversationTitle } from '@/lib/connect/validation';
import { isValidEntityId } from '@/lib/connect/ids';
import { loadUserProfiles } from '@/lib/connect/membership';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';
import { notifyAddedToGroup } from '@/lib/connect/notification-bridge';

export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const includeArchived = searchParams.get('includeArchived') === '1';
    const limit = parseBoundedIntParam(searchParams.get('limit'), 100, MESSAGE_PAGE_SIZE_MAX);

    const conversations = await listUserConversations(caller.userId, { includeArchived, limit });
    return NextResponse.json({ data: conversations, total: conversations.length });
  } catch (error) {
    return connectErrorResponse(error, 'GET /api/connect/conversations');
  }
}

export async function POST(request: NextRequest) {
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

    const profiles = await loadUserProfiles([caller.userId]);
    const creatorName = profiles.get(caller.userId)?.name ?? null;

    const raw = await request.json();
    if (!isJsonObject(raw)) {
      return NextResponse.json({ error: 'صيغة الطلب غير صالحة' }, { status: 400 });
    }

    const type = raw.type;

    // ── Direct: get-or-create THE conversation with the other user ──
    if (type === 'direct') {
      const { otherUserId } = raw as { otherUserId?: unknown };
      if (!isValidEntityId(otherUserId)) {
        return NextResponse.json({ error: 'معرّف المستخدم الآخر غير صالح' }, { status: 400 });
      }
      if (otherUserId === caller.userId) {
        return NextResponse.json({ error: 'لا يمكن إنشاء محادثة مباشرة مع نفسك' }, { status: 400 });
      }
      const otherUser = await getById<Record<string, unknown>>('users', otherUserId);
      if (!otherUser) {
        return NextResponse.json({ error: 'المستخدم المحدد غير موجود' }, { status: 400 });
      }
      // §ACCOUNT-STATUS — suspended accounts are inactive: no new
      // direct conversation can target them (existing conversations
      // are unaffected; display joins still resolve).
      if (otherUser.isSuspended === true) {
        return NextResponse.json({ error: 'الحساب المحدد غير نشط' }, { status: 400 });
      }

      const meProfile = profiles.get(caller.userId);
      const { conversation, created } = await getOrCreateDirectConversation(caller.userId, otherUserId, {
        me: meProfile?.name ?? null,
        other: (otherUser.name as string | undefined) ?? null,
      });
      return NextResponse.json({ data: conversation, created }, { status: created ? 201 : 200 });
    }

    // ── Group / Department: explicit membership materialization ──
    if (type === 'group' || type === 'department') {
      const { title, description, memberUserIds, deptNodeId } = raw as Record<string, unknown>;

      const titleCheck = validateConversationTitle(title, true);
      if (!titleCheck.ok) return NextResponse.json({ error: titleCheck.error }, { status: 400 });
      const descCheck = validateConversationDescription(description);
      if (!descCheck.ok) return NextResponse.json({ error: descCheck.error }, { status: 400 });

      if (!Array.isArray(memberUserIds) || memberUserIds.length + 1 > GROUP_MEMBERS_MAX) {
        return NextResponse.json({ error: `عدد الأعضاء غير صالح (الحد ${GROUP_MEMBERS_MAX})` }, { status: 400 });
      }
      const memberIds = memberUserIds.filter((id): id is string => isValidEntityId(id));

      // §DEPARTMENT — creating a department-tied group requires the
      // caller to hold the ORGANIZATION page permission (existing
      // organizational permission, no invented ones). The dept node
      // must exist. Membership is still EXPLICIT (materialized below) —
      // the node itself grants nothing.
      let resolvedDeptNodeId: string | null = null;
      if (type === 'department') {
        if (!isValidEntityId(deptNodeId)) {
          return NextResponse.json({ error: 'معرّف الجهة التنظيمية غير صالح' }, { status: 400 });
        }
        const orgDecision = await authorizeRequest(request, { page: 'organization', action: 'view' });
        if (!orgDecision.decision.allowed) {
          return NextResponse.json({ error: orgDecision.decision.reason }, { status: 403 });
        }
        const node = await getById<Record<string, unknown>>('orgNodes', deptNodeId);
        if (!node) {
          return NextResponse.json({ error: 'الجهة التنظيمية غير موجودة' }, { status: 400 });
        }
        resolvedDeptNodeId = deptNodeId;
      }

      const conversation = await createGroupConversation({
        creatorId: caller.userId,
        creatorName,
        type,
        title: titleCheck.title as string,
        description: descCheck.description,
        memberUserIds: memberIds,
        deptNodeId: resolvedDeptNodeId,
      });

      void (async () => {
        try {
          await writeConnectAudit({
            action: 'conversation_create',
            actorId: caller.userId,
            actorName: creatorName,
            conversationId: conversation.id,
            details: `إنشاء ${type === 'department' ? 'محادثة جهة' : 'مجموعة'} «${titleCheck.title}» بعدد أعضاء ${conversation.memberCount}`,
            after: { type, title: titleCheck.title, deptNodeId: resolvedDeptNodeId, memberCount: conversation.memberCount },
          });
          if (memberIds.length > 0) {
            await notifyAddedToGroup({
              kind: 'added_to_group',
              conversationId: conversation.id,
              conversationTitle: conversation.title,
              conversationType: type,
              recipientUserIds: memberIds,
              senderUserId: caller.userId,
              senderName: creatorName,
              excerpt: null,
            });
          }
        } catch { /* bridge failures never break creation */ }
      })();

      return NextResponse.json({ data: conversation, created: true }, { status: 201 });
    }

    return NextResponse.json({ error: 'نوع المحادثة غير مدعوم' }, { status: 400 });
  } catch (error) {
    return connectErrorResponse(error, 'POST /api/connect/conversations');
  }
}
