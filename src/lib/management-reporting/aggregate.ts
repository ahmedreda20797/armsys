// ══════════════════════════════════════════════════════════════
//  Management Reporting — PURE aggregation (Milestone 7, Phase A)
//
//  Deterministic cross-domain grouping over ALREADY-SCOPED rows.
//  No db access, no KPI recomputation (the quality block is the
//  engine's own summary passed through), no fabricated months or
//  groups. Every status vocabulary is imported from the canonical
//  metrics modules — never redefined here.
// ══════════════════════════════════════════════════════════════

import {
  ACTIVE_CAPA_STATUSES,
  TERMINAL_CAPA_STATUSES,
} from '@/lib/metrics/capaMetrics';
import {
  ACTIVE_FOLLOWUP_STATUSES,
  TERMINAL_FOLLOWUP_STATUSES,
} from '@/lib/metrics/followUpMetrics';
import type { KpiManagementSummary, KpiSummaryGroupBreakdown } from '@/lib/kpi-reporting';
import type {
  DepartmentManagementRow,
  DomainPeriodFacts,
  ManagementDomainSource,
  ManagementReport,
  ManagementReportLoaders,
} from './types';

type Row = Record<string, unknown>;

// ─────────────────────────────────────────────────────────────
//  Canonical open/closed vocabularies (reused — never redefined)
// ─────────────────────────────────────────────────────────────

/** Complaints: open set mirrors the Complaints page stats doctrine. */
const OPEN_COMPLAINT_STATUSES: ReadonlySet<string> = new Set([
  'open',
  'investigating',
  'pending_resolution',
]);
const CLOSED_COMPLAINT_STATUSES: ReadonlySet<string> = new Set(['resolved', 'closed']);

/** CAPA: canonical metrics vocabulary. */
const OPEN_CAPA_STATUSES: ReadonlySet<string> = new Set(ACTIVE_CAPA_STATUSES);
const CLOSED_CAPA_STATUSES_SET: ReadonlySet<string> = new Set(TERMINAL_CAPA_STATUSES);

/** Follow-ups: canonical metrics vocabulary. */
const OPEN_FOLLOWUP_STATUSES: ReadonlySet<string> = new Set(ACTIVE_FOLLOWUP_STATUSES);
const CLOSED_FOLLOWUP_STATUSES: ReadonlySet<string> = new Set(TERMINAL_FOLLOWUP_STATUSES);

/** HR deductions: undecided = pending; decided = approved/rejected. */
const OPEN_HR_STATUSES: ReadonlySet<string> = new Set(['pending']);
const CLOSED_HR_STATUSES: ReadonlySet<string> = new Set(['approved', 'rejected']);

// ─────────────────────────────────────────────────────────────
//  Period attribution (existing stored fields only)
// ─────────────────────────────────────────────────────────────

/** complaints/capaCases carry an ISO createdAt; followUps carry YYYY-MM-DD date. */
function recordMonth(row: Row, fields: readonly string[]): string | null {
  for (const field of fields) {
    const value = row[field];
    if (typeof value === 'string' && value.length >= 7) {
      // ISO ("2026-09-05T…") or day key ("2026-09-05") → "2026-09".
      if (/^\d{4}-\d{2}/.test(value)) return value.slice(0, 7);
    }
  }
  return null;
}

const PERIOD_FIELDS: Record<ManagementDomainSource, readonly string[]> = {
  complaints: ['createdAt'],
  capaCases: ['createdAt'],
  followUps: ['date'],
  // HR deductions store an explicit month key; deductionDate is the fallback.
  hrDeductions: ['month', 'deductionDate'],
};

// ─────────────────────────────────────────────────────────────
//  Domain aggregation
// ─────────────────────────────────────────────────────────────

const DOMAIN_LABELS: Record<ManagementDomainSource, string> = {
  complaints: 'شكاوى العملاء',
  capaCases: 'حالات كابا',
  followUps: 'المتابعات',
  hrDeductions: 'خصومات الموارد البشرية',
};

/** Status split by the canonical vocabulary (null = neither open nor closed). */
function statusSplit(
  source: ManagementDomainSource,
  status: string,
): 'open' | 'closed' | null {
  switch (source) {
    case 'complaints':
      if (OPEN_COMPLAINT_STATUSES.has(status)) return 'open';
      if (CLOSED_COMPLAINT_STATUSES.has(status)) return 'closed';
      return null;
    case 'capaCases':
      if (OPEN_CAPA_STATUSES.has(status)) return 'open';
      if (CLOSED_CAPA_STATUSES_SET.has(status)) return 'closed';
      return null;
    case 'followUps':
      if (OPEN_FOLLOWUP_STATUSES.has(status)) return 'open';
      if (CLOSED_FOLLOWUP_STATUSES.has(status)) return 'closed';
      return null;
    case 'hrDeductions':
      if (OPEN_HR_STATUSES.has(status)) return 'open';
      if (CLOSED_HR_STATUSES.has(status)) return 'closed';
      return null;
  }
}

/**
 * Aggregate one domain's scoped rows for the period. Pure.
 * `byStatus` counts every status string verbatim (no remapping).
 */
export function aggregateDomainFacts(
  source: ManagementDomainSource,
  rows: ReadonlyArray<Row>,
  monthKey: string,
): DomainPeriodFacts {
  let total = 0;
  let open = 0;
  let closed = 0;
  const byStatus: Record<string, number> = {};

  for (const row of rows) {
    const month = recordMonth(row, PERIOD_FIELDS[source]);
    if (month !== monthKey) continue;
    total++;
    const status = typeof row.status === 'string' ? row.status : '';
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    const split = statusSplit(source, status);
    if (split === 'open') open++;
    else if (split === 'closed') closed++;
  }

  return { source, label: DOMAIN_LABELS[source], total, open, closed, byStatus };
}

/** Empty facts for a domain with no rows in the period. */
export function emptyDomainFacts(source: ManagementDomainSource): DomainPeriodFacts {
  return { source, label: DOMAIN_LABELS[source], total: 0, open: 0, closed: 0, byStatus: {} };
}

// ─────────────────────────────────────────────────────────────
//  Group merging (engine groups + operational counts)
// ─────────────────────────────────────────────────────────────

interface GroupInput {
  rows: ReadonlyArray<Row>;
  source: ManagementDomainSource;
  /** employeeId → group key (department name or team name). */
  groupOf: (employeeId: string) => string | null;
}

/**
 * Merge ONE engine group breakdown with the operational counts of
 * the same groups. Groups that exist only operationally still appear
 * (quality fields null — never zero-filled); engine-only groups keep
 * null domain counts as zero (genuinely no scoped records).
 */
function mergeGroups(
  monthKey: string,
  engineGroups: ReadonlyArray<KpiSummaryGroupBreakdown>,
  inputs: ReadonlyArray<GroupInput>,
): DepartmentManagementRow[] {
  const rowsByKey = new Map<string, DepartmentManagementRow>();

  const ensureRow = (key: string): DepartmentManagementRow => {
    let row = rowsByKey.get(key);
    if (!row) {
      row = {
        key,
        label: key,
        employeeCount: 0,
        quality: null,
        domains: {
          complaints: emptyDomainFacts('complaints'),
          capaCases: emptyDomainFacts('capaCases'),
          followUps: emptyDomainFacts('followUps'),
          hrDeductions: emptyDomainFacts('hrDeductions'),
        },
      };
      rowsByKey.set(key, row);
    }
    return row;
  };

  // Engine groups first (they define employeeCount + quality stats).
  for (const group of engineGroups) {
    const row = ensureRow(group.key);
    row.employeeCount = group.employeeCount;
    row.quality = {
      avgRawScore: group.avgRawScore,
      avgContribution: group.avgContribution,
    };
  }

  // Operational rows fold into the same groups (or add new ones).
  for (const input of inputs) {
    const byGroup = new Map<string, Row[]>();
    for (const row of input.rows) {
      const employeeId = typeof row.employeeId === 'string' ? row.employeeId : null;
      if (!employeeId) continue; // unlinked operational rows stay in totals only
      const key = input.groupOf(employeeId);
      if (!key) continue; // ungrouped employees are skipped in grouping, not fabricated
      const list = byGroup.get(key) ?? [];
      list.push(row);
      byGroup.set(key, list);
    }
    for (const [key, rows] of byGroup) {
      const row = ensureRow(key);
      row.domains[input.source] = aggregateDomainFacts(input.source, rows, monthKey);
    }
  }

  // Deterministic order: engine presence first (employee count desc),
  // then operational-only groups by name — stable, no random order.
  const out = [...rowsByKey.values()];
  out.sort((a, b) => {
    if (a.quality && !b.quality) return -1;
    if (!a.quality && b.quality) return 1;
    if (a.employeeCount !== b.employeeCount) return b.employeeCount - a.employeeCount;
    return a.label.localeCompare(b.label, 'ar');
  });
  return out;
}

/** Distinct employee ids contributing an operational record in the period. */
function countActiveEmployees(
  monthKey: string,
  inputs: ReadonlyArray<GroupInput>,
): number {
  const ids = new Set<string>();
  for (const input of inputs) {
    for (const row of input.rows) {
      const employeeId = typeof row.employeeId === 'string' ? row.employeeId : null;
      if (employeeId && recordMonth(row, PERIOD_FIELDS[input.source]) === monthKey) {
        ids.add(employeeId);
      }
    }
  }
  return ids.size;
}

/**
 * Build the full cross-domain management report. PURE over loaded
 * data — the service supplies scoped rows + the engine's quality
 * summary. No KPI value is ever recomputed here.
 */
export function buildManagementReport(input: {
  monthKey: string;
  qualitySummary: KpiManagementSummary;
  scopedRows: Record<ManagementDomainSource, ReadonlyArray<Row>>;
  departmentOf: (employeeId: string) => string | null;
  teamOf: (employeeId: string) => string | null;
  generatedAt: string;
}): ManagementReport {
  const domainSources: ReadonlyArray<ManagementDomainSource> = [
    'complaints',
    'capaCases',
    'followUps',
    'hrDeductions',
  ];

  const totals: Record<ManagementDomainSource, DomainPeriodFacts> = {
    complaints: aggregateDomainFacts('complaints', input.scopedRows.complaints, input.monthKey),
    capaCases: aggregateDomainFacts('capaCases', input.scopedRows.capaCases, input.monthKey),
    followUps: aggregateDomainFacts('followUps', input.scopedRows.followUps, input.monthKey),
    hrDeductions: aggregateDomainFacts('hrDeductions', input.scopedRows.hrDeductions, input.monthKey),
  };

  const departments = mergeGroups(
    input.monthKey,
    input.qualitySummary.departments,
    domainSources.map((source) => ({
      rows: input.scopedRows[source],
      source,
      groupOf: input.departmentOf,
    })),
  );

  const teams = mergeGroups(
    input.monthKey,
    input.qualitySummary.teams,
    domainSources.map((source) => ({
      rows: input.scopedRows[source],
      source,
      groupOf: input.teamOf,
    })),
  );

  const activeEmployeeCount = countActiveEmployees(
    input.monthKey,
    domainSources.map((source) => ({
      rows: input.scopedRows[source],
      source,
      groupOf: input.departmentOf,
    })),
  );

  const explanation =
    'أرقام الجودة (الدرجة والمساهمة) تُستهلك حرفياً من ملخص KPI الجودة لمحرك المؤشرات — لا يُعاد حسابها هنا. ' +
    'أرقام الشكاوى/كابا/المتابعات/خصومات HR تجميع حتمي للسجلات داخل نطاق صلاحيتك للفترة ' +
    `${input.monthKey} حسب تاريخ كل سجل (createdAt للشكاوى وكابا، date للمتابعات، month لخصومات HR).`;

  return {
    reportKind: 'MANAGEMENT',
    monthKey: input.monthKey,
    statisticsKind: 'QUALITY_KPI',
    qualitySummary: input.qualitySummary,
    departments,
    teams,
    totals: { domains: totals },
    activeEmployeeCount,
    explanation,
    generatedAt: input.generatedAt,
  };
}

/** Orchestrator: loaders → scoped rows → pure builder (service-side). */
export async function assembleManagementReport(input: {
  monthKey: string;
  /** Viewer's authorized employee set (null = unrestricted). */
  scopeLimit: ReadonlyArray<string> | null;
  loaders: ManagementReportLoaders;
  /** Pre-scope-filtered row sets (server applied the scope engine). */
  scopedRows: Record<ManagementDomainSource, ReadonlyArray<Row>>;
  generatedAt: string;
}): Promise<ManagementReport> {
  const [employees, orgNodes, qualitySummary] = await Promise.all([
    input.loaders.loadEmployees(),
    input.loaders.loadOrgNodes(),
    input.loaders.loadQualitySummary(input.monthKey, input.scopeLimit),
  ]);

  const teamNodeIds = new Set(
    orgNodes.filter((n) => n.type === 'team' || n.type === 'subteam').map((n) => n.id),
  );
  const nodeById = new Map(orgNodes.map((n) => [n.id, n]));

  const departmentOf = (employeeId: string): string | null => {
    const emp = employees.find((e) => e.id === employeeId);
    return emp?.department ?? null;
  };
  const teamOf = (employeeId: string): string | null => {
    const emp = employees.find((e) => e.id === employeeId);
    if (!emp?.orgNodeId) return null;
    const node = nodeById.get(emp.orgNodeId);
    return node && teamNodeIds.has(node.id) ? node.name : null;
  };

  return buildManagementReport({
    monthKey: input.monthKey,
    qualitySummary,
    scopedRows: input.scopedRows,
    departmentOf,
    teamOf,
    generatedAt: input.generatedAt,
  });
}
