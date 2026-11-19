// src/app/api/connect/conversations/[conversationId]/typing/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — typing ping
//    POST — sets THIS user's typing entry with an expiry timestamp
//    (TYPING_TTL_MS). Indicators expire automatically even if the
//    browser dies mid-typing — no cleanup dependency (§SPEC-11).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { setTyping } from '@/lib/connect/read-state-service';
import { requireActiveMembership } from '@/lib/connect/membership';

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

    await requireActiveMembership(conversationId, caller.userId);
    await setTyping(conversationId, caller.userId);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return connectErrorResponse(error, 'POST .../typing');
  }
}
