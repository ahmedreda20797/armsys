// src/app/api/connect/conversations/[conversationId]/sync/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — incremental sync (active conversation polling)
//    GET ?cursor={messageId}&sinceMs={n}
//  Membership-gated; delivery cursors advance because the server
//  SERVED the messages here (markDelivered inside the service).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { syncConversation } from '@/lib/connect/sync-service';
import { loadSendContext } from '@/lib/connect/message-service';

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

    const cursorRaw = searchParams.get('cursor');
    const cursor = cursorRaw && cursorRaw.length > 0 && cursorRaw.length <= 128 ? cursorRaw : null;
    const sinceRaw = searchParams.get('sinceMs');
    const sinceMs = sinceRaw ? Number.parseInt(sinceRaw, 10) : null;
    // §SYNC-CONTINUATION — composite cursor key (push key of the last
    // processed update at sinceMs; RTDB orders value ties by key).
    const sinceKeyRaw = searchParams.get('sinceKey');
    const sinceKey = sinceKeyRaw && sinceKeyRaw.length > 0 && sinceKeyRaw.length <= 128 ? sinceKeyRaw : null;

    const { ctx } = await loadSendContext(conversationId, caller.userId);
    const payload = await syncConversation(ctx, { cursor, sinceMs: Number.isFinite(sinceMs) ? sinceMs : null, sinceKey });
    return NextResponse.json({ data: payload });
  } catch (error) {
    return connectErrorResponse(error, 'GET .../sync');
  }
}
