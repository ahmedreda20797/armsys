// src/app/api/connect/users/route.ts
// ══════════════════════════════════════════════════════════════
//  Connect API — user account resolution
//    GET ?ids=a,b,c    → [{ id, name, photoUrl }]   (member rendering)
//    GET ?query=…      → ACCOUNT SEARCH — the ONLY data source for
//                        starting a direct conversation. Searches
//                        existing QNALYS USER ACCOUNTS (never the
//                        employee directory), returns a MINIMAL
//                        display projection, excludes the caller and
//                        suspended accounts, and is hard-limited
//                        (§PRIVACY: no emails/roles/permissions, no
//                        arbitrary enumeration).
//  Authorization always comes from membership records, never from
//  this endpoint. Page gate: 'connect' view (the same permission the
//  floating launcher uses).
// ══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { connectErrorResponse } from '@/lib/connect/api-helpers';
import { authorizeRequest } from '@/lib/verify-permission';
import { loadUserProfiles } from '@/lib/connect/membership';
import { getAll } from '@/lib/db';
import {
  ACCOUNT_SEARCH_QUERY_MAX,
  ACCOUNT_SEARCH_RESULTS_MAX,
} from '@/lib/connect/constants';

interface UserAccountRow {
  id: string;
  name?: string;
  email?: string;
  photoUrl?: string;
  isSuspended?: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // §CONNECT-GATE — canonical authenticate+authorize entry (one check,
    // request-memoized; the page 'connect' view gate ties the API to the
    // same permission the floating launcher uses).
    const { caller, decision } = await authorizeRequest(request, { page: 'connect', action: 'view' });
    if (!caller) {
      return NextResponse.json({ error: 'لم يتم المصادقة على المستخدم' }, { status: 401 });
    }
    if (!decision.allowed) {
      return NextResponse.json({ error: decision.reason }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);

    // ── Account search mode (direct-chat entry workflow) ──
    const query = searchParams.get('query');
    if (query !== null) {
      const q = query.trim().toLowerCase();
      if (q.length < 2) {
        return NextResponse.json({ data: { accounts: [] } });
      }
      if (q.length > ACCOUNT_SEARCH_QUERY_MAX) {
        return NextResponse.json({ error: 'استعلام البحث طويل جداً' }, { status: 400 });
      }

      // One cached single-flight read of the users table (the same
      // primitive the dashboard directory uses) — filtering happens
      // server-side; the browser only ever sees the bounded projection.
      const users = await getAll<UserAccountRow>('users');
      const accounts = users
        .filter((u) => u && typeof u.id === 'string')
        .filter((u) => u.id !== caller.userId) // never offer the caller themselves
        .filter((u) => u.isSuspended !== true) // account status rules apply
        .filter((u) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q))
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'ar'))
        .slice(0, ACCOUNT_SEARCH_RESULTS_MAX)
        .map((u) => ({ id: u.id, name: u.name ?? null, photoUrl: u.photoUrl ?? null }));

      return NextResponse.json({ data: { accounts } });
    }

    // ── ids mode (member/profile rendering for known ids) ──
    const idsParam = searchParams.get('ids') ?? '';
    const ids = idsParam.split(',').map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 128).slice(0, 200);
    if (ids.length === 0) {
      return NextResponse.json({ data: [] });
    }

    const profiles = await loadUserProfiles(ids);
    const data = ids.map((id) => {
      const p = profiles.get(id);
      return { id, name: p?.name ?? null, photoUrl: p?.photoUrl ?? null };
    });
    return NextResponse.json({ data });
  } catch (error) {
    return connectErrorResponse(error, 'GET /api/connect/users');
  }
}
