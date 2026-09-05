// ══════════════════════════════════════════════════════════════
//  Repetition Detection — tests (Milestone 7 §8)
//
//  Run: npx tsx --test src/lib/__tests__/repetition-detection.test.ts
//
//  Covers:
//    1  Two same-key records inside 30 days → alert (risk-center rule)
//    2  Records outside the window → no alert
//    3  Different employees with the same key → separate groups, no alert
//    4  Different taxonomies never merge (source separation doctrine)
//    5  minOccurrences = 1 impossible by default (≥2 required)
//    6  Deterministic ordering (count desc → employeeId → key)
//    7  CAPA pre-fill carries evidence ids + period explanation
//    8  Config override respected (configurable rule, no magic numbers)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REPETITION_RULE,
  buildCapaPrefillFromAlert,
  detectRepetitions,
  type RepetitionRecord,
} from '@/lib/repetition-detection';

const NOW = new Date(2026, 8, 10, 12, 0, 0); // 2026-09-10 noon local

function rec(partial: Partial<RepetitionRecord> & { id: string }): RepetitionRecord {
  return {
    employeeId: 'e1',
    issueKey: 'quality',
    issueLabel: 'مشكلة جودة',
    day: '2026-09-01',
    source: 'followUp',
    ...partial,
  };
}

describe('Repetition Detection (§8 — deterministic rules)', () => {
  it('1. two same-key records within 30 days trigger one alert', () => {
    const alerts = detectRepetitions([
      rec({ id: 'f1', day: '2026-08-20' }),
      rec({ id: 'f2', day: '2026-09-05' }),
    ], NOW);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].occurrenceCount, 2);
    assert.equal(alerts[0].firstDay, '2026-08-20');
    assert.equal(alerts[0].lastDay, '2026-09-05');
    assert.deepEqual(alerts[0].records.map((r) => r.id), ['f1', 'f2']);
  });

  it('2. records older than the 30-day window never alert', () => {
    const alerts = detectRepetitions([
      rec({ id: 'f1', day: '2026-07-01' }),
      rec({ id: 'f2', day: '2026-07-15' }),
    ], NOW);
    assert.equal(alerts.length, 0);
  });

  it('3. same key, different employees → separate groups, no alert', () => {
    const alerts = detectRepetitions([
      rec({ id: 'f1', employeeId: 'e1', day: '2026-09-01' }),
      rec({ id: 'f2', employeeId: 'e2', day: '2026-09-02' }),
    ], NOW);
    assert.equal(alerts.length, 0);
  });

  it('4. complaint and follow-up with the same key string stay SEPARATE taxonomies', () => {
    // 'delay' as a complaintType vs 'delay' as a followUpType is NOT
    // automatically the same problem — source separation is binding.
    const alerts = detectRepetitions([
      rec({ id: 'c1', source: 'complaint', day: '2026-09-01' }),
      rec({ id: 'f1', source: 'followUp', day: '2026-09-02' }),
    ], NOW);
    assert.equal(alerts.length, 0);
  });

  it('5. same key twice on the same source within window alerts across observation taxonomy too', () => {
    const alerts = detectRepetitions([
      rec({ id: 'o1', source: 'observation', issueKey: 'cat_lateness', issueLabel: 'التأخير', day: '2026-09-01' }),
      rec({ id: 'o2', source: 'observation', issueKey: 'cat_lateness', issueLabel: 'التأخير', day: '2026-09-08' }),
    ], NOW);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].source, 'observation');
    assert.equal(alerts[0].issueLabel, 'التأخير');
  });

  it('6. ordering: occurrence count desc, then employeeId', () => {
    const alerts = detectRepetitions([
      rec({ id: 'a1', employeeId: 'e1', day: '2026-09-01' }),
      rec({ id: 'a2', employeeId: 'e1', day: '2026-09-02' }),
      rec({ id: 'b1', employeeId: 'e2', day: '2026-09-01' }),
      rec({ id: 'b2', employeeId: 'e2', day: '2026-09-02' }),
      rec({ id: 'b3', employeeId: 'e2', day: '2026-09-03' }),
    ], NOW);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[0].employeeId, 'e2');
    assert.equal(alerts[0].occurrenceCount, 3);
  });

  it('7. defaults match the established codebase constants (2 × 30 days)', () => {
    assert.equal(DEFAULT_REPETITION_RULE.minOccurrences, 2);
    assert.equal(DEFAULT_REPETITION_RULE.windowDays, 30);
  });

  it('8. config override is respected (configurable, testable, auditable)', () => {
    const alerts = detectRepetitions([
      rec({ id: 'f1', day: '2026-06-01' }),
      rec({ id: 'f2', day: '2026-06-02' }),
    ], NOW, { minOccurrences: 2, windowDays: 120 });
    assert.equal(alerts.length, 1);
  });

  it('9. CAPA pre-fill carries employee, evidence ids and a self-explaining description', () => {
    const alerts = detectRepetitions([
      rec({ id: 'f1', day: '2026-08-20' }),
      rec({ id: 'f2', day: '2026-09-05' }),
    ], NOW);
    const prefill = buildCapaPrefillFromAlert(alerts[0], 'أحمد');
    assert.equal(prefill.employeeId, 'e1');
    assert.equal(prefill.source, 'repetition');
    assert.ok(prefill.problemDescription.includes('f1'));
    assert.ok(prefill.problemDescription.includes('f2'));
    assert.ok(prefill.problemDescription.includes('أحمد'));
    assert.ok(prefill.title.includes('مشكلة متكررة'));
  });

  it('10. unlinked records (no employeeId) are ignored entirely', () => {
    const alerts = detectRepetitions([
      rec({ id: 'c1', employeeId: null, day: '2026-09-01' }),
      rec({ id: 'c2', employeeId: null, day: '2026-09-02' }),
    ], NOW);
    assert.equal(alerts.length, 0);
  });
});
