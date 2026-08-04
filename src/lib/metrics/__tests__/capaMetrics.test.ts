// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/metrics/capaMetrics.ts — overdue/SLA/effectiveness
//
//  Run: node --test src/lib/metrics/__tests__/capaMetrics.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOverdueCAPA,
  isClosedCAPA,
  isTerminalCAPA,
  capaDueDateMs,
  capaOverdueDays,
  calcCAPAEffectiveness,
  CAPA_SLA_DAYS,
  ACTIVE_CAPA_STATUSES,
  TERMINAL_CAPA_STATUSES,
} from '../capaMetrics';

describe('CAPA_SLA_DAYS', () => {
  it('critical = 1, high = 3, medium = 7, low = 14', () => {
    assert.equal(CAPA_SLA_DAYS.critical, 1);
    assert.equal(CAPA_SLA_DAYS.high, 3);
    assert.equal(CAPA_SLA_DAYS.medium, 7);
    assert.equal(CAPA_SLA_DAYS.low, 14);
  });
});

describe('isClosedCAPA / isTerminalCAPA', () => {
  it('closed is both closed and terminal', () => {
    assert.equal(isClosedCAPA({ status: 'closed' } as any), true);
    assert.equal(isTerminalCAPA({ status: 'closed' } as any), true);
  });

  it('rejected is terminal but not closed', () => {
    assert.equal(isClosedCAPA({ status: 'rejected' } as any), false);
    assert.equal(isTerminalCAPA({ status: 'rejected' } as any), true);
  });

  it('open is neither closed nor terminal', () => {
    assert.equal(isClosedCAPA({ status: 'open' } as any), false);
    assert.equal(isTerminalCAPA({ status: 'open' } as any), false);
  });

  it('reopened is neither closed nor terminal', () => {
    assert.equal(isClosedCAPA({ status: 'reopened' } as any), false);
    assert.equal(isTerminalCAPA({ status: 'reopened' } as any), false);
  });
});

describe('capaDueDateMs', () => {
  it('returns correctiveDueDate when set (no SLA addition)', () => {
    const due = '2025-07-01T00:00:00Z';
    const ms = capaDueDateMs({ correctiveDueDate: due, createdAt: '2025-06-01T00:00:00Z', priority: 'high' } as any);
    assert.equal(ms, new Date(due).getTime());
  });

  it('returns createdAt + slaDays when no correctiveDueDate', () => {
    const created = '2025-06-01T00:00:00Z';
    const ms = capaDueDateMs({ createdAt: created, priority: 'high' } as any);
    // high = 3 days
    assert.equal(ms, new Date(created).getTime() + 3 * 86400000);
  });

  it('returns null when no dates available', () => {
    const ms = capaDueDateMs({} as any);
    assert.equal(ms, null);
  });

  it('ignores correctiveDueDate when it is invalid', () => {
    const created = '2025-06-01T00:00:00Z';
    const ms = capaDueDateMs({ correctiveDueDate: 'bad-date', createdAt: created, priority: 'medium' } as any);
    // Falls back to createdAt + 7 days
    assert.equal(ms, new Date(created).getTime() + 7 * 86400000);
  });
});

describe('isOverdueCAPA', () => {
  it('active CAPA past due → overdue', () => {
    const now = new Date('2025-07-05T12:00:00Z');
    // Created Jun 29, high priority → due Jul 2 (3 days). Jul 5 > Jul 2 → overdue.
    assert.equal(
      isOverdueCAPA({ status: 'open', createdAt: '2025-06-29T00:00:00Z', priority: 'high' } as any, now),
      true
    );
  });

  it('active CAPA not yet due → not overdue', () => {
    const now = new Date('2025-06-30T12:00:00Z');
    // Created Jun 29, high priority → due Jul 2. Jun 30 < Jul 2 → not overdue.
    assert.equal(
      isOverdueCAPA({ status: 'open', createdAt: '2025-06-29T00:00:00Z', priority: 'high' } as any, now),
      false
    );
  });

  it('closed CAPA → never overdue', () => {
    const now = new Date('2025-12-31T00:00:00Z');
    assert.equal(
      isOverdueCAPA({ status: 'closed', createdAt: '2025-01-01T00:00:00Z', priority: 'critical' } as any, now),
      false
    );
  });

  it('rejected CAPA → never overdue', () => {
    const now = new Date('2025-12-31T00:00:00Z');
    assert.equal(
      isOverdueCAPA({ status: 'rejected', createdAt: '2025-01-01T00:00:00Z', priority: 'critical' } as any, now),
      false
    );
  });

  it('uses correctiveDueDate as due date when set', () => {
    const now = new Date('2025-08-01T00:00:00Z');
    // correctiveDueDate = Jul 30 → overdue on Aug 1
    assert.equal(
      isOverdueCAPA({ status: 'open', createdAt: '2025-06-01T00:00:00Z', correctiveDueDate: '2025-07-30T00:00:00Z', priority: 'low' } as any, now),
      true
    );
  });
});

describe('capaOverdueDays', () => {
  it('returns 0 for non-overdue', () => {
    const now = new Date('2025-06-30T00:00:00Z');
    const days = capaOverdueDays({ status: 'open', createdAt: '2025-06-29T00:00:00Z', priority: 'high' } as any, now);
    assert.equal(days, 0);
  });

  it('returns positive days for overdue', () => {
    const now = new Date('2025-07-05T00:00:00Z');
    // Due Jul 2, now Jul 5 → 3 days overdue
    const days = capaOverdueDays({ status: 'open', createdAt: '2025-06-29T00:00:00Z', priority: 'high' } as any, now);
    assert.ok(days > 0, `expected > 0, got ${days}`);
  });

  it('returns 0 for closed CAPA regardless of date', () => {
    const now = new Date('2025-12-31T00:00:00Z');
    const days = capaOverdueDays({ status: 'closed', createdAt: '2025-01-01T00:00:00Z', priority: 'critical' } as any, now);
    assert.equal(days, 0);
  });
});

describe('calcCAPAEffectiveness', () => {
  it('empty array → 0', () => {
    assert.equal(calcCAPAEffectiveness([]), 0);
  });

  it('no closed cases → 0', () => {
    assert.equal(calcCAPAEffectiveness([{ status: 'open' } as any]), 0);
  });

  it('all closed effective → 100%', () => {
    const cases = [
      { status: 'closed', verificationResult: 'effective' } as any,
      { status: 'closed', verificationResult: 'effective' } as any,
    ];
    assert.equal(calcCAPAEffectiveness(cases), 100);
  });

  it('half effective → 50%', () => {
    const cases = [
      { status: 'closed', verificationResult: 'effective' } as any,
      { status: 'closed', verificationResult: 'not_effective' } as any,
    ];
    assert.equal(calcCAPAEffectiveness(cases), 50);
  });

  it('open cases are ignored in denominator', () => {
    const cases = [
      { status: 'closed', verificationResult: 'effective' } as any,
      { status: 'open' } as any,
      { status: 'investigation' } as any,
    ];
    // 1 effective / 1 closed = 100%
    assert.equal(calcCAPAEffectiveness(cases), 100);
  });
});
