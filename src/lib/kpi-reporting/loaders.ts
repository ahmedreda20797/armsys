// ══════════════════════════════════════════════════════════════
//  KPI Reporting Layer — Injectable data loaders (Phase 2)
//
//  Project convention: business builders are PURE and every db-bound
//  orchestration accepts in-memory loaders in tests (no Firebase
//  mocking). The reporting loaders EXTEND the engine's own
//  EmployeeResultLoaders so the reporting layer can call the KPI
//  engine's canonical pipeline directly — zero engine duplication.
//
//  Batched reads only (spec §21): ONE cached read per table per
//  request — no N+1 employee loops.
// ══════════════════════════════════════════════════════════════

import { getAll, getById, TTL } from '@/lib/db';
import { getMonthSnapshot } from '@/lib/month-lock';
import { getMonthDetail } from '@/lib/month-snapshots';
import { resolveSchemeForEmployee } from '@/lib/kpi-framework/resolution';
import type { MonthSnapshot, QualityObservation } from '@/types/quality-kpi';
import type {
  EmployeeResultLoaders,
  EmploymentEventLike,
} from '@/lib/kpi-framework/employee-result';
import { defaultKpiFrameworkLoaders } from '@/lib/kpi-framework/employee-result';
import type { KpiFrameworkEmployee, KpiScheme, KpiSchemeOverride } from '@/lib/kpi-framework/types';
import { ORG_NODES_TABLE, type OrgNode } from '@/lib/organization';
import { normalizeEmployeeStatus } from '@/lib/organization/employee-status';

// ─────────────────────────────────────────────────────────────
//  Reporting employee view
// ─────────────────────────────────────────────────────────────

/**
 * The reporting layer's employee record. Stable Employee fields only
 * (name/code/department/position/status) + lifecycle metadata —
 * never the Organization Tree structure (spec §19).
 */
export interface ReportEmployee {
  id: string;
  code: string | null;
  name: string;
  department: string | null;
  position: string | null;
  status: unknown;
  hireDate: string | null;
  createdAt: string | undefined;
  archivedAt: string | null;
  orgNodeId: string | null;
}

/** Project the reporting record into the engine's slim employee view. */
export function toFrameworkEmployee(employee: ReportEmployee): KpiFrameworkEmployee {
  return {
    id: employee.id,
    name: employee.name,
    department: employee.department,
    status: employee.status,
    hireDate: employee.hireDate,
    createdAt: employee.createdAt,
    archivedAt: employee.archivedAt,
  };
}

// ─────────────────────────────────────────────────────────────
//  Loader contract
// ─────────────────────────────────────────────────────────────

/**
 * Everything the reporting builders may touch. Extends the ENGINE's
 * loader set so `computeEmployeeKpiResultWithLoaders` can be invoked
 * with the SAME object (the canonical pipeline stays the only
 * calculation path).
 */
export interface KpiReportingLoaders extends EmployeeResultLoaders {
  /** Full reporting record for ONE employee (null = not found). */
  loadEmployeeRecord(employeeId: string): Promise<ReportEmployee | null>;
  /** All employee records (batched — ONE read). */
  loadEmployees(): Promise<ReportEmployee[]>;
  /** Lifecycle ledger batched by employee (ONE read). */
  loadEmploymentEventsByEmployee(): Promise<Map<string, EmploymentEventLike[]>>;
  /** FULL snapshot document (reporting needs frozen metadata). */
  loadSnapshotDocument(monthKey: string): Promise<MonthSnapshot | null>;
  /**
   * The month detail through the EXISTING snapshot service lifecycle:
   * closed → frozen document verbatim; open → the service's live
   * preview (engine-computed scores). This is the ONLY sanctioned
   * source of open-month quality scores for reporting.
   */
  loadMonthDetail(monthKey: string): Promise<MonthSnapshot | null>;
  /** Batched snapshot documents for a trend window (spec §21). */
  loadSnapshotDocuments(monthKeys: ReadonlyArray<string>): Promise<Map<string, MonthSnapshot>>;
  /** All observations of one month (evidence traceability). */
  loadObservations(monthKey: string): Promise<QualityObservation[]>;
  /**
   * Employee id → team label from CURRENT org assignment (team or
   * subteam node name); absent/null when not resolvable. Reporting
   * reads existing org data without depending on its redesign.
   */
  loadTeamNames(): Promise<Map<string, string | null>>;
}

function toReportEmployee(raw: Record<string, unknown>, id: string): ReportEmployee {
  return {
    id,
    code: typeof raw.code === 'string' && raw.code.length > 0 ? raw.code : null,
    name: String(raw.name ?? ''),
    department: typeof raw.department === 'string' ? raw.department : null,
    position: typeof raw.position === 'string' ? raw.position : null,
    status: raw.status,
    hireDate: typeof raw.hireDate === 'string' ? raw.hireDate : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : undefined,
    archivedAt: typeof raw.archivedAt === 'string' ? raw.archivedAt : null,
    orgNodeId: typeof raw.orgNodeId === 'string' ? raw.orgNodeId : null,
  };
}

/** DB-backed default loader set (all reads cached by lib/db). */
export const defaultKpiReportingLoaders: KpiReportingLoaders = {
  // ── Engine pipeline loaders (canonical, reused verbatim) ──
  ...defaultKpiFrameworkLoaders,

  // ── Reporting extras ──
  loadEmployeeRecord: async (employeeId) => {
    const raw = await getById<Record<string, unknown>>('employees', employeeId);
    return raw ? toReportEmployee(raw, employeeId) : null;
  },

  loadEmployees: async () => {
    const all = await getAll<Record<string, unknown>>('employees', TTL.MEDIUM);
    return all
      .filter((e) => e && typeof e.id === 'string')
      .map((e) => toReportEmployee(e, String(e.id)));
  },

  loadEmploymentEventsByEmployee: async () => {
    const all = await getAll<{ employeeId?: string; kind?: string; effectiveAt?: string }>(
      'employmentEvents',
      TTL.MEDIUM,
    );
    const byEmployee = new Map<string, EmploymentEventLike[]>();
    for (const e of all) {
      if (
        typeof e.employeeId === 'string' &&
        (e.kind === 'archived' || e.kind === 'restored') &&
        typeof e.effectiveAt === 'string'
      ) {
        const list = byEmployee.get(e.employeeId) ?? [];
        list.push({ kind: e.kind, effectiveAt: e.effectiveAt });
        byEmployee.set(e.employeeId, list);
      }
    }
    return byEmployee;
  },

  loadSnapshotDocument: (monthKey) => getMonthSnapshot(monthKey),

  // Frozen-vs-live orchestration stays owned by the snapshot service
  // (closed → frozen doc verbatim; open → engine live preview).
  loadMonthDetail: (monthKey) => getMonthDetail(monthKey),

  loadSnapshotDocuments: async (monthKeys) => {
    const unique = [...new Set(monthKeys)];
    const entries = await Promise.all(
      unique.map(async (key) => [key, await getMonthSnapshot(key)] as const),
    );
    const map = new Map<string, MonthSnapshot>();
    for (const [key, snap] of entries) {
      if (snap) map.set(key, snap);
    }
    return map;
  },

  loadObservations: async (monthKey) => {
    const all = await getAll<QualityObservation>('qualityObservations', TTL.MEDIUM);
    return all.filter((o) => o && o.month === monthKey);
  },

  loadTeamNames: async () => {
    const [employees, orgNodes] = await Promise.all([
      getAll<{ id?: string; orgNodeId?: string | null }>('employees', TTL.MEDIUM),
      getAll<OrgNode>(ORG_NODES_TABLE, TTL.MEDIUM),
    ]);
    const nodeById = new Map(orgNodes.map((n) => [n.id, n]));
    const out = new Map<string, string | null>();
    for (const employee of employees) {
      if (typeof employee.id !== 'string') continue;
      const node = employee.orgNodeId ? nodeById.get(employee.orgNodeId) : undefined;
      const isTeam = node && (node.type === 'team' || node.type === 'subteam');
      out.set(employee.id, isTeam ? node.name : null);
    }
    return out;
  },
};

// ─────────────────────────────────────────────────────────────
//  Shared pure helpers over loaded data
// ─────────────────────────────────────────────────────────────

/** Resolve a scheme for one employee from batch-loaded inputs (pure). */
export function resolveSchemeFromLoaded(
  employee: KpiFrameworkEmployee,
  overrides: KpiSchemeOverride[],
  schemes: KpiScheme[],
  period: string,
) {
  return resolveSchemeForEmployee({ employee, overrides, schemes, period });
}

/** Employment status vocabulary for display. */
export function employmentStatusOf(employee: ReportEmployee): ReturnType<typeof normalizeEmployeeStatus> {
  return normalizeEmployeeStatus(employee.status);
}
