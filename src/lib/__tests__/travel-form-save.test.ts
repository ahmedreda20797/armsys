// ══════════════════════════════════════════════════════════════
//  §TRAVEL-FORM — the canonical Travel save contract.
//
//  Spec mapping:
//    §7  payload compatibility — closedAt is OPTIONAL (legacy edits
//        without it keep working); dealClosedAt goes through only when set
//    §9  the client closedAt travels ONLY where the server may honor it
//        (a completed-deal EDIT) — never for creates, never for
//        non-completed deals
//    §13 describeTravelSaveError — a server validation message is shown
//        verbatim; transport jargon/aborts fall back to the localized
//        generic line (no internals leaked, §14)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTravelSavePayload,
  describeTravelSaveError,
  TRAVEL_SAVE_TIMEOUT_MS,
  type TravelFormData,
} from '@/lib/travel-form';

const baseForm: TravelFormData = {
  employeeId: 'emp-1',
  destination: 'روسيا',
  departureDate: '06/12/2025',
  returnDate: '01/01/2026',
  dealClosedAt: '18/09/2026',
  closedAt: '',
  dealerName: 'deal',
  customerNames: 'cust',
  bookingItems: [],
  notes: '',
  status: 'completed',
};

describe('buildTravelSavePayload', () => {
  it('completed-deal EDIT with a historical completion date sends closedAt (legacy backfill §6.C)', () => {
    const p = buildTravelSavePayload({ ...baseForm, closedAt: '18/09/2026' }, true);
    assert.equal(p.closedAt, '18/09/2026');
    assert.equal(p.status, 'completed');
  });

  it('completed-deal EDIT with an EMPTY completion field omits closedAt entirely (§5 no fabrication)', () => {
    const p = buildTravelSavePayload({ ...baseForm, closedAt: '' }, true);
    assert.equal('closedAt' in p, false);
  });

  it('non-completed EDIT never sends closedAt (§6.A — client value cannot smuggle a ledger)', () => {
    const p = buildTravelSavePayload({ ...baseForm, status: 'in_progress', closedAt: '18/09/2026' }, true);
    assert.equal('closedAt' in p, false);
  });

  it('CREATE never sends closedAt — the server owns the initial ledger', () => {
    const p = buildTravelSavePayload({ ...baseForm, status: 'completed', closedAt: '18/09/2026' }, false);
    assert.equal('closedAt' in p, false);
  });

  it('legacy deal without dealClosedAt keeps the field out of the payload (§7 optional)', () => {
    const p = buildTravelSavePayload({ ...baseForm, dealClosedAt: '' }, true);
    assert.equal('dealClosedAt' in p, false);
  });

  it('every regular field travels verbatim (existing deals stay intact §12.4)', () => {
    const p = buildTravelSavePayload(baseForm, true);
    assert.equal(p.employeeId, 'emp-1');
    assert.equal(p.destination, 'روسيا');
    assert.equal(p.departureDate, '06/12/2025');
    assert.equal(p.returnDate, '01/01/2026');
    assert.equal(p.dealerName, 'deal');
    assert.equal(p.customerNames, 'cust');
    assert.deepEqual(p.bookingItems, []);
    assert.equal(p.notes, '');
    assert.equal(p.status, 'completed');
  });
});

describe('describeTravelSaveError', () => {
  const FALLBACK = 'تعذر حفظ الصفقة — تحقق من التاريخ والبيانات المطلوبة';

  it('shows the server validation message verbatim (safe, localized §14)', () => {
    assert.equal(
      describeTravelSaveError(new Error('تاريخ الاكتمال غير صالح — الصيغة DD/MM/YYYY'), FALLBACK),
      'تاريخ الاكتمال غير صالح — الصيغة DD/MM/YYYY',
    );
  });

  it('transport failures fall back to the localized generic line (no browser jargon)', () => {
    assert.equal(describeTravelSaveError(new Error('Failed to fetch'), FALLBACK), FALLBACK);
    assert.equal(describeTravelSaveError(new Error('The operation was aborted'), FALLBACK), FALLBACK);
    assert.equal(describeTravelSaveError(new Error('Load failed'), FALLBACK), FALLBACK);
  });

  it('non-Error / empty / oversized failures fall back too', () => {
    assert.equal(describeTravelSaveError(undefined, FALLBACK), FALLBACK);
    assert.equal(describeTravelSaveError('string-error', FALLBACK), FALLBACK);
    assert.equal(describeTravelSaveError(new Error('x'.repeat(400)), FALLBACK), FALLBACK);
  });
});

describe('TRAVEL_SAVE_TIMEOUT_MS', () => {
  it('bounds every save attempt (§13 — no infinite جاري الحفظ)', () => {
    assert.equal(TRAVEL_SAVE_TIMEOUT_MS, 30_000);
  });
});
