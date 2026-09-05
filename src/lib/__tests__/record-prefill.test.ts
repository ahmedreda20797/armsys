// ══════════════════════════════════════════════════════════════
//  Cross-page create pre-fill — tests (UX Corrections §1/§3)
//
//  Run: npx tsx --test src/lib/__tests__/record-prefill.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  capaDefaultsFromNavParams,
  complaintPrefillFromTravelIntent,
  hasCreateIntent,
} from '@/lib/record-prefill';
import { sanitizeUserPreferencesInput } from '@/lib/personalization';

describe('Cross-page create pre-fill (§1)', () => {
  it('1. hasCreateIntent: source + no id = create; id present = detail link', () => {
    assert.equal(hasCreateIntent({ source: 'complaint' }), true);
    assert.equal(hasCreateIntent({ source: 'complaint', id: 'capa-1' }), false);
    assert.equal(hasCreateIntent({}), false);
    assert.equal(hasCreateIntent(null), false);
  });

  it('2. CAPA pre-fill maps ALL provided context keys (employee, description, links)', () => {
    const d = capaDefaultsFromNavParams({
      source: 'quality',
      title: 'خصم جودة — تأخير',
      department: 'المبيعات',
      priority: 'high',
      employeeId: 'e1',
      problemDescription: 'خصم متكرر',
      relatedQualityDeductionId: 'q9',
    });
    assert.deepEqual(d, {
      title: 'خصم جودة — تأخير',
      department: 'المبيعات',
      priority: 'high',
      employeeId: 'e1',
      problemDescription: 'خصم متكرر',
      source: 'quality',
      relatedQualityDeductionId: 'q9',
    });
  });

  it('3. CAPA pre-fill: missing keys are NOT invented (never fabricated)', () => {
    const d = capaDefaultsFromNavParams({ source: 'repetition' });
    assert.deepEqual(d, { source: 'repetition' });
    assert.equal('employeeId' in d, false);
  });

  it('4. Travel → Complaint pre-fill maps deal/customer/employee/description', () => {
    const p = complaintPrefillFromTravelIntent({
      source: 'travel',
      dealId: 'DEAL-77',
      customerName: 'عميل الرياض',
      employeeId: 'e5',
      description: 'مشكلة في رحلة',
    });
    assert.deepEqual(p, {
      customerName: 'عميل الرياض',
      dealId: 'DEAL-77',
      employeeId: 'e5',
      description: 'مشكلة في رحلة',
    });
  });

  it('5. Complaint pre-fill: non-travel sources yield empty (scope-locked intent)', () => {
    assert.deepEqual(complaintPrefillFromTravelIntent({ source: 'complaint' }), {
      customerName: '', dealId: '', employeeId: '', description: '',
    });
    assert.deepEqual(complaintPrefillFromTravelIntent(null), {
      customerName: '', dealId: '', employeeId: '', description: '',
    });
  });
});

describe('Sidebar pinned preference (§3 — sanitizer)', () => {
  it('6. boolean pinOpen survives the whitelist; non-boolean is dropped', () => {
    const ok = sanitizeUserPreferencesInput({ sidebar: { pinOpen: true } });
    assert.ok(ok);
    assert.equal(ok.sidebar?.pinOpen, true);

    const junk = sanitizeUserPreferencesInput({ sidebar: { pinOpen: 'yes' } });
    assert.ok(junk);
    assert.equal(junk.sidebar, undefined);
  });

  it('7. order + pinOpen persist together in one sidebar dict', () => {
    const both = sanitizeUserPreferencesInput({
      sidebar: { order: ['home', 'capa'], pinOpen: false },
    });
    assert.ok(both);
    assert.deepEqual(both.sidebar?.order, ['home', 'capa']);
    assert.equal(both.sidebar?.pinOpen, false);
  });
});
