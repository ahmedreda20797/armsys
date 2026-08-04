// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/metrics/riskMetrics.ts — canonical risk formula
//
//  Run: node --test src/lib/metrics/__tests__/riskMetrics.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRisk,
  levelForScore,
  RISK_WEIGHTS,
  RISK_CAPS,
  RISK_SCORE_MAX,
  RISK_LEVEL_BANDS,
} from '../riskMetrics';

// Helper: all-zero input
const ZERO_INPUT = {
  delayCount: 0, absenceCount: 0, qualityCount: 0, hrCount: 0,
  openFollowUpCount: 0, highPriorityFollowUpCount: 0,
  criticalFollowUpCount: 0, openComplaintCount: 0,
  repeatedIssueCount: 0,
  openCapaCount: 0, overdueCapaCount: 0,
  criticalCapaCount: 0, reopenedCapaCount: 0,
};

describe('computeRisk', () => {
  it('returns score 0 and level low for all-zero input', () => {
    const r = computeRisk(ZERO_INPUT);
    assert.equal(r.score, 0);
    assert.equal(r.level, 'low');
  });

  it('each factor contributes correct weighted points before cap', () => {
    // 1 delay → 1×1 = 1
    const r = computeRisk({ ...ZERO_INPUT, delayCount: 1 });
    assert.equal(r.breakdown.delay.count, 1);
    assert.equal(r.breakdown.delay.points, 1);
  });

  it('quality factor: 3 quality records → 3×5 = 15', () => {
    const r = computeRisk({ ...ZERO_INPUT, qualityCount: 3 });
    assert.equal(r.breakdown.quality.count, 3);
    assert.equal(r.breakdown.quality.points, 15);
  });

  it('quality factor: 6 quality records → 6×5 = 30, but capped at 25', () => {
    const r = computeRisk({ ...ZERO_INPUT, qualityCount: 6 });
    assert.equal(r.breakdown.quality.count, 6);
    assert.equal(r.breakdown.quality.points, 25); // capped
  });

  it('absence factor: 5 absences → 5×3 = 15', () => {
    const r = computeRisk({ ...ZERO_INPUT, absenceCount: 5 });
    assert.equal(r.breakdown.absence.count, 5);
    assert.equal(r.breakdown.absence.points, 15);
  });

  it('absence factor caps at 30 (10 absences → 30, not 30)', () => {
    const r = computeRisk({ ...ZERO_INPUT, absenceCount: 11 });
    assert.equal(r.breakdown.absence.points, 30);
  });

  it('critical follow-up: 2 → 2×10 = 20', () => {
    const r = computeRisk({ ...ZERO_INPUT, criticalFollowUpCount: 2 });
    assert.equal(r.breakdown.criticalFollowUp.count, 2);
    assert.equal(r.breakdown.criticalFollowUp.points, 20);
  });

  it('total score is capped at RISK_SCORE_MAX (100)', () => {
    // Max out every factor
    const r = computeRisk({
      delayCount: 100, absenceCount: 100, qualityCount: 100, hrCount: 100,
      openFollowUpCount: 100, highPriorityFollowUpCount: 100,
      criticalFollowUpCount: 100, openComplaintCount: 100,
      repeatedIssueCount: 100,
      openCapaCount: 100, overdueCapaCount: 100,
      criticalCapaCount: 100, reopenedCapaCount: 100,
    });
    assert.ok(r.score <= RISK_SCORE_MAX, `score ${r.score} exceeds max ${RISK_SCORE_MAX}`);
  });

  it('breakdown entries for zero-count factors still have count:0 points:0', () => {
    const r = computeRisk(ZERO_INPUT);
    for (const key of Object.keys(r.breakdown) as Array<keyof typeof r.breakdown>) {
      assert.equal(r.breakdown[key].count, 0, `${key} count should be 0`);
      assert.equal(r.breakdown[key].points, 0, `${key} points should be 0`);
    }
  });

  it('sum of all breakdown points equals score (before global cap)', () => {
    // Use moderate values that won't trigger global cap
    const r = computeRisk({
      ...ZERO_INPUT,
      delayCount: 2,    // 2
      absenceCount: 1,  // 3
      qualityCount: 1,   // 5
      hrCount: 1,       // 5
      openFollowUpCount: 1, // 3
      complaintCount: 1, // 8 — wait, the field is openComplaintCount
    });
    // Fix: use proper field name
    const r2 = computeRisk({
      ...ZERO_INPUT,
      delayCount: 2,
      absenceCount: 1,
      qualityCount: 1,
      hrCount: 1,
      openFollowUpCount: 1,
      openComplaintCount: 1,
    });
    const sum = Object.values(r2.breakdown).reduce((s, e) => s + e.points, 0);
    assert.equal(r2.score, sum, `score ${r2.score} != breakdown sum ${sum}`);
  });

  it('negative counts are coerced to 0', () => {
    const r = computeRisk({ ...ZERO_INPUT, delayCount: -5 });
    assert.equal(r.breakdown.delay.count, 0);
    assert.equal(r.breakdown.delay.points, 0);
  });
});

describe('levelForScore', () => {
  it('score 0 → low', () => assert.equal(levelForScore(0), 'low'));
  it('score 10 → low', () => assert.equal(levelForScore(10), 'low'));
  it('score 11 → medium', () => assert.equal(levelForScore(11), 'medium'));
  it('score 25 → medium', () => assert.equal(levelForScore(25), 'medium'));
  it('score 26 → high', () => assert.equal(levelForScore(26), 'high'));
  it('score 50 → high', () => assert.equal(levelForScore(50), 'high'));
  it('score 51 → critical', () => assert.equal(levelForScore(51), 'critical'));
  it('score 100 → critical', () => assert.equal(levelForScore(100), 'critical'));
});

describe('RISK_LEVEL_BANDS constants', () => {
  it('bands are ordered low < medium < high < critical', () => {
    assert.ok(RISK_LEVEL_BANDS.low < RISK_LEVEL_BANDS.medium);
    assert.ok(RISK_LEVEL_BANDS.medium < RISK_LEVEL_BANDS.high);
    assert.ok(RISK_LEVEL_BANDS.high < RISK_LEVEL_BANDS.critical);
  });
});
