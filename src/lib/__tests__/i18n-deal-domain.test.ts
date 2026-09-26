// ══════════════════════════════════════════════════════════════
//  §35 LOCALIZATION — every new deal-domain UI string translates
//
//  The i18n boundary (§I18N-BOUNDARY): Arabic is the SOURCE language,
//  English renders through the en-map. Every NEW Arabic string
//  introduced by the deal-date / booking-item / employee-metrics work
//  must carry an EXACT English mapping — no Arabic-only UI, no
//  hardcoded English in components.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translateUIText } from '@/lib/i18n/ui-text';
import { DICTIONARY } from '@/lib/i18n/dictionary';
import type { Locale } from '@/lib/i18n/dictionary';

/** New application-owned strings (deal dates, date bases, bookings,
 *  reconciled employee metrics, filter labels, empty/validation states). */
const NEW_DEAL_DOMAIN_STRINGS: readonly string[] = [
  // Deal dates (تاريخ تقفيل الديل / تاريخ الاكتمال)
  'تاريخ تقفيل الديل',
  'تقفيل الديل:',
  'تقفيل الديل',
  'بتاريخ تقفيل غير معروف',
  'غير مسجل (صفقة قديمة)',
  'تاريخ الاكتمال',
  'الاكتمال:',
  'تاريخ الاكتمال غير معروف',
  'تاريخ الاكتمال غير معروف — سجل مكتمل أرشيفي (قبل التسجيل التلقائي)',
  'غير مكتمل — يُسجل تلقائياً من النظام عند الإكمال',
  'يُسجل تلقائياً من النظام عند الإكمال',
  // Filters (أساس التاريخ / الحالة)
  'أساس التاريخ',
  'الحالة: الكل',
  // Bookings (الخدمات والحجوزات)
  'الخدمات والحجوزات',
  'إضافة حجز',
  'إزالة الحجز',
  'لا حجوزات بعد — أضف أول حجز (نفس النوع يمكن تكراره)',
  'جولة',
  'قطار',
  // Employee metrics (§13.1)
  'الصفقات المغلقة',
  'الصفقات المكتملة',
  'إجمالي الصفقات المغلقة',
  'مغلقة خلال الفترة',
  'مكتملة خلال الفترة',
  'كل الفترات',
  'الجاري',
  'الملغي',
  'نسبة إكمال رحلات الفترة',
  'صفقة بتاريخ تقفيل غير معروف (أرشيفية) — لا تُنسب لأي شهر في مقاييس الفترة.',
  'صفقة مكتملة بتاريخ اكتمال غير معروف (أرشيفية) — لا تُنسب لأي شهر ولا تُحتسب في فترة التقرير.',
  'كل بعد زمني مستقل: التقفيل (dealClosedAt)، الاكتمال (closedAt)، الإنشاء (createdAt)، السفر (departureDate) — لا بُعد يعوّض آخر، والحالة الحالية مقياس منفصل.',
];

/** Pre-existing strings the feature REUSES (still pinned here so a
 *  dictionary refactor cannot silently break them). */
const REUSED_STRINGS: readonly string[] = [
  'طيران دولي', 'طيران داخلي', 'فندق', 'تأشيرة', 'مواصلات',
  'معلق', 'محجوز', 'غير موجود',
  'تعديل', 'جاري', 'مكتمل', 'ملغي',
  'تاريخ السفر', 'تاريخ العودة',
  'صفقات مغلقة', 'رحلات غادرت (تاريخ السفر)',
  'صفقات مُنشأة (تاريخ الإنشاء)',
];

describe('§35.51/52 — every deal-domain string has an exact EN mapping', () => {
  for (const raw of [...NEW_DEAL_DOMAIN_STRINGS, ...REUSED_STRINGS]) {
    it(`translates: ${raw.slice(0, 42)}…`, () => {
      const en = translateUIText(raw, 'en' as Locale);
      assert.notEqual(en, raw, `missing en-map entry for: ${raw}`);
      assert.equal(typeof en, 'string');
      assert.equal(en.length > 0, true);
    });
  }
  it('Arabic rendering is identity (the source language never changes)', () => {
    for (const raw of NEW_DEAL_DOMAIN_STRINGS) {
      assert.equal(translateUIText(raw, 'ar' as Locale), raw);
    }
  });
});

describe('§35.51/52 — dictionary keys for the Home card stay bilingual', () => {
  it('home.closedDeals keeps both locales ("الصفقات المغلقة" = Closed Deals)', () => {
    const key = DICTIONARY['home.closedDeals'];
    assert.ok(key, 'home.closedDeals missing from the dictionary');
    assert.match(key.ar, /صفقات مغلقة/);
    assert.match(key.en, /Closed Deals/);
  });
  it('home.closedUnknown keeps both locales (unknown-completion state)', () => {
    const key = DICTIONARY['home.closedUnknown'];
    assert.ok(key, 'home.closedUnknown missing from the dictionary');
    assert.ok(key.ar.length > 0 && key.en.length > 0);
  });
});

describe('§35.55 — business data is never translated (i18n boundary holds)', () => {
  it('the translator leaves user-generated text untouched', () => {
    // Free-text business values (names, destinations, notes) pass through.
    assert.equal(translateUIText('Ahmed Travels — شرم الشيخ', 'en' as Locale), 'Ahmed Travels — شرم الشيخ');
  });
});
