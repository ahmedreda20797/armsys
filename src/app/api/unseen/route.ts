// ══════════════════════════════════════════════════════════════
//  /api/unseen — per-user "new items" summary + mark-seen
//
//  GET  → { counts: { [pageId]: number }, serverTime }
//         NEW = records created AFTER the viewer's last-seen stamp
//         for that module AND created by someone ELSE, inside the
//         viewer's employee scope. First visit initializes silently
//         (no retroactive badge flood): no stored stamp ⇒ 0.
//  POST { page } → stores lastSeenAt=now for that module (O(1)
//         upsert of the viewer's own tiny state record).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { getById, createRecordWithId, updateRecord, getAllBatch } from '@/lib/db';
import {
  authScopeViewer, filterRowsByEmployeeScope, resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
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
    const [batch, scopeCtx] = await Promise.all([
      getAllBatch(tables),
      resolveEmployeeScopeFromDb(authScopeViewer(auth), undefined, auth.permissions),
    ]);

    const counts: Record<string, number> = {};
    for (const [pageId, table] of Object.entries(UNSEEN_MONITORED_TABLES)) {
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

    return NextResponse.json({ counts, serverTime: new Date().toISOString() });
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
