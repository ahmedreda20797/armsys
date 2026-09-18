// ══════════════════════════════════════════════════════════════
//  Python ↔ TypeScript parity tests (Phase 5.3 §8/§9 — MANDATORY)
//
//  For each deterministic fixture:
//    • the TypeScript engine (canonical, in-process)
//    • the Python reference engine (python-analytics/, REFERENCE
//      ONLY — spawned over stdin/stdout exactly as Phase 5 did)
//  both analyze the SAME dataset and the results are deep-compared.
//
//  COMPARISON DOCTRINE (spec §8/§9):
//    • Structure: exact — same keys, same arrays, same order.
//    • Strings/booleans/nulls: exact.
//    • Numbers: expected EXACTLY equal (both engines round to the
//      same 1-4 decimal digits via round-half-even). A documented
//      tolerance of 1e-9 (absolute) exists ONLY for unrounded
//      intermediates feeding identically-rounded outputs — it can
//      never hide an algorithmic difference at the reported
//      precision.
//    • `analyticsEngineVersion` is EXCLUDED by design: the two
//      builds carry different version identifiers ('1.0.0' python
//      reference vs '2.0.0' TypeScript).
//
//  Skip-guard: when no Python interpreter exists the suite skips
//  (the production system does not need Python; parity testing is
//  a migration-time activity).
// ══════════════════════════════════════════════════════════════

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  runEmployeeAnalytics,
  type AnalyticsServiceOutcome,
} from '@/lib/analytics/service';
import {
  makeFullNineMonthDataset,
  makeTrendFiveMonthDataset,
  makePartialMtdDataset,
  makeTrendGapDataset,
  makeUnconfirmedComplaintsDataset,
  makeFlatBaselineDataset,
  makeArchiveOutsideDataset,
  makeRoundingEdgeDataset,
  makeSingleLiveNoKpiDataset,
} from './parity-fixtures';

// ── Reference engine plumbing ─────────────────────────────────

const ENGINE_PATH = path.resolve(process.cwd(), 'python-analytics', 'employee_analytics.py');

function detectPython(): { bin: string; prefix: string[] } | null {
  for (const candidate of [
    { bin: 'python3', prefix: [] as string[] },
    { bin: 'python', prefix: [] as string[] },
    { bin: 'py', prefix: ['-3'] },
  ]) {
    try {
      const probe = spawnSync(candidate.bin, [...candidate.prefix, '-I', '-X', 'utf8', '-c', 'pass'], {
        timeout: 5_000,
        encoding: 'utf8',
      });
      if (!probe.error && probe.status === 0) return candidate;
    } catch {
      /* try next */
    }
  }
  return null;
}

const python = detectPython();
const engineAvailable = python !== null && existsSync(ENGINE_PATH);

interface PythonRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runPythonReference(
  fixture: unknown,
  opts?: { raw?: boolean },
): PythonRun {
  // The reference engine reads the ENVELOPE {schemaVersion, dataset} —
  // exactly the bytes Phase 5's bridge used to send. opts.raw sends
  // the value verbatim (used by envelope-level rejection fixtures).
  const envelope = opts?.raw
    ? fixture
    : typeof fixture === 'object' && fixture !== null &&
        (fixture as Record<string, unknown>).dataset !== undefined &&
        (fixture as Record<string, unknown>).schemaVersion !== undefined
      ? fixture
      : { schemaVersion: 1, dataset: fixture };
  // -X utf8: match the production bridge (python-bridge.ts) — a piped
  // Windows interpreter defaults to the ANSI codepage and would return
  // mojibake for the Arabic labels in the fixtures.
  const result = spawnSync(python!.bin, [...python!.prefix, '-I', '-X', 'utf8', ENGINE_PATH], {
    input: JSON.stringify(envelope),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ── Deep comparator (documented tolerance, exact structure) ───

const NUMERIC_TOLERANCE = 1e-9;
const EXCLUDED_PATHS = new Set<string>(['$.analyticsEngineVersion']);

function numbersClose(a: number, b: number): boolean {
  if (a === b) return true;
  return Math.abs(a - b) <= NUMERIC_TOLERANCE;
}

function deepCompare(a: unknown, b: unknown, path: string, diffs: string[]): void {
  if (EXCLUDED_PATHS.has(path)) return;
  if (a === null || b === null || a === undefined || b === undefined) {
    if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
    return;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    if (!numbersClose(a, b)) {
      diffs.push(`${path}: ${a} !== ${b}`);
    }
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      diffs.push(`${path}: array length ${a.length} !== ${b.length}`);
      return;
    }
    for (let i = 0; i < a.length; i++) deepCompare(a[i], b[i], `${path}[${i}]`, diffs);
    return;
  }
  const aObj = typeof a === 'object' && a !== null;
  const bObj = typeof b === 'object' && b !== null;
  if (aObj && bObj) {
    const ak = Object.keys(a as Record<string, unknown>).sort();
    const bk = Object.keys(b as Record<string, unknown>).sort();
    const onlyA = ak.filter((k) => !bk.includes(k));
    const onlyB = bk.filter((k) => !ak.includes(k));
    if (onlyA.length > 0) diffs.push(`${path}: keys only in TS: ${onlyA.join(',')}`);
    if (onlyB.length > 0) diffs.push(`${path}: keys only in Python: ${onlyB.join(',')}`);
    for (const k of ak) {
      if (bk.includes(k)) {
        deepCompare(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          `${path}.${k}`,
          diffs,
        );
      }
    }
    return;
  }
  if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
}

async function runTypeScriptEngine(fixture: unknown): Promise<AnalyticsServiceOutcome> {
  return runEmployeeAnalytics(fixture as never);
}

/**
 * Dataset-level rejections: the SAME invalid DATASET object goes to
 * both engines (Python wrapped in a valid envelope) → identical codes.
 */
const INVALID_DATASET_FIXTURES: Array<{ name: string; dataset: unknown; expectedCode: string }> = [
  {
    name: 'wrong datasetKind',
    dataset: { datasetKind: 'SOMETHING_ELSE' },
    expectedCode: 'UNSUPPORTED_DATASET_KIND',
  },
  {
    name: 'missing dataset fields',
    dataset: { datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE', employee: {} },
    expectedCode: 'MISSING_DATASET_FIELDS',
  },
];

/**
 * Envelope-level rejections: the Python reference reads the full
 * envelope; the in-process TypeScript service builds its envelope
 * itself (schemaVersion is a compile-time constant), so these two
 * paths assert FAIL-CLOSED on both sides without code equality.
 */
const INVALID_ENVELOPE_FIXTURES: Array<{ name: string; envelope: unknown; expectedCode: string }> = [
  { name: 'non-object envelope', envelope: [1, 2, 3], expectedCode: 'INVALID_ENVELOPE' },
  { name: 'wrong schemaVersion', envelope: { schemaVersion: 2, dataset: {} }, expectedCode: 'UNSUPPORTED_SCHEMA_VERSION' },
  { name: 'missing dataset', envelope: { schemaVersion: 1 }, expectedCode: 'MISSING_DATASET' },
];

describe('Phase 5.3 — Python ↔ TypeScript analytics parity (spec §8/§9)', () => {
  before(() => {
    if (!engineAvailable) {
      console.log('  [parity] Python reference engine unavailable — parity suite skipped.');
    }
  });

  const OK_FIXTURES: Array<{ name: string; make: () => unknown }> = [
    { name: 'F1 full nine months (spike, drop, correlations, attendance)', make: makeFullNineMonthDataset },
    { name: 'F2 five-month trend (mean 87.2 example)', make: makeTrendFiveMonthDataset },
    { name: 'F3 partial MTD (per-method INSUFFICIENT_DATA)', make: makePartialMtdDataset },
    { name: 'F4 missing KPI month (never zero-filled)', make: makeTrendGapDataset },
    { name: 'F5 unconfirmed complaint attribution gating', make: makeUnconfirmedComplaintsDataset },
    { name: 'F6 flat baselines + zero-variance correlation', make: makeFlatBaselineDataset },
    { name: 'F7 archived-eligible + outside window months', make: makeArchiveOutsideDataset },
    { name: 'F8 rounding edges (half-even ties, 12-month confidence)', make: makeRoundingEdgeDataset },
    { name: 'F9 single LIVE month without KPI value', make: makeSingleLiveNoKpiDataset },
  ];

  for (const { name, make } of OK_FIXTURES) {
    it(`parity: ${name}`, { skip: !engineAvailable && 'python reference unavailable' }, async () => {
      const fixture = make();
      const tsOutcome = await runTypeScriptEngine(fixture);
      assert.equal(tsOutcome.ok, true, `TS engine failed: ${!tsOutcome.ok ? tsOutcome.detail : ''}`);

      const py = runPythonReference(fixture);
      assert.equal(py.exitCode, 0, `python engine exited ${py.exitCode}: ${py.stderr.slice(0, 400)}`);
      const pyResult = JSON.parse(py.stdout) as unknown;

      const diffs: string[] = [];
      deepCompare(tsOutcome.ok ? tsOutcome.result : null, pyResult, '$', diffs);
      assert.deepEqual(
        diffs,
        [],
        `parity divergences (${diffs.length}):\n${diffs.slice(0, 40).join('\n')}`,
      );
    });
  }

  for (const { name, dataset, expectedCode } of INVALID_DATASET_FIXTURES) {
    it(`parity (invalid dataset): ${name} → identical rejection code`, { skip: !engineAvailable && 'python reference unavailable' }, async () => {
      const tsOutcome = await runTypeScriptEngine(dataset);
      assert.equal(tsOutcome.ok, false);
      assert.ok(
        !tsOutcome.ok && tsOutcome.detail!.includes(expectedCode),
        `TS detail should mention ${expectedCode}: ${!tsOutcome.ok ? tsOutcome.detail : ''}`,
      );

      const py = runPythonReference({ schemaVersion: 1, dataset });
      assert.equal(py.exitCode, 2, `python should exit 2, got ${py.exitCode}`);
      const verdict = JSON.parse(py.stdout) as { status?: string; error?: { code?: string } };
      assert.equal(verdict.status, 'INVALID_INPUT');
      assert.equal(verdict.error?.code, expectedCode);
    });
  }

  for (const { name, envelope, expectedCode } of INVALID_ENVELOPE_FIXTURES) {
    it(`parity (invalid envelope): ${name} → both engines fail closed`, { skip: !engineAvailable && 'python reference unavailable' }, async () => {
      const py = runPythonReference(envelope, { raw: true });
      assert.equal(py.exitCode, 2, `python should exit 2, got ${py.exitCode}`);
      const verdict = JSON.parse(py.stdout) as { status?: string; error?: { code?: string } };
      assert.equal(verdict.status, 'INVALID_INPUT');
      assert.equal(verdict.error?.code, expectedCode);

      // The in-process service cannot express these envelope defects
      // (it builds its own envelope) — it must still REJECT the
      // garbage treated as a dataset, never throw, never pass.
      const tsOutcome = await runTypeScriptEngine(envelope);
      assert.equal(tsOutcome.ok, false);
    });
  }

  it('TS engine version is the 2.0.0 TypeScript build (excluded from parity by design)', async () => {
    const outcome = await runTypeScriptEngine(makeTrendFiveMonthDataset());
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      assert.equal(outcome.result.analyticsEngineVersion, '2.0.0');
    }
  });
});
