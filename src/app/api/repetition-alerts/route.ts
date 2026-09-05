// ══════════════════════════════════════════════════════════════
//  GET /api/repetition-alerts — deterministic repetition alerts
//  (Milestone 7 §8 — Repetition → CAPA)
//
//  Permission doctrine (same as global search): a domain the caller
//  cannot view is NOT queried — no names, no counts. Employee scope
//  is resolved ONCE and applied at the retrieval boundary. Detection
//  is the pure deterministic module — no AI, configurable thresholds
//  documented in lib/repetition-detection.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { migratePermission } from '@/config/permissions';
import {
  internalError,
  logServerFailure,
  unauthorizedError,
} from '@/lib/api-error';
import { getAll, TTL } from '@/lib/db';
import {
  authScopeViewer,
  filterRowsByEmployeeScope,
  resolveEmployeeScopeFromDb,
} from '@/lib/scope/server';
import { canViewDomain } from '@/lib/search/search-service';
import {
  detectRepetitions,
  type RepetitionRecord,
} from '@/lib/repetition-detection';

type Row = Record<string, unknown>;

/** Convert the stored observationDate (DD/MM/YYYY) to a day key. */
function observationDay(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const parts = raw.split('/');
  if (parts.length !== 3) return '';
  const [, mm, yyyy] = parts;
  return `${yyyy}-${mm}-${parts[0]}`;
}

/** ISO/day-key day slice — "2026-09-05T…" or "2026-09-05" → "2026-09-05". */
function dayOf(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permissions = auth.permissions;
    const scopeCtx = await resolveEmployeeScopeFromDb(
      authScopeViewer(auth),
      undefined,
      permissions,
    );

    // ── Per-domain permission gate: unauthorized domains not read ──
    const wantsFollowUps = canViewDomain(permissions, auth.role, 'followUps');
    const wantsComplaints = canViewDomain(permissions, auth.role, 'complaints');
    const wantsObservations = canViewDomain(permissions, auth.role, 'observations');

    const [followUps, complaints, observations] = await Promise.all([
      wantsFollowUps
        ? getAll<Row>('followUps', TTL.MEDIUM).then((rows) =>
            filterRowsByEmployeeScope(rows, scopeCtx),
          )
        : Promise.resolve([] as Row[]),
      wantsComplaints
        ? getAll<Row>('complaints', TTL.MEDIUM).then((rows) =>
            filterRowsByEmployeeScope(rows, scopeCtx, { optionalLink: true }),
          )
        : Promise.resolve([] as Row[]),
      wantsObservations
        ? getAll<Row>('qualityObservations', TTL.MEDIUM).then((rows) =>
            filterRowsByEmployeeScope(rows, scopeCtx),
          )
        : Promise.resolve([] as Row[]),
    ]);

    // ── Project each domain onto the shared detection shape —
    //    each keeps its OWN taxonomy (no cross-source key matching).
    const records: RepetitionRecord[] = [];

    for (const f of followUps) {
      if (typeof f.id !== 'string') continue;
      records.push({
        id: f.id,
        employeeId: typeof f.employeeId === 'string' ? f.employeeId : null,
        issueKey: typeof f.followUpType === 'string' ? f.followUpType : '',
        issueLabel: typeof f.subject === 'string' && f.subject ? f.subject : (typeof f.followUpType === 'string' ? f.followUpType : ''),
        day: dayOf(f.date),
        source: 'followUp',
      });
    }

    for (const c of complaints) {
      if (typeof c.id !== 'string') continue;
      records.push({
        id: c.id,
        employeeId: typeof c.employeeId === 'string' ? c.employeeId : null,
        issueKey: typeof c.complaintType === 'string' ? c.complaintType : '',
        issueLabel: typeof c.complaintType === 'string' ? c.complaintType : '',
        day: dayOf(c.createdAt),
        source: 'complaint',
      });
    }

    for (const o of observations) {
      if (typeof o.id !== 'string') continue;
      records.push({
        id: o.id,
        employeeId: typeof o.employeeId === 'string' ? o.employeeId : null,
        issueKey: typeof o.categoryId === 'string' ? o.categoryId : '',
        issueLabel: typeof o.categoryName === 'string' && o.categoryName ? o.categoryName : (typeof o.categoryId === 'string' ? o.categoryId : ''),
        day: observationDay(o.observationDate),
        source: 'observation',
      });
    }

    const alerts = detectRepetitions(records, new Date());

    return Response.json({
      alerts,
      rule: { minOccurrences: 2, windowDays: 30 },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    logServerFailure('repetition-alerts', 'GET', error);
    return internalError();
  }
}
