// ══════════════════════════════════════════════════════════════
//  §SMART-REPORT — observation month attribution (root-cause fix)
//
//  The Smart Quality Report showed «غير متاح» for months that DID
//  have real observations because the loader/attribution only trusted
//  the stored `month` field. Records with a missing/legacy-shaped
//  `month` but a valid `observationDate` (DD/MM/YYYY) were silently
//  dropped. Attribution now matches the deductions/follow-ups policy:
//  stored month FIRST, display-date derivation as the deterministic
//  fallback; still unattributable records are counted — never guessed.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { monthOfObservation, attributeRecords } from '@/lib/performance-intelligence/loaders';
import type { QualityObservation } from '@/types/quality-kpi';

function obs(overrides: Partial<QualityObservation>): QualityObservation {
  return {
    id: 'o1',
    employeeId: 'emp1',
    month: '2026-08',
    observationDate: '15/08/2026',
    type: 'deduction',
    severity: 'medium',
    status: 'open',
    approvalStatus: 'approved',
    points: 5,
    isBonus: false,
    applyPointDeduction: true,
    categoryId: null,
    categoryName: null,
    categoryWeight: 1,
    notes: '',
    evidence: [],
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    createdBy: 'system',
    createdByName: 'system',
    ...overrides,
  } as unknown as QualityObservation;
}

const WINDOW = ['2026-08'];

describe('observation month attribution — stored month first, display-date fallback', () => {
  it('a valid stored month wins verbatim', () => {
    assert.equal(monthOfObservation(obs({ month: '2026-08' })), '2026-08');
  });

  it('a missing stored month falls back to observationDate (DD/MM/YYYY, day-first)', () => {
    const record = obs({ month: undefined as unknown as string, observationDate: '05/09/2026' });
    assert.equal(monthOfObservation(record), '2026-09');
  });

  it('a legacy-shaped stored month (2026-8) falls back to observationDate instead of dropping', () => {
    const record = obs({ month: '2026-8', observationDate: '21/08/2026' });
    assert.equal(monthOfObservation(record), '2026-08');
  });

  it('unparseable month AND date → null (unattributed, never guessed)', () => {
    const record = obs({ month: '', observationDate: 'bad-date' });
    assert.equal(monthOfObservation(record), null);
  });

  it('attributeRecords: display-date-derived records land in the reported period', () => {
    const records = [
      obs({ id: 'a', month: '2026-08' }),                                  // stored month matches
      obs({ id: 'b', month: undefined as unknown as string, observationDate: '02/08/2026' }), // derived
      obs({ id: 'c', month: undefined as unknown as string, observationDate: '30/07/2026' }), // outside window
    ];
    const result = attributeRecords(records, monthOfObservation, '2026-08', WINDOW);
    assert.equal(result.inPeriod.length, 2);
    assert.deepEqual(result.inPeriod.map((r) => r.id).sort(), ['a', 'b']);
    assert.equal(result.inWindow.length, 2);
    assert.equal(result.unattributed, 0);
  });

  it('3 real observations with legacy month shape produce 3 in-period records (the reported defect)', () => {
    const records = [1, 2, 3].map((i) =>
      obs({ id: `obs${i}`, month: undefined as unknown as string, observationDate: `1${i}/08/2026` }),
    );
    const result = attributeRecords(records, monthOfObservation, '2026-08', WINDOW);
    assert.equal(result.inPeriod.length, 3, 'all three real observations are analyzed — no «غير متاح»');
  });
});
