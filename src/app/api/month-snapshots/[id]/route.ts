// ══════════════════════════════════════════════════════════════
//  /api/month-snapshots/[id]
//
//  GET — fetch a single month snapshot in full detail.
//
//  If the month is CLOSED → return the frozen immutable snapshot.
//  If the month is OPEN (no snapshot or status=open) → live-compute
//  from current observations so managers can preview before closing.
//
//  Permission: requireAuth.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { getAll, getById, TTL } from '@/lib/db';
import { requireAuth } from '@/lib/verify-permission';
import {
  unauthorizedError, notFoundError, validationError,
  internalError, logServerFailure,
} from '@/lib/api-error';
import { MONTH_SNAPSHOTS_TABLE, getMonthSnapshot } from '@/lib/month-lock';
import { getKpiSettings } from '@/lib/kpi-settings';
import { computeMonthSnapshot } from '@/lib/metrics/kpiMetrics';
import type { EmployeeLike } from '@/lib/metrics/kpiMetrics';
import type { QualityObservation, MonthSnapshot as MonthSnapshotType } from '@/types/quality-kpi';
import type { Employee } from '@/types';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();

    const { id: monthKey } = await params;

    // Validate month key format (YYYY-MM).
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      return validationError('صيغة الشهر غير صحيحة (YYYY-MM مطلوبة)');
    }

    // Look up an existing snapshot for this month.
    const existing = await getMonthSnapshot(monthKey);

    // If a closed snapshot exists, return the immutable frozen copy.
    // (Reopen sets status back to 'open', so a closed doc is always frozen.)
    if (existing && existing.status === 'closed') {
      return Response.json(existing);
    }

    // Otherwise, live-compute a preview from current observations.
    const settings = await getKpiSettings();
    const allObs = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
    const monthObs = allObs.filter((o) => o.month === monthKey);

    // Build the employee lookup for the snapshot.
    const employees = await getAll<Employee>('employees', TTL.MEDIUM);
    const empMap = new Map<string, EmployeeLike>();
    for (const e of employees) {
      empMap.set(e.id, {
        id: e.id,
        name: e.name,
        department: e.department,
        position: e.position,
      });
    }

    // Supervisor map — not stored today, so all entries map to null.
    // (Future schema addition: employees.supervisorId.)
    const supervisorMap = new Map<string, string | null>();

    const liveSnapshot = computeMonthSnapshot(
      monthObs,
      monthKey,
      empMap,
      supervisorMap,
      settings,
    );

    // Mark as 'open' since this is a live preview (not yet frozen).
    const preview: MonthSnapshotType = {
      id: monthKey,
      ...liveSnapshot,
      status: 'open',
    } as MonthSnapshotType;

    return Response.json(preview);
  } catch (error) {
    logServerFailure('month-snapshots/[id]', 'GET', error);
    return internalError();
  }
}

// Re-export table constant for sub-routes that import it.
export { MONTH_SNAPSHOTS_TABLE };
