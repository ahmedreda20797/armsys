// ══════════════════════════════════════════════════════════════
//  POST /api/performance-hub/group — Group Performance Report
//  (تقرير أداء المجموعة — §GROUP-REPORTING)
//
//  Thin route: authenticate → authorize (the SAME 'employee360'
//  permission as the single-employee Hub) → SECTION gates (risk/HR,
//  the same resolver Employee 360 uses) → resolve the AUTHORIZED
//  employee scope → delegate to the read-only group builder.
//
//  Request body (JSON):
//    month        required, YYYY-MM
//    employeeIds  optional string[] (≤ GROUP_SELECTION_MAX_IDS)
//    orgNodeIds   optional string[] (≤ GROUP_SELECTION_MAX_IDS)
//    compare      optional boolean (default true — previous-month trends)
//    limit        optional number (≤ GROUP_REPORT_MAX_MEMBERS)
//
//  Scope doctrine (M0.5): the authorized employee set narrows the
//  selection BEFORE any aggregation — client-submitted ids can only
//  narrow it, never widen. Out-of-scope ids/nodes are NOT silently
//  dropped: they are counted and reported back (outOfScope* fields).
//  At least ONE selection source is required (empty selection → 400).
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth, verifyPermission } from '@/lib/verify-permission';
import {
  forbiddenError,
  internalError,
  logServerFailure,
  unauthorizedError,
  validationError,
} from '@/lib/api-error';
import { validateMonthKey } from '@/lib/month-utils';
import { asScopeViewer, resolveEmployeeScopeFromDb } from '@/lib/scope/server';
import { resolveEmployee360SectionGate } from '@/lib/permissions/employee360-access';
import {
  buildPerformanceGroupReport,
  GROUP_REPORT_MAX_MEMBERS,
  GROUP_SELECTION_MAX_IDS,
} from '@/lib/performance-hub';

/** Client-submitted id list → sanitized unique strings (bounded). */
function sanitizeIdList(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return null;
  if (raw.length > GROUP_SELECTION_MAX_IDS) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 128) return null;
    out.push(item);
  }
  return [...new Set(out)];
}

function parseIdArray(body: Record<string, unknown>, field: string): { ids: string[] } | { error: string } {
  const sanitized = sanitizeIdList(body[field]);
  if (sanitized === null) {
    return { error: `حقل ${field} يجب أن يكون مصفوفة معرفات حتى ${GROUP_SELECTION_MAX_IDS} عنصرًا` };
  }
  return { ids: sanitized };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const permCheck = await verifyPermission(request, 'employee360', 'view');
    if (!permCheck.allowed || !permCheck.user) {
      return forbiddenError(permCheck.error);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return validationError('صيغة الطلب غير صالحة');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return validationError('صيغة الطلب غير صالحة');
    }
    const payload = body as Record<string, unknown>;

    const monthError = validateMonthKey(typeof payload.month === 'string' ? payload.month : null);
    if (monthError) return validationError(monthError);
    const monthKey = payload.month as string;

    const employeeIds = parseIdArray(payload, 'employeeIds');
    if ('error' in employeeIds) return validationError(employeeIds.error);
    const orgNodeIds = parseIdArray(payload, 'orgNodeIds');
    if ('error' in orgNodeIds) return validationError(orgNodeIds.error);

    if (employeeIds.ids.length === 0 && orgNodeIds.ids.length === 0) {
      return validationError('حدد موظفًا واحدًا على الأقل أو عقدة تنظيمية واحدة');
    }

    const compare = payload.compare === undefined ? true : payload.compare === true;

    let limit: number | undefined;
    if (payload.limit !== undefined && payload.limit !== null) {
      const parsed = Number(payload.limit);
      if (!Number.isFinite(parsed) || parsed < 1) {
        return validationError('الحد يجب أن يكون رقمًا موجبًا');
      }
      limit = Math.trunc(parsed);
    }

    // ── Authorized employee scope (M0.5) — resolved server-side ──
    const scopeCtx = await resolveEmployeeScopeFromDb(
      asScopeViewer(permCheck.user),
      undefined,
      permCheck.user.permissions,
    );
    const scopeLimit = scopeCtx.isUnrestricted ? null : [...scopeCtx.employeeIds];

    // ── Section gates — the SAME resolver the Employee 360 profile uses ──
    const sectionGate = resolveEmployee360SectionGate(permCheck.user.permissions);

    const report = await buildPerformanceGroupReport({
      monthKey,
      selection: { employeeIds: employeeIds.ids, orgNodeIds: orgNodeIds.ids },
      scopeLimit,
      compare,
      riskEnabled: sectionGate.risk,
      hrAuthorized: sectionGate.hrDeductions,
      limit: Math.min(limit ?? GROUP_REPORT_MAX_MEMBERS, GROUP_REPORT_MAX_MEMBERS),
    });

    return Response.json(report);
  } catch (error) {
    logServerFailure('performance-hub-group', 'POST', error);
    return internalError();
  }
}
