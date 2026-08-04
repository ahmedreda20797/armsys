// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/metrics/followUpMetrics.ts — overdue on-read
//
//  Run: node --test src/lib/metrics/__tests__/followUpMetrics.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOverdueFollowUp,
  isActiveFollowUp,
  isTerminalFollowUp,
  ACTIVE_FOLLOWUP_STATUSES,
  TERMINAL_FOLLOWUP_STATUSES,
} from '../followUpMetrics';

describe('isOverdueFollowUp', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  it('past-due open follow-up → overdue = true', () => {
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: yesterdayStr }), true);
  });

  it('past-due under_review follow-up → overdue = true', () => {
    assert.equal(isOverdueFollowUp({ status: 'under_review', nextFollowUpDate: yesterdayStr }), true);
  });

  it('past-due closed follow-up → overdue = false (terminal)', () => {
    assert.equal(isOverdueFollowUp({ status: 'closed', nextFollowUpDate: yesterdayStr }), false);
  });

  it('past-due cancelled follow-up → overdue = false (terminal)', () => {
    assert.equal(isOverdueFollowUp({ status: 'cancelled', nextFollowUpDate: yesterdayStr }), false);
  });

  it('future due date open follow-up → overdue = false', () => {
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: tomorrowStr }), false);
  });

  it('no nextFollowUpDate → overdue = false', () => {
    assert.equal(isOverdueFollowUp({ status: 'open' }), false);
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: '' }), false);
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: null as any }), false);
  });

  it('invalid nextFollowUpDate → overdue = false', () => {
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: 'not-a-date' }), false);
  });

  it('follow-up due today is NOT overdue (due < start of today fails)', () => {
    // today's date at midnight is NOT < start of today, so not overdue
    assert.equal(isOverdueFollowUp({ status: 'open', nextFollowUpDate: todayStr }), false);
  });

  it('accepts explicit now parameter', () => {
    const fixedNow = new Date('2025-06-15T12:00:00Z');
    // June 14 is before June 15 → overdue
    assert.equal(
      isOverdueFollowUp({ status: 'open', nextFollowUpDate: '2025-06-14' }, fixedNow),
      true
    );
    // June 16 is after June 15 → not overdue
    assert.equal(
      isOverdueFollowUp({ status: 'open', nextFollowUpDate: '2025-06-16' }, fixedNow),
      false
    );
  });
});

describe('isActiveFollowUp', () => {
  it('active statuses are recognized', () => {
    for (const s of ACTIVE_FOLLOWUP_STATUSES) {
      assert.equal(isActiveFollowUp({ status: s }), true, `${s} should be active`);
    }
  });

  it('terminal statuses are not active', () => {
    for (const s of TERMINAL_FOLLOWUP_STATUSES) {
      assert.equal(isActiveFollowUp({ status: s }), false, `${s} should not be active`);
    }
  });

  it('unknown status is not active', () => {
    assert.equal(isActiveFollowUp({ status: 'unknown_status' }), false);
  });
});

describe('isTerminalFollowUp', () => {
  it('terminal statuses are recognized', () => {
    for (const s of TERMINAL_FOLLOWUP_STATUSES) {
      assert.equal(isTerminalFollowUp({ status: s }), true, `${s} should be terminal`);
    }
  });

  it('active statuses are not terminal', () => {
    for (const s of ACTIVE_FOLLOWUP_STATUSES) {
      assert.equal(isTerminalFollowUp({ status: s }), false, `${s} should not be terminal`);
    }
  });
});
