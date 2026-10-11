// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/insights — route contract tests
//
//  Run: npx tsx --test src/app/api/kpi-reports/__tests__/insights.test.ts
//
//  Covers the route-level guarantees (spec §36 — permissions/scope):
//    1  page permission gate (kpiReports view) — denied → 403
//    2  audience gate: TEAM_LEADER / HR callers are refused the
//       technical detail (directed to /api/reports/hr-performance)
//    3  TECHNICAL caller gets the composed insights payload
//    4  authorized scope is the ceiling: a selection can only
//       narrow (employee ids ∩ scope; org-node subtree ∩ scope)
//    5  fail-closed: a selection entirely outside the scope → empty
//       rows, no leakage, no widening
//    6  invalid month → 400 (Arabic validation message)
//    7  data quality marks hrDeductions RESTRICTED for callers
//       without the hrDeductions grant
//
//  Harness: m01-test-support (in-memory db stubs — no Firebase).
// ══════════════════════════════════════════════════════════════

import '../../../../lib/__tests__/m01-test-support';
import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resetTestData,
  registerFixtures,
  registerUser,
  setTable,
  mintToken,
  bearerHeaders,
  type TestTokens,
} from '../../../../lib/__tests__/m01-test-support';

// ══════════════════════════════════════════════════════════════
//  GET /api/kpi-reports/insights — route contract tests
// ══════════════════════════════════════════════════════════════

type Route = { GET: (req: Request) => Promise<Response> };

// ── Canonical fixtures (same shapes the pure builder tests use) ──

const SCHEME = {
  id: 'scheme_v1',
  schemaVersion: 1,
  name: 'مخطط أداء الموظفين',
  description: null,
  status: 'ACTIVE',
  version: 1,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  isDefault: true,
  applicableDepartments: null,
  components: [
    { componentId: 'quality', name: 'الجودة', weight: 15, owner: 'quality', calculationType: 'quality_engine', status: 'ACTIVE', configuration: null },
    { componentId: 'direct_manager', name: 'المدير المباشر', weight: 15, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
    { componentId: 'hr', name: 'الموارد البشرية', weight: 10, owner: 'hr', calculationType: 'none', status: 'ACTIVE', configuration: null },
    { componentId: 'target', name: 'المستهدف', weight: 60, owner: 'management', calculationType: 'none', status: 'ACTIVE', configuration: null },
  ],
  previousSchemeId: null,
  createdBy: 'tester',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const ORG_NODES = [
  { id: 'ga', name: 'الإدارة العامة', type: 'general_administration', parentId: null, managerUserId: null, status: 'active', order: 0, description: null, createdAt: '', updatedAt: '' },
  { id: 'dept_sales', name: 'المبيعات', type: 'department', parentId: 'ga', managerUserId: null, status: 'active', order: 1, description: null, createdAt: '', updatedAt: '' },
  { id: 'team_a', name: 'فريق الشمال', type: 'team', parentId: 'dept_sales', managerUserId: null, status: 'active', order: 2, description: null, createdAt: '', updatedAt: '' },
  { id: 'sub_a', name: 'فريق الشمال الفرعي', type: 'subteam', parentId: 'team_a', managerUserId: null, status: 'active', order: 3, description: null, createdAt: '', updatedAt: '' },
  { id: 'team_b', name: 'فريق الجنوب', type: 'team', parentId: 'dept_sales', managerUserId: null, status: 'active', order: 4, description: null, createdAt: '', updatedAt: '' },
];

const EMPLOYEES = [
  { id: 'emp_ahmed', code: '001', name: 'أحمد محمد', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'sub_a' },
  { id: 'emp_rahma', code: '002', name: 'رحمة حسام', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'team_a' },
  { id: 'emp_yaser', code: '003', name: 'ياسر فؤاد', department: 'المبيعات', position: 'مندوب', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: 'team_b' },
  { id: 'emp_mona', code: '004', name: 'منى حسن', department: 'تقنية المعلومات', position: 'مهندس', status: 'active', hireDate: null, createdAt: '2026-01-10T00:00:00.000Z', archivedAt: null, orgNodeId: null },
];

function observation(over: Record<string, unknown> & { id: string; employeeId: string; month: string }) {
  const [y, m] = over.month.split('-');
  return {
    schemaVersion: 1,
    employeeName: 'x',
    department: 'd',
    positionSnapshot: 'p',
    observerId: 'u1',
    observerName: 'مراقب',
    observationDate: `05/${m}/${y}`,
    type: 'quality_observation',
    severity: 'medium',
    categoryId: 'cat_followup',
    categoryName: 'تأخر المتابعة',
    categoryWeight: 1,
    notes: 'ملاحظة',
    evidence: '',
    status: 'resolved',
    relatedCapaId: null,
    correctiveAction: '',
    dueDate: null,
    resolvedDate: null,
    applyPointDeduction: true,
    isBonus: false,
    approvalStatus: 'approved',
    approvalHistory: [],
    auditLog: [],
    createdById: 'u1',
    createdByName: 'منشئ',
    clientRequestId: null,
    createdAt: '2026-09-05T10:00:00.000Z',
    updatedAt: '2026-09-05T10:00:00.000Z',
    ...over,
  };
}

const OBSERVATIONS = [
  observation({ id: 'o1', employeeId: 'emp_ahmed', month: '2026-09' }),
  observation({ id: 'o2', employeeId: 'emp_ahmed', month: '2026-09', severity: 'high' }),
  observation({ id: 'o3', employeeId: 'emp_rahma', month: '2026-09' }),
  observation({ id: 'o4', employeeId: 'emp_ahmed', month: '2026-09', approvalStatus: 'pending' }),
  observation({ id: 'o5', employeeId: 'emp_yaser', month: '2026-08' }),
];

function snapshotEmployee(employeeId: string, name: string, score: number) {
  return {
    employeeSnapshot: {
      employeeId,
      employeeName: name,
      departmentId: 'd1',
      departmentName: 'المبيعات',
      position: 'مندوب',
      supervisorId: null,
    },
    score,
    deductionPoints: 100 - score,
    bonusPoints: 0,
    weightedPoints: 0,
    observationCount: 2,
    approvedCount: 2,
    pendingCount: 0,
    rejectedCount: 0,
    categoryTotals: {},
    rank: 1,
    dept: 'المبيعات',
  };
}

function frozenKpiResult(employeeId: string, score: number) {
  return {
    employeeId,
    period: '2026-09',
    schemeId: SCHEME.id,
    schemeName: SCHEME.name,
    schemeVersion: 1,
    finalizedAt: '2026-10-01T00:00:00.000Z',
    calculationVersion: 'v1',
    availableWeight: 15,
    weightedTotal: Math.round(score * 15) / 100,
    overallStatus: 'INCOMPLETE',
    components: [
      {
        componentId: 'quality',
        name: 'الجودة',
        owner: 'quality',
        calculationType: 'quality_engine',
        status: 'FINALIZED',
        weight: 15,
        rawScore: score,
        weightedContribution: Math.round(score * 15) / 100,
        maxContribution: 15,
        evidence: { source: 'quality_engine', observationCount: 2, deductionPoints: 100 - score, bonusPoints: 0 },
      },
    ],
  };
}

function closedSnapshot(month: string, scores: Record<string, { name: string; score: number }>) {
  const employeeScores: Record<string, unknown> = {};
  const kpiResults: Record<string, unknown> = {};
  for (const [employeeId, entry] of Object.entries(scores)) {
    employeeScores[employeeId] = snapshotEmployee(employeeId, entry.name, entry.score);
    kpiResults[employeeId] = frozenKpiResult(employeeId, entry.score);
  }
  return {
    id: month,
    schemaVersion: 1,
    monthKey: month,
    status: 'closed',
    closedAt: '2026-10-01T00:00:00.000Z',
    closedBy: 'u1',
    closedByName: 'المدير العام',
    reopenCount: 0,
    reopenReason: '',
    auditLog: [],
    generatedAt: '2026-10-01T00:00:00.000Z',
    settingsSnapshot: {},
    employeeScores,
    departmentScores: {},
    topEmployees: [],
    bottomEmployees: [],
    categoryTotals: {},
    approvalStats: { total: 0, pending: 0, approved: 0, rejected: 0, avgApprovalHours: 0 },
    kpiResults,
  };
}

function seedData(): void {
  setTable('orgNodes', ORG_NODES);
  setTable('employees', EMPLOYEES);
  setTable('employmentEvents', []);
  setTable('kpiSchemes', [SCHEME]);
  setTable('kpiSchemeOverrides', []);
  setTable('monthSnapshots', [
    closedSnapshot('2026-09', {
      emp_ahmed: { name: 'أحمد محمد', score: 90 },
      emp_rahma: { name: 'رحمة حسام', score: 92 },
      emp_yaser: { name: 'ياسر فؤاد', score: 80 },
    }),
    closedSnapshot('2026-08', {
      emp_ahmed: { name: 'أحمد محمد', score: 85 },
      emp_rahma: { name: 'رحمة حسام', score: 80 },
      emp_yaser: { name: 'ياسر فؤاد', score: 84 },
    }),
  ]);
  setTable('qualityObservations', OBSERVATIONS);
  setTable('followUps', [{ id: 'f1' }]);
  setTable('complaints', []);
  setTable('capaCases', []);
  setTable('attendanceResults', []);
  setTable('hrDeductions', [{ id: 'hrd1' }]);
}

describe('GET /api/kpi-reports/insights — route contract (KPI Reports 2.0)', () => {
  let route: Route;
  let t: TestTokens;
  let scopedToken: string;

  before(async () => {
    route = (await import('@/app/api/kpi-reports/insights/route')) as unknown as Route;
  });

  beforeEach(async () => {
    resetTestData();
    t = await registerFixtures();
    seedData();
    // A TECHNICAL caller with a NARROWED people scope: the quality role
    // preset carries quality/observations view (→ TECHNICAL audience);
    // the stored employees override narrows the AUTHORIZED set to the
    // DIRECT members of team_a only.
    registerUser({
      id: 'u-scoped',
      email: 'scoped@test.local',
      name: 'جودة مقيدة',
      role: 'quality',
      orgBoundaryNodeIds: ['team_a'],
      permissions: { employees: { level: 'edit', scope: 'team' } },
    });
    scopedToken = await mintToken({ userId: 'u-scoped', email: 'scoped@test.local', role: 'quality' });
    // Non-technical people managers: no quality/observations view —
    // employees scope resolves TEAM_LEADER / HR audiences (the routes
    // refuse them the technical detail, server-side).
    registerUser({
      id: 'u-tl',
      email: 'tl@test.local',
      name: 'قائد فريق',
      role: 'user',
      orgBoundaryNodeIds: ['team_a'],
      permissions: { kpiReports: { level: 'read' }, employees: { level: 'read', scope: 'team' } },
    });
    registerUser({
      id: 'u-hruser',
      email: 'hruser@test.local',
      name: 'موارد بشرية',
      role: 'user',
      orgBoundaryNodeIds: ['ga'],
      permissions: { kpiReports: { level: 'read' }, employees: { level: 'read', scope: 'all' } },
    });
  });

  async function get(query: string, token: string): Promise<{ status: number; body: any }> {
    const res = await route.GET(new Request(`http://localhost/api/kpi-reports/insights${query}` as unknown as Request, {
      headers: bearerHeaders(token),
    }));
    return { status: res.status, body: await res.json() };
  }

  it('1. admin (TECHNICAL) gets the composed insights payload', async () => {
    const { status, body } = await get('?month=2026-09', t.adminToken);
    assert.equal(status, 200);
    assert.equal(body.reportKind, 'INSIGHTS');
    assert.equal(body.valueBasis, 'FINALIZED');
    assert.equal(body.rows.length, 4);
    assert.equal(body.overview.observationsApproved, 3); // pending one never counts
    assert.equal(body.overview.observationsPending, 1);
    assert.equal(body.selection.isCompanyWide, true);
    // Unrestricted viewer → hrDeductions source stays available.
    assert.equal(body.dataQuality.find((d: any) => d.source === 'hrDeductions').status, 'available');
  });

  it('2. missing kpiReports view → 403 (page permission gate)', async () => {
    const { status, body } = await get('?month=2026-09', t.userToken);
    assert.equal(status, 403);
    assert.ok(body.error);
  });

  it('3. TEAM_LEADER / HR audiences are refused technical detail (403, pointed at the HR report)', async () => {
    const tlToken = await mintToken({ userId: 'u-tl', email: 'tl@test.local', role: 'user' });
    const tl = await get('?month=2026-09', tlToken);
    assert.equal(tl.status, 403);
    assert.ok(String(tl.body.error.message).includes('الموارد البشرية'));

    const hrToken2 = await mintToken({ userId: 'u-hruser', email: 'hruser@test.local', role: 'user' });
    const hr = await get('?month=2026-09', hrToken2);
    assert.equal(hr.status, 403);
    assert.ok(String(hr.body.error.message).includes('الموارد البشرية'));
  });

  it('4. authorized scope is the ceiling: employee selection can only narrow', async () => {
    // Authorized (team anchor) = DIRECT members of team_a = [رحمة].
    const both = await get('?month=2026-09&employees=emp_rahma,emp_yaser', scopedToken);
    assert.equal(both.status, 200);
    // ياسر is outside the authorized set → dropped, never widened.
    assert.deepEqual(both.body.rows.map((r: any) => r.employeeId), ['emp_rahma']);
    assert.equal(both.body.selection.isCompanyWide, false);
  });

  it('5. org-node selection resolves subtrees INSIDE the authorized scope only', async () => {
    // sub_a's subtree contains أحمد — but he is NOT in the authorized
    // direct-member set → fail-closed empty report.
    const out = await get('?month=2026-09&orgNodes=sub_a', scopedToken);
    assert.equal(out.status, 200);
    assert.equal(out.body.rows.length, 0);

    // The authorized team itself resolves its direct member.
    const own = await get('?month=2026-09&orgNodes=team_a', scopedToken);
    assert.equal(own.status, 200);
    assert.deepEqual(own.body.rows.map((r: any) => r.employeeId), ['emp_rahma']);
    // The vocabulary never lists units outside the authorized scope.
    assert.ok(!own.body.vocab.teams.some((v: any) => v.nodeId === 'team_b'));
    assert.ok(own.body.vocab.teams.some((v: any) => v.nodeId === 'team_a'));
  });

  it('6. invalid month → 400 with an Arabic validation message', async () => {
    const { status, body } = await get('?month=09-2026', t.adminToken);
    assert.equal(status, 400);
    assert.ok(typeof body.error?.message === 'string' && body.error.message.length > 0);
  });

  it('7. hrDeductions source reads RESTRICTED for callers without the grant', async () => {
    // The scoped quality viewer holds no hrDeductions page grant.
    const { status, body } = await get('?month=2026-09', scopedToken);
    assert.equal(status, 200);
    const hrEntry = body.dataQuality.find((d: any) => d.source === 'hrDeductions');
    assert.equal(hrEntry.status, 'restricted');
  });

  it('8. previous-period change is data-driven (deltas from the canonical previous month)', async () => {
    const { body } = await get('?month=2026-09', t.adminToken);
    const ahmed = body.employeeFacts['emp_ahmed'];
    assert.equal(ahmed.previousRawScore, 85);
    assert.equal(ahmed.deltaPoints, 5);
    const yaser = body.employeeFacts['emp_yaser'];
    assert.equal(yaser.deltaPoints, -4);
  });
});
