// ══════════════════════════════════════════════════════════════
//  §TRAVEL-THRESHOLD regression guards — the "قريب" business rule
//
//  Business requirement under test:
//    "قريب" = departure within 10 days. A deal departing after 10
//    days (11, 30, 40…) must NEVER be labeled قريب. Return-date
//    alerts are a SEPARATE concept with their own window.
//
//  Dates are built relative to TODAY and flow through the REAL
//  DD/MM/YYYY parser (getDaysRemaining) — no mocked clock, the same
//  path production takes.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEAR_TRAVEL_DAYS,
  URGENT_TRAVEL_DAYS,
  DEPARTURE_ATTENTION_DAYS,
  RETURN_ATTENTION_DAYS,
  isNearDeparture,
  getDepartureUrgency,
  getTravelPhase,
  isDepartureAttention,
  isReturnAttention,
  travelDaysUntil,
} from '@/lib/travel-status';

/** A DD/MM/YYYY date `days` from today (negative = past). */
function dateOffset(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon — immune to DST edge clipping
  d.setDate(d.getDate() + days);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

describe('§TRAVEL-THRESHOLD — daysUntilTravel arithmetic (real DD/MM/YYYY parsing)', () => {
  it('parses departure dates into exact day deltas', () => {
    assert.equal(travelDaysUntil(dateOffset(0)), 0);
    assert.equal(travelDaysUntil(dateOffset(1)), 1);
    assert.equal(travelDaysUntil(dateOffset(10)), 10);
    assert.equal(travelDaysUntil(dateOffset(11)), 11);
    assert.equal(travelDaysUntil(dateOffset(30)), 30);
    assert.equal(travelDaysUntil(dateOffset(40)), 40);
    assert.equal(travelDaysUntil(dateOffset(-1)), -1);
  });
});

describe('§TRAVEL-THRESHOLD — the قريب rule (isNearDeparture)', () => {
  it('0 days (today) IS قريب', () => {
    assert.equal(isNearDeparture(0), true);
  });
  it('1 day IS قريب', () => {
    assert.equal(isNearDeparture(1), true);
  });
  it('10 days IS قريب (inclusive boundary)', () => {
    assert.equal(isNearDeparture(10), true);
  });
  it('11 days is NOT قريب', () => {
    assert.equal(isNearDeparture(11), false);
  });
  it('30 days is NOT قريب', () => {
    assert.equal(isNearDeparture(30), false);
  });
  it('40 days is NOT قريب', () => {
    assert.equal(isNearDeparture(40), false);
  });
  it('past dates are NOT قريب (they are traveling/returned)', () => {
    assert.equal(isNearDeparture(-1), false);
    assert.equal(isNearDeparture(-30), false);
  });
  it('the constant matches the business rule (10 days)', () => {
    assert.equal(NEAR_TRAVEL_DAYS, 10);
  });
});

describe('§TRAVEL-THRESHOLD — urgency sub-windows (styling only, never widen قريب)', () => {
  it('today/1-3 days → critical (عاجل)', () => {
    assert.equal(getDepartureUrgency(0), 'critical');
    assert.equal(getDepartureUrgency(3), 'critical');
    assert.equal(URGENT_TRAVEL_DAYS, 3);
  });
  it('4-7 days → urgent', () => {
    assert.equal(getDepartureUrgency(4), 'urgent');
    assert.equal(getDepartureUrgency(7), 'urgent');
  });
  it('8-10 days → soon (still inside the قريب window)', () => {
    assert.equal(getDepartureUrgency(8), 'soon');
    assert.equal(getDepartureUrgency(10), 'soon');
  });
  it('anything beyond 10 days → normal (no urgency, no قريب)', () => {
    assert.equal(getDepartureUrgency(11), 'normal');
    assert.equal(getDepartureUrgency(14), 'normal');
    assert.equal(getDepartureUrgency(40), 'normal');
  });
});

describe('§TRAVEL-THRESHOLD — trip phase from REAL dates', () => {
  it('departure today/10 days → near (قريب)', () => {
    assert.equal(getTravelPhase(dateOffset(0), null), 'near');
    assert.equal(getTravelPhase(dateOffset(10), dateOffset(25)), 'near');
  });
  it('departure 11/30/40 days → scheduled (NOT قريب)', () => {
    assert.equal(getTravelPhase(dateOffset(11), null), 'scheduled');
    assert.equal(getTravelPhase(dateOffset(30), null), 'scheduled');
    assert.equal(getTravelPhase(dateOffset(40), dateOffset(60)), 'scheduled');
  });
  it('departure passed + return ahead → traveling', () => {
    assert.equal(getTravelPhase(dateOffset(-3), dateOffset(5)), 'traveling');
  });
  it('return passed → returned (final state wins)', () => {
    assert.equal(getTravelPhase(dateOffset(-20), dateOffset(-5)), 'returned');
  });
});

describe('§TRAVEL-THRESHOLD — alert windows: departure vs return INDEPENDENT', () => {
  it('departure attention follows the 10-day قريب rule', () => {
    assert.equal(DEPARTURE_ATTENTION_DAYS, 10);
    assert.equal(isDepartureAttention(0), true);
    assert.equal(isDepartureAttention(10), true);
    assert.equal(isDepartureAttention(11), false);
    assert.equal(isDepartureAttention(30), false);
  });
  it('return attention keeps its own window (deliberately NOT the departure rule)', () => {
    assert.equal(RETURN_ATTENTION_DAYS, 14);
    assert.equal(isReturnAttention(14), true);
    assert.equal(isReturnAttention(15), false);
  });
  it('a return 14 days out alerts even though a departure 14 days out does not', () => {
    assert.equal(isReturnAttention(14), true);
    assert.equal(isDepartureAttention(14), false);
  });
});
