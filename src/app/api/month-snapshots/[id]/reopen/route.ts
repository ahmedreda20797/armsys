// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]/reopen
//
//  POST — reopen a closed month (spec §11).
//
//  Flips status back to 'open' so observations can be edited again.
//  REVERSIBLE & NON-DESTRUCTIVE (spec §12): the frozen snapshot
//  document is NEVER deleted — only its `status` field changes.
//  `reopenCount` increments, the latest reason is stored, and the
//  previous close metadata (closedAt/closedBy/…) plus the full audit
//  trail are preserved. A fresh Close archives the prior frozen
//  version and generates a new one.
//
//  A meaningful reason is REQUIRED — empty/blank reasons are rejected.
//
//  Idempotent: reopening an already-open month is safe and returns
//  the existing open document unchanged (no second notification).
//
//  Permission: 'approve' on 'monthClose' (manager/admin only, via the
//  existing permission system — no hardcoded roles).
//
//  This route is THIN (spec §2): authenticates, validates input,
//  delegates to the month-snapshots service. No business logic here.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, validationError, notFoundError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { notifyMonthReopened } from '@/lib/notifications/quality-events';
import { validateMonthKey } from '@/lib/month-utils';
import { reopenMonth } from '@/lib/month-snapshots';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ── 1. Authenticate + authorize ──
    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    // ── 2. Validate month key (strict YYYY-MM) ──
    const { id: monthKey } = await params;
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);

    // ── 3. Require a meaningful reason (spec §11) ──
    const body = await request.json().catch(() => ({}));
    const reason: string = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      return validationError('سبب إعادة الفتح مطلوب');
    }

    // ── 4. Resolve actor (server-side) ──
    const actor = await resolveActor(permCheck.user?.id);

    // ── 5. Delegate to service (idempotent reopen, never deletes data) ──
    const result = await reopenMonth(monthKey, reason, actor);
    if (!result) {
      return notFoundError('لا توجد لقطة لهذا الشهر لإعادة فتحه');
    }
    const { snapshot: reopened, kind } = result;

    // ── 6. Audit + notify ONLY on a genuine reopen ──
    // An already-open month is returned idempotently without a second
    // notification (spec §15) or duplicate audit entry.
    if (kind === 'reopened') {
      await writeAudit({
        collection: AUDIT_LOG_TABLE,
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
    }

    return Response.json(reopened);
  } catch (error) {
    logServerFailure('month-snapshots/[id]/reopen', 'POST', error);
    return internalError();
  }
}
