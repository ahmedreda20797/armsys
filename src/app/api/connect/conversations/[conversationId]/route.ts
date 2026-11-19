// src/app/api/connect/conversations/[conversationId]/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — one conversation
//    GET    — details (membership-gated; 404 for nonmembers/missing)
//    PATCH  — group meta (owner/admin) OR per-user state
//             ({archived, mutedUntil}) for any active member
//    DELETE — leave the conversation (owner must transfer first)
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import {
  canEditConversationMeta,
  getConversationDetails,
  leaveConversation,
  setArchived,
  setMutedUntil,
  transferOwnership,
  updateConversationMeta,
} from '@/lib/connect/conversation-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { isJsonObject, validateConversationDescription, validateConversationTitle } from '@/lib/connect/validation';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';
import { CONVERSATION_TITLE_MAX } from '@/lib/connect/constants';

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
    return NextResponse.json({ data: details });
  } catch (error) {
    return connectErrorResponse(error, 'GET /api/connect/conversations/[id]');
  }
}

export async function PATCH(
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

    const ctx = await requireActiveMembership(conversationId, caller.userId);

    // ── Per-user state (any active member) ──
    const isUserState = raw.archived !== undefined || raw.mutedUntil !== undefined;
    if (isUserState) {
      if (raw.archived !== undefined) {
        await setArchived(conversationId, caller.userId, raw.archived === true);
      }
      if (raw.mutedUntil !== undefined) {
        const muted = typeof raw.mutedUntil === 'number' && raw.mutedUntil >= 0 ? raw.mutedUntil : null;
        await setMutedUntil(conversationId, caller.userId, muted && muted > Date.now() ? muted : null);
      }
      return NextResponse.json({ data: { ok: true } });
    }

    // ── Group meta (owner/admin, groups only — direct titles are derived) ──
    const wantsMeta = raw.title !== undefined || raw.description !== undefined;
    if (wantsMeta) {
      if (!canEditConversationMeta(ctx.conversation)) {
        return NextResponse.json({ error: 'لا يمكن تعديل بيانات المحادثة المباشرة' }, { status: 400 });
      }
      if (ctx.member.role !== 'owner' && ctx.member.role !== 'admin') {
        return NextResponse.json({ error: 'التغيير متاح لمالك أو مشرف المجموعة' }, { status: 403 });
      }

      const patch: { title?: string; description?: string | null } = {};
      if (raw.title !== undefined) {
        const titleCheck = validateConversationTitle(raw.title, true);
        if (!titleCheck.ok) return NextResponse.json({ error: titleCheck.error }, { status: 400 });
        patch.title = titleCheck.title as string;
        void (async () => {
          try {
            await writeConnectAudit({
              action: 'conversation_update',
              actorId: caller.userId,
              actorName: null,
              conversationId,
              details: `تعديل عنوان المجموعة إلى «${(patch.title ?? '').slice(0, CONVERSATION_TITLE_MAX)}»`,
              before: { title: ctx.conversation.title },
              after: { title: patch.title },
            });
          } catch { /* never break */ }
        })();
      }
      if (raw.description !== undefined) {
        const descCheck = validateConversationDescription(raw.description);
        if (!descCheck.ok) return NextResponse.json({ error: descCheck.error }, { status: 400 });
        patch.description = descCheck.description;
      }
      await updateConversationMeta(conversationId, patch);
      return NextResponse.json({ data: { ok: true } });
    }

    // ── Ownership transfer (owner → target, actor demoted to admin) ──
    if (raw.transferOwnershipTo !== undefined) {
      if (ctx.member.role !== 'owner') {
        return NextResponse.json({ error: 'نقل الملكية متاح للمالك فقط' }, { status: 403 });
      }
      const target = raw.transferOwnershipTo;
      if (typeof target !== 'string' || target.length === 0 || target.length > 128) {
        return NextResponse.json({ error: 'معرّف العضو غير صالح' }, { status: 400 });
      }
      await transferOwnership(conversationId, caller.userId, target);
      void writeConnectAudit({
        action: 'role_change',
        actorId: caller.userId,
        actorName: null,
        conversationId,
        targetUserId: target,
        details: 'نقل ملكية المجموعة',
        after: { role: 'owner' },
      }).catch(() => undefined);
      return NextResponse.json({ data: { ok: true } });
    }

    return NextResponse.json({ error: 'لا يوجد تغيير مطلوب' }, { status: 400 });
  } catch (error) {
    return connectErrorResponse(error, 'PATCH /api/connect/conversations/[id]');
  }
}

export async function DELETE(
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
    await leaveConversation(conversationId, caller.userId);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return connectErrorResponse(error, 'DELETE /api/connect/conversations/[id]');
  }
}
