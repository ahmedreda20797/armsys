// src/app/api/connect/conversations/[conversationId]/members/[memberId]/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — one member
//    PATCH  — role change (OWNER only; 'admin' | 'member')
//    DELETE — remove member (owner/admin; owner is irremovable —
//             immediate access loss: membership tombstoned + index
//             entry deleted in the same flow)
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { changeRole, removeMember } from '@/lib/connect/conversation-service';
import { requireActiveMembership } from '@/lib/connect/membership';
import { isJsonObject } from '@/lib/connect/validation';
import { writeConnectAudit } from '@/lib/connect/audit-bridge';
import { resolveSenderName } from '@/lib/connect/message-service';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; memberId: string }> },
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
    const { conversationId, memberId } = await params;
    const raw = await request.json().catch(() => null);
    if (!isJsonObject(raw) || (raw.role !== 'admin' && raw.role !== 'member')) {
      return NextResponse.json({ error: 'الدور المطلوب غير صالح (admin | member)' }, { status: 400 });
    }

    const ctx = await requireActiveMembership(conversationId, caller.userId);
    if (ctx.member.role !== 'owner') {
      return NextResponse.json({ error: 'تغيير الأدوار متاح لمالك المجموعة فقط' }, { status: 403 });
    }

    await changeRole(conversationId, caller.userId, memberId, raw.role);
    void writeConnectAudit({
      action: 'role_change',
      actorId: caller.userId,
      actorName: await resolveSenderName(caller.userId),
      conversationId,
      targetUserId: memberId,
      details: `تغيير دور العضو إلى ${raw.role === 'admin' ? 'مشرف' : 'عضو'}`,
      after: { role: raw.role },
    }).catch(() => undefined);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return connectErrorResponse(error, 'PATCH .../members/[memberId]');
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string; memberId: string }> },
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
    const { conversationId, memberId } = await params;

    const ctx = await requireActiveMembership(conversationId, caller.userId);
    if (ctx.member.role !== 'owner' && ctx.member.role !== 'admin') {
      return NextResponse.json({ error: 'إزالة الأعضاء متاحة لمالك أو مشرف المجموعة' }, { status: 403 });
    }
    if (memberId === caller.userId) {
      return NextResponse.json({ error: 'استخدم مغادرة المحادثة لإخراج نفسك' }, { status: 400 });
    }

    await removeMember(conversationId, caller.userId, memberId);
    void writeConnectAudit({
      action: 'member_remove',
      actorId: caller.userId,
      actorName: await resolveSenderName(caller.userId),
      conversationId,
      targetUserId: memberId,
      details: 'إزالة عضو من المجموعة (فقدان الوصول فوري)',
    }).catch(() => undefined);
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return connectErrorResponse(error, 'DELETE .../members/[memberId]');
  }
}
