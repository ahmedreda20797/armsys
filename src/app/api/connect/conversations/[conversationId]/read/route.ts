// src/app/api/connect/conversations/[conversationId]/read/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — mark READ
//    POST { messageId? } — advances the member's monotonic read
//    cursor (transaction-guarded; a stale client can never regress
//    it). Absent messageId = the conversation's newest message.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { markRead } from '@/lib/connect/read-state-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { isJsonObject } from '@/lib/connect/validation';

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

    const ctx = await requireActiveMembership(conversationId, caller.userId);
    const raw = await request.json().catch(() => null);
    const messageId = isJsonObject(raw) && typeof raw.messageId === 'string' && raw.messageId.length <= 128
      ? raw.messageId
      : null;

    const result = await markRead(conversationId, caller.userId, messageId, ctx.conversation.lastMessageId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return connectErrorResponse(error, 'POST .../read');
  }
}
