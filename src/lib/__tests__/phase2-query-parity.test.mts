// ══════════════════════════════════════════════════════════════
//  Phase 2 — OLD vs NEW query parity + reliability + measurement
//
//  For every reader adopted onto the §INDEXED-QUERY primitive this
//  suite proves the result is UNCHANGED, using two independent
//  methods:
//
//    A — LEGACY RE-MATERIALIZATION: the exact pre-Phase-2
//        computation (full-table read + in-memory strict filter) is
//        re-implemented verbatim in this file and compared
//        deep-equal against the new reader (order included).
//
//    B — DOUBLE-RUN: the same new reader is executed twice against
//        identical fixtures — once with the fake index working,
//        once with the index forced to FAIL (the fallback path,
//        which IS the legacy computation). Deep equality proves
//        indexed ≡ legacy through the shipped code itself.
//
//  Fixtures deliberately include the historical-data hazards: rows
//  with a MISSING employeeId, a MISSING month, duplicate
//  (employeeId, month) pairs, unknown/extra stored fields, and
//  records of employees outside the queried scope.
//
//  The Firebase Admin DB is mocked at the firebase-server boundary —
//  no real database. The measurement numbers are therefore
//  MOCK/HARNESS measurements (op counts + row-download counts), not
//  production timings.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

mock.module('server-only', { exports: {} });

// ─── Fake RTDB ─────────────────────────────────────────────────
const fake = {
  tables: new Map<string, Record<string, unknown>>(),
  indexedError: false,
  hangIndexed: false,
  // measurement counters
  fullOps: 0,
  indexedOps: 0,
  fullRowsDownloaded: 0,
  indexedRowsDownloaded: 0,
};

function resetFake() {
  fake.tables = new Map();
  fake.indexedError = false;
  fake.hangIndexed = false;
  fake.fullOps = 0;
  fake.indexedOps = 0;
  fake.fullRowsDownloaded = 0;
  fake.indexedRowsDownloaded = 0;
}

function setTable(name: string, rows: Record<string, unknown>) {
  fake.tables.set(name, rows);
}

function makeSnapshot(obj: Record<string, unknown> | null) {
  return {
    exists: () => obj !== null && Object.keys(obj).length > 0,
    val: () => obj,
  };
}

const fakeDb = {
  ref(path: string) {
    const [table, recordId] = path.replace(/^arm_erp\//, '').split('/');
    return {
      async get() {
        fake.fullOps += 1;
        const node = (fake.tables.get(table) as Record<string, unknown>) ?? null;
        if (recordId) {
          const rec = node?.[recordId];
          return makeSnapshot(rec ? { [recordId]: rec } : null);
        }
        if (node) fake.fullRowsDownloaded += Object.keys(node).length;
        return makeSnapshot(node);
      },
      async set(record: Record<string, unknown>) {
        const node = (fake.tables.get(table) as Record<string, unknown>) ?? {};
        node[recordId!] = record;
        fake.tables.set(table, node);
      },
      async update(patch: Record<string, unknown>) {
        const node = (fake.tables.get(table) as Record<string, unknown>) ?? {};
        node[recordId!] = { ...((node[recordId!] as Record<string, unknown>) ?? {}), ...patch };
        fake.tables.set(table, node);
      },
      async remove() {
        const node = (fake.tables.get(table) as Record<string, unknown>) ?? {};
        delete node[recordId!];
        fake.tables.set(table, node);
      },
      orderByChild(field: string) {
        return {
          equalTo(value: string) {
            const query = {
              // findUserByEmail caps duplicates with limitToFirst(2) —
              // passthrough (does not change single-match behavior).
              limitToFirst(_limit: number) {
                return query;
              },
              async get() {
                fake.indexedOps += 1;
                if (fake.hangIndexed) return new Promise(() => {});
                if (fake.indexedError) {
                  throw new Error(`[Error client] Index not defined. Consider using ".indexOn": "${field}"`);
                }
                const node = (fake.tables.get(table) as Record<string, unknown>) ?? {};
                const matches = Object.entries(node)
                  .filter(([, val]) => (val as Record<string, unknown>)?.[field] === value)
                  .map(([key, val]) => [key, val] as const);
                fake.indexedRowsDownloaded += matches.length;
                return makeSnapshot(Object.fromEntries(matches));
              },
            };
            return query as never;
          },
        };
      },
    };
  },
};

mock.module('@/lib/firebase-server', {
  exports: {
    getAdminDb: () => fakeDb,
  },
});

const {
  invalidateCache,
  getAll,
  resetIndexedQueryStateForTests,
} = await import('@/lib/db');

const { attributeMonth } = await import('@/lib/performance-intelligence/month-attribution');
const { computeEmployeeScore } = await import('@/lib/metrics/kpiMetrics');
const {
  getAttendanceResultsForMonth,
  generateMonthlyAttendanceResults,
  attendanceResultId,
} = await import('@/lib/attendance/monthly-results');
const { defaultEmployeePerformanceLoaders } = await import('@/lib/employee-performance');
const { defaultPerformanceIntelligenceLoaders } = await import('@/lib/performance-intelligence');
const { defaultKpiReportingLoaders } = await import('@/lib/kpi-reporting');
const { defaultKpiFrameworkLoaders } = await import('@/lib/kpi-framework/employee-result');
const { computeFreshMonthSnapshot } = await import('@/lib/month-snapshots');
const { getKpiSettings } = await import('@/lib/kpi-settings');

beforeEach(() => {
  resetFake();
  invalidateCache();
  resetIndexedQueryStateForTests();
});

/** A cold-cache snapshot of the fake's measurement counters. */
function stats() {
  return { ...fake };
}

// ══════════════════════════════════════════════════════════════
//  Fixtures
// ══════════════════════════════════════════════════════════════

const MONTHS = ['2026-06', '2026-07', '2026-08'] as const;
const EMPLOYEES = ['emp_alpha', 'emp_beta', 'emp_gamma'] as const;
const OTHER_EMP = 'emp_delta'; // rows that must NEVER leak into alpha's reads

/** attendanceResults — one deterministic id per employee/month, plus
 *  duplicates, edge rows and an out-of-scope employee. */
function buildAttendanceResults(): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  for (const month of MONTHS) {
    for (const emp of EMPLOYEES) {
      rows[attendanceResultId(month, emp)] = {
        employeeId: emp,
        month,
        attendanceDeductionDays: emp === 'emp_alpha' && month === '2026-07' ? 2 : 0,
        compliance: { score: 90 },
      };
    }
  }
  // duplicate (employeeId, month) under a non-canonical key — legacy
  // "last row wins" semantics must be preserved by the new read
  rows['legacy_dup_1'] = { employeeId: 'emp_alpha', month: '2026-08', attendanceDeductionDays: 9, compliance: { score: 10 } };
  rows['legacy_dup_2'] = { employeeId: 'emp_alpha', month: '2026-08', attendanceDeductionDays: 1, compliance: { score: 99 } };
  // historical hazards: missing employeeId / missing month
  rows['edge_no_emp'] = { month: '2026-07', attendanceDeductionDays: 5 };
  rows['edge_no_month'] = { employeeId: 'emp_alpha', attendanceDeductionDays: 5 };
  // out-of-scope employee
  rows[attendanceResultId('2026-08', OTHER_EMP)] = { employeeId: OTHER_EMP, month: '2026-08', attendanceDeductionDays: 3 };
  return rows;
}

/** qualityObservations — multi-employee, multi-month, plus rows whose
 *  stored month is MISSING but whose observationDate attributes them
 *  (the loadObservationsForWindow hazard), missing employeeId rows,
 *  bonus/approval variants and unknown fields. */
function buildObservations(): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  let n = 0;
  const push = (row: Record<string, unknown>) => {
    rows[`obs_${++n}`] = row;
  };
  for (const month of MONTHS) {
    for (const emp of EMPLOYEES) {
      push({
        employeeId: emp,
        month,
        observationDate: `05/${month.slice(5)}/${month.slice(0, 4)}`,
        points: 2,
        applyPointDeduction: true,
        approvalStatus: 'approved',
        isBonus: false,
        description: `${emp} ${month}`,
      });
      push({
        employeeId: emp,
        month,
        observationDate: `20/${month.slice(5)}/${month.slice(0, 4)}`,
        points: 1,
        applyPointDeduction: false,
        approvalStatus: 'pending',
        isBonus: false,
      });
    }
  }
  // legacy row: stored month MISSING, attributable via observationDate
  push({ employeeId: 'emp_alpha', observationDate: '10/08/2026', points: 3, applyPointDeduction: true, approvalStatus: 'approved' });
  // bonus variant
  push({ employeeId: 'emp_alpha', month: '2026-08', observationDate: '21/08/2026', points: 2, isBonus: true, approvalStatus: 'approved' });
  // hazards
  push({ month: '2026-08', points: 9, applyPointDeduction: true, approvalStatus: 'approved' }); // no employeeId
  push({ employeeId: OTHER_EMP, month: '2026-08', points: 4, applyPointDeduction: true, approvalStatus: 'approved' });
  push({ employeeId: 'emp_alpha', weird: { shape: [1, 2, 3] } }); // no month, no date
  return rows;
}

function buildPerEmployeeTable(prefix: string): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  let n = 0;
  for (const emp of [...EMPLOYEES, OTHER_EMP]) {
    rows[`${prefix}_a_${++n}`] = { employeeId: emp, label: `${prefix}-${emp}-a` };
    rows[`${prefix}_b_${++n}`] = { employeeId: emp, label: `${prefix}-${emp}-b` };
  }
  rows[`${prefix}_no_emp`] = { label: `${prefix}-missing-employeeId` };
  return rows;
}

function buildHrDeductions(): Record<string, unknown> {
  const rows: Record<string, unknown> = {};
  let n = 0;
  for (const emp of EMPLOYEES) {
    rows[`hr_${++n}`] = { employeeId: emp, month: '2026-08', amount: 100, status: 'approved' };
    rows[`hr_${++n}`] = { employeeId: emp, month: '2026-07', amount: 50, status: 'pending' }; // pending must survive untouched
  }
  rows['hr_no_emp'] = { month: '2026-08', amount: 999 };
  return rows;
}

const BASE_TABLES = () => {
  setTable('attendanceResults', buildAttendanceResults());
  setTable('qualityObservations', buildObservations());
  setTable('followUps', buildPerEmployeeTable('fu'));
  setTable('travelDeals', buildPerEmployeeTable('deal'));
  setTable('complaints', buildPerEmployeeTable('cmp'));
  setTable('hrDeductions', buildHrDeductions());
  setTable('employees', {
    emp_alpha: { id: 'emp_alpha', name: 'Alpha', orgNodeId: null },
    emp_beta: { id: 'emp_beta', name: 'Beta', orgNodeId: null },
    emp_gamma: { id: 'emp_gamma', name: 'Gamma', orgNodeId: null },
    emp_delta: { id: 'emp_delta', name: 'Delta', orgNodeId: null },
  });
  setTable('orgNodes', {});
  setTable('monthSnapshots', {});
  setTable('kpiSettings', {});
  setTable('kpiSchemes', {});
};

// ══════════════════════════════════════════════════════════════
//  Task C — attendanceResults
// ══════════════════════════════════════════════════════════════

describe('Phase 2 parity — attendanceResults', () => {
  it('getAttendanceResultsForMonth ≡ legacy full-scan filter (indexed run, method A + B)', async () => {
    BASE_TABLES();
    const month = '2026-08';

    // Legacy computation re-materialized verbatim (the pre-Phase-2 read).
    const legacy = (await getAll<any>('attendanceResults')).filter((r) => r.month === month);

    // New read, indexed path.
    const viaIndexed = await getAttendanceResultsForMonth(month);
    assert.deepEqual(viaIndexed, legacy, 'indexed ≡ legacy');

    // New read, forced-fallback path (= the legacy computation shipped).
    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    const viaFallback = await getAttendanceResultsForMonth(month);
    assert.deepEqual(viaFallback, legacy, 'fallback ≡ legacy');
    assert.ok(viaIndexed.length >= 3, 'fixture sanity: the month has results');
  });

  it('months with no results return [] on both paths (never fabricated)', async () => {
    BASE_TABLES();
    assert.deepEqual(await getAttendanceResultsForMonth('2020-01'), []);
    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    assert.deepEqual(await getAttendanceResultsForMonth('2020-01'), []);
  });

  it('loadStoredAttendanceResult keeps LAST-WINS over duplicate (employee, month) records', async () => {
    BASE_TABLES();
    // legacy: full read, iterate in table order, last matching wins
    const all = await getAll<any>('attendanceResults');
    let legacy: any = null;
    for (const r of all) {
      if (r && r.employeeId === 'emp_alpha' && r.month === '2026-08') legacy = r;
    }
    assert.equal(legacy.attendanceDeductionDays, 1, 'fixture sanity: legacy_dup_2 is last');

    const viaIndexed = await defaultPerformanceIntelligenceLoaders.loadStoredAttendanceResult('emp_alpha', '2026-08');
    assert.deepEqual(viaIndexed, legacy, 'indexed (key-order ties) ≡ legacy last-wins');

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    const viaFallback = await defaultPerformanceIntelligenceLoaders.loadStoredAttendanceResult('emp_alpha', '2026-08');
    assert.deepEqual(viaFallback, legacy, 'fallback ≡ legacy last-wins');
  });

  it('defaultEmployeePerformanceLoaders.loadAttendanceResults ≡ legacy per-employee filter', async () => {
    BASE_TABLES();
    const legacy = (await getAll<any>('attendanceResults')).filter((r) => r.employeeId === 'emp_alpha');
    const viaIndexed = await defaultEmployeePerformanceLoaders.loadAttendanceResults('emp_alpha');
    assert.deepEqual(viaIndexed, legacy);
    assert.ok(!viaIndexed.some((r) => r.employeeId === OTHER_EMP), 'no other employee’s rows leak in');

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    assert.deepEqual(await defaultEmployeePerformanceLoaders.loadAttendanceResults('emp_alpha'), legacy);
  });

  it('generateMonthlyAttendanceResults: identical summary + table state with and without the index', async () => {
    // Non-deterministic fields of a REAL generation run: wall-clock
    // stamps and the random cuid2 audit-record ids. They are stripped
    // (and the audit log key-order-normalized) before comparison —
    // everything else must match exactly.
    const scrubDeep = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(scrubDeep);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === 'createdAt' || k === 'updatedAt' || k === 'generatedAt') continue;
          out[k] = scrubDeep(v);
        }
        return out;
      }
      return value;
    };
    // Audit-record ids are random cuid2 and their `timestamp` is the
    // write moment — both differ between runs by design. The audit
    // CONTENT (action/entityId/before/after) must match exactly.
    const scrubAuditEntry = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(scrubAuditEntry);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === 'id' || k === 'timestamp') continue;
          out[k] = scrubAuditEntry(v);
        }
        return out;
      }
      return value;
    };
    const normalizeAudit = (log: Record<string, unknown> | undefined) =>
      Object.values(log ?? {}).map((e) => scrubAuditEntry(scrubDeep(e))).sort((a, b) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const run = async () => {
      BASE_TABLES();
      setTable('deductionRules', {});
      setTable('biometrics', {});
      setTable('attendance', {});
      setTable('requests', {});
      setTable('waivedDeductions', {});
      setTable('attendanceAuditLog', {}); // per-run capture — no leftovers
      // 1st generation: 2026-09 has NO seeded rows → every result is CREATED.
      const first = await generateMonthlyAttendanceResults('2026-09', { id: 'admin_1', name: 'Admin' });
      // 2nd generation (regeneration): the same deterministic ids now EXIST
      // as genuine stored records (generatedBy etc.) → every result is
      // UPDATED, exercising planResultWrites' update path end-to-end.
      const second = await generateMonthlyAttendanceResults('2026-09', { id: 'admin_1', name: 'Admin' });
      const finalTable = scrubDeep(JSON.parse(JSON.stringify(fake.tables.get('attendanceResults'))));
      const auditLog = normalizeAudit(JSON.parse(JSON.stringify(fake.tables.get('attendanceAuditLog') ?? {})));
      return { first: scrubDeep(first), second: scrubDeep(second), finalTable, auditLog };
    };

    const withIndex = await run();
    fake.indexedError = true; // forced fallback for the existing-results read
    const withoutIndex = await run();

    assert.deepEqual(withIndex, withoutIndex, 'generation summaries, persisted rows and audit entries identical');
    assert.ok(withIndex.first.resultsCreated > 0, 'fixture sanity: first generation created results');
    assert.equal(withIndex.second.resultsCreated, 0, 'regeneration updates, never duplicates');
    assert.equal(withIndex.second.resultsUpdated, withIndex.first.resultsCreated);
    // Deterministic id: regeneration converges on the same records.
    assert.ok(Object.keys(withIndex.finalTable).includes(attendanceResultId('2026-09', 'emp_alpha')));
  });
});

// ══════════════════════════════════════════════════════════════
//  Task D — qualityObservations
// ══════════════════════════════════════════════════════════════

describe('Phase 2 parity — qualityObservations', () => {
  it('loadObservations(month) ≡ legacy stored-month filter (records without a month never match)', async () => {
    BASE_TABLES();
    const legacy = (await getAll<any>('qualityObservations')).filter((o) => o && o.month === '2026-08');
    const viaIndexed = await defaultKpiReportingLoaders.loadObservations('2026-08');
    assert.deepEqual(viaIndexed, legacy);

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    assert.deepEqual(await defaultKpiReportingLoaders.loadObservations('2026-08'), legacy);
    assert.ok(legacy.length >= 6, 'fixture sanity');
  });

  it('loadObservationsForWindow ≡ legacy filter incl. attributeMonth attribution of legacy rows', async () => {
    BASE_TABLES();
    const window = ['2026-07', '2026-08'] as const;
    // Legacy computation re-materialized verbatim (full read + the
    // exact legacy filter chain: employeeId strict equality, then
    // canonical attribution).
    const legacy = (await getAll<any>('qualityObservations')).filter((o) => {
      if (!o || o.employeeId !== 'emp_alpha') return false;
      const month = attributeMonth(o.month, o.observationDate);
      return month !== null && window.includes(month);
    });

    const viaIndexed = await defaultPerformanceIntelligenceLoaders.loadObservationsForWindow('emp_alpha', window);
    assert.deepEqual(viaIndexed, legacy, 'indexed ≡ legacy — including the row with a missing stored month');
    assert.ok(viaIndexed.some((o) => !o.month), 'fixture sanity: the attribution-rescued legacy row is present');

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    const viaFallback = await defaultPerformanceIntelligenceLoaders.loadObservationsForWindow('emp_alpha', window);
    assert.deepEqual(viaFallback, legacy, 'fallback ≡ legacy');
  });

  it('loadLiveQualityScore ≡ legacy lookupQualityScore computation (open month)', async () => {
    BASE_TABLES();
    const settings = await getKpiSettings();
    // Legacy: full read + (month ∧ employeeId) filter + canonical scorer.
    const allObs = await getAll<any>('qualityObservations');
    const empObs = allObs.filter((o) => o.month === '2026-08' && o.employeeId === 'emp_alpha');
    const score = computeEmployeeScore(empObs, settings as never, 'emp_alpha');
    const legacy = empObs.length === 0
      ? null
      : {
          score: score.score,
          deductionPoints: score.deductionPoints,
          bonusPoints: score.bonusPoints,
          observationCount: score.observationCount,
        };

    const viaIndexed = await defaultKpiFrameworkLoaders.loadLiveQualityScore('emp_alpha', '2026-08');
    assert.deepEqual(viaIndexed, legacy, 'indexed ≡ legacy score');

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    const viaFallback = await defaultKpiFrameworkLoaders.loadLiveQualityScore('emp_alpha', '2026-08');
    assert.deepEqual(viaFallback, legacy, 'fallback ≡ legacy score');
    assert.ok(legacy && legacy.observationCount > 0, 'fixture sanity');
  });

  it('computeFreshMonthSnapshot: identical payload with and without the index (engine end-to-end)', async () => {
    BASE_TABLES();
    const withIndex = await computeFreshMonthSnapshot('2026-08');

    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    const viaFallback = await computeFreshMonthSnapshot('2026-08');

    // `generatedAt` is the run's wall-clock stamp (identical pipeline,
    // different milliseconds) — everything else must match exactly.
    const { generatedAt: _a, ...indexedPayload } = withIndex as Record<string, unknown>;
    const { generatedAt: _b, ...fallbackPayload } = viaFallback as Record<string, unknown>;
    assert.deepEqual(indexedPayload, fallbackPayload, 'the snapshot pipeline sees the same observations either way');
    const alpha = (withIndex.employeeScores ?? {})['emp_alpha'];
    assert.ok(alpha && (alpha as { observationCount?: number }).observationCount! > 0, 'fixture sanity: alpha scored');
  });
});

// ══════════════════════════════════════════════════════════════
//  Task F — followUps / travelDeals / complaints / hrDeductions
// ══════════════════════════════════════════════════════════════

describe('Phase 2 parity — per-employee operational loaders', () => {
  const cases = [
    { name: 'loadFollowUps', table: 'followUps', load: (id: string) => defaultPerformanceIntelligenceLoaders.loadFollowUps(id) },
    { name: 'loadTravelDeals', table: 'travelDeals', load: (id: string) => defaultPerformanceIntelligenceLoaders.loadTravelDeals(id) },
    { name: 'loadComplaints', table: 'complaints', load: (id: string) => defaultPerformanceIntelligenceLoaders.loadComplaints(id) },
    { name: 'loadHrDeductions (employee-performance)', table: 'hrDeductions', load: (id: string) => defaultEmployeePerformanceLoaders.loadHrDeductions(id) },
  ] as const;

  for (const c of cases) {
    it(`${c.name} ≡ legacy full-scan filter, indexed and fallback`, async () => {
      BASE_TABLES();
      const legacy = (await getAll<any>(c.table)).filter((r) => r && r.employeeId === 'emp_alpha');
      assert.ok(legacy.length > 0, 'fixture sanity');

      const viaIndexed = await c.load('emp_alpha');
      assert.deepEqual(viaIndexed, legacy, `${c.name}: indexed ≡ legacy`);

      fake.indexedError = true;
      invalidateCache();
      resetIndexedQueryStateForTests();
      assert.deepEqual(await c.load('emp_alpha'), legacy, `${c.name}: fallback ≡ legacy`);
    });
  }

  it('HR pending rows survive the indexed read untouched (no status rewriting)', async () => {
    BASE_TABLES();
    const rows = await defaultEmployeePerformanceLoaders.loadHrDeductions('emp_beta');
    assert.ok(rows.some((r) => (r as { status?: string }).status === 'pending'), 'pending preserved');
  });

  it('an employee with NO records returns [] on both paths (never zero-filled)', async () => {
    BASE_TABLES();
    assert.deepEqual(await defaultPerformanceIntelligenceLoaders.loadFollowUps('emp_ghost'), []);
    fake.indexedError = true;
    invalidateCache();
    resetIndexedQueryStateForTests();
    assert.deepEqual(await defaultPerformanceIntelligenceLoaders.loadFollowUps('emp_ghost'), []);
  });
});

// ══════════════════════════════════════════════════════════════
//  Cross-cutting security shape
// ══════════════════════════════════════════════════════════════

describe('Phase 2 — scope/leak shape of the adopted reads', () => {
  it('an employee-scoped read never returns another employee’s row on any path', async () => {
    BASE_TABLES();
    for (const load of [
      () => defaultPerformanceIntelligenceLoaders.loadFollowUps('emp_alpha'),
      () => defaultPerformanceIntelligenceLoaders.loadTravelDeals('emp_alpha'),
      () => defaultPerformanceIntelligenceLoaders.loadComplaints('emp_alpha'),
      () => defaultEmployeePerformanceLoaders.loadAttendanceResults('emp_alpha'),
      () => defaultEmployeePerformanceLoaders.loadHrDeductions('emp_alpha'),
    ]) {
      const rows = await load();
      for (const r of rows) assert.equal((r as { employeeId?: string }).employeeId, 'emp_alpha');

      fake.indexedError = true;
      invalidateCache();
      resetIndexedQueryStateForTests();
      const viaFallback = await load();
      for (const r of viaFallback) assert.equal((r as { employeeId?: string }).employeeId, 'emp_alpha');
      fake.indexedError = false;
      invalidateCache();
      resetIndexedQueryStateForTests();
    }
  });
});

// ══════════════════════════════════════════════════════════════
//  Measurement — rows downloaded BEFORE (legacy) vs AFTER (indexed)
//  Mock/harness measurements: op + row counts, not production time.
// ══════════════════════════════════════════════════════════════

describe('Phase 2 measurement — rows downloaded per read (cold cache)', () => {
  /** Scaled fixture: 12 employees × 12 months → 144 attendance rows,
   *  288 observations (2/month each) + edge rows; the employee under
   *  test owns one month-set like any other (≈1/12 of each table). */
  function buildScaled() {
    const employees = Array.from({ length: 12 }, (_, i) => `emp_${String(i).padStart(2, '0')}`);
    const months = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
    const attendance: Record<string, unknown> = {};
    const observations: Record<string, unknown> = {};
    const followUps: Record<string, unknown> = {};
    const hr: Record<string, unknown> = {};
    let n = 0;
    for (const month of months) {
      for (const emp of employees) {
        attendance[`${month}_${emp}`] = { employeeId: emp, month, attendanceDeductionDays: 0 };
        observations[`o_${++n}`] = { employeeId: emp, month, points: 1, applyPointDeduction: true, approvalStatus: 'approved' };
        observations[`o_${++n}`] = { employeeId: emp, month, points: 0, applyPointDeduction: false, approvalStatus: 'pending' };
        if (month === '2025-06') {
          followUps[`f_${emp}`] = { employeeId: emp, label: 'fu' };
          hr[`h_${emp}`] = { employeeId: emp, month, amount: 10, status: 'approved' };
        }
      }
    }
    setTable('attendanceResults', attendance);
    setTable('qualityObservations', observations);
    setTable('followUps', followUps);
    setTable('hrDeductions', hr);
    setTable('employees', {});
    setTable('orgNodes', {});
    setTable('monthSnapshots', {});
    setTable('kpiSettings', {});
    setTable('kpiSchemes', {});
    return { employees, months };
  }

  it('attendanceResults month read: legacy full-table vs indexed month fetch', async () => {
    const { months } = buildScaled();
    const month = months[6];

    const before = stats();
    await (async () => (await getAll<any>('attendanceResults')).filter((r) => r.month === month))(); // legacy
    const legacyStats = { ...fake };

    invalidateCache();
    resetIndexedQueryStateForTests();
    await getAttendanceResultsForMonth(month); // new
    const afterStats = { ...fake };

    console.log(
      `[measure] attendanceResults/month: BEFORE ${legacyStats.fullOps} full read, ` +
      `${legacyStats.fullRowsDownloaded - before.fullRowsDownloaded} rows downloaded → ` +
      `AFTER ${afterStats.indexedOps} indexed read, ${afterStats.indexedRowsDownloaded} rows downloaded`,
    );
    assert.equal(afterStats.indexedRowsDownloaded, 12, 'one month = one row per employee');
    assert.ok(afterStats.indexedRowsDownloaded < legacyStats.fullRowsDownloaded - before.fullRowsDownloaded);
  });

  it('qualityObservations month read: legacy full-table vs indexed month fetch', async () => {
    const { months } = buildScaled();
    const month = months[6];

    const before = stats();
    await (async () => (await getAll<any>('qualityObservations')).filter((o) => o && o.month === month))(); // legacy
    const legacyRows = fake.fullRowsDownloaded - before.fullRowsDownloaded;

    invalidateCache();
    resetIndexedQueryStateForTests();
    await defaultKpiReportingLoaders.loadObservations(month); // new
    const indexedRows = fake.indexedRowsDownloaded;

    console.log(`[measure] qualityObservations/month: BEFORE 1 full read, ${legacyRows} rows → AFTER 1 indexed read, ${indexedRows} rows`);
    assert.equal(indexedRows, 24, 'one month = 2 rows per employee');
    assert.ok(indexedRows < legacyRows);
  });

  it('single-employee window reads (observations/followUps/HR/attendance): legacy full-tables vs indexed fetches', async () => {
    const { employees } = buildScaled();
    const emp = employees[3];
    const window = ['2025-05', '2025-06'];

    const before = stats();
    // LEGACY bundle: every per-employee read was a full-table download.
    await (async () => (await getAll<any>('qualityObservations')).filter((o) => o && o.employeeId === emp && window.includes(attributeMonth(o.month, o.observationDate) ?? '')))();
    await (async () => (await getAll<any>('followUps')).filter((f) => f && f.employeeId === emp))();
    await (async () => (await getAll<any>('hrDeductions')).filter((r) => r && r.employeeId === emp))();
    await (async () => (await getAll<any>('attendanceResults')).filter((r) => r.employeeId === emp))();
    const legacyRows = fake.fullRowsDownloaded - before.fullRowsDownloaded;
    const legacyOps = fake.fullOps - before.fullOps;

    invalidateCache();
    resetIndexedQueryStateForTests();
    // NEW bundle: the same four reads through the guarded indexed fetches.
    await defaultPerformanceIntelligenceLoaders.loadObservationsForWindow(emp, window);
    await defaultPerformanceIntelligenceLoaders.loadFollowUps(emp);
    await defaultEmployeePerformanceLoaders.loadHrDeductions(emp);
    await defaultEmployeePerformanceLoaders.loadAttendanceResults(emp);
    const indexedRows = fake.indexedRowsDownloaded;
    const indexedOps = fake.indexedOps;

    console.log(
      `[measure] single-employee bundle (obs+fu+hr+att): BEFORE ${legacyOps} full reads, ` +
      `${legacyRows} rows downloaded → AFTER ${indexedOps} indexed reads, ${indexedRows} rows downloaded`,
    );
    assert.ok(indexedRows < legacyRows / 4, 'indexed bundle downloads less than a quarter of the rows');
  });

  it('users.email login lookup: legacy full scan vs indexed point query', async () => {
    const users: Record<string, unknown> = {};
    for (let i = 0; i < 120; i++) users[`u${i}`] = { id: `u${i}`, email: `user${i}@arm.com`, password: 'h' };
    setTable('users', users);

    const before = stats();
    await (async () => (await getAll<any>('users')).filter((r) => r.email === 'user77@arm.com'))(); // legacy scan
    const legacyRows = fake.fullRowsDownloaded - before.fullRowsDownloaded;

    invalidateCache();
    resetIndexedQueryStateForTests();
    const { findUserByEmail } = await import('@/lib/db');
    await findUserByEmail('user77@arm.com'); // indexed (limitToFirst(2))
    const indexedRows = fake.indexedRowsDownloaded;

    console.log(`[measure] users.email: BEFORE 1 full scan, ${legacyRows} rows → AFTER 1 indexed query, ${indexedRows} rows`);
    assert.equal(indexedRows, 1);
    assert.ok(indexedRows < legacyRows / 10);
  });
});
