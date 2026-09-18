// ══════════════════════════════════════════════════════════════
//  /api/unseen — per-user "new items" summary + mark-seen
//
//  GET  → { counts: { [pageId]: number }, pending: { [pageId]: number },
//           serverTime }
//         counts[pageId]  — NEW = records created AFTER the viewer's
//         last-seen stamp for that module AND created by someone
//         ELSE, inside the viewer's employee scope. First visit
//         initializes silently (no retroactive badge flood): no
//         stored stamp ⇒ 0.
//         pending.quality — PENDING APPROVAL discounts visible in
//         the viewer's scope (§APPROVAL-NOTIFY). This is NOT a
//         "seen" counter — it is an action-needed count for users
//         holding the quality approve/reject authority, so mark-seen
//         never clears it (only the decision does).
//
//  §UNSEEN-PERMISSION — every module count is gated by the viewer's
//  EFFECTIVE permission for that page (level !== 'none'): a user
//  without module access never receives a badge for it. The admin
//  bypass flows through the same effective map.
//
//  POST { page } → stores lastSeenAt=now for that module (O(1)
//         upsert of the viewer's own tiny state record).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { getById, createRecordWithId, updateRecord, getAllBatch } from '@/lib/db';
import {
  authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import { migratePermission } from '@/config/permissions';
import { isPendingDeduction, QUALITY_DEDUCTIONS_TABLE } from '@/lib/quality-deductions/domain';
import { UNSEEN_MONITORED_TABLES, USER_SEEN_STATE_TABLE } from '@/lib/unseen';

/** Employee-linked tables that respect the read scope; every OTHER
 *  monitored table is scoped too, these two keep link-less rows. */
const OPTIONAL_LINK_TABLES = new Set(['complaints', 'capaCases']);

interface SeenState {
  userId: string;
  modules?: Record<string, { lastSeenAt?: string }>;
  updatedAt?: string;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const seen = await getById<SeenState>(USER_SEEN_STATE_TABLE, auth.userId);

    // One batched read over the monitored tables — they are hot in
    // the server's TTL cache, so a summary call usually costs ZERO
    // additional RTDB reads beyond the tiny per-user record.
    const tables = Object.values(UNSEEN_MONITORED_TABLES);
    if (!tables.includes(QUALITY_DEDUCTIONS_TABLE)) tables.push(QUALITY_DEDUCTIONS_TABLE);
    const [batch, scopeCtx] = await Promise.all([
      getAllBatch(tables),
      resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions),
    ]);

    const counts: Record<string, number> = {};
    for (const [pageId, table] of Object.entries(UNSEEN_MONITORED_TABLES)) {
      // §UNSEEN-PERMISSION — a module the viewer cannot access never
      // badges (hiding in the sidebar is not enough; the count is
      // withheld server-side).
      if (migratePermission(auth.permissions?.[pageId]).level === 'none') {
        counts[pageId] = 0;
        continue;
      }
      const lastSeenAt = seen?.modules?.[pageId]?.lastSeenAt;
      // No stamp yet → first-ever summary call for this module:
      // report 0 and let the state initialize going forward.
      if (!lastSeenAt) {
        counts[pageId] = 0;
        continue;
      }
      const lastSeenMs = Date.parse(lastSeenAt);
      if (Number.isNaN(lastSeenMs)) {
        counts[pageId] = 0;
        continue;
      }
      let rows = batch.get(table) || [];
      rows = filterRowsByEmployeeScope(
        rows as Array<{ employeeId?: string | null }>,
        scopeCtx,
        OPTIONAL_LINK_TABLES.has(table) ? { optionalLink: true } : undefined,
      );
      let n = 0;
      for (const row of rows as Array<{ createdAt?: string; createdById?: string; createdByUserId?: string }>) {
        if (!row?.createdAt) continue;
        const createdMs = Date.parse(row.createdAt);
        if (Number.isNaN(createdMs) || createdMs <= lastSeenMs) continue;
        // Records the user created themselves are never "new" to them.
        if (row.createdById === auth.userId || row.createdByUserId === auth.userId) continue;
        n += 1;
      }
      counts[pageId] = n;
    }

    // ── §APPROVAL-NOTIFY — pending decision counts ──
    // Users holding the quality approve/reject ACTION see how many
    // pending discounts await a decision (scope-filtered). Everyone
    // else gets none — the badge is actionable, not decorative.
    const pending: Record<string, number> = {};
    const qualityPerm = migratePermission(auth.permissions?.['quality']);
    const mayDecide =
      auth.role === 'admin' ||
      (qualityPerm.level === 'edit' &&
        (qualityPerm.actions?.approve === true || qualityPerm.actions?.reject === true));
    if (mayDecide) {
      let deductionRows = batch.get(QUALITY_DEDUCTIONS_TABLE) || [];
      deductionRows = filterRowsByEmployeeScope(
        deductionRows as Array<{ employeeId?: string | null }>,
        scopeCtx,
      );
      pending['quality'] = (deductionRows as Array<Record<string, unknown>>)
        .filter((row) => isPendingDeduction(row))
        .length;
    }

    return NextResponse.json({ counts, pending, serverTime: new Date().toISOString() });
  } catch (error) {
    console.error('Unseen summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const page = typeof body?.page === 'string' ? body.page : '';
    if (!page || !(page in UNSEEN_MONITORED_TABLES)) {
      return NextResponse.json({ error: 'Unknown page' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const existing = await getById<SeenState>(USER_SEEN_STATE_TABLE, auth.userId);
    if (existing) {
      await updateRecord(USER_SEEN_STATE_TABLE, auth.userId, {
        userId: auth.userId,
        modules: { ...(existing.modules || {}), [page]: { lastSeenAt: now } },
        updatedAt: now,
      });
    } else {
      await createRecordWithId(USER_SEEN_STATE_TABLE, auth.userId, {
        userId: auth.userId,
        modules: { [page]: { lastSeenAt: now } },
        updatedAt: now,
      });
    }

    return NextResponse.json({ ok: true, page, lastSeenAt: now });
  } catch (error) {
    console.error('Unseen mark error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
