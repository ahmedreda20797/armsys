// ══════════════════════════════════════════════════════════════
//  §LEGACY-BACKFILL — regression suite for the canonical closedAt
//  update resolver + the date normalization it relies on.
//
//  Spec mapping (§6 lifecycle rules, §5 no fabrication, §8 dates,
//  §16/§18 canonical metrics):
//    A  non-completed deal never receives a closedAt (client value ignored)
//    B  entering 'completed': explicit valid client date honored; else now
//    C  legacy completed + null ledger: valid client date backfills;
//       absent/empty client value leaves null (NEVER fabricated)
//    D  completed + existing ledger: valid client date corrects;
//       absent/empty leaves the stored value verbatim
//    E  leaving 'completed': ledger cleared (client value ignored)
//    §8  DD/MM/YYYY validation (no 31/02, no garbage), Arabic-Indic
//        digits normalized, ISO day/instant accepted, month preserved
//        with no timezone shift
//    §16 the backfilled instant attributes to the correct canonical
//        CLOSED month (September 2026), never to the departure month
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveClosedAtForUpdate,
  CLOSED_AT_INVALID_ERROR,
  buildDealMetrics,
  getDealMonthKey,
} from '@/lib/deal-dates';
import {
  isValidDisplayDate,
  normalizeArabicDigits,
  displayDateToIsoDayStart,
  isoToDisplayDate,
} from '@/lib/date-utils';

const NOW = new Date('2026-09-30T12:00:00.000Z');

// ── §6.A — non-completed deals never receive the ledger ──────
describe('resolveClosedAtForUpdate — A. non-completed', () => {
  it('legacy in_progress deal + client date → closedAt untouched (client value ignored)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'in_progress', existingClosedAt: null,
      nextStatus: 'in_progress', clientClosedAt: '18/09/2026', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal('closedAt' in r ? (r as { closedAt?: string | null }).closedAt : undefined, undefined);
  });

  it('upcoming deal + ISO client value → untouched', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'upcoming', existingClosedAt: null,
      nextStatus: 'upcoming', clientClosedAt: '2026-09-18', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal('closedAt' in r ? (r as { closedAt?: string | null }).closedAt : undefined, undefined);
  });
});

// ── §6.B — entering 'completed' ───────────────────────────────
describe('resolveClosedAtForUpdate — B. entering completed', () => {
  it('explicit valid historical client date is honored (historical completion registration)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'in_progress', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: '18/09/2026', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-18T00:00:00.000Z');
  });

  it('no client value → server stamps now (existing canonical rule)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'in_progress', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: undefined, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-30T12:00:00.000Z');
  });

  it('created-as-completed legacy null + no transition + no client value stays null', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: undefined, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, undefined);
  });
});

// ── §6.C — legacy backfill ────────────────────────────────────
describe('resolveClosedAtForUpdate — C. legacy backfill', () => {
  it('completed + null ledger + valid client date → backfilled ISO instant', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: '18/09/2026', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-18T00:00:00.000Z');
  });

  it('empty-string client value means "leave untouched" — null stays null (§5 no fabrication)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: '', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, undefined);
  });

  it('null client value also means "leave untouched"', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: null, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, undefined);
  });

  it('Arabic-Indic digits normalize to the same instant (§8 AR input)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: '١٨/٠٩/٢٠٢٦', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-18T00:00:00.000Z');
  });
});

// ── §6.D — authorized correction / preservation ───────────────
describe('resolveClosedAtForUpdate — D. existing ledger', () => {
  it('valid client date corrects the stored ledger', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: '2026-08-01T00:00:00.000Z',
      nextStatus: 'completed', clientClosedAt: '18/09/2026', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-18T00:00:00.000Z');
  });

  it('absent client value preserves the stored ledger verbatim', () => {
    const stored = '2026-08-01T09:41:00.123Z';
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: stored,
      nextStatus: 'completed', clientClosedAt: undefined, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, undefined);
  });

  it('idempotent round-trip: the stored ISO instant accepted unchanged', () => {
    const stored = '2026-08-01T09:41:00.123Z';
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: stored,
      nextStatus: 'completed', clientClosedAt: stored, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, stored);
  });

  it('ISO day key accepted (YYYY-MM-DD)', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: null,
      nextStatus: 'completed', clientClosedAt: '2026-09-18', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, '2026-09-18T00:00:00.000Z');
  });
});

// ── §6.E — leaving 'completed' ─────────────────────────────────
describe('resolveClosedAtForUpdate — E. leaving completed', () => {
  it('completed → canceled clears the ledger even if a client date was sent', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: '2026-08-01T00:00:00.000Z',
      nextStatus: 'canceled', clientClosedAt: '18/09/2026', now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, null);
  });

  it('completed → upcoming clears the ledger', () => {
    const r = resolveClosedAtForUpdate({
      existingStatus: 'completed', existingClosedAt: '2026-08-01T00:00:00.000Z',
      nextStatus: 'upcoming', clientClosedAt: undefined, now: NOW,
    });
    assert.ok(r.ok);
    assert.equal((r as { closedAt?: string | null }).closedAt, null);
  });
});

// ── invalid input fails closed (deterministic 400 source) ─────
describe('resolveClosedAtForUpdate — invalid client dates', () => {
  for (const bad of ['18-09-2026', '31/02/2026', '2026/09/18', 'garbage', 42, {}, '09/2026']) {
    it(`rejects ${JSON.stringify(bad)} with the canonical error`, () => {
      const r = resolveClosedAtForUpdate({
        existingStatus: 'completed', existingClosedAt: null,
        nextStatus: 'completed', clientClosedAt: bad, now: NOW,
      });
      assert.ok(!r.ok);
      assert.equal((r as { error?: string }).error, CLOSED_AT_INVALID_ERROR);
    });
  }
});

// ── §8 — date utilities ───────────────────────────────────────
describe('date-utils — display/ISO contract', () => {
  it('normalizeArabicDigits maps both Arabic digit ranges to ASCII', () => {
    assert.equal(normalizeArabicDigits('١٨/٠٩/٢٠٢٦'), '18/09/2026');
    assert.equal(normalizeArabicDigits('۰۳'), '03');
    assert.equal(normalizeArabicDigits('18/09/2026'), '18/09/2026');
  });

  it('isValidDisplayDate accepts Arabic-Indic input and real calendar dates, rejects the rest', () => {
    assert.ok(isValidDisplayDate('18/09/2026'));
    assert.ok(isValidDisplayDate('١٨/٠٩/٢٠٢٦'));
    assert.ok(!isValidDisplayDate('31/02/2026'));
    assert.ok(!isValidDisplayDate('18-09-2026'));
    assert.ok(!isValidDisplayDate(''));
    assert.ok(!isValidDisplayDate(42));
  });

  it('displayDateToIsoDayStart is UTC-anchored (no timezone shift, month preserved)', () => {
    assert.equal(displayDateToIsoDayStart('18/09/2026'), '2026-09-18T00:00:00.000Z');
    assert.equal(displayDateToIsoDayStart('01/01/2025'), '2025-01-01T00:00:00.000Z');
    assert.equal(displayDateToIsoDayStart('bad'), null);
  });

  it('isoToDisplayDate reverses the ISO forms (pure string surgery)', () => {
    assert.equal(isoToDisplayDate('2026-09-18T00:00:00.000Z'), '18/09/2026');
    assert.equal(isoToDisplayDate('2026-09-18'), '18/09/2026');
    assert.equal(isoToDisplayDate('18/09/2026'), null);
  });
});

// ── §16/§18 — the backfilled ledger flows into canonical metrics ──
describe('canonical metrics after backfill', () => {
  const deal = {
    id: 'legacy-1',
    status: 'completed' as const,
    // departure December 2025, created March 2026, backfilled completion 18/09/2026
    departureDate: '06/12/2025',
    createdAt: '2026-03-01T08:00:00.000Z',
    dealClosedAt: '18/09/2026',
    closedAt: '2026-09-18T00:00:00.000Z',
  };

  it('closedAt attributes to the CLOSURE month (2026-09), never departure/creation', () => {
    assert.equal(getDealMonthKey(deal, 'CLOSED'), '2026-09');
    assert.notEqual(getDealMonthKey(deal, 'CLOSED'), getDealMonthKey(deal, 'TRAVEL'));
    assert.notEqual(getDealMonthKey(deal, 'CLOSED'), getDealMonthKey(deal, 'CREATED'));
  });

  it('the deal counts in September 2026 completed metrics through the ONE builder', () => {
    const m = buildDealMetrics([deal], { periodMonthKey: '2026-09' });
    assert.equal(m.completedInPeriod, 1);
    const december = buildDealMetrics([deal], { periodMonthKey: '2025-12' });
    assert.equal(december.completedInPeriod, 0, 'departure month must not receive the completion');
  });

  it('the same deal with an UNKNOWN ledger surfaces as unknown, not counted in any month', () => {
    const legacy = { ...deal, closedAt: null };
    const m = buildDealMetrics([legacy], { periodMonthKey: '2026-09' });
    assert.equal(m.completedInPeriod, 0);
    assert.equal(m.completedUnknownMonth, 1);
  });
});
