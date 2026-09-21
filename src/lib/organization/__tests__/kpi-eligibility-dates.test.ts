// ══════════════════════════════════════════════════════════════
//  KPI eligibility date-boundary regression — Qnlys investigation
//
//  ROOT CAUSE (production incident, September 2026):
//  employmentOverlapsRange compared STORED date strings directly
//  (blind slice(0,10)). The employee form's documented hireDate
//  format is DD/MM/YYYY (e.g. "28/7/2026"), so the sliced value was
//  compared LEXICOGRAPHICALLY against the ISO window ("2026-09-30"):
//  "28/7/2026" > "2026-09-30" because '8' > '0' at position 1 →
//  every such employee was judged "hired after the period" →
//  NOT_ELIGIBLE_PERIOD → silently dropped from Monthly/MTD/Historical
//  rows, employee reports and performance intelligence despite real
//  September evidence (EMP-075 أمنية السعيد, 3 observations, was
//  invisible). 28 of 103 live employees carried day-first dates;
//  14 were wrongly ineligible, and visibility accidentally depended
//  on the first digit of the day component (days 1–2 and 10–20
//  passed; 3–9 and 21–31 failed).
//
//  THE FIX: normalizeDayKey at the employment-periods boundary —
//  ISO values pass through; day-first slash values convert to
//  canonical YYYY-MM-DD; unparseable values are UNKNOWN (never
//  compared as strings).
//
//  These tests pin the eligibility contract that the KPI framework,
//  KPI reporting (monthly/MTD/historical/employee) and performance
//  intelligence all consume through isEmployeeEligibleForPeriod.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDayKey,
  foldEmploymentPeriods,
  employmentOverlapsRange,
} from '@/lib/organization/employment-periods';
import {
  isEmployeeEligibleForPeriod,
} from '@/lib/kpi-framework/employee-result';
import { resolveSchemeForEmployee } from '@/lib/kpi-framework/resolution';

const SEP = { start: '2026-09-01', end: '2026-09-30' };

function employee(overrides: Partial<Parameters<typeof isEmployeeEligibleForPeriod>[0]> = {}) {
  return {
    id: 'e1',
    name: 'موظف',
    department: null,
    status: 'active',
    hireDate: null,
    createdAt: undefined as string | undefined,
    archivedAt: null,
    ...overrides,
  };
}

// ── normalizeDayKey contract ──
describe('normalizeDayKey — canonical day keys at the employment boundary', () => {
  it('passes ISO day keys and ISO instants through', () => {
    assert.equal(normalizeDayKey('2026-09-20'), '2026-09-20');
    assert.equal(normalizeDayKey('2026-09-20T14:03:00.000Z'), '2026-09-20');
  });

  it('normalizes the employee form DD/MM/YYYY contract (day-first)', () => {
    assert.equal(normalizeDayKey('28/7/2026'), '2026-07-28');
    assert.equal(normalizeDayKey('05/04/2025'), '2025-04-05'); // app contract: day-first
    assert.equal(normalizeDayKey('9/9/2026'), '2026-09-09');
  });

  it('returns null for unparseable values (never compared as strings)', () => {
    assert.equal(normalizeDayKey('نص غير مفهوم'), null);
    assert.equal(normalizeDayKey(''), null);
    assert.equal(normalizeDayKey('99/99/2026'), null); // impossible date
    assert.equal(normalizeDayKey('2026-13-40'), null); // impossible month/day
  });
});

// ── the production regression: day-first hire dates vs an ISO window ──
describe('employmentOverlapsRange — DD/MM/YYYY hire dates (production regression)', () => {
  it('EMP-075 case: hireDate "28/7/2026" IS employed during September 2026', () => {
    const periods = foldEmploymentPeriods([], '28/7/2026');
    assert.equal(employmentOverlapsRange(periods, SEP.start, SEP.end), true);
  });

  it('zero-padded DD/MM/YYYY also overlaps', () => {
    const periods = foldEmploymentPeriods([], '05/09/2026');
    assert.equal(employmentOverlapsRange(periods, SEP.start, SEP.end), true);
  });

  it('a day-first hire AFTER the window stays ineligible (no over-inclusion)', () => {
    const periods = foldEmploymentPeriods([], '15/10/2026');
    assert.equal(employmentOverlapsRange(periods, SEP.start, SEP.end), false);
  });

  it('ISO hires keep their exact behavior (hired mid-month → eligible; next month → not)', () => {
    assert.equal(employmentOverlapsRange(foldEmploymentPeriods([], '2026-09-15'), SEP.start, SEP.end), true);
    assert.equal(employmentOverlapsRange(foldEmploymentPeriods([], '2026-10-15'), SEP.start, SEP.end), false);
  });

  it('an unparseable hire date is UNKNOWN presence, not "hired after the period"', () => {
    // Fail-open on presence: a corrupt date must not delete a real
    // employee from every report (the historical disappearance mode).
    const periods = foldEmploymentPeriods([], 'غير معروف');
    assert.equal(employmentOverlapsRange(periods, SEP.start, SEP.end), true);
  });
});

// ── engine-level eligibility (the exact function every KPI page consumes) ──
describe('isEmployeeEligibleForPeriod — engine eligibility verdicts', () => {
  it('active + day-first hireDate mid-period → ELIGIBLE (EMP-075 class)', () => {
    const e = employee({ hireDate: '28/7/2026' });
    assert.equal(isEmployeeEligibleForPeriod(e, [], '2026-09'), true);
  });

  it('hired inside the period month (ISO) → ELIGIBLE', () => {
    const e = employee({ hireDate: '2026-09-09', createdAt: '2026-09-09T08:00:00.000Z' });
    assert.equal(isEmployeeEligibleForPeriod(e, [], '2026-09'), true);
  });

  it('hired after the period (ISO) → NOT ELIGIBLE', () => {
    const e = employee({ hireDate: '2026-10-01' });
    assert.equal(isEmployeeEligibleForPeriod(e, [], '2026-09'), false);
  });

  it('hired after the period (day-first) → NOT ELIGIBLE', () => {
    const e = employee({ hireDate: '1/10/2026' });
    assert.equal(isEmployeeEligibleForPeriod(e, [], '2026-09'), false);
  });

  it('archived BEFORE the period with no restore → NOT ELIGIBLE (record guard)', () => {
    const e = employee({
      status: 'archived',
      hireDate: '2025-01-10',
      archivedAt: '2026-05-20T10:00:00.000Z',
    });
    assert.equal(isEmployeeEligibleForPeriod(e, [], '2026-09'), false);
  });

  it('archived DURING the period (ledger) → ELIGIBLE for that period', () => {
    const e = employee({ status: 'archived', hireDate: '2025-01-10' });
    const events = [{ kind: 'archived' as const, effectiveAt: '2026-09-12T10:00:00.000Z' }];
    assert.equal(isEmployeeEligibleForPeriod(e, events, '2026-09'), true);
  });

  it('archived before the period but restored after it started → ELIGIBLE', () => {
    const e = employee({
      status: 'archived',
      hireDate: '2025-01-10',
      archivedAt: '2026-05-20T10:00:00.000Z',
    });
    const events = [
      { kind: 'archived' as const, effectiveAt: '2026-05-20T10:00:00.000Z' },
      { kind: 'restored' as const, effectiveAt: '2026-09-05T10:00:00.000Z' },
    ];
    assert.equal(isEmployeeEligibleForPeriod(e, events, '2026-09'), true);
  });
});

// ── §12 reporting contract: distinct states, never collapsed ──
describe('eligibility vs scheme states remain semantically distinct', () => {
  const schemes = [
    {
      id: 'scheme-default',
      name: 'نظام افتراضي',
      version: 1,
      schemaVersion: 1 as const,
      description: null,
      previousSchemeId: null,
      createdBy: null,
      status: 'ACTIVE' as const,
      isDefault: true,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      applicableDepartments: null,
      components: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('an ACTIVE employee with real evidence but an active default scheme still resolves a plan', () => {
    const e = { id: 'e1', department: null };
    const r = resolveSchemeForEmployee({ employee: e, overrides: [], schemes, period: '2026-09' });
    assert.equal(r.status, 'RESOLVED');
  });

  it('no active scheme for the period → NO_SCHEME (distinct from NOT_ELIGIBLE_PERIOD)', () => {
    const e = { id: 'e1', department: null };
    const expired = [{ ...schemes[0], effectiveFrom: '2027-01-01' }];
    const r = resolveSchemeForEmployee({ employee: e, overrides: [], schemes: expired, period: '2026-09' });
    assert.equal(r.status, 'NO_SCHEME');
  });
});
