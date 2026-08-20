// ══════════════════════════════════════════════════════════════
//  Report Catalog Endpoint (Milestone 8)
//
//    GET /api/reports/catalog
//
//  Permission-filtered listing of registered reports. Returns each
//  visible definition plus a server-computed canExport flag so the
//  UI never guesses. Frontend visibility is UX only — /run
//  re-enforces everything server-side.
//
//  This is the seam where the future Admin Report Builder (spec §9)
//  plugs in: an admin overlay merged before listVisibleReports
//  changes this endpoint's output without touching consumers.
// ══════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { authenticateFromRequest } from '@/lib/verify-permission';
import { internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';
import { canExportReport, canSeeReport, listReportDefinitions } from '@/lib/reports/registry';
import type { ReportDefinition } from '@/lib/reports/types';

export async function GET(request: Request) {
  try {
    const auth = await authenticateFromRequest(request);
    if (!auth) {
      return unauthorizedError();
    }

    const checker = {
      isAdmin: auth.role === 'admin',
      getPermission: (pageId: string) => {
        const perm = auth.permissions[pageId];
        if (!perm) return { level: 'none' as const };
        if (typeof perm === 'string') return { level: perm };
        return { level: perm.level, actions: perm.actions as Record<string, boolean> | undefined };
      },
    };

    const reports = listReportDefinitions()
      .filter((def) => canSeeReport(def, checker))
      .map((def) => ({
        ...def,
        canExport: canExportReport(def, checker),
      })) as Array<ReportDefinition & { canExport: boolean }>;

    return NextResponse.json({ reports });
  } catch (error) {
    logServerFailure('reports-catalog', 'GET', error);
    return internalError();
  }
}
