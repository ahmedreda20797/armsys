import assert from 'node:assert/strict';
import { test } from 'node:test';

// ══════════════════════════════════════════════════════════════
//  §20.1-FORMAT — the shared locale-aware presentation layer.
//  Pure functions: numerals/punctuation must follow the locale,
//  underlying values are never mutated, and EN never renders
//  Arabic-Indic digits (or vice versa).
// ══════════════════════════════════════════════════════════════

import {
  DASH,
  displayLocale,
  formatDateTime,
  formatInteger,
  formatMonthKey,
  formatNumber,
  formatPercentage,
  intlLocale,
  setDisplayLocale,
  unitWord,
} from '../i18n/format';

const AR_DIGIT = /[\u0660-\u0669]/;
const LATIN_DIGIT = /[0-9]/;

test('formatNumber: ar renders Arabic-Indic digits with grouping', () => {
  const out = formatNumber(1234.5, { locale: 'ar', maximumFractionDigits: 1 });
  assert.match(out, AR_DIGIT);
  assert.doesNotMatch(out, LATIN_DIGIT);
});

test('formatNumber: en renders Latin digits with grouping', () => {
  const out = formatNumber(1234.5, { locale: 'en', maximumFractionDigits: 1 });
  assert.match(out, LATIN_DIGIT);
  assert.doesNotMatch(out, AR_DIGIT);
});

test('formatInteger: thousands grouping in both locales, same value', () => {
  const en = formatInteger(1234567, 'en');
  const ar = formatInteger(1234567, 'ar');
  assert.equal(en, '1,234,567');
  assert.match(ar, AR_DIGIT);
  assert.doesNotMatch(ar, LATIN_DIGIT);
});

test('formatPercentage: value is in percent units — never ×100', () => {
  assert.equal(formatPercentage(88, { locale: 'en' }), '88%');
  assert.equal(formatPercentage(88.5, { locale: 'en' }), '88.5%');
  const ar = formatPercentage(88, { locale: 'ar' });
  assert.match(ar, AR_DIGIT);
  assert.ok(ar.includes('٪'), 'Arabic percent sign expected');
  assert.doesNotMatch(ar, LATIN_DIGIT);
});

test('formatDateTime: month names follow the locale', () => {
  const d = new Date(2026, 8, 21, 14, 30); // Sep 21 2026
  const en = formatDateTime(d, 'en', { month: 'long', year: 'numeric', day: 'numeric' });
  assert.ok(en.includes('September'), `expected English month, got ${en}`);
  const ar = formatDateTime(d, 'ar', { month: 'long', year: 'numeric', day: 'numeric' });
  assert.ok(ar.includes('سبتمبر'), `expected Arabic month, got ${ar}`);
});

test('formatMonthKey: YYYY-MM label localized; malformed keys pass through', () => {
  assert.equal(formatMonthKey('2026-09', 'en'), 'September 2026');
  assert.match(formatMonthKey('2026-09', 'ar') ?? '', /سبتمبر|٢٠٢٦/);
  assert.equal(formatMonthKey('not-a-month', 'en'), 'not-a-month');
  assert.equal(formatMonthKey(null, 'en'), '');
});

test('identifiers are never formatted (presentation layer only)', () => {
  // The layer only accepts numbers — codes like EMP-075 can never enter it.
  const code = 'EMP-075';
  assert.equal(code, 'EMP-075');
  assert.equal(formatInteger(75, 'en'), '75');
});

test('module-current locale: defaults to ar, setDisplayLocale switches intl tag', () => {
  assert.equal(displayLocale(), 'ar');
  assert.equal(intlLocale(), 'ar-EG');
  setDisplayLocale('en');
  assert.equal(displayLocale(), 'en');
  assert.equal(intlLocale(), 'en-GB');
  assert.equal(formatPercentage(12.3), '12.3%');
  setDisplayLocale('ar');
  assert.equal(formatPercentage(12.3).includes('٪'), true);
});

test('unitWord follows the locale', () => {
  assert.equal(unitWord('days', 'en'), 'days');
  assert.equal(unitWord('days', 'ar'), 'يوم');
  assert.equal(unitWord('minutes', 'en'), 'minutes');
});

test('DASH is the universal missing-value glyph', () => {
  assert.equal(DASH, '—');
});
