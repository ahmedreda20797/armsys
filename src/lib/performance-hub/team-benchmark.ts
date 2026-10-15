// ══════════════════════════════════════════════════════════════
//  Employee Performance Hub — Team Benchmark (§14)
//
//  AGGREGATE team statistics only — never another employee's details.
//  Every per-member value is a CANONICAL source read:
//    • quality   → the month snapshot's stored employee scores (the
//                  SAME sanctioned source the KPI reports read —
//                  loadMonthDetail; open months read the live
//                  preview, closed months the frozen document)
//    • attendance→ stored attendanceResults compliance
//    • deals     → DEAL_CLOSED dimension closures (canonical
//                  deal-dates semantics)
//    • follow-ups→ canonical followUpMetrics completion over the
//                  period's follow-ups
//
//  Membership: the employee's TEAM from the ORGANIZATION TREE. The
//  caller narrows members through the viewer's authorized employee
//  scope (scopeIncludes) — out-of-scope members are excluded, not
//  anonymized, so no unauthorized data is ever touched.
//
// PURE: no reads — the caller injects loaders/values (testable).
// ══════════════════════════════════════════════════════════════

import type { StoredAttendanceResult } from '@/lib/attendance';
import type { FollowUp, TravelDeal } from '@/types';
import type { MonthSnapshot } from '@/types/quality-kpi';
import { getDealMonthKey } from '@/lib/deal-dates';
import type { TeamBenchmarkBlock, TeamBenchmarkMetric } from './types';

/** A team member's benchmark values for one period. */
export interface TeamMemberBenchmarkValues {
  employeeId: string;
  /** Stored month-snapshot quality score (null when absent). */
  qualityScore: number | null;
  /** Stored attendance compliance (null when no stored result). */
  attendanceCompliance: number | null;
  /** DEAL_CLOSED closures with the member in the period. */
  closedDeals: number | null;
  /** Period follow-up completion rate (null when the member has none). */
  followUpCompletion: number | null;
}

export interface BuildTeamBenchmarkInput {
  /** The employee's team node name (null = no team resolved). */
  teamName: string | null;
  /** Team member ids INCLUDING the employee, already scope-filtered. */
  memberIds: ReadonlyArray<string>;
  employeeId: string;
  monthKey: string;
  /** The month snapshot (stored scores) — null when not generated. */
  snapshot: MonthSnapshot | null;
  /** Stored attendance result per member (absent = null entry). */
  attendanceByMember: ReadonlyArray<StoredAttendanceResult | null>;
  dealsByMember: ReadonlyArray<TravelDeal>;
  followUpsByMember: ReadonlyArray<FollowUp>;
}

/** Mean over the non-null values; null when none are measurable. */
function mean(values: ReadonlyArray<number | null>): number | null {
  const usable = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (usable.length === 0) return null;
  return Math.round((usable.reduce((s, v) => s + v, 0) / usable.length) * 100) / 100;
}

/** Rank of `value` among the member values (1 = best, higherIsBetter). */
function rankOf(value: number, memberValues: ReadonlyArray<number | null>, higherIsBetter: boolean): number | null {
  const usable = memberValues.filter((v): v is number => v !== null && Number.isFinite(v));
  if (usable.length < 2) return null; // a rank needs at least two members with data
  const better = higherIsBetter
    ? usable.filter((v) => v > value).length
    : usable.filter((v) => v < value).length;
  return better + 1;
}

function metricOf(
  key: TeamBenchmarkMetric['key'],
  employeeValue: number | null,
  memberValues: ReadonlyArray<number | null>,
  higherIsBetter: boolean,
): TeamBenchmarkMetric {
  const teamAverage = mean(memberValues);
  return {
    key,
    employeeValue,
    teamAverage,
    difference:
      employeeValue !== null && teamAverage !== null
        ? Math.round((employeeValue - teamAverage) * 100) / 100
        : null,
    rank: employeeValue !== null ? rankOf(employeeValue, memberValues, higherIsBetter) : null,
    membersWithData: memberValues.filter((v) => v !== null && Number.isFinite(v)).length,
  };
}

/**
 * Build the benchmark block. UNAVAILABLE when the employee has no
 * resolved team, the team has fewer than two members, or the member
 * set could not be authorized — never a guessed comparison.
 */
export function buildTeamBenchmark(input: BuildTeamBenchmarkInput): TeamBenchmarkBlock {
  const { teamName, memberIds, employeeId, monthKey, snapshot } = input;
  if (!teamName || memberIds.length < 2) {
    return {
      status: 'UNAVAILABLE',
      unavailableReason: teamName ? 'insufficient_members' : 'no_team',
      teamName,
      memberCount: memberIds.length,
      metrics: [],
    };
  }

  // ── Per-member canonical values ──
  const attendanceByMember = new Map(
    input.attendanceByMember.filter((r): r is StoredAttendanceResult => r !== null).map((r) => [r.employeeId, r]),
  );

  const memberValues: TeamMemberBenchmarkValues[] = memberIds.map((memberId) => {
    const storedScore = snapshot?.employeeScores?.[memberId];
    return {
      employeeId: memberId,
      qualityScore: typeof storedScore?.score === 'number' ? storedScore.score : null,
      attendanceCompliance: attendanceByMember.get(memberId)?.compliance ?? null,
      closedDeals: input.dealsByMember.filter(
        (d) => d.employeeId === memberId && getDealMonthKey(d, 'DEAL_CLOSED') === monthKey,
      ).length,
      followUpCompletion: null,
    };
  });

  // Follow-up completion per member (canonical predicates).
  const followUpsByMember = new Map<string, FollowUp[]>();
  for (const f of input.followUpsByMember) {
    const list = followUpsByMember.get(f.employeeId) ?? [];
    list.push(f);
    followUpsByMember.set(f.employeeId, list);
  }
  for (const member of memberValues) {
    const list = followUpsByMember.get(member.employeeId) ?? [];
    if (list.length === 0) continue;
    // Dataset parity: "completed" = resolved + closed (cancelled excluded).
    const completed = list.filter((f) => f.status === 'resolved' || f.status === 'closed').length;
    member.followUpCompletion = Math.round((completed / list.length) * 10000) / 100;
  }

  const me = memberValues.find((m) => m.employeeId === employeeId);
  const values = (key: keyof TeamMemberBenchmarkValues): Array<number | null> =>
    memberValues.map((m) => m[key] as number | null);

  const metrics: TeamBenchmarkMetric[] = [
    metricOf('quality', me?.qualityScore ?? null, values('qualityScore'), true),
    metricOf('attendance', me?.attendanceCompliance ?? null, values('attendanceCompliance'), true),
    metricOf('deals', me?.closedDeals ?? null, values('closedDeals'), true),
    metricOf('followUpCompletion', me?.followUpCompletion ?? null, values('followUpCompletion'), true),
  ];

  return {
    status: 'AVAILABLE',
    unavailableReason: null,
    teamName,
    memberCount: memberIds.length,
    metrics,
  };
}
