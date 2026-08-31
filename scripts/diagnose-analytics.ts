// ══════════════════════════════════════════════════════════════
//  Phase 5.1A — Python Analytics Diagnostic (spec §2/§4/§9/§10)
//
//  Purpose: determine EXACTLY which of the following is happening
//  on the CURRENT machine, without guessing:
//    A. Python executable cannot start
//    B. Python starts but input validation fails
//    C. Python starts and returns an analytics result
//    D. Python returns an error because the dataset is malformed
//    E. Next.js bridge incorrectly converts a valid Python result
//       into PYTHON_UNAVAILABLE
//
//  Safe by design (spec §2): prints STRUCTURAL counters only —
//  never passwords, tokens, secrets, or customer content.
//
//  Run:  npx tsx scripts/diagnose-analytics.ts
// ══════════════════════════════════════════════════════════════

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

// ── 1. Environment / runtime probe (spec §9) ──────────────────

function probe(bin: string, args: string[]): { ok: boolean; detail: string } {
  try {
    const r = spawnSync(bin, args, { timeout: 5_000, encoding: 'utf8' });
    if (r.error) return { ok: false, detail: `${bin} → error: ${r.error.message}` };
    if (r.status !== 0) {
      return {
        ok: false,
        detail: `${bin} → exit ${r.status}${r.stderr ? ` (${r.stderr.trim().slice(0, 120)})` : ''}`,
      };
    }
    return { ok: true, detail: `${bin} → OK` };
  } catch (e) {
    return { ok: false, detail: `${bin} → threw: ${e instanceof Error ? e.message : e}` };
  }
}

console.log('═'.repeat(64));
console.log('STEP 1 — Python runtime probe (spec §9)');
console.log('═'.repeat(64));

const CANDIDATES: Array<{ bin: string; args: string[] }> = [
  { bin: 'python3', args: ['-I', '-c', 'pass'] },
  { bin: 'python', args: ['-I', '-c', 'pass'] },
  { bin: 'python', args: ['-I', '--version'] },
  { bin: 'py', args: ['-3', '-I', '-c', 'pass'] },
];

let workingBinary: string | null = null;
let workingArgs: string[] = [];
for (const c of CANDIDATES) {
  const p = probe(c.bin, c.args);
  console.log(`  ${p.ok ? '✓' : '✗'} ${p.detail}`);
  if (p.ok && !workingBinary) {
    workingBinary = c.bin;
    workingArgs = c.args.slice(0, 1).concat(c.args.slice(1)); // -I ...
  }
}

const scriptPath = path.join(process.cwd(), 'python-analytics', 'employee_analytics.py');
console.log(`  ${existsSync(scriptPath) ? '✓' : '✗'} engine script: ${scriptPath}`);

if (!workingBinary) {
  console.log('');
  console.log('  ► VERDICT: CASE A — Python executable cannot start on this');
  console.log('    machine. The message "التحليل الإحصائي غير متاح على هذه');
  console.log('    البيئة" is CORRECT for this environment (PYTHON_UNAVAILABLE).');
  console.log('    Fix: install Python 3 and ensure it is on the PATH of the');
  console.log('    process running Next.js, or set PYTHON_ANALYTICS_BIN.');
  process.exit(0);
}

// ── 2. Build the SPEC §5 partial dataset (real contract shape) ─
//    observations=2, months=1 (MTD), complaints=0, capa=0,
//    followUps=3, deals=3 — the exact profile from the bug report.

function buildPartialDataset(): Record<string, unknown> {
  const window = ['2026-08'];
  return {
    datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE',
    employee: {
      employeeId: 'diag-employee',
      employeeName: 'DIAGNOSTIC EMPLOYEE (synthetic)',
      employeeCode: 'DIAG-1',
      department: null,
      position: null,
      employmentStatus: 'active',
      eligibleForPeriod: true,
      archivedButEligible: false,
      archivedAt: null,
      restoredAt: null,
      relationship: 'CONFIRMED',
    },
    period: { monthKey: '2026-08', valueBasis: 'MTD', finalized: false, finalizedAt: null },
    kpi: {
      outcomeStatus: 'VALUE',
      message: null,
      scheme: { schemeId: 's1', schemeName: 'default', schemeVersion: 1, qualityWeight: 15, frozen: true },
      quality: {
        componentId: 'quality', name: 'quality', status: 'AVAILABLE',
        rawScore: 88, weight: 15, weightedContribution: 13.2,
        maxContribution: 15, observationCount: 2, deductionPoints: 0, bonusPoints: 0,
      },
      availableWeight: 15, weightedTotal: 13.2,
      overallStatus: 'AVAILABLE', rowStatus: 'AVAILABLE',
      calculationVersion: 'v1', source: 'kpi_engine',
    },
    trend: {
      windowMonths: window,
      points: window.map((m) => ({
        monthKey: m, valueBasis: 'MTD', available: true, rawScore: 88,
        weightedContribution: 13.2, weight: 15, rowStatus: 'AVAILABLE',
        finalized: false, schemeId: 's1',
      })),
      mom: null, direction: null,
    },
    quality: {
      observations: {
        total: 2,
        byApproval: { approved: 1, pending: 1, rejected: 0 },
        byCategory: [{ key: 'CLEANLINESS', label: 'cleanliness', count: 2 }],
        bySeverity: [{ key: 'MINOR', label: 'minor', count: 2 }],
        byResolutionStatus: [{ key: 'OPEN', label: 'open', count: 2 }],
        monthly: [{ month: '2026-08', count: 2 }],
        records: [
          { id: 'obs-1', month: '2026-08', category: 'CLEANLINESS', severity: 'MINOR', resolutionStatus: 'OPEN', approvalStatus: 'APPROVED' },
          { id: 'obs-2', month: '2026-08', category: 'CLEANLINESS', severity: 'MINOR', resolutionStatus: 'OPEN', approvalStatus: 'PENDING' },
        ],
      },
      repeatedIssues: { minOccurrences: 2, byCategory: [], byType: [], windowByCategory: [], windowByType: [] },
      deductions: {
        count: 0, totalDays: 0, totalAmount: 0,
        byType: [], records: [],
      },
    },
    complaints: {
      total: 0,
      byStatus: [], byType: [], bySeverity: [],
      resolution: { resolvedOrClosed: 0, stillOpen: 0, avgResolutionDays: null },
      monthly: [{ month: '2026-08', count: 0 }],
      records: [],
      attribution: 'CONFIRMED',
    },
    capa: {
      total: 0, active: 0, terminal: 0, overdueRatePct: null,
      byStatus: [], byPriority: [], bySource: [],
      closure: { closedCount: 0, avgClosureDays: null, avgOverdueDays: null },
      monthly: [{ month: '2026-08', count: 0 }],
      records: [],
    },
    followUps: {
      total: 3, overdueRatePct: 0,
      completionRatePct: 33.33,
      byStatus: [{ key: 'COMPLETED', label: 'completed', count: 1 }, { key: 'OPEN', label: 'open', count: 2 }],
      byType: [{ key: 'FIELD', label: 'field', count: 3 }],
      byPriority: [{ key: 'NORMAL', label: 'normal', count: 3 }],
      monthly: [{ month: '2026-08', count: 3 }],
      records: [
        { id: 'fu-1', month: '2026-08', status: 'COMPLETED', type: 'FIELD', priority: 'NORMAL' },
        { id: 'fu-2', month: '2026-08', status: 'OPEN', type: 'FIELD', priority: 'NORMAL' },
        { id: 'fu-3', month: '2026-08', status: 'OPEN', type: 'FIELD', priority: 'NORMAL' },
      ],
    },
    deals: {
      total: 3, cancellationRatePct: 0,
      completionRatePct: 100,
      byStatus: [{ key: 'COMPLETED', label: 'completed', count: 3 }],
      monthly: [{ month: '2026-08', count: 3 }],
      records: [
        { id: 'deal-1', month: '2026-08', status: 'COMPLETED' },
        { id: 'deal-2', month: '2026-08', status: 'COMPLETED' },
        { id: 'deal-3', month: '2026-08', status: 'COMPLETED' },
      ],
    },
    attendance: null,
    dataQuality: {
      windowMonths: window,
      missingData: [{ area: 'trend', detail: 'only 1 month available' }],
      ambiguousRelationships: [],
      unattributedRecords: [],
      notes: ['MTD_PARTIAL_MONTH'],
    },
    evidence: {
      observations: { collection: 'quality_observations', ids: ['obs-1', 'obs-2'] },
      deductions: { collection: 'quality_deductions', ids: [] },
      complaints: { collection: 'complaints', ids: [] },
      capa: { collection: 'capa', ids: [] },
      followUps: { collection: 'follow_ups', ids: ['fu-1', 'fu-2', 'fu-3'] },
      deals: { collection: 'travel_deals', ids: ['deal-1', 'deal-2', 'deal-3'] },
      attendance: null,
    },
    generatedAt: new Date().toISOString(),
  };
}

const dataset = buildPartialDataset();

// ── 3. Safe structural summary (spec §2 — counters ONLY) ──────

console.log('');
console.log('═'.repeat(64));
console.log('STEP 2 — dataset structural summary (no content, spec §2)');
console.log('═'.repeat(64));
const q = dataset.quality as Record<string, Record<string, unknown>>;
console.log(JSON.stringify({
  employeeId: 'diag-employee',
  period: '2026-08',
  datasetKind: dataset.datasetKind,
  schemaVersion: 1,
  observations: (q.observations.total as number) ?? 0,
  deductions: ((q.deductions as Record<string, unknown>).count as number) ?? 0,
  complaints: 0,
  capa: 0,
  followUps: 3,
  deals: 3,
  attendanceAvailable: dataset.attendance !== null,
  kpiAvailable: (dataset.kpi as Record<string, unknown>).overallStatus === 'AVAILABLE',
  valueBasis: 'MTD',
  windowMonths: 1,
}, null, 2));

const payload = JSON.stringify({ schemaVersion: 1, dataset });

// ── 4. Execute Python DIRECTLY with the exact payload (§4/§9) ─

console.log('');
console.log('═'.repeat(64));
console.log('STEP 3 — direct Python execution (bypasses the Next.js bridge)');
console.log('═'.repeat(64));

const direct = spawnSync(workingBinary, [...workingArgs.slice(0, 1), scriptPath], {
  input: payload,
  timeout: 20_000,
  encoding: 'utf8',
  maxBuffer: 10 * 1024 * 1024,
});

let directVerdict: string;
if (direct.error) {
  directVerdict = `CASE A — spawn error: ${direct.error.message}`;
} else if (direct.status !== 0) {
  let code = '?';
  try {
    code = (JSON.parse(direct.stdout) as { error?: { code?: string } }).error?.code ?? '?';
  } catch { /* non-JSON stdout */ }
  directVerdict = `CASE B/D — Python started but rejected the input (exit ${direct.status}, code ${code})`;
} else {
  try {
    const parsed = JSON.parse(direct.stdout) as Record<string, unknown>;
    if (parsed.status === 'INVALID_INPUT') {
      directVerdict = `CASE B/D — engine returned INVALID_INPUT: ${JSON.stringify((parsed as { error?: unknown }).error)}`;
    } else {
      directVerdict = 'CASE C — Python started and returned a full analytics result';
    }
  } catch (e) {
    directVerdict = `CASE D — exit 0 but unparseable output: ${e instanceof Error ? e.message : e}`;
  }
}
console.log(`  ► ${directVerdict}`);

if (direct.status === 0) {
  const r = JSON.parse(direct.stdout) as {
    trendAnalysis?: { status?: string; availableMonths?: number };
    correlations?: unknown[];
    anomalies?: unknown[];
    patternAnalysis?: { observations?: { status?: string; byCategory?: { total?: number } } };
    distributionAnalysis?: {
      followUps?: { status?: string };
      deals?: { status?: string };
    };
    dataQuality?: { insufficientSamples?: Array<{ area?: string; reason?: string }> };
  };
  console.log('  per-method statuses (spec §5/§8 expectations):');
  console.log(`    trendAnalysis.status        = ${r.trendAnalysis?.status} (availableMonths=${r.trendAnalysis?.availableMonths}) — expect INSUFFICIENT_DATA`);
  console.log(`    correlations.length          = ${r.correlations?.length} — expect 0 (n<8)`);
  console.log(`    anomalies.length             = ${r.anomalies?.length} — expect 0 (baseline<5)`);
  console.log(`    observations pattern status  = ${r.patternAnalysis?.observations?.status} — expect OK (2 obs)`);
  console.log(`    followUps analysis status    = ${r.distributionAnalysis?.followUps?.status} — expect OK (3)`);
  console.log(`    deals analysis status        = ${r.distributionAnalysis?.deals?.status} — expect OK (3)`);
  console.log(`    insufficientSamples          = ${JSON.stringify(r.dataQuality?.insufficientSamples?.map((s) => `${s.area}:${s.reason}`))}`);
}

// ── 5. Same payload through the REAL TS bridge (case E check) ──

console.log('');
console.log('═'.repeat(64));
console.log('STEP 4 — same payload through the Next.js bridge (case E)');
console.log('═'.repeat(64));

async function step4Bridge(): Promise<void> {
  try {
    const bridgeUrl = '../src/lib/analytics/python-bridge';
    const { runPythonAnalytics, analyticsApiResponseBody, _resetPythonAnalyticsCacheForTests } =
      await import(bridgeUrl);
    _resetPythonAnalyticsCacheForTests();
    const outcome = await runPythonAnalytics(dataset as never);
    if (outcome.ok) {
      console.log('  ► bridge outcome: OK — valid result returned (no case E)');
      console.log(`    status=${analyticsApiResponseBody(outcome).status}`);
    } else {
      console.log(`  ► bridge outcome: FAILURE reason=${outcome.reason}`);
      console.log(`    detail=${outcome.detail ?? '(none)'}`);
      const body = analyticsApiResponseBody(outcome);
      console.log(`    api status=${body.status} message=${'message' in body ? body.message : ''}`);
      if (direct.status === 0 && (outcome.reason === 'PYTHON_UNAVAILABLE' || outcome.reason === 'SCRIPT_MISSING')) {
        console.log('    ► VERDICT: CASE E — Python itself WORKS but the bridge');
        console.log('      converted a working runtime into an unavailable state!');
      } else {
        console.log('    ► VERDICT: bridge outcome is consistent with the direct run.');
      }
    }
  } catch (e) {
    console.log(`  ► bridge import/execution threw: ${e instanceof Error ? e.message : e}`);
  }
}

void step4Bridge().then(() => {
  console.log('');
  console.log('Diagnostic complete.');
});
