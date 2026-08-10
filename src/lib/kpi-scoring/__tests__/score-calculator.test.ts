// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/kpi-scoring/score-calculator.ts (pure functions)
//
//  Run: npx tsx --test src/lib/kpi-scoring/__tests__/score-calculator.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampScore,
  computeScoreFromAdjustments,
  aggregateAdjustments,
  toPerformanceFactor,
} from '../score-calculator';
import type { ScoreAdjustment, ScoreInput } from '../types';

function baseInput(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    startScore: 100,
    deductions: 0,
    bonuses: 0,
    allowBonus: true,
    maximumBonus: 20,
    minimumScore: 0,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════

describe('clampScore', () => {
  it('returns the value when above the minimum', () => {
    assert.equal(clampScore(50, 0), 50);
  });

  it('returns the minimum when the value is below it', () => {
    assert.equal(clampScore(-10, 0), 0);
    assert.equal(clampScore(5, 10), 10);
  });
});

// ══════════════════════════════════════════════════════════════

describe('computeScoreFromAdjustments', () => {
  it('no deductions/bonuses → startScore', () => {
    const r = computeScoreFromAdjustments(baseInput());
    assert.equal(r.score, 100);
    assert.equal(r.bonusCapped, false);
  });

  it('single deduction reduces the score', () => {
    const r = computeScoreFromAdjustments(baseInput({ deductions: 5 }));
    assert.equal(r.score, 95);
    assert.equal(r.deductions, 5);
  });

  it('single bonus increases the score', () => {
    const r = computeScoreFromAdjustments(baseInput({ bonuses: 3 }));
    assert.equal(r.score, 103);
    assert.equal(r.effectiveBonus, 3);
  });

  it('bonus is capped at maximumBonus', () => {
    const r = computeScoreFromAdjustments(baseInput({ bonuses: 50, maximumBonus: 10 }));
    assert.equal(r.effectiveBonus, 10);
    assert.equal(r.score, 110);
    assert.equal(r.rawBonus, 50);
    assert.equal(r.bonusCapped, true);
  });

  it('allowBonus=false ignores bonuses entirely', () => {
    const r = computeScoreFromAdjustments(baseInput({ bonuses: 10, allowBonus: false }));
    assert.equal(r.effectiveBonus, 0);
    assert.equal(r.score, 100);
    assert.equal(r.bonusCapped, false);
  });

  it('score never goes below minimumScore', () => {
    const r = computeScoreFromAdjustments(baseInput({ deductions: 200, minimumScore: 0 }));
    assert.equal(r.score, 0);
  });

  it('minimumScore floor is respected when set higher', () => {
    const r = computeScoreFromAdjustments(baseInput({ deductions: 200, minimumScore: 30 }));
    assert.equal(r.score, 30);
  });

  it('deduction + bonus combine correctly', () => {
    const r = computeScoreFromAdjustments(baseInput({ deductions: 5, bonuses: 3 }));
    assert.equal(r.score, 98);
  });
});

// ══════════════════════════════════════════════════════════════

describe('aggregateAdjustments', () => {
  function adj(id: string, delta: number, isBonus: boolean): ScoreAdjustment {
    return { id, delta, isBonus };
  }

  it('empty list → startScore', () => {
    const r = aggregateAdjustments([], 100, true, 20, 0);
    assert.equal(r.score, 100);
  });

  it('sums deductions and bonuses separately', () => {
    const list = [adj('d1', 5, false), adj('d2', 3, false), adj('b1', 4, true)];
    const r = aggregateAdjustments(list, 100, true, 20, 0);
    assert.equal(r.deductions, 8);
    assert.equal(r.effectiveBonus, 4);
    assert.equal(r.score, 96); // 100 - 8 + 4
  });

  it('negative deltas for deductions still count as deductions', () => {
    const list = [adj('d1', -5, false)];
    const r = aggregateAdjustments(list, 100, true, 20, 0);
    assert.equal(r.deductions, 5);
    assert.equal(r.score, 95);
  });

  it('caps bonuses at maximumBonus', () => {
    const list = [adj('b1', 50, true)];
    const r = aggregateAdjustments(list, 100, true, 10, 0);
    assert.equal(r.effectiveBonus, 10);
    assert.equal(r.bonusCapped, true);
  });

  it('does not mutate the input list', () => {
    const list = [adj('d1', 5, false)];
    const snapshot = [...list];
    aggregateAdjustments(list, 100, true, 20, 0);
    assert.deepEqual(list, snapshot);
  });
});

// ══════════════════════════════════════════════════════════════

describe('toPerformanceFactor', () => {
  it('converts a ScoreResult into a PerformanceFactor', () => {
    const r = computeScoreFromAdjustments(baseInput({ deductions: 5 }));
    const f = toPerformanceFactor('quality', 'Quality', r, 1);
    assert.equal(f.factorId, 'quality');
    assert.equal(f.factorName, 'Quality');
    assert.equal(f.score, 95);
    assert.equal(f.weight, 1);
    assert.ok(f.maxScore >= f.score);
    assert.ok(f.normalized > 0 && f.normalized <= 1);
  });

  it('default weight is 1', () => {
    const f = toPerformanceFactor('x', 'X', computeScoreFromAdjustments(baseInput()));
    assert.equal(f.weight, 1);
  });

  it('includes optional breakdown when provided', () => {
    const f = toPerformanceFactor('x', 'X', computeScoreFromAdjustments(baseInput()), 1, { cat_a: 5 });
    assert.deepEqual(f.breakdown, { cat_a: 5 });
  });
});
