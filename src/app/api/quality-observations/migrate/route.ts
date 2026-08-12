// ══════════════════════════════════════════════════════════════
//  /api/quality-observations/migrate  (Milestone 6B)
//
//  POST — migrate legacy qualityDeductions into qualityObservations.
//
//  THIN route: authenticates, enforces admin-only, parses the optional
//  dryRun body flag, then delegates to the quality-migration service
//  (src/lib/quality-migration.ts). No mapping/idempotency/persistence
//  logic lives here.
//
//  Permission: admin only.
//    Enforced via the existing JWT authentication architecture:
//    authenticate (requireAuth) then verify role === 'admin'. This
//    mirrors the precedent in /api/rules/execute-all and does not
//    introduce a new authentication mechanism.
//
//  Body (optional):
//    { dryRun?: boolean }
//
//  Response: typed MigrationSummary.
//
//  Idempotency: re-running never creates duplicate observations.
//  Legacy records are NEVER deleted or modified.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import {
  unauthorizedError, forbiddenError, internalError,
  logServerFailure,
} from '@/lib/api-error';
import { resolveActor } from '@/lib/auth/actor-resolver';
import { migrateLegacyDeductions } from '@/lib/quality-migration';
import type { MigrationOptions } from '@/lib/quality-migration';

export async function POST(request: NextRequest) {
  try {
    // ── 1. Authenticate via existing JWT mechanism ──
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    // ── 2. Admin-only enforcement ──
    if (auth.role !== 'admin') return forbiddenError('هذا الإجراء متاح للمسؤولين فقط');

    // ── 3. Resolve the admin actor for audit trails ──
    const actor = await resolveActor(auth.userId);

    // ── 4. Parse optional dryRun flag ──
    let dryRun = false;
    try {
      const body = await request.json();
      if (body && typeof body.dryRun === 'boolean') {
        dryRun = body.dryRun;
      }
    } catch {
      // Empty or invalid body — default to live migration.
    }

    // ── 5. Delegate to the migration service ──
    const options: MigrationOptions = { dryRun };
    const summary = await migrateLegacyDeductions(
      { actorId: actor.id, actorName: actor.name },
      options,
    );

    return Response.json(summary, {
      status: summary.success ? 200 : 500,
    });
  } catch (error) {
    logServerFailure('quality-observations/migrate', 'POST', error);
    return internalError();
  }
}
