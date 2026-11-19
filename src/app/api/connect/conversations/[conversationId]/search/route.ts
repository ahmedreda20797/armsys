// src/app/api/connect/conversations/[conversationId]/search/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — in-conversation search
//    GET ?q={query}
//  Membership-gated (nonmembers cannot search — §SECURITY); bounded
//  server-side scan of the newest SEARCH_SCAN_LIMIT messages; only
//  SEARCH_RESULT_LIMIT matches travel to the client (§SPEC-13).
//  Global cross-conversation search is explicitly NOT in 1.0.
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { searchConversationMessages } from '@/lib/connect/message-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from '@/lib/connect/constants';

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

    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (q.length < SEARCH_QUERY_MIN) {
      return NextResponse.json({ error: `اكتب ${SEARCH_QUERY_MIN} أحرف على الأقل للبحث` }, { status: 400 });
    }
    if (q.length > SEARCH_QUERY_MAX) {
      return NextResponse.json({ error: `استعلام البحث طويل جداً (الحد ${SEARCH_QUERY_MAX} حرف)` }, { status: 400 });
    }

    const result = await searchConversationMessages(conversationId, q);
    return NextResponse.json({ data: result });
  } catch (error) {
    return connectErrorResponse(error, 'GET .../search');
  }
}
