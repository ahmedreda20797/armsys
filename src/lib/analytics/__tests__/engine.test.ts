// ══════════════════════════════════════════════════════════════
//  TypeScript Analytics Engine — unit tests (Phase 5.3 §33)
//
//  Behavioral contract of the canonical engine: trend, distributions,
//  repeated issues, anomalies, cross-domain patterns, correlations,
//  confidence, data quality, evidence, MTD/historical, archive
//  eligibility — plus the deterministic-rounding core and the
//  service outcome/cache semantics.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  pyRound,
  r,
  median,
  sampleStddev,
  leastSquaresSlope,
  pearson,
  robustBaseline,
  parseStoredDateToDayNumber,
} from '../numeric';
import { buildDistribution, monthlySeries } from '../distributions';
import {
  buildEmployeeAnalyticsResult,
  validateAnalyticsEnvelope,
  ANALYTICS_ENGINE_VERSION,
} from '../engine';
import {
  runEmployeeAnalytics,
  analyticsApiResponseBody,
  _resetAnalyticsCacheForTests,
  _analyticsCacheSizeForTests,
} from '../service';
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

type AnyRec = Record<string, unknown>;
const build = (fixture: object) => buildEmployeeAnalyticsResult(fixture as AnyRec);

// ── Deterministic rounding core (Python round semantics) ──────

describe('numeric — pyRound round-half-even parity core', () => {
  it('rounds exact binary ties to EVEN (Python behavior, unlike toFixed)', () => {
    assert.equal(pyRound(0.125, 2), 0.12);   // tie → even (0.13 would be JS toFixed)
    assert.equal(pyRound(0.375, 2), 0.38);   // tie → even
    assert.equal(pyRound(-0.125, 2), -0.12); // symmetric
  });
  it('rounds non-exact decimals by the true binary value', () => {
    assert.equal(pyRound(2.675, 2), 2.67);   // 2.675 is 2.67499… in binary
    assert.equal(pyRound(1.005, 2), 1.0);
  });
  it('identity on integers and null pass-through', () => {
    assert.equal(pyRound(87, 2), 87);
    assert.equal(pyRound(87.0, 3), 87);
    assert.equal(r(null), null);
  });
  it('negative zero normalizes to positive zero (JSON-stable)', () => {
    const out = pyRound(-0.0001, 2);
    assert.equal(Object.is(out, -0), false);
    assert.equal(out, 0);
  });
  it('1..3 digit variants used by the engine', () => {
    assert.equal(pyRound(0.74135, 1), 0.7);
    assert.equal(pyRound(-0.74135, 3), -0.741);
    assert.equal(pyRound(6.74571, 2), 6.75);
  });
  it('median / sampleStddev / slope / pearson primitives', () => {
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([3, 1, 2]), 2);
    const scores = [88, 85.75, 90.5, 82.25, 89.5];
    const std = sampleStddev(scores) as number;
    assert.ok(Math.abs(std - 3.2948823954733197) < 1e-12);
    assert.equal(sampleStddev([5]), null);
    assert.equal(leastSquaresSlope([[0, 0], [1, 1], [2, 2]]), 1);
    assert.equal(leastSquaresSlope([[0, 5], [1, 5]]), 0); // constant y → zero slope
    assert.equal(leastSquaresSlope([[5, 0], [5, 1]]), null); // zero x variance
    assert.equal(leastSquaresSlope([[0, 1]]), null); // n < 2
    assert.equal(pearson([[0, 0], [1, 1], [2, 2], [3, 3]]), 1);
    assert.equal(pearson([[0, 1], [1, 1], [2, 1], [3, 1]]), null); // no variance
  });
  it('robustBaseline: MAD sigma, and MAD=0 falls back to population std', () => {
    const madPath = robustBaseline([0, 1, 2, 3, 4]);
    assert.equal(madPath.med, 2);
    assert.ok(madPath.sigma !== null && Math.abs(madPath.sigma - 1 / 0.6745) < 1e-12);
    const fallback = robustBaseline([1, 1, 2, 1, 1]); // MAD=0 → population std
    assert.equal(fallback.med, 1);
    assert.ok(fallback.sigma !== null && Math.abs(fallback.sigma - 0.4) < 1e-12);
    const flat = robustBaseline([2, 2, 2, 2, 2, 2]);
    assert.equal(flat.med, 2);
    assert.equal(flat.sigma, null); // flat baseline → undefined z
  });
  it('stored DD/MM/YYYY parsing is strict (no rollover)', () => {
    assert.equal(parseStoredDateToDayNumber('05/12/2025'), Date.UTC(2025, 11, 5) / 86400000);
    assert.equal(parseStoredDateToDayNumber('31/02/2026'), null); // impossible date
    assert.equal(parseStoredDateToDayNumber('2026-07-05'), null); // wrong format
    assert.equal(parseStoredDateToDayNumber(null), null);
  });
});

// ── Distribution builders ─────────────────────────────────────

describe('distributions — deterministic builders', () => {
  it('sorts count desc then key asc and computes sharePct', () => {
    const dist = buildDistribution(
      [['b', 'B', 1], ['a', 'A', 3], ['c', 'C', 1]],
      5,
    );
    assert.deepEqual(dist.items.map((i) => i.key), ['a', 'b', 'c']);
    assert.equal(dist.items[0].sharePct, 60);
    assert.equal(dist.total, 5);
  });
  it('concentration requires count>=3 AND share>=40% (measurable facts)', () => {
    const dist = buildDistribution([['x', 'X', 3], ['y', 'Y', 2]], 5);
    assert.deepEqual(dist.concentration.map((c) => c.key), ['x']); // 60% & 3
    const low = buildDistribution([['x', 'X', 2], ['y', 'Y', 3]], 10);
    assert.equal(low.concentration.length, 0); // 30% / 30% — none qualify
  });
  it('window months absent from monthly counts are 0 (stored fact), outside reported', () => {
    const { series, outside } = monthlySeries(
      ['2026-05', '2026-06', '2026-07'],
      [{ month: '2026-04', count: 2 }, { month: '2026-05', count: 4 }, { month: '2026-07', count: 3 }],
    );
    assert.deepEqual(series, [4, 0, 3]);
    assert.deepEqual(outside, ['2026-04']);
  });
});

// ── Envelope validation (fail-closed) ─────────────────────────

describe('engine — envelope validation', () => {
  it('rejects invalid envelopes with the reference error codes', () => {
    assert.equal(validateAnalyticsEnvelope([1]).ok, false);
    const codeOf = (envelope: unknown): string => {
      const out = validateAnalyticsEnvelope(envelope);
      return out.ok ? 'NO_ERROR' : out.error.code;
    };
    assert.equal(codeOf({ schemaVersion: 2, dataset: {} }), 'UNSUPPORTED_SCHEMA_VERSION');
    assert.equal(codeOf({ schemaVersion: 1 }), 'MISSING_DATASET');
    assert.equal(
      codeOf({ schemaVersion: 1, dataset: { datasetKind: 'X' } }),
      'UNSUPPORTED_DATASET_KIND',
    );
    const message = validateAnalyticsEnvelope({
      schemaVersion: 1,
      dataset: { datasetKind: 'EMPLOYEE_PERFORMANCE_INTELLIGENCE' },
    });
    assert.equal(message.ok, false);
    assert.ok(
      !message.ok && message.error.message.includes('employee, period'),
    );
  });
});

// ── Trend analysis (spec §6 behavior) ─────────────────────────

describe('engine — trend analysis', () => {
  it('five available scores with mean exactly 87.2 produce 87.2 (spec §6 example)', () => {
    const result = build(makeTrendFiveMonthDataset());
    assert.equal(result.trendAnalysis.status, 'OK');
    assert.equal(result.trendAnalysis.stats?.mean, 87.2);
    assert.equal(result.trendAnalysis.stats?.count, 5);
    assert.equal(result.trendAnalysis.availableMonths, 5);
    assert.equal(result.trendAnalysis.confidence, 'MEDIUM');
  });
  it('missing months are never zero-filled; deltas only across consecutive AVAILABLE months', () => {
    const result = build(makeTrendGapDataset());
    const trend = result.trendAnalysis;
    assert.deepEqual(trend.missingMonths, ['2026-06']);
    assert.equal(trend.availableMonths, 3);
    assert.equal(trend.status, 'OK');
    // (04→05), then (05→07) across the gap — no zero month anywhere.
    assert.deepEqual(
      trend.periodOverPeriod.map((p) => [p.fromMonth, p.toMonth, p.deltaPoints]),
      [['2026-04', '2026-05', 3.5], ['2026-05', '2026-07', 3.5]],
    );
    assert.equal(trend.stats?.lastMonth, '2026-07');
  });
  it('direction threshold: ±0.5 pp/month boundaries', () => {
    assert.equal(pyRound(0.5, 3) >= 0.5, true);
    // slope exactly +0.5 → UP, exactly -0.5 → DOWN, ±0.4999 → STABLE
    const dataset = makeTrendFiveMonthDataset();
    const trend = (dataset as AnyRec).trend as AnyRec;
    trend.points = [
      { monthKey: '2026-03', available: true, rawScore: 90 },
      { monthKey: '2026-04', available: true, rawScore: 90.5 },
      { monthKey: '2026-05', available: true, rawScore: 91 },
      { monthKey: '2026-06', available: true, rawScore: 91.5 },
      { monthKey: '2026-07', available: true, rawScore: 92 },
    ];
    const result = build(dataset);
    assert.equal(result.trendAnalysis.stats?.slopePerMonth, 0.5);
    assert.equal(result.trendAnalysis.stats?.direction, 'UP');
  });
  it('fewer than 3 available months → INSUFFICIENT_DATA + note', () => {
    const result = build(makeSingleLiveNoKpiDataset());
    assert.equal(result.trendAnalysis.status, 'INSUFFICIENT_DATA');
    assert.deepEqual(result.trendAnalysis.noteCodes, ['INSUFFICIENT_TREND_DATA']);
    assert.equal(result.trendAnalysis.stats, null);
    assert.equal(result.trendAnalysis.confidence, 'INSUFFICIENT_DATA');
  });
});

// ── MTD / historical semantics ────────────────────────────────

describe('engine — MTD / LIVE / FINALIZED semantics', () => {
  beforeEach(() => _resetAnalyticsCacheForTests());

  it('MTD excludes count-spike detection and is never labeled FINALIZED', () => {
    const result = build(makePartialMtdDataset());
    assert.equal(result.input.valueBasis, 'MTD');
    assert.equal(result.trendAnalysis.mtdPartial, true);
    // insufficientSamples order: mtdPartialMonth entry FIRST.
    assert.equal(result.dataQuality.insufficientSamples[0].area, 'mtdPartialMonth');
    assert.equal(result.dataQuality.insufficientSamples[0].reason, 'MTD_PARTIAL_MONTH');
    assert.ok(result.dataQuality.notes.some((n) => n.startsWith('MTD_PARTIAL_MONTH')));
    // no anomalies could run for MTD
    assert.equal(result.anomalies.length, 0);
    assert.ok(result.dataQuality.insufficientSamples.some(
      (s) => s.area === 'anomalyDetection' && s.reason === 'MTD_PARTIAL_MONTH',
    ));
  });
  it('period comparison carries MTD note when partial', () => {
    const result = build(makePartialMtdDataset());
    assert.equal(result.periodComparison.status, 'INSUFFICIENT_DATA'); // 1-month window
    const full = build(makeFullNineMonthDataset());
    assert.equal(full.periodComparison.noteCode, null); // FINALIZED
  });
});

// ── Anomalies / cross-domain / correlations ───────────────────

describe('engine — anomalies, cross-domain, correlations', () => {
  it('count spike: robust z >= 3 flagged, >= 5 HIGH, MAD=0 falls back to population std', () => {
    const result = build(makeFullNineMonthDataset());
    const spike = result.anomalies.find((a) => a.anomalyType === 'COMPLAINTS_COUNT_SPIKE');
    assert.ok(spike);
    assert.equal(spike.direction, 'ABOVE_EXPECTED');
    assert.equal(spike.severity, 'HIGH');
    // baseline [0,1,0,1,1,0,1,1]: MAD=0 → population std 0.4841 → z = 5/0.4841 = 10.33
    assert.equal(spike.zScore, 10.33);
    assert.deepEqual(spike.expectedRange, {
      low: -0.45,
      high: 2.45,
      medianBaseline: 1,
      method: 'ROBUST_Z_MEDIAN_MAD',
    });
    assert.equal(spike.noteCode, 'ANOMALY_NOT_WRONGDOING');
    assert.ok(spike.supportingEvidence[0].recordIds.includes('cmp-1'));
  });
  it('score drop: last delta <= -10pp flagged with FIXED_THRESHOLD', () => {
    const result = build(makeFullNineMonthDataset());
    const drop = result.anomalies.find((a) => a.anomalyType === 'SCORE_DROP');
    assert.ok(drop);
    assert.equal(drop.observedValue, -11.25);
    assert.equal(drop.severity, 'MEDIUM');
    assert.equal(drop.expectedRange.high, -10);
    assert.equal(drop.month, '2026-07');
  });
  it('flat baselines produce FLAT_BASELINE insufficient entries (never a crash)', () => {
    const result = build(makeFlatBaselineDataset());
    const flats = result.dataQuality.insufficientSamples.filter((s) => s.reason === 'FLAT_BASELINE');
    assert.ok(flats.length >= 2);
    assert.ok(flats.every((s) => s.area === 'anomalyDetection'));
  });
  it('correlations: n>=8 runs, n<8 skipped explicitly, strength tiers + limits', () => {
    const full = build(makeFullNineMonthDataset());
    assert.ok(full.correlations.length > 0);
    for (const c of full.correlations) {
      assert.equal(c.sampleSize, 9);
      assert.ok(['STRONG', 'MODERATE', 'WEAK', 'NEGLIGIBLE'].includes(c.strength));
      assert.deepEqual(c.limitations, ['CORRELATION_NOT_CAUSATION', 'SMALL_SAMPLE', 'COUNT_DATA_ONLY']);
    }
    const five = build(makeTrendFiveMonthDataset());
    assert.ok(five.dataQuality.insufficientSamples.some(
      (s) => s.area === 'correlation' && s.reason === 'INSUFFICIENT_SAMPLE' && s.actual === 5,
    ));
  });
  it('zero-variance series → NO_VARIANCE, never a fabricated coefficient', () => {
    const result = build(makeFlatBaselineDataset());
    assert.ok(result.dataQuality.insufficientSamples.some(
      (s) => s.area === 'correlation' && s.reason === 'NO_VARIANCE',
    ));
  });
  it('cross-domain: shared increase months >= 2, TEMPORAL_ASSOCIATION + not-causation note', () => {
    const result = build(makeFullNineMonthDataset());
    if (result.crossDomainPatterns.length > 0) {
      for (const p of result.crossDomainPatterns) {
        assert.equal(p.patternType, 'TEMPORAL_ASSOCIATION');
        assert.ok(p.sharedIncreaseMonthIndices.length >= 2);
        assert.equal(p.noteCode, 'ASSOCIATION_NOT_CAUSATION');
      }
    }
  });
  it('unconfirmed complaint attribution gates complaint trend + eligibility', () => {
    const result = build(makeUnconfirmedComplaintsDataset());
    const complaints = result.distributionAnalysis.complaints;
    assert.equal(complaints.status, 'NOT_CONFIRMED_ATTRIBUTION');
    assert.deepEqual(complaints.noteCodes, ['ANALYSIS_GATED_ON_CONFIRMED_ATTRIBUTION']);
    assert.equal(complaints.countTrend, null);
    // complaints absent from eligible pairs → no complaint correlation
    assert.ok(result.correlations.every(
      (c) => !c.variables.includes('complaints'),
    ));
  });
});

// ── Repeated issues ───────────────────────────────────────────

describe('engine — repeated issues', () => {
  it('recurrence interval + window span from stored groups only', () => {
    const result = build(makeFullNineMonthDataset());
    const cat = result.patternAnalysis.repeatedIssues.byCategory[0];
    assert.equal(cat.occurrenceCount, 6);
    assert.equal(cat.recurrenceIntervalDays, 39.6); // 198 days / (6-1)
    const win = result.patternAnalysis.repeatedIssues.windowByCategory[0];
    assert.equal(win.windowSpanMonths, 4); // 2026-04..2026-07
    assert.equal(win.monthsPresentPct, 44.4); // 4/9
  });
});

// ── Evidence + KPI echo + contract surface ────────────────────

describe('engine — evidence, kpiFactsEcho, contract', () => {
  it('evidence references: kpi list first, canonical order, no invented ids', () => {
    const result = build(makeFullNineMonthDataset());
    const refs = result.evidenceReferences;
    assert.equal(refs[0].collection, 'kpiMonthlyResults');
    assert.deepEqual(refs.map((r) => r.collection), [
      'kpiMonthlyResults', 'monthSnapshots', 'qualityObservations', 'qualityDeductions',
      'complaints', 'capaCases', 'followUps', 'travelDeals', 'attendanceResults',
    ]);
  });
  it('kpiFactsEcho is VERBATIM — engine never recalculates KPI values', () => {
    const result = build(makeFullNineMonthDataset());
    assert.deepEqual(result.kpiFactsEcho, {
      source: 'kpi_engine',
      rowStatus: 'VALUE',
      overallStatus: null,
      componentId: 'quality',
      name: 'الجودة',
      status: 'FINAL',
      rawScore: 78.0,
      weight: 15,
      weightedContribution: null,
      maxContribution: 15,
      calculationVersion: 'kpi-v1',
    });
  });
  it('contract surface: engine version, deterministic, thresholds, noteCodes', () => {
    const result = build(makeFullNineMonthDataset());
    assert.equal(result.analyticsEngineVersion, ANALYTICS_ENGINE_VERSION);
    assert.equal(result.deterministic, true);
    assert.equal(result.status, 'OK');
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.interpretationBoundary, 'FACT_AND_ANALYSIS_ONLY');
    assert.deepEqual(result.thresholds, {
      trendMinMonths: 3,
      anomalyBaselineMinMonths: 5,
      anomalyZThreshold: 3,
      scoreDropThresholdPoints: 10,
      correlationMinMonths: 8,
      crossDomainMinMonths: 4,
      crossDomainMinSharedIncreases: 2,
      concentrationMinCount: 3,
      concentrationMinSharePct: 40,
      directionSlopeThresholdPpPerMonth: 0.5,
    });
    assert.deepEqual(result.noteCodes, [
      'ABSENT_MONTH_IS_ZERO_RECORDS',
      'ANOMALY_NOT_WRONGDOING',
      'ASSOCIATION_NOT_CAUSATION',
      'CORRELATION_NOT_CAUSATION',
      'MTD_PARTIAL_MONTH',
    ]);
  });
  it('deterministic: same input → byte-identical output', () => {
    const a = JSON.stringify(build(makeFullNineMonthDataset()));
    const b = JSON.stringify(build(makeFullNineMonthDataset()));
    assert.equal(a, b);
  });
});

// ── Archive eligibility behavior (spec §7) ────────────────────

describe('engine — archived employee historical eligibility', () => {
  it('archivedButEligible: historical facts kept, explicit note, no fabricated zeros', () => {
    const result = build(makeArchiveOutsideDataset());
    assert.equal(result.input.archivedButEligible, true);
    assert.equal(result.input.employmentStatus, 'archived');
    assert.ok(result.dataQuality.notes.some((n) => n.startsWith('ARCHIVED_BUT_ELIGIBLE')));
    // The archived employee's historical months still carry their values.
    assert.equal(result.trendAnalysis.availableMonths, 2); // 05 + 07 (06 missing, not zero)
    assert.deepEqual(result.trendAnalysis.missingMonths, ['2026-06']);
  });
  it('records outside the window are excluded and reported', () => {
    const result = build(makeArchiveOutsideDataset());
    assert.ok(result.dataQuality.notes.some((n) => n.includes('2026-04')));
    assert.equal(result.patternAnalysis.observations.monthlySeries.counts, result.patternAnalysis.observations.monthlySeries.counts);
    assert.deepEqual(result.patternAnalysis.observations.monthlySeries.counts, [4, 0, 3]);
  });
});

// ── Service outcome + cache semantics ─────────────────────────

describe('service — outcome mapping + cache', () => {
  beforeEach(() => _resetAnalyticsCacheForTests());

  it('OK outcome maps to the stable API response', async () => {
    const outcome = await runEmployeeAnalytics(makeTrendFiveMonthDataset() as never);
    assert.equal(outcome.ok, true);
    if (outcome.ok) {
      const body = analyticsApiResponseBody(outcome);
      assert.equal(body.status, 'OK');
      if (body.status === 'OK') {
        assert.equal(body.analytics.overallConfidence, 'MEDIUM');
      }
    }
  });
  it('caches successes by payload content and reports cached=true', async () => {
    const fixture = makeTrendFiveMonthDataset();
    const first = await runEmployeeAnalytics(fixture as never);
    assert.equal(first.ok, true);
    assert.equal(first.ok && first.cached, false);
    const second = await runEmployeeAnalytics(fixture as never);
    assert.equal(second.ok && second.cached, true);
    assert.equal(_analyticsCacheSizeForTests(), 1);
  });
  it('any dataset change produces a new cache key (stale results impossible)', async () => {
    const fixture = makeTrendFiveMonthDataset();
    await runEmployeeAnalytics(fixture as never);
    const mutated = structuredClone(fixture);
    const quality = (mutated as AnyRec).quality as AnyRec;
    quality.observations = { ...(quality.observations as AnyRec), total: 99 };
    const second = await runEmployeeAnalytics(mutated as never);
    assert.equal(second.ok && second.cached, false);
    assert.equal(_analyticsCacheSizeForTests(), 2);
    if (second.ok) {
      assert.equal(second.result.patternAnalysis.observations.total, 99);
    }
  });
  it('failures are NEVER cached (retry after fixing data succeeds)', async () => {
    const bad = { datasetKind: 'NOPE' };
    const failed = await runEmployeeAnalytics(bad as never);
    assert.equal(failed.ok, false);
    assert.equal(_analyticsCacheSizeForTests(), 0);
    const body = analyticsApiResponseBody(failed);
    assert.equal(body.status, 'ANALYTICS_ERROR');
    if (body.status === 'ANALYTICS_ERROR') {
      assert.equal(body.reason, 'DATA_CONTRACT_ERROR');
    }
  });
  it('DATA_CONTRACT_ERROR for a contract-violating dataset (never UNAVAILABLE)', async () => {
    const outcome = await runEmployeeAnalytics({ datasetKind: 'X' } as never);
    assert.equal(outcome.ok, false);
    assert.equal(!outcome.ok ? outcome.reason : '', 'DATA_CONTRACT_ERROR');
    const body = analyticsApiResponseBody(outcome);
    assert.equal(body.status, 'ANALYTICS_ERROR');
  });
});
