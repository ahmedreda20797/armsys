// ══════════════════════════════════════════════════════════════
//  Qnlys milestone regression tests
//
//  Covers the pure layers of this milestone's fixes:
//    • §6  employee identity (Risk Center duplicate root cause)
//    • §7  (pure part of the period default lives in the route/page)
//    • §1  report filtering: team / search / department / archived
//    • §18 archive gates (quality + HR effectiveness predicates)
//    • §15 automation stats — real executions only, null otherwise
//    • §24 follow-up report runner (period/type/status + grouping)
//    • §9  user validation vocabulary (email format gate)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeEmployeesByIdentity, employeeIdentityKey } from '@/lib/risk/employee-identity';
import { isEffectiveDeduction, isArchivedDeduction } from '@/lib/quality-deductions/domain';
import { isEffectiveHrDeduction } from '@/lib/hr-deductions/domain';
import { computeAutomationStats } from '@/lib/automation/stats';
import { resolveEmployeeOrgLabels } from '@/lib/reports/employee-org';
import { buildOrgIndex } from '@/lib/organization/graph';
import { resolveReportRequest } from '@/lib/reports/scope';
import { QUALITY_DEDUCTIONS_REPORT, FOLLOW_UPS_REPORT } from '@/lib/reports/registry';
import {
  filterFollowUpRecords, groupFollowUpsByEmployee, summarizeFollowUps,
} from '@/lib/reports/runners/follow-ups';
import { filterQualityDeductionRecords } from '@/lib/reports/runners/quality-deductions';
import { loadEmployeeOrgRefs } from '@/lib/reports/employee-org';
import type { QualityDeduction, FollowUp } from '@/types';
import type { OrgNode } from '@/lib/organization/types';

// ─────────────────────────────────────────────────────────────
//  §6 Employee identity
// ─────────────────────────────────────────────────────────────

describe('§6 employee identity (risk duplicates root cause)', () => {
  it('merges duplicate records sharing a code into ONE identity', () => {
    const employees = [
      { id: 'a1', code: '101', name: 'أحمد علي', createdAt: '2026-01-01', status: 'active' },
      { id: 'a2', code: '101', name: 'أحمد علي (جديد)', createdAt: '2026-02-01', status: 'active' },
      { id: 'b1', code: '102', name: 'محمد حسن', createdAt: '2026-01-01', status: 'active' },
    ];
    const index = dedupeEmployeesByIdentity(employees);
    assert.equal(index.primaries.length, 2);
    assert.equal(index.mergedIds.length, 1);
    assert.ok(index.mergedIds.includes('a2'));
  });

  it('code identity is case-insensitive and whitespace-safe', () => {
    assert.equal(employeeIdentityKey({ code: ' EM-9 ', name: 'x' }), employeeIdentityKey({ code: 'em-9', name: 'y' }));
  });

  it('falls back to normalized NAME when no code exists', () => {
    const employees = [
      { id: 'x1', code: null, name: 'سعيد محمد' },
      { id: 'x2', code: null, name: 'سعيد  محمد' }, // spacing variant
      { id: 'x3', code: null, name: 'اسم مختلف' },
    ];
    const index = dedupeEmployeesByIdentity(employees);
    assert.equal(index.primaries.length, 2);
  });

  it('primary record prefers ACTIVE status, then the OLDEST record', () => {
    const employees = [
      { id: 'newer', code: '77', name: 'موظف', createdAt: '2026-05-01', status: 'archived' },
      { id: 'older', code: '77', name: 'موظف', createdAt: '2026-01-01', status: 'archived' },
      { id: 'active', code: '77', name: 'موظف', createdAt: '2026-06-01', status: 'active' },
    ];
    const index = dedupeEmployeesByIdentity(employees);
    assert.equal(index.primaries[0].id, 'active');
  });

  it('identityOf maps every record id to its identity key', () => {
    const employees = [
      { id: 'p1', code: '5', name: 'أ' },
      { id: 'dup', code: '5', name: 'أ' },
    ];
    const index = dedupeEmployeesByIdentity(employees);
    assert.equal(index.identityOf('p1'), index.identityOf('dup'));
    assert.equal(index.identityOf('unknown'), null);
  });
});

// ─────────────────────────────────────────────────────────────
//  §18 archive gates
// ─────────────────────────────────────────────────────────────

describe('§18 archive gates (quality + HR)', () => {
  it('archived quality deduction is NOT effective (excluded from active totals)', () => {
    const rec = { approvalStatus: 'approved', archived: true } as Partial<QualityDeduction>;
    assert.equal(isEffectiveDeduction(rec as QualityDeduction), false);
    assert.equal(isArchivedDeduction(rec as QualityDeduction), true);
  });

  it('non-archived approved deduction stays effective', () => {
    assert.equal(isEffectiveDeduction({ approvalStatus: 'approved' } as QualityDeduction), true);
    assert.equal(isEffectiveDeduction({} as QualityDeduction), true); // legacy
  });

  it('archived HR deduction is NOT effective', () => {
    assert.equal(isEffectiveHrDeduction({ status: 'approved', archived: true }), false);
    assert.equal(isEffectiveHrDeduction({ status: 'approved' }), true);
    assert.equal(isEffectiveHrDeduction({ status: 'pending' }), false);
  });
});

// ─────────────────────────────────────────────────────────────
//  §15 automation stats — REAL execution data only
// ─────────────────────────────────────────────────────────────

describe('§15 automation stats', () => {
  it('successRate and lastExecutedAt are NULL when nothing ever executed', () => {
    const stats = computeAutomationStats([
      { id: 'r1', status: 'active', totalExecutions: 0, successCount: 0, failCount: 0 },
      { id: 'r2', status: 'inactive', totalExecutions: 0, successCount: 0, failCount: 0 },
      { id: 'r3', status: 'draft', totalExecutions: 0, successCount: 0, failCount: 0 },
    ] as never);
    assert.equal(stats.total, 3);
    assert.equal(stats.active, 1);
    assert.equal(stats.successRate, null);
    assert.equal(stats.lastExecutedAt, null);
    assert.equal(stats.triggeredToday, 0);
  });

  it('computes the rate from REAL counters', () => {
    const stats = computeAutomationStats([
      { id: 'r1', status: 'active', totalExecutions: 8, successCount: 7, failCount: 1, lastRunAt: '2026-09-14T10:00:00Z' },
      { id: 'r2', status: 'active', totalExecutions: 2, successCount: 1, failCount: 1 },
    ] as never);
    assert.equal(stats.totalExecutions, 10);
    assert.equal(stats.successCount, 8);
    assert.equal(stats.failureCount, 2);
    assert.equal(stats.successRate, 80);
    assert.equal(stats.lastExecutedAt, '2026-09-14T10:00:00Z');
  });

  it('triggeredToday counts only rules whose last run was today', () => {
    const now = new Date('2026-09-14T15:00:00Z');
    const stats = computeAutomationStats([
      { id: 'r1', status: 'active', totalExecutions: 1, successCount: 1, failCount: 0, lastRunAt: '2026-09-14T09:00:00Z' },
      { id: 'r2', status: 'active', totalExecutions: 1, successCount: 0, failCount: 1, lastRunAt: '2026-09-13T09:00:00Z' },
    ] as never, now);
    assert.equal(stats.triggeredToday, 1);
  });
});

// ─────────────────────────────────────────────────────────────
//  §1 report filtering — org-aware labels + new filters
// ─────────────────────────────────────────────────────────────

const ORG_NODES: OrgNode[] = [
  { id: 'company', name: 'الشركة', type: 'company', parentId: null, managerUserId: null, status: 'active', order: 0 } as OrgNode,
  { id: 'dept', name: 'قسم الجودة', type: 'department', parentId: 'company', managerUserId: null, status: 'active', order: 1 } as OrgNode,
  { id: 'team', name: 'فريق المراجعة', type: 'team', parentId: 'dept', managerUserId: null, status: 'active', order: 2 } as OrgNode,
  { id: 'subteam', name: 'فريق فرعي', type: 'subteam', parentId: 'team', managerUserId: null, status: 'active', order: 3 } as OrgNode,
];

// Pre-annotated EmployeeOrgRef rows (what loadEmployeeOrgRefs produces):
// department/team are the RESOLVED org labels, subteams roll up to the team.
const ORG_EMPLOYEES = [
  { id: 'e1', name: 'أحمد', code: '101', department: 'قسم الجودة', team: 'فريق المراجعة', orgNodeId: 'team', searchKey: 'احمد 101' },
  { id: 'e2', name: 'سعيد', code: '102', department: 'قسم الجودة', team: 'فريق المراجعة', orgNodeId: 'subteam', searchKey: 'سعيد 102' },
  { id: 'e3', name: 'ليلى', code: '103', department: 'المبيعات', team: null, orgNodeId: null, searchKey: 'ليلى 103' },
];

describe('§1/§12 org-aware employee labels', () => {
  it('resolves department/team from the ORG TREE (subteam rolls up to team)', () => {
    const index = buildOrgIndex(ORG_NODES);
    const deptLabels = resolveEmployeeOrgLabels(index, { id: 'e1', name: 'أحمد', code: '101', department: 'قسم قديم', orgNodeId: 'team' } as never);
    assert.equal(deptLabels.department, 'قسم الجودة');
    assert.equal(deptLabels.team, 'فريق المراجعة');

    const subLabels = resolveEmployeeOrgLabels(index, { id: 'e2', name: 'سعيد', code: '102', department: null, orgNodeId: 'subteam' } as never);
    assert.equal(subLabels.team, 'فريق المراجعة');
    assert.equal(subLabels.department, 'قسم الجودة');
  });

  it('falls back to the stored department string for unassigned employees', () => {
    const index = buildOrgIndex(ORG_NODES);
    const labels = resolveEmployeeOrgLabels(index, { id: 'e3', name: 'ليلى', code: '103', department: 'المبيعات', orgNodeId: null } as never);
    assert.equal(labels.department, 'المبيعات');
    assert.equal(labels.team, null);
  });
});

function qualityRecord(overrides: Partial<QualityDeduction>): QualityDeduction {
  return {
    id: 'q', employeeId: 'e1', date: '2026-09-05', type: 'quality_issue',
    description: 'وصف', deductionDays: 1, deductionAmount: 0, evidence: null,
    month: '2026-09', relatedCapaId: null, createdAt: '2026-09-05T10:00:00Z',
    ...overrides,
  } as QualityDeduction;
}

function resolvedForQuality(overrides: Record<string, unknown> = {}) {
  const request = {
    reportId: 'quality-deductions',
    monthKey: '2026-09',
    ...overrides,
  };
  const resolution = resolveReportRequest(QUALITY_DEDUCTIONS_REPORT.definition, request as never, new Date('2026-09-14T12:00:00Z'));
  assert.ok(resolution.ok, 'request must resolve');
  return resolution.value;
}

describe('§1 quality report filters (team/search/status/archived)', () => {
  const records = [
    qualityRecord({ id: 'q1' }),
    qualityRecord({ id: 'q2', employeeId: 'e2' }),
    qualityRecord({ id: 'q3', employeeId: 'e3' }),
    qualityRecord({ id: 'qArch', archived: true }),
  ];

  it('TEAM filter uses the real org-team label and rolls subteams up', () => {
    const rows = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({ team: 'فريق المراجعة' }));
    const ids = rows.map((r) => r.id).sort();
    assert.deepEqual(ids, ['q1', 'q2']); // e1 (team) + e2 (subteam roll-up), NOT e3
  });

  it('SEARCH matches the employee NAME (Arabic-normalized substring)', () => {
    const rows = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({ search: 'سعيد' }));
    assert.deepEqual(rows.map((r) => r.id), ['q2']);
  });

  it('rows carry the REAL team label', () => {
    const rows = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({}));
    const q1 = rows.find((r) => r.id === 'q1');
    const q3 = rows.find((r) => r.id === 'q3');
    assert.equal(q1?.team, 'فريق المراجعة');
    assert.equal(q3?.team, null);
  });

  it('ARCHIVED records are excluded by default and shown only on explicit request', () => {
    const active = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({}));
    assert.ok(!active.some((r) => r.id === 'qArch'));
    assert.ok(active.every((r) => !r.archived));

    const archivedOnly = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({ filters: { archived: 'archived' } }));
    assert.deepEqual(archivedOnly.map((r) => r.id), ['qArch']);
    assert.equal(archivedOnly[0]?.archived, true);

    const all = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({ filters: { archived: 'all' } }));
    assert.equal(all.length, 4);
  });

  it('filters COMBINE (team + search + month)', () => {
    const rows = filterQualityDeductionRecords(records, ORG_EMPLOYEES as never, resolvedForQuality({ team: 'فريق المراجعة', search: 'أحمد' }));
    assert.deepEqual(rows.map((r) => r.id), ['q1']);
  });
});

// ─────────────────────────────────────────────────────────────
//  §24 follow-up report runner
// ─────────────────────────────────────────────────────────────

function followUpRecord(overrides: Partial<FollowUp>): FollowUp {
  return {
    id: 'f', employeeId: 'e1', date: '2026-09-01', followUpType: 'quality',
    subject: 'موضوع', status: 'open', priorityLevel: 'medium',
    nextFollowUpDate: null, createdAt: '2026-09-01T10:00:00Z',
    ...overrides,
  } as FollowUp;
}

function resolvedForFollowUps(overrides: Record<string, unknown> = {}) {
  const request = { reportId: 'follow-ups', monthKey: '2026-09', ...overrides };
  const resolution = resolveReportRequest(FOLLOW_UPS_REPORT.definition, request as never, new Date('2026-09-14T12:00:00Z'));
  assert.ok(resolution.ok, 'follow-up request must resolve');
  return resolution.value;
}

describe('§24 follow-ups report (deterministic)', () => {
  const records = [
    followUpRecord({ id: 'f1', employeeId: 'e1', status: 'open' }),
    followUpRecord({ id: 'f2', employeeId: 'e1', status: 'resolved' }),
    followUpRecord({ id: 'f3', employeeId: 'e2', status: 'open', nextFollowUpDate: '2026-09-10' }), // overdue vs 2026-09-14
    followUpRecord({ id: 'f4', employeeId: 'e3', status: 'closed', date: '2026-08-20' }), // previous month
  ];

  it('period scoping excludes other months', () => {
    const rows = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({}), new Date('2026-09-14T12:00:00Z'));
    assert.deepEqual(rows.map((r) => r.id).sort(), ['f1', 'f2', 'f3']);
  });

  it('status and type filters narrow the dataset server-side', () => {
    const rows = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({ filters: { status: 'open' } }), new Date('2026-09-14T12:00:00Z'));
    assert.deepEqual(rows.map((r) => r.id).sort(), ['f1', 'f3']);
    const byType = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({ filters: { type: 'quality' } }), new Date('2026-09-14T12:00:00Z'));
    assert.equal(byType.length, 3);
  });

  it('summary is deterministic: completion rate, overdue count, avg delay', () => {
    const rows = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({}), new Date('2026-09-14T12:00:00Z'));
    const summary = summarizeFollowUps(rows);
    assert.equal(summary.totalCount, 3);
    assert.equal(summary.completedCount, 1);
    assert.equal(summary.overdueCount, 1);
    assert.equal(summary.completionRate, 33);
    assert.ok(summary.avgOverdueDays > 0);
  });

  it('per-employee grouping produces rates, repeated issues and distributions', () => {
    const rows = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({}), new Date('2026-09-14T12:00:00Z'));
    const groups = groupFollowUpsByEmployee(rows);
    const g1 = groups.find((g) => g.employeeId === 'e1');
    assert.equal(g1?.followUpCount, 2);
    assert.equal(g1?.completedCount, 1);
    assert.equal(g1?.completionRate, 50);
    assert.equal(g1?.statusDistribution.includes('مفتوحة: 1'), true);
  });

  it('follow-up labels never leak raw codes', () => {
    const rows = filterFollowUpRecords(records, ORG_EMPLOYEES as never, resolvedForFollowUps({}), new Date('2026-09-14T12:00:00Z'));
    assert.equal(rows[0].type, 'جودة');
    assert.ok(['مفتوحة', 'قيد المراجعة', 'قيد المتابعة', 'تم الحل', 'مغلقة', 'ملغاة'].includes(rows[0].status));
  });
});

// ─────────────────────────────────────────────────────────────
//  §9 user validation vocabulary
// ─────────────────────────────────────────────────────────────

describe('§9 user creation validation gates', () => {
  it('rejects malformed emails before any database access', async () => {
    const { isValidEmailFormat } = await import('@/lib/login-errors');
    assert.equal(isValidEmailFormat('not-an-email'), false);
    assert.equal(isValidEmailFormat('a@b.c'), true);
  });
});
