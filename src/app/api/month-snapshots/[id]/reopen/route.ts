// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]/reopen
//
//  POST — reopen a closed month: flip status back to 'open' so
//  observations can be edited again. REVERSIBLE: the frozen
//  snapshot document is NEVER deleted — only its status field
//  changes, and reopenCount increments. A fresh Close regenerates.
//
//  Permission: 'approve' on 'monthClose' (manager/admin only).
//  Requires a reason (audited).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { updateRecord, invalidateCache } from '@/lib/db';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, validationError, notFoundError, lockedError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { makeRecordAuditEvent, writeQualityAudit } from '@/lib/audit/server-audit-logger';
import { notifyMonthReopened } from '@/lib/notifications/quality-events';
import { getMonthSnapshot } from '@/lib/month-lock';
import type { MonthSnapshot } from '@/types/quality-kpi';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    const { id: monthKey } = await params;

    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return validationError('صيغة الشهر غير صحيحة (YYYY-MM مطلوبة)');
    }

    const body = await request.json().catch(() => ({}));
    const reason: string = (body.reason || '').trim();
    if (!reason) {
      return validationError('سبب إعادة الفتح مطلوب');
    }

    const existing = await getMonthSnapshot(monthKey);
    if (!existing) {
      return notFoundError('لا توجد لقطة لهذا الشهر لإعادة فتحه');
    }

    // Idempotent: already open — return as-is.
    if (existing.status === 'open') {
      return Response.json(existing);
    }

    const actor = await resolveActor(permCheck.user?.id);
    const now = new Date().toISOString();

    const auditEvent = makeRecordAuditEvent({
      action: 'reopen',
      actorId: actor.id,
      actorName: actor.name,
      details: `إعادة فتح شهر ${monthKey}: ${reason}`,
    });

    // REVERSIBLE: never delete the frozen snapshot — only flip status.
    // Reopen count and reason are preserved for the audit trail.
    const updated = await updateRecord('monthSnapshots', monthKey, {
      status: 'open',
      reopenCount: (existing.reopenCount || 0) + 1,
      reopenReason: reason,
      auditLog: [...(existing.auditLog || []), auditEvent],
    });
    if (!updated) return lockedError('فشل تحديث حالة الشهر');
    const reopened = updated as unknown as MonthSnapshot;

    await invalidateCache('monthSnapshots');

    // Global audit trail (fire-and-forget).
    await writeQualityAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'reopen_month',
      entityType: 'month',
      entityId: monthKey,
      monthKey,
      before: { status: 'closed' } as Record<string, unknown>,
      after: { status: 'open', reopenCount: reopened.reopenCount } as Record<string, unknown>,
      reason,
      details: `إعادة فتح شهر ${monthKey}: ${reason}`,
    });

    await notifyMonthReopened(monthKey, actor.name, reason);

    return Response.json(reopened);
  } catch (error) {
    logServerFailure('month-snapshots/[id]/reopen', 'POST', error);
    return internalError();
  }
}
