// ══════════════════════════════════════════════════════════════
//  §TRAVEL-TOMORROW — the canonical tomorrow matcher
//  (العملاء المسافرون غدًا / العملاء العائدون غدًا filters)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTomorrow } from '@/lib/travel-status';

function ddMmYYYY(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

describe('isTomorrow — DD/MM/YYYY display dates vs server clock', () => {
  it('tomorrow matches', () => {
    assert.equal(isTomorrow(ddMmYYYY(1)), true);
  });

  it('today, yesterday and later dates do not match', () => {
    assert.equal(isTomorrow(ddMmYYYY(0)), false);
    assert.equal(isTomorrow(ddMmYYYY(-1)), false);
    assert.equal(isTomorrow(ddMmYYYY(2)), false);
    assert.equal(isTomorrow(ddMmYYYY(30)), false);
  });

  it('unparseable input never matches (fail-closed)', () => {
    assert.equal(isTomorrow('bad-date'), false);
    assert.equal(isTomorrow(''), false);
    assert.equal(isTomorrow(null), false);
    assert.equal(isTomorrow(undefined), false);
    assert.equal(isTomorrow(12345), false);
    assert.equal(isTomorrow('00/00/0000'), false);
  });
});
