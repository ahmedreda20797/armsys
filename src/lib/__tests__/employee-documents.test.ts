// ══════════════════════════════════════════════════════════════
//  Employee Documents — pure helper tests (Milestone 7 §17)
//
//  Run: npx tsx --test src/lib/__tests__/employee-documents.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DOCUMENT_TYPES,
  DOCUMENT_STATUS_LABELS,
  documentStatus,
  documentTypeLabel,
  isKnownDocumentType,
} from '@/lib/employee-documents';

describe('Employee Documents (§17 — metadata + derived status)', () => {
  it('1. open-ended document (no expiry) is PERMANENT, never expired', () => {
    assert.equal(documentStatus(null), 'permanent');
    assert.equal(documentStatus(undefined), 'permanent');
    assert.equal(documentStatus(null, '2026-09-05'), 'permanent');
  });

  it('2. expiry before today → expired; today and later → valid (deterministic day boundary)', () => {
    assert.equal(documentStatus('2026-09-04', '2026-09-05'), 'expired');
    assert.equal(documentStatus('2026-09-05', '2026-09-05'), 'valid');
    assert.equal(documentStatus('2027-01-01', '2026-09-05'), 'valid');
  });

  it('3. status labels exist for every status (UI never shows raw keys)', () => {
    for (const status of ['valid', 'expired', 'permanent'] as const) {
      assert.ok(DOCUMENT_STATUS_LABELS[status].length > 0);
    }
  });

  it('4. type vocabulary is closed — unknown types rejected, labels fall back', () => {
    assert.ok(isKnownDocumentType('identity'));
    assert.ok(isKnownDocumentType('contract'));
    assert.ok(!isKnownDocumentType('passport_of_doom'));
    assert.equal(documentTypeLabel('identity'), 'هوية / بطاقة');
    assert.equal(documentTypeLabel('unknown_x'), 'unknown_x');
  });

  it('5. every vocabulary entry has a non-empty label', () => {
    assert.ok(DOCUMENT_TYPES.length >= 4);
    for (const t of DOCUMENT_TYPES) assert.ok(t.label.length > 0);
  });
});
