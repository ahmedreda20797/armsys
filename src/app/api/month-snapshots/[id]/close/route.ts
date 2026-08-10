// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]/close
//
//  POST — close (freeze) a month (spec §8/§9).
//
//  IDEMPOTENT (spec §3): if the month is ALREADY closed, the request
//  returns the existing frozen snapshot UNCHANGED — it does NOT
//  regenerate the snapshot, modify it, change generatedAt, or change
//  employee scores. A duplicate close is a no-op that returns the
//  already-frozen data. This is safe against double-clicks, retries,
//  duplicate requests, and concurrent close requests.
//
//  On a genuine close (month was open or had no snapshot):
//    1. Load the month's observations and active employee records.
//    2. Compute the snapshot via the CANONICAL KPI engine (only
//       approved observations affect the score; pending/rejected do
//       not — spec §9).
//    3. Freeze employee metadata, settings, KPI values, ranking,
//       category totals, and approval statistics.
//    4. Persist. Mark status = closed. Audit + notify.
//
//  On a re-close (after reopen): archive the previous frozen version
//  into snapshotHistory before replacing the active fields (§13).
//
//  Permission: 'approve' on 'monthClose' (manager/admin only, via the
//  existing permission system — no hardcoded roles).
//
//  This route is THIN (spec §2): it authenticates, validates input,
//  and delegates to the month-snapshots service. No score formula
//  lives here.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { writeAudit } from '@/lib/audit';
import { AUDIT_LOG_TABLE } from '@/app/api/quality-audit-log/route';
import { notifyMonthClosed } from '@/lib/notifications/quality-events';
import { validateMonthKey } from '@/lib/month-utils';
import { closeMonth } from '@/lib/month-snapshots';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ── 1. Authenticate + authorize (existing permission system) ──
    const permCheck = await verifyPermission(request, 'monthClose', 'approve');
    if (!permCheck.allowed) return forbiddenError(permCheck.error);

    // ── 2. Validate month key (strict YYYY-MM, spec §18) ──
    const { id: monthKey } = await params;
    const monthError = validateMonthKey(monthKey);
    if (monthError) return validationError(monthError);

    // ── 3. Resolve actor (server-side, never trust client) ──
    const actor = await resolveActor(permCheck.user?.id);

    // ── 4. Delegate to service (idempotent close + canonical engine) ──
    const result = await closeMonth(monthKey, actor);
    const { snapshot, kind } = result;

    // ── 5. Audit + notify ONLY on a genuine close ──
    // A duplicate/idempotent close must NOT re-notify (spec §15) or
    // write a redundant audit entry — it is a pure read-and-return.
    if (kind === 'created') {
      await writeAudit({
        collection: AUDIT_LOG_TABLE,
        actorId: actor.id,
        actorName: actor.name,
        action: 'close_month',
        entityType: 'month',
        entityId: monthKey,
        monthKey,
        after: { monthKey, status: 'closed', closedAt: snapshot.closedAt } as Record<string, unknown>,
        details: `إغلاق شهر ${monthKey} (${Object.keys(snapshot.employeeScores).length} موظف)`,
      });

      await notifyMonthClosed(monthKey, actor.name);
    }

    return Response.json(snapshot);
  } catch (error) {
    logServerFailure('month-snapshots/[id]/close', 'POST', error);
    return internalError();
  }
}
