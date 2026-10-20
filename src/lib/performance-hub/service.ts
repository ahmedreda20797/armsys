// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — Service (orchestrator)
//
//  Wires the canonical datasets + gated blocks into the Hub dataset:
//
//    current/previous  → getEmployeePerformanceDataset (the existing
//                        Phase-3 service — canonical KPI/quality/
//                        follow-up/deals/complaints/CAPA/attendance
//                        facts, verbatim)
//    risk              → computePeriodRisk (canonical computeRisk fed
//                        with period-attributed canonical records)
//    hr                → aggregateHrMonth over the period's HR
//                        deduction records (only READ when authorized)
//    timeline          → buildHubTimeline over the same period records
//    team benchmark    → buildTeamBenchmark (aggregate team stats)
//    analysis          → buildHubAnalysis (deterministic rules)
//
//  READ-ONLY: no collection is ever written. Batched, cached reads
//  (lib/db TTL) — the same tables the datasets already read, so the
//  extra cost per request is the engine run for the PREVIOUS month
//  (frozen fast-path when closed) plus org/snapshot lookups.
//
//  Returns null ONLY when the employee does not exist (caller → 404).
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { isValidMonthKey } from '@/lib/month-utils';
import { previousMonthKey, defaultKpiReportingLoaders } from '@/lib/kpi-reporting';
import { buildOrgIndex, findAncestorOfType } from '@/lib/organization/graph';
import { findAncestorAtLevel } from '@/lib/organization/levels';
import {
  getEmployeePerformanceDataset,
  defaultPerformanceIntelligenceLoaders,
  attributeRecords,
  monthOfCapa,
  monthOfComplaint,
  monthOfFollowUp,
  monthOfObservation,
  monthOfQualityDeduction,
  PERFORMANCE_INTELLIGENCE_SOURCES,
} from '@/lib/performance-intelligence';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { ATTENDANCE_RESULTS_TABLE } from '@/lib/attendance';
import type { StoredAttendanceResult } from '@/lib/attendance';
import { getDealMonthKey } from '@/lib/deal-dates';
import { aggregateHrMonth, HR_DEDUCTIONS_TABLE } from '@/lib/employee-performance';
import type { EmployeeHrDeductionRecord } from '@/lib/employee-performance';
import type { FollowUp, TravelDeal } from '@/types';
import { computePeriodRisk, riskSignalsOf } from './risk-block';
import { buildHubTimeline } from './timeline';
import { buildTeamBenchmark } from './team-benchmark';
import { buildHubAnalysis } from './analysis';
import type {
  EmployeePerformanceHubDataset,
  GetEmployeePerformanceHubDatasetInput,
  HubDataQualityItem,
  HubHrBlock,
  HubRiskBlock,
} from './types';

export interface GetPerformanceHubServiceInput extends GetEmployeePerformanceHubDatasetInput {
  /** Risk section granted (route-resolved employee360 section gate). */
  riskEnabled: boolean;
  /** HR-deductions section granted (route-resolved). */
  hrAuthorized: boolean;
}

/**
 * Build the Employee Performance Hub dataset. Thin orchestration over
 * canonical sources — every business value is computed by its owning
 * engine; this function only assembles and analyzes.
 */
export async function getEmployeePerformanceHubDataset(
  input: GetPerformanceHubServiceInput,
): Promise<EmployeePerformanceHubDataset | null> {
  if (!isValidMonthKey(input.monthKey)) {
    throw new Error(`invalid month key: ${String(input.monthKey)}`);
  }
  const now = input.now ?? new Date();
  const monthKey = input.monthKey;
  const prevKey = previousMonthKey(monthKey);
  const loaders = defaultPerformanceIntelligenceLoaders;

  // ── Canonical fact datasets: current + previous period ──
  const [current, previous] = await Promise.all([
    getEmployeePerformanceDataset({ employeeId: input.employeeId, monthKey, now }),
    getEmployeePerformanceDataset({ employeeId: input.employeeId, monthKey: prevKey, now }).catch(() => null),
  ]);
  if (!current) return null;

  // ── Period records (cached, batched — the same tables the datasets read) ──
  const [observations, deductions, complaints, capaSplit, followUps, deals, attCurrent, attPrevious] =
    await Promise.all([
      loaders.loadObservationsForWindow(input.employeeId, [prevKey, monthKey]),
      loaders.loadQualityDeductions(input.employeeId),
      loaders.loadComplaints(input.employeeId),
      loaders.loadCapaCases(input.employeeId),
      loaders.loadFollowUps(input.employeeId),
      loaders.loadTravelDeals(input.employeeId),
      loaders.loadStoredAttendanceResult(input.employeeId, monthKey),
      loaders.loadStoredAttendanceResult(input.employeeId, prevKey),
    ]);

  const twoMonths = [prevKey, monthKey];
  const attrObservations = attributeRecords(observations, monthOfObservation, monthKey, twoMonths);
  const attrDeductions = attributeRecords(deductions, monthOfQualityDeduction, monthKey, twoMonths);
  const attrComplaints = attributeRecords(complaints, monthOfComplaint, monthKey, twoMonths);
  const attrCapa = attributeRecords(capaSplit.primary, monthOfCapa, monthKey, twoMonths);
  const attrFollowUps = attributeRecords(followUps, monthOfFollowUp, monthKey, twoMonths);
  const capaAll = [...capaSplit.primary, ...capaSplit.indirect];

  // ── HR block (read ONLY when the viewer is authorized) ──
  let hr: HubHrBlock | null = null;
  let hrRecordsCurrent: Array<EmployeeHrDeductionRecord & { id?: string; type?: string; deductionDate?: string | null; status?: string | null }> = [];
  let hrCountCurrent = 0;
  let hrCountPrevious = 0;
  if (input.hrAuthorized) {
    const allHr = await getAll<EmployeeHrDeductionRecord & { id: string; type?: string; deductionDate?: string | null; status?: string | null }>(HR_DEDUCTIONS_TABLE);
    const own = allHr.filter((r) => r && r.employeeId === input.employeeId);
    const currentRows = own.filter((r) => r.month === monthKey);
    const previousRows = own.filter((r) => r.month === prevKey);
    hr = {
      current: currentRows.length ? aggregateHrMonth(monthKey, currentRows) : null,
      previous: previousRows.length ? aggregateHrMonth(prevKey, previousRows) : null,
    };
    hrRecordsCurrent = currentRows;
    hrCountCurrent = currentRows.length;
    hrCountPrevious = previousRows.length;
  }

  // ── Risk (canonical formula, period-attributed factors) ──
  const riskCurrent = input.riskEnabled
    ? computePeriodRisk({
        attendanceResult: attCurrent,
        qualityDeductionCount: attrDeductions.inPeriod.length,
        hrCount: hrCountCurrent,
        followUps: attrFollowUps.inPeriod,
        complaints: attrComplaints.inPeriod,
        capaCases: capaAll,
        now,
      })
    : null;
  const riskPrevious = input.riskEnabled
    ? computePeriodRisk({
        attendanceResult: attPrevious,
        qualityDeductionCount: attrDeductions.byMonth.get(prevKey)?.length ?? 0,
        hrCount: hrCountPrevious,
        followUps: attrFollowUps.byMonth.get(prevKey) ?? [],
        complaints: attrComplaints.byMonth.get(prevKey) ?? [],
        capaCases: capaAll,
        now,
      })
    : null;

  const riskBlock: HubRiskBlock | null = riskCurrent
    ? {
        status: 'AVAILABLE',
        level: riskCurrent.level,
        score: riskCurrent.score,
        signals: riskSignalsOf(riskCurrent.breakdown),
        previousScore: riskPrevious?.score ?? null,
        previousLevel: riskPrevious?.level ?? null,
        source: 'risk_engine',
      }
    : null;

  // ── Timeline (period events; HR events only when authorized) ──
  const timeline = buildHubTimeline({
    observations: attrObservations.inPeriod,
    qualityDeductions: attrDeductions.inPeriod,
    followUps: attrFollowUps.inPeriod,
    complaints: attrComplaints.inPeriod,
    capaCases: attrCapa.inPeriod,
    deals: deals.filter((d) => getDealMonthKey(d, 'DEAL_CLOSED') === monthKey),
    attendanceResult: attCurrent,
    hrRecords: hrRecordsCurrent,
    kpi: { monthKey, finalized: current.period.finalized, rowStatus: current.kpi.rowStatus },
  });

  // ── Organization context + team benchmark ──
  const identity = await loaders.loadEmployeeIdentity(input.employeeId);
  const orgNodes = await loaders.loadOrgNodes();
  const orgIndex = buildOrgIndex(orgNodes as never);
  const orgNodeId = identity?.orgNodeId ?? null;
  const teamNode = orgNodeId ? findAncestorOfType(orgIndex, orgNodeId, 'team') : null;
  // §ORG-LEVELS — the company is the nearest ancestor whose SEMANTIC
  // level is 'company' (derived, never assumed from the stored type:
  // a legacy GA root is company-typed but is General Administration).
  const companyNode = orgNodeId ? findAncestorAtLevel(orgIndex, orgNodeId, 'company') : null;

  let teamBenchmark: EmployeePerformanceHubDataset['teamBenchmark'] = null;
  if (input.scopeIncludes) {
    const allEmployees = await defaultKpiReportingLoaders.loadEmployees();
    // Team membership: employees whose nearest team ancestor (self
    // counts) IS the employee's team node — the org tree is canonical.
    const memberIds = allEmployees
      .filter((e) => {
        if (!e.orgNodeId) return false;
        const memberTeam = findAncestorOfType(orgIndex, e.orgNodeId, 'team');
        return memberTeam?.id === teamNode?.id;
      })
      .map((e) => e.id)
      .filter((id) => id === input.employeeId || input.scopeIncludes!(id));

    if (teamNode && memberIds.length > 0) {
      const memberSet = new Set(memberIds);
      const [snapshot, attendanceRows, memberDeals, memberFollowUps] = await Promise.all([
        defaultKpiReportingLoaders.loadMonthDetail(monthKey),
        getAll<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE, TTL.STATIC),
        getAll<TravelDeal>(PERFORMANCE_INTELLIGENCE_SOURCES.deals),
        getAll<FollowUp>(PERFORMANCE_INTELLIGENCE_SOURCES.followUps),
      ]);
      teamBenchmark = buildTeamBenchmark({
        teamName: teamNode.name,
        memberIds,
        employeeId: input.employeeId,
        monthKey,
        snapshot,
        attendanceByMember: memberIds.map((id) => attendanceRows.find((r) => r.employeeId === id && r.month === monthKey) ?? null),
        dealsByMember: memberDeals.filter((d) => memberSet.has(d.employeeId)),
        followUpsByMember: memberFollowUps.filter((f) => memberSet.has(f.employeeId)),
      });
    } else {
      teamBenchmark = {
        status: 'UNAVAILABLE',
        unavailableReason: teamNode ? 'insufficient_members' : 'no_team',
        teamName: teamNode?.name ?? null,
        memberCount: 0,
        metrics: [],
      };
    }
  }

  // ── Deterministic analysis ──
  const analysis = buildHubAnalysis({
    current,
    previous,
    risk: { current: riskCurrent, previous: riskPrevious },
    hr: input.hrAuthorized ? { current: hr?.current ?? null, previous: hr?.previous ?? null } : null,
  });

  // ── Data quality (material limitations only — §24) ──
  const dataQuality = buildDataQuality({
    current,
    previous,
    attCurrent,
    riskEnabled: input.riskEnabled,
    hrAuthorized: input.hrAuthorized,
    teamBenchmark,
  });

  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_HUB',
    employee: current.employee,
    organizationContext: {
      department: current.employee.department,
      team: current.employee.team,
      manager: current.employee.manager,
      company: companyNode?.name ?? null,
    },
    period: {
      monthKey,
      previousMonthKey: prevKey,
      valueBasis: current.period.valueBasis,
      finalized: current.period.finalized,
    },
    current,
    previous,
    overview: analysis.overview,
    dimensions: analysis.dimensions,
    changes: analysis.changes,
    crossSignals: analysis.crossSignals,
    patterns: analysis.patterns,
    strengths: analysis.strengths,
    developmentAreas: analysis.developmentAreas,
    recommendations: analysis.recommendations,
    timeline,
    teamBenchmark,
    risk: riskBlock,
    hr,
    dataQuality,
    generatedAt: now.toISOString(),
  };
}

function buildDataQuality(args: {
  current: EmployeePerformanceDataset;
  previous: EmployeePerformanceDataset | null;
  attCurrent: StoredAttendanceResult | null;
  riskEnabled: boolean;
  hrAuthorized: boolean;
  teamBenchmark: EmployeePerformanceHubDataset['teamBenchmark'];
}): HubDataQualityItem[] {
  const { current, previous, attCurrent, riskEnabled, hrAuthorized, teamBenchmark } = args;
  const items: HubDataQualityItem[] = [];

  const kpiIncomplete = current.kpi.rowStatus === 'INCOMPLETE' || current.kpi.rowStatus === 'PENDING';
  items.push({
    domain: 'kpi',
    state: kpiIncomplete ? 'PARTIAL' : 'COMPLETE',
    note: kpiIncomplete ? 'note.kpiIncomplete' : null,
  });

  items.push(
    attCurrent
      ? { domain: 'attendance' as const, state: 'COMPLETE' as const, note: null }
      : { domain: 'attendance' as const, state: 'MISSING' as const, note: 'note.attendanceUnavailable' },
  );

  items.push(
    riskEnabled
      ? { domain: 'risk' as const, state: 'COMPLETE' as const, note: null }
      : { domain: 'risk' as const, state: 'RESTRICTED' as const, note: 'note.riskRestricted' },
  );

  items.push(
    hrAuthorized
      ? { domain: 'hr' as const, state: 'COMPLETE' as const, note: null }
      : { domain: 'hr' as const, state: 'RESTRICTED' as const, note: 'note.hrRestricted' },
  );

  if (current.deals.closedWithEmployeeUnknownMonth > 0) {
    items.push({
      domain: 'deals',
      state: 'PARTIAL',
      note: 'note.dealClosureDatesUnknown',
    });
  }

  if (teamBenchmark?.status === 'UNAVAILABLE') {
    items.push({
      domain: 'teamBenchmark',
      state: 'UNAVAILABLE',
      note: teamBenchmark.unavailableReason === 'no_team' ? 'note.noTeam' : 'note.insufficientMembers',
    });
  }

  if (!previous) {
    items.push({ domain: 'kpi', state: 'PARTIAL', note: 'note.previousPeriodUnavailable' });
  }

  for (const entry of current.dataQuality.unattributedRecords) {
    const domain =
      entry.collection === 'qualityObservations' || entry.collection === 'qualityDeductions' ? 'quality'
        : entry.collection === 'followUps' ? 'followUp'
          : entry.collection === 'travelDeals' ? 'deals'
            : entry.collection === 'complaints' ? 'complaints'
              : entry.collection === 'capaCases' ? 'capa'
                : 'quality';
    items.push({ domain, state: 'PARTIAL', note: 'note.unattributedRecords' });
  }

  return items;
}
