// ══════════════════════════════════════════════════════════════
//  §PRESENTATION-BOUNDARY — canonical presentation resolver tests.
//
//  Verifies the global UI contract: internal keys → localized human
//  labels; unknown system keys → safe generic fallbacks (never the
//  raw key); record-ID-shaped values are detected and never displayed;
//  user-generated business data passes through UNCHANGED; internal ids
//  remain intact for navigation (this module never touches them).
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSystemLabel,
  presentEntity,
  presentStatus,
  presentRule,
  presentSystemOrVerbatim,
  presentRecordTitle,
  isRecordIdLike,
  safeDisplayText,
  DOMAIN_ENTITY_LABELS,
  STATUS_LABELS,
} from '@/lib/i18n/presentation';

// ── 1) Domain entity resolution (§40.1–40.5) ────────────────────

describe('presentEntity — collection/domain keys', () => {
  it('resolves the confirmed leak examples to Arabic business labels', () => {
    assert.equal(presentEntity('qualityObservations', 'ar'), 'ملاحظات الجودة');
    assert.equal(presentEntity('qualityDeductions', 'ar'), 'خصومات الجودة');
    assert.equal(presentEntity('followUps', 'ar'), 'المتابعات');
    assert.equal(presentEntity('travelDeals', 'ar'), 'صفقات السفر');
    assert.equal(presentEntity('monthSnapshots', 'ar'), 'لقطات الشهر');
    assert.equal(presentEntity('kpiSchemes', 'ar'), 'مخططات KPI');
  });

  it('resolves the same keys in English', () => {
    assert.equal(presentEntity('qualityObservations', 'en'), 'Quality Observations');
    assert.equal(presentEntity('travelDeals', 'en'), 'Travel Deals');
    assert.equal(presentEntity('followUps', 'en'), 'Follow-ups');
    assert.equal(presentEntity('monthSnapshots', 'en'), 'Monthly Snapshots');
    assert.equal(presentEntity('kpiSchemes', 'en'), 'KPI Schemes');
  });

  it('never returns a raw collection name for unknown keys', () => {
    const out = presentEntity('someUnknownCollection', 'ar');
    assert.equal(out, 'سجل نظام');
    assert.equal(presentEntity('someUnknownCollection', 'en'), 'System record');
    assert.match(out, /^[^A-Za-z]*[^\x00-\x7F][^A-Za-z]*$/); // no Latin technical token
  });
});

// ── 2) Status/enum resolution (§40.6–40.8) ──────────────────────

describe('presentStatus — enum keys', () => {
  it('resolves lifecycle statuses', () => {
    assert.equal(presentStatus('completed', 'ar'), 'مكتملة');
    assert.equal(presentStatus('cancelled', 'ar'), 'ملغاة');
    assert.equal(presentStatus('canceled', 'ar'), 'ملغاة'); // legacy alias
    assert.equal(presentStatus('pending', 'ar'), 'معلقة');
    assert.equal(presentStatus('under_investigation', 'ar'), 'قيد التحقيق');
  });

  it('resolves severities and priorities in both cases', () => {
    assert.equal(presentStatus('high', 'ar'), 'عالية');
    assert.equal(presentStatus('HIGH', 'ar'), 'عالية'); // hr-decision emits uppercase
    assert.equal(presentStatus('critical', 'ar'), 'حرجة');
  });

  it('resolves engine verdicts that must never surface raw', () => {
    assert.equal(presentStatus('INCOMPLETE', 'ar'), 'غير مكتمل');
    assert.equal(presentStatus('NO_SCHEME', 'ar'), 'لا يوجد مخطط KPI');
    assert.equal(presentStatus('NOT_ELIGIBLE_PERIOD', 'ar'), 'غير مؤهل للفترة');
  });

  it('falls back to a safe generic label for unknown keys', () => {
    assert.equal(presentStatus('totally_unknown_key', 'ar'), 'غير محدد');
    assert.equal(presentStatus('totally_unknown_key', 'en'), 'Unspecified');
  });

  it('supports a domain-specific overriding vocabulary', () => {
    const vocab = { pending: ['بانتظار الاعتماد', 'Awaiting approval'] } as const;
    assert.equal(presentStatus('pending', 'ar', vocab), 'بانتظار الاعتماد');
    // falls through to the shared vocabulary for unlisted keys
    assert.equal(presentStatus('approved', 'ar', vocab), 'معتمدة');
  });
});

// ── 3) Rule / engine identifier resolution (§40.20) ─────────────

describe('presentRule — rule ids', () => {
  it('resolves known decision-rule ids', () => {
    assert.equal(presentRule('KPI_BELOW_CONFIGURED_TARGET', 'ar'), 'نتيجة دون المستهدف المُهيّأ');
    assert.equal(presentRule('QUALITY_REPEATED_ISSUE_RECURRENCE', 'ar'), 'تكرار مشكلات الجودة');
    assert.equal(presentRule('ATTENDANCE_DATA_UNAVAILABLE', 'ar'), 'بيانات الحضور غير متاحة');
    assert.equal(presentRule('kpi_engine.mom_delta_direction', 'ar'), 'اتجاه التغير الشهري لمؤشر KPI');
  });

  it('never renders an unknown rule id raw', () => {
    assert.equal(presentRule('some_rule.not_mapped_42', 'ar'), 'قاعدة نظام');
    assert.equal(presentRule('some_rule.not_mapped_42', 'en'), 'System rule');
  });
});

// ── 4) Record-ID detection & safe display (§40.9–40.10) ─────────

describe('isRecordIdLike — record-id shape detection', () => {
  it('detects Firebase push IDs', () => {
    assert.equal(isRecordIdLike('o0gsticpahpxowlmsmlmg85s'), true);
    assert.equal(isRecordIdLike('hwsiq0b1z7a2eydhahwzarwh'), true);
    assert.equal(isRecordIdLike('-NxT9cZk2pQwErTyUiOp'), true);
  });

  it('rejects human business text and short codes', () => {
    assert.equal(isRecordIdLike('محمد أحمد'), false);
    assert.equal(isRecordIdLike('Quality issue: late delivery'), false);
    assert.equal(isRecordIdLike('EMP-2043'), false);
    assert.equal(isRecordIdLike('CAPA-2025-001'), false);
    assert.equal(isRecordIdLike(''), false);
    assert.equal(isRecordIdLike(null), false);
  });
});

describe('safeDisplayText', () => {
  it('passes business text through untouched', () => {
    assert.equal(safeDisplayText('محمد أحمد', 'بدون اسم'), 'محمد أحمد');
    assert.equal(safeDisplayText('CAPA-2025-001', 'بدون اسم'), 'CAPA-2025-001');
  });

  it('collapses empty and record-ID-shaped values to the fallback', () => {
    assert.equal(safeDisplayText('', 'بدون اسم'), 'بدون اسم');
    assert.equal(safeDisplayText(null, 'بدون اسم'), 'بدون اسم');
    assert.equal(safeDisplayText('hwsiq0b1z7a2eydhahwzarwh', 'بدون اسم'), 'بدون اسم');
  });
});

// ── 5) Resolve-or-verbatim (§34 — no generic auto-translation) ──

describe('presentSystemOrVerbatim', () => {
  it('translates known system keys', () => {
    assert.equal(presentSystemOrVerbatim('service_quality', 'ar'), 'جودة الخدمة');
    assert.equal(presentSystemOrVerbatim('quality_observation', 'ar'), 'ملاحظة جودة');
  });

  it('preserves user-generated / legacy stored text unchanged', () => {
    assert.equal(presentSystemOrVerbatim('تأخير في تسليم التقرير الشهري', 'ar'), 'تأخير في تسليم التقرير الشهري');
    assert.equal(presentSystemOrVerbatim('Custom legacy text', 'ar'), 'Custom legacy text');
  });

  it('never displays a record-id-shaped value', () => {
    assert.equal(presentSystemOrVerbatim('o0gsticpahpxowlmsmlmg85s', 'ar'), 'سجل بدون اسم');
  });
});

// ── 6) Record title projection (§8 — human representation) ──────

describe('presentRecordTitle', () => {
  it('prefers the human-readable deal name', () => {
    const deal = { id: 'hwsiq0b1z7a2eydhahwzarwh', destination: 'القاهرة', dealerName: 'شركة النيل للسياحة' };
    const title = presentRecordTitle('travelDeals', deal, 'ar');
    assert.match(title, /شركة النيل للسياحة/); // first canonical business field wins
    assert.doesNotMatch(title, /hwsiq0b1z7a2eydhahwzarwh/);
    const byDestination = presentRecordTitle('travelDeals', { id: 'x'.repeat(25), destination: 'القاهرة' }, 'ar');
    assert.match(byDestination, /القاهرة/);
  });

  it('falls back to an entity-aware unnamed label, never the raw id', () => {
    const title = presentRecordTitle('travelDeals', { id: 'hwsiq0b1z7a2eydhahwzarwh' }, 'ar');
    assert.equal(title, 'صفقات السفر بدون اسم');
    assert.doesNotMatch(title, /hwsiq0b1z7a2eydhahwzarwh/);
    const en = presentRecordTitle('travelDeals', { id: 'hwsiq0b1z7a2eydhahwzarwh' }, 'en');
    assert.equal(en, 'Travel Deals without a name');
  });

  it('uses the record name alone for person entities', () => {
    assert.equal(presentRecordTitle('employees', { id: 'abc123def456ghi789jk', name: 'سارة' }, 'ar'), 'سارة');
  });

  it('handles non-object records safely', () => {
    assert.equal(presentRecordTitle('followUps', null, 'ar'), 'المتابعات بدون اسم');
  });
});

// ── 7) Internal identifiers stay internal (§5/§40.15–40.19) ─────

describe('presentation boundary does not touch internal ids', () => {
  it('resolver functions never mutate or hide the raw key for internal use', () => {
    // The raw key remains available to the caller for navigation/API.
    const key = 'travelDeals';
    presentEntity(key, 'ar');
    assert.equal(key, 'travelDeals');
  });

  it('the internal ids of domain records are never consumed as labels', () => {
    const record = { id: '-NxT9cZk2pQwErTyUiOp', employeeName: 'أحمد' };
    assert.equal(presentRecordTitle('qualityObservations', record, 'ar'), 'ملاحظات الجودة — أحمد');
    assert.equal(record.id, '-NxT9cZk2pQwErTyUiOp'); // untouched
  });
});

// ── 8) Vocabulary sanity — no empty/placeholder entries ─────────

describe('canonical vocabulary sanity', () => {
  it('every entity label has both Arabic and English', () => {
    for (const [key, pair] of Object.entries(DOMAIN_ENTITY_LABELS)) {
      assert.ok(pair[0].trim().length > 0, `entity ${key} missing Arabic`);
      assert.ok(pair[1].trim().length > 0, `entity ${key} missing English`);
    }
  });

  it('every status label has both Arabic and English', () => {
    for (const [key, pair] of Object.entries(STATUS_LABELS)) {
      assert.ok(pair[0].trim().length > 0, `status ${key} missing Arabic`);
      assert.ok(pair[1].trim().length > 0, `status ${key} missing English`);
    }
  });

  it('resolves the spec examples in English as well', () => {
    assert.equal(resolveSystemLabel('completed', 'en'), 'Completed');
    assert.equal(resolveSystemLabel('cancelled', 'en'), 'Cancelled');
    assert.equal(resolveSystemLabel('pending', 'en'), 'Pending');
  });
});
