// src/app/api/connect/conversations/[conversationId]/messages/[messageId]/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — one message
//    GET    — single message (membership-gated; deep-link safe)
//    PATCH  — edit (AUTHOR only, within EDIT_WINDOW_MS — §EDIT-POLICY)
//    DELETE — tombstone (author or conversation owner/admin);
//             ?mode=purge → permanent deletion, SYSTEM ADMIN ONLY
//             (page 'connect' delete authorization — admin bypass is
//             the only tier that holds it; §DELETION policy)
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/verify-permission';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import {
  deleteMessageTombstone,
  editMessage,
  loadSendContext,
  purgeMessage,
  resolveSenderName,
} from '@/lib/connect/message-service';
import { getMessageForViewer } from '@/lib/connect/sync-service';
import { validateMessageBody } from '@/lib/connect/validation';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
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
    const { conversationId, messageId } = await params;
    const { ctx } = await loadSendContext(conversationId, caller.userId);
    const message = await getMessageForViewer(ctx, messageId);
    if (!message) {
      return NextResponse.json({ error: 'الرسالة غير موجودة' }, { status: 404 });
    }
    return NextResponse.json({ data: message });
  } catch (error) {
    return connectErrorResponse(error, 'GET .../messages/[messageId]');
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
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
    const { conversationId, messageId } = await params;
    const raw = await request.json().catch(() => null);
    const bodyCheck = validateMessageBody(raw?.body);
    if (!bodyCheck.ok) {
      return NextResponse.json({ error: bodyCheck.error }, { status: 400 });
    }

    // Membership gate happens inside editMessage via loadSendContext —
    // run it first for the audit actor name.
    await loadSendContext(conversationId, caller.userId);
    const updated = await editMessage(conversationId, caller.userId, messageId, raw.body);
    void (async () => {
      try {
        await writeConnectAudit({
          action: 'message_edit',
          actorId: caller.userId,
          actorName: await resolveSenderName(caller.userId),
          conversationId,
          messageId,
          details: 'تعديل رسالة (المحتوى غير مسجّل)',
        });
      } catch { /* never break */ }
    })();
    return NextResponse.json({ data: updated });
  } catch (error) {
    return connectErrorResponse(error, 'PATCH .../messages/[messageId]');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; messageId: string }> },
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
    const { conversationId, messageId } = await params;
    const mode = new URL(request.url).searchParams.get('mode') ?? 'tombstone';

    if (mode === 'purge') {
      // §DELETION — permanent removal is a SYSTEM-ADMIN operation and
      // deliberately does NOT require conversation membership (the
      // system administrator may purge from any conversation).
      const deleteDecision = await authorizeRequest(request, { page: 'connect', action: 'delete' });
      if (!deleteDecision.decision.allowed) {
        return NextResponse.json({ error: deleteDecision.decision.reason }, { status: 403 });
      }
      await purgeMessage(conversationId, messageId);
      void writeConnectAudit({
        action: 'message_purge',
        actorId: caller.userId,
        actorName: await resolveSenderName(caller.userId),
        conversationId,
        messageId,
        details: 'حذف نهائي لرسالة (المحتوى غير قابل للاسترجاع — البيانات الوصفية فقط في السجل)',
      }).catch(() => undefined);
      return NextResponse.json({ data: { ok: true, mode: 'purged' } });
    }

    // Tombstone requires ACTIVE membership (author or conversation
    // owner/admin inside editMessage's gates).
    const { ctx } = await loadSendContext(conversationId, caller.userId);
    const tombstone = await deleteMessageTombstone(conversationId, caller.userId, messageId, ctx);
    void writeConnectAudit({
      action: 'message_delete',
      actorId: caller.userId,
      actorName: await resolveSenderName(caller.userId),
      conversationId,
      messageId,
      details: 'حذف رسالة (tombstone — النص أزيل من قاعدة البيانات)',
    }).catch(() => undefined);
    return NextResponse.json({ data: tombstone });
  } catch (error) {
    return connectErrorResponse(error, 'DELETE .../messages/[messageId]');
  }
}
