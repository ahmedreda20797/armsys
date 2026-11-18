// ══════════════════════════════════════════════════════════════
//  Dynamic Labels Coverage Test (§DYNAMIC-LABELS audit)
//
//  Verifies the canonical resolver chain and its consumers cover
//  known semantic status/category values. In English mode, known
//  Arabic semantic labels must resolve to English. Does NOT claim
//  complete localization — only validates the resolver's contract
//  and the presence of the legacy alias map.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveStoredLabel,
  resolveStoredLabelOrVerbatim,
  isKnownStoredLabel,
  LEGACY_VALUE_LABELS,
} from '@/lib/i18n/dynamic-labels';
import { presentSystemOrVerbatim } from '@/lib/i18n/presentation';
import { translateUIText } from '@/lib/i18n/ui-text';
import { presentStatus } from '@/lib/i18n/presentation';

describe('§DYNAMIC-LABELS — resolver contract & coverage', () => {
  // ─────────────────────────────────────────────────────────────
  //  1. Legacy alias map completeness (the known Arabic values
  //     from the delivery notes)
  // ─────────────────────────────────────────────────────────────
  it('1a · legacy alias map contains the documented Arabic values', () => {
    const required = [
      'تأخر متابعة',
      'مكتملة',
      'مفتوحة',
      'متأخرة',
      'أداء ممتاز',
    ];
    for (const key of required) {
      assert.ok(key in LEGACY_VALUE_LABELS, `LEGACY_VALUE_LABELS missing "${key}"`);
    }
  });

  it('1b · each required alias resolves to its English equivalent', () => {
    assert.equal(LEGACY_VALUE_LABELS['تأخر متابعة']?.[1], 'Follow-up Delay');
    assert.equal(LEGACY_VALUE_LABELS['مكتملة']?.[1], 'Completed');
    assert.equal(LEGACY_VALUE_LABELS['مفتوحة']?.[1], 'Open');
    assert.equal(LEGACY_VALUE_LABELS['متأخرة']?.[1], 'Overdue');
    assert.equal(LEGACY_VALUE_LABELS['أداء ممتاز']?.[1], 'Excellent Performance');
  });

  // ─────────────────────────────────────────────────────────────
  //  2. Resolver chain: system enum → legacy alias → null (business data)
  // ─────────────────────────────────────────────────────────────
  it('2a · resolveStoredLabel returns English for known system enum', () => {
    // 'open' is a system status enum; its English is 'Open'.
    assert.equal(resolveStoredLabel('open', 'en'), 'Open');
    assert.equal(resolveStoredLabel('open', 'ar'), 'مفتوحة');
  });

  it('2b · resolveStoredLabel returns English for legacy alias', () => {
    assert.equal(resolveStoredLabel('مكتملة', 'en'), 'Completed');
    assert.equal(resolveStoredLabel('مكتملة', 'ar'), 'مكتملة');
  });

  it('2c · unknown business data returns null (never fabricated)', () => {
    const arbitrary = 'Some random customer name 123';
    assert.equal(resolveStoredLabel(arbitrary, 'en'), null);
    assert.equal(resolveStoredLabel(arbitrary, 'ar'), null);
  });

  it('2d · resolveStoredLabelOrVerbatim falls back to the raw value', () => {
    assert.equal(resolveStoredLabelOrVerbatim('مكتملة', 'en'), 'Completed');
    const arbitrary = 'Customer XYZ';
    assert.equal(resolveStoredLabelOrVerbatim(arbitrary, 'en'), arbitrary);
  });

  // ─────────────────────────────────────────────────────────────
  //  3. System enum + legacy alias coverage through presentation
  // ─────────────────────────────────────────────────────────────
  it('3a · presentSystemOrVerbatim localizes known statuses', () => {
    assert.equal(presentSystemOrVerbatim('open', 'ar'), 'مفتوحة');
    assert.equal(presentSystemOrVerbatim('open', 'en'), 'Open');
    // 'مكتملة' is a legacy alias; in EN it localizes to 'Completed'
    assert.equal(presentSystemOrVerbatim('مكتملة', 'en'), 'Completed');
  });

  it('3b · presentSystemOrVerbatim passes through business data', () => {
    const freeText = 'Any free text from user';
    assert.equal(presentSystemOrVerbatim(freeText, 'en'), freeText);
    assert.equal(presentSystemOrVerbatim(freeText, 'ar'), freeText);
  });

  // ─────────────────────────────────────────────────────────────
  //  4. UI text track (EN_MAP) covers legacy values
  // ─────────────────────────────────────────────────────────────
  it('4a · translateUIText localizes legacy Arabic in EN_MAP', () => {
    assert.equal(translateUIText('مكتملة', 'en'), 'Completed');
    assert.equal(translateUIText('مفتوحة', 'en'), 'Open');
    assert.equal(translateUIText('متأخرة', 'en'), 'Overdue');
  });

  it('4b · unknown text passes through verbatim in EN mode', () => {
    assert.equal(translateUIText('Unknown business text', 'en'), 'Unknown business text');
  });

  // ─────────────────────────────────────────────────────────────
  //  5. Present status / approval system vocabulary
  // ─────────────────────────────────────────────────────────────
  it('5a · presentStatus localizes approval statuses', () => {
    assert.equal(presentStatus('approved', 'ar'), 'معتمدة');
    assert.equal(presentStatus('approved', 'en'), 'Approved');
    assert.equal(presentStatus('pending', 'ar'), 'معلقة');
    assert.equal(presentStatus('pending', 'en'), 'Pending');
    assert.equal(presentStatus('rejected', 'ar'), 'مرفوضة');
    assert.equal(presentStatus('rejected', 'en'), 'Rejected');
  });

  // ─────────────────────────────────────────────────────────────
  //  6. isKnownStoredLabel predicate
  // ─────────────────────────────────────────────────────────────
  it('6a · isKnownStoredLabel is true for legacy aliases', () => {
    assert.ok(isKnownStoredLabel('مكتملة'));
    assert.ok(isKnownStoredLabel('مفتوحة'));
    assert.ok(isKnownStoredLabel('متأخرة'));
  });

  it('6b · isKnownStoredLabel is false for arbitrary text', () => {
    assert.ok(!isKnownStoredLabel('Random customer name'));
  });

  // ─────────────────────────────────────────────────────────────
  //  7. Resolution priority documented: system > legacy > null
  // ─────────────────────────────────────────────────────────────
  it('7 · system enum beats legacy alias (both exist, system wins)', () => {
    // 'open' is both a system status AND a legacy alias ('مفتوحة').
    // The system enum wins — resolveStoredLabel('open') should give 'Open'.
    assert.equal(resolveStoredLabel('open', 'en'), 'Open');
    // The legacy alias 'مفتوحة' also gives 'Open'.
    assert.equal(resolveStoredLabel('مفتوحة', 'en'), 'Open');
  });
});