// src/app/api/connect/conversations/[conversationId]/pins/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — pinned messages
//    GET  — pinned roster (membership-gated)
//    POST { messageId, pinned } — pin/unpin
//         §PIN-POLICY: group/department → owner/admin;
//         direct → either participant.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { listPinnedMessages, setMessagePinned } from '@/lib/connect/message-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { isJsonObject } from '@/lib/connect/validation';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';
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
    await requireActiveMembership(conversationId, caller.userId);
    const pins = await listPinnedMessages(conversationId);
    return NextResponse.json({ data: pins });
  } catch (error) {
    return connectErrorResponse(error, 'GET .../pins');
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
    if (
      !isJsonObject(raw) ||
      typeof raw.messageId !== 'string' || raw.messageId.length === 0 || raw.messageId.length > 128 ||
      typeof raw.pinned !== 'boolean'
    ) {
      return NextResponse.json({ error: 'بيانات التثبيت غير صالحة' }, { status: 400 });
    }

    const ctx = await requireActiveMembership(conversationId, caller.userId);
    await setMessagePinned(conversationId, caller.userId, raw.messageId, raw.pinned, ctx);
    void writeConnectAudit({
      action: 'pin_change',
      actorId: caller.userId,
      actorName: await resolveSenderName(caller.userId),
      conversationId,
      messageId: raw.messageId,
      details: raw.pinned ? 'تثبيت رسالة' : 'إلغاء تثبيت رسالة',
      after: { pinned: raw.pinned },
    }).catch(() => undefined);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return connectErrorResponse(error, 'POST .../pins');
  }
}
