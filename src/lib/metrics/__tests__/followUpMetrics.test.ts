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
  isDueToday,
  ACTIVE_FOLLOWUP_STATUSES,
  TERMINAL_FOLLOWUP_STATUSES,
} from '../followUpMetrics';

/**
 * LOCAL calendar-day key (YYYY-MM-DD) — the same shape users enter via
 * <input type="date"> and the predicates compare against. NEVER build
 * fixtures with toISOString(): it yields the UTC day, which differs
 * from the local day between 00:00 and 03:00 for UTC+X clients — the
 * exact trap the canonical predicates guard against.
 */
function localDayKey(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

describe('isOverdueFollowUp', () => {
  const yesterdayStr = localDayKey(-1);
  const tomorrowStr = localDayKey(1);
  const todayStr = localDayKey(0);

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


// ══════════════════════════════════════════════════════════════
//  isDueToday — the canonical "متابعات اليوم" predicate (§26).
//  The Home dashboard MUST count exactly these records: active
//  statuses (open | under_review | under_follow_up) whose
//  nextFollowUpDate equals today. The pre-fix Home route tested
//  'open' | 'in_progress' — 'in_progress' does not exist and
//  'under_review'/'under_follow_up' were silently dropped, so Home
//  undercounted the records the Follow-ups page shows.
// ══════════════════════════════════════════════════════════════
describe('isDueToday — canonical due-today semantics', () => {
  const todayStr = localDayKey(0);
  const tomorrowStr = localDayKey(1);
  const yesterdayStr = localDayKey(-1);

  it('every ACTIVE status due today counts — including under_review and under_follow_up', () => {
    for (const status of ACTIVE_FOLLOWUP_STATUSES) {
      assert.equal(isDueToday({ status, nextFollowUpDate: todayStr }), true, `status=${status}`);
    }
  });

  it('terminal statuses never count as due today', () => {
    for (const status of TERMINAL_FOLLOWUP_STATUSES) {
      assert.equal(isDueToday({ status, nextFollowUpDate: todayStr }), false, `status=${status}`);
    }
  });

  it('due tomorrow is not due today', () => {
    assert.equal(isDueToday({ status: 'open', nextFollowUpDate: tomorrowStr }), false);
  });

  it('due yesterday is overdue, not due today', () => {
    assert.equal(isDueToday({ status: 'open', nextFollowUpDate: yesterdayStr }), false);
  });

  it('a missing next-follow-up date is never due today', () => {
    assert.equal(isDueToday({ status: 'open', nextFollowUpDate: null }), false);
    assert.equal(isDueToday({ status: 'open' }), false);
  });

  it('an unparseable next-follow-up date is never due today (fail-closed)', () => {
    assert.equal(isDueToday({ status: 'open', nextFollowUpDate: 'not-a-date' }), false);
  });
});
