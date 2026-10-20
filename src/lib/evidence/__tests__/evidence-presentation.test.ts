// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-PRESENTATION — multi-item evidence display/copy/print
//  regression suite.
//
//  The regression being eliminated: after the Evidence → Evidence
//  Collection migration, several consumers kept reading the legacy
//  single-value projection (= the FIRST evidence item) and silently
//  dropped every other item. These tests pin the canonical rule:
//
//     Evidence Collection = ALL valid evidence items
//
//  against the ONE shared presentation resolver every surface
//  consumes (report display, copy buttons, print text, evidence
//  preview projection). Route-level image authorization (401/404)
//  stays covered by evidence-routes.test.ts.
//
//  Pure imports only — no db, no HTTP, no Firebase.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildFinalStoragePath, normalizeEvidenceItems } from '@/lib/evidence-items';
import {
  evidenceImageLabel,
  evidenceLineValue,
  formatEvidenceItemsAsText,
  formatEvidenceItemsForCopy,
  resolveEvidenceLines,
} from '@/lib/evidence/presentation';
import { projectEvidenceRecord } from '@/lib/evidence/record-projection';
import type { EvidenceItem } from '@/types';

// ── Fixtures ─────────────────────────────────────────────────

const imgPath = (table: string, recordId: string, itemId: string) =>
  buildFinalStoragePath(table, recordId, itemId);

/** The task's canonical 6-item collection: 1 link, 1 number, 2 images, 2 links — stored order. */
function sixItemCollection(): EvidenceItem[] {
  return [
    { id: 'ev-a', type: 'link', url: 'https://example.com/customer-chat' },
    { id: 'ev-b', type: 'number', number: '12345' },
    { id: 'ev-c', type: 'image', image: { storagePath: imgPath('qualityDeductions', 'q9', 'ev-c'), fileName: 'chat.webp', mimeType: 'image/webp', size: 1024, width: 800, height: 600 } },
    { id: 'ev-d', type: 'image', image: { storagePath: imgPath('qualityDeductions', 'q9', 'ev-d'), fileName: 'receipt.webp', mimeType: 'image/webp', size: 2048, width: 900, height: 700 } },
    { id: 'ev-e', type: 'link', url: 'https://example.com/booking-ref' },
    { id: 'ev-f', type: 'link', url: 'https://example.com/voucher' },
  ];
}

// ── resolveEvidenceLines — ALL items, order, hrefs ────────────

describe('evidence presentation — ALL items render (never evidence[0])', () => {
  it('a 6-item collection (link/number/image/image/link/link) yields exactly 6 lines in stored order', () => {
    const lines = resolveEvidenceLines(sixItemCollection());
    assert.equal(lines.length, 6);
    assert.deepEqual(
      lines.map((l) => l.type),
      ['link', 'number', 'image', 'image', 'link', 'link'],
    );
    assert.deepEqual(
      lines.map((l) => l.text),
      [
        'https://example.com/customer-chat',
        '12345',
        'صورة دليل 1',
        'صورة دليل 2',
        'https://example.com/booking-ref',
        'https://example.com/voucher',
      ],
    );
  });

  it('positions are 1..n with no gaps (items keep their identity)', () => {
    const lines = resolveEvidenceLines(sixItemCollection());
    assert.deepEqual(lines.map((l) => l.position), [1, 2, 3, 4, 5, 6]);
  });

  it('LINK → clickable href carries the exact stored URL', () => {
    const lines = resolveEvidenceLines([{ id: 'l', type: 'link', url: 'https://example.com/a?x=1' }]);
    assert.equal(lines[0].href, 'https://example.com/a?x=1');
    assert.equal(lines[0].image, false);
  });

  it('NUMBER → plain text, never a URL (leading zeros preserved verbatim)', () => {
    const lines = resolveEvidenceLines([{ id: 'n', type: 'number', number: '00789' }]);
    assert.equal(lines[0].text, '00789');
    assert.equal(lines[0].href, null);
    assert.equal(lines[0].image, false);
  });

  it('IMAGE → compact label + AUTHORIZED image route URL (never a Storage internal)', () => {
    const path = imgPath('qualityDeductions', 'q9', 'ev-c');
    const lines = resolveEvidenceLines([{ id: 'ev-c', type: 'image', image: { storagePath: path, fileName: 'chat.webp', mimeType: 'image/webp', size: 1024 } }]);
    assert.equal(lines[0].image, true);
    assert.equal(lines[0].text, 'صورة دليل'); // single image → unnumbered
    assert.equal(lines[0].href, `/api/evidence/image/${path}`);
    assert.ok(!lines[0].href!.includes('firebasestorage'));
    assert.ok(!lines[0].href!.includes('gs://'));
  });

  it('multiple images number their labels; a single image does not', () => {
    assert.equal(evidenceImageLabel(1, 2), 'صورة دليل 1');
    assert.equal(evidenceImageLabel(2, 2), 'صورة دليل 2');
    assert.equal(evidenceImageLabel(1, 1), 'صورة دليل');
  });

  it('baseUrl prefixes the authorized image URL (copy/print that leaves the app)', () => {
    const path = imgPath('qualityDeductions', 'q9', 'ev-c');
    const lines = resolveEvidenceLines(
      [{ id: 'ev-c', type: 'image', image: { storagePath: path, fileName: 'chat.webp', mimeType: 'image/webp', size: 1024 } }],
      { baseUrl: 'https://qnalys.app/' },
    );
    assert.equal(lines[0].href, `https://qnalys.app/api/evidence/image/${path}`);
  });

  it('legacy TEXT renders verbatim as plain text', () => {
    const lines = resolveEvidenceLines([{ id: 't', type: 'text', text: 'مراسلة العميل' }]);
    assert.equal(lines[0].text, 'مراسلة العميل');
    assert.equal(lines[0].href, null);
  });
});

// ── Malformed items never hide the valid ones ────────────────

describe('evidence presentation — malformed items degrade safely', () => {
  it('a malformed item (bad storage path / unsafe scheme / empty value) never hides the remaining valid items', () => {
    const lines = resolveEvidenceLines([
      { id: 'bad-img', type: 'image', image: { storagePath: '../outside/evil.webp', fileName: 'evil.webp', mimeType: 'image/webp', size: 1 } },
      { id: 'bad-link', type: 'link', url: 'javascript:alert(1)' },
      { id: 'empty-number', type: 'number', number: '   ' },
      { id: 'good-link', type: 'link', url: 'https://example.com/ok' },
      { id: 'good-number', type: 'number', number: '67890' },
    ]);
    // valid items survive, invalid ones degrade without hiding them
    assert.deepEqual(lines.map((l) => l.text), [
      'صورة دليل', // malformed storage path → label only, NO href
      'javascript:alert(1)', // unsafe scheme → never openable, still visible
      'https://example.com/ok',
      '67890',
    ]);
    assert.equal(lines[0].href, null);
    assert.equal(lines[1].href, null);
    assert.equal(lines[2].href, 'https://example.com/ok');
  });

  it('empty evidence resolves to zero lines', () => {
    assert.deepEqual(resolveEvidenceLines([]), []);
    assert.equal(formatEvidenceItemsAsText([]), '');
    assert.equal(formatEvidenceItemsForCopy([]), '');
  });

  it('one evidence item resolves to a single line', () => {
    const lines = resolveEvidenceLines([{ id: 'only', type: 'number', number: '1' }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, '1');
  });
});

// ── Legacy compatibility through the read adapter ────────────

describe('evidence presentation — legacy adapter + no duplication', () => {
  it('legacy single-value evidence (url) adapts into ONE link item', () => {
    const items = normalizeEvidenceItems({ evidence: 'https://example.com/legacy' }, 'nullable-string');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'link');
    assert.equal(resolveEvidenceLines(items)[0].href, 'https://example.com/legacy');
  });

  it('legacy single-value evidence (text) adapts into ONE text item', () => {
    const items = normalizeEvidenceItems({ evidence: 'محادثة واتساب' }, 'required-string');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'text');
  });

  it('legacy follow-up attachments each become their own item', () => {
    const items = normalizeEvidenceItems(
      { evidence: null, attachments: ['https://example.com/a', 'https://example.com/b'] },
      'followup',
    );
    assert.equal(items.length, 2);
    assert.equal(items[1].type, 'link');
  });

  it('the NEW collection is authoritative — legacy + new together never duplicate', () => {
    const record = {
      evidence: 'https://example.com/legacy-projected', // write-path projection
      evidenceItems: sixItemCollection(),
    };
    const items = normalizeEvidenceItems(record, 'nullable-string');
    assert.equal(items.length, 6); // NOT 7 — legacy field ignored once the collection exists
    assert.ok(!items.some((i) => i.url === 'https://example.com/legacy-projected'));
  });
});

// ── Copy / print text projections ─────────────────────────────

describe('evidence presentation — copy and print text carry ALL items', () => {
  it('copy text numbers every item in order (links, numbers, image authorized URLs)', () => {
    const text = formatEvidenceItemsForCopy(sixItemCollection(), {
      baseUrl: 'https://qnalys.app',
      locale: 'en',
    });
    const lines = text.split('\n');
    assert.equal(lines[0], 'Evidence:');
    assert.equal(lines.length, 7); // header + 6 items
    assert.equal(lines[1], '1. https://example.com/customer-chat');
    assert.equal(lines[2], '2. 12345');
    assert.equal(lines[3], `3. Image evidence 1: https://qnalys.app/api/evidence/image/${imgPath('qualityDeductions', 'q9', 'ev-c')}`);
    assert.equal(lines[4], `4. Image evidence 2: https://qnalys.app/api/evidence/image/${imgPath('qualityDeductions', 'q9', 'ev-d')}`);
    assert.equal(lines[5], '5. https://example.com/booking-ref');
    assert.equal(lines[6], '6. https://example.com/voucher');
  });

  it('print/report text numbers every item without a header', () => {
    const text = formatEvidenceItemsAsText(sixItemCollection());
    const lines = text.split('\n');
    assert.equal(lines.length, 6);
    assert.match(lines[0], /^1\. https:\/\/example\.com\/customer-chat$/);
    assert.match(lines[2], /^3\. صورة دليل 1: \/api\/evidence\/image\//);
    assert.match(lines[5], /^6\. https:\/\/example\.com\/voucher$/);
  });

  it('image line value keeps a meaningful label even without an authorized URL', () => {
    const line = resolveEvidenceLines([
      { id: 'bad-img', type: 'image', image: { storagePath: 'garbage', fileName: 'x.webp', mimeType: 'image/webp', size: 1 } },
    ])[0];
    assert.equal(evidenceLineValue(line), 'صورة دليل'); // label, never a crash, never dropped
  });
});

// ── Evidence preview projection (Smart Quality Report modal) ──

describe('evidence presentation — record projection exposes every item', () => {
  it('a quality deduction with a 6-item collection projects 6 evidence fields in order', () => {
    const projected = projectEvidenceRecord('qualityDeductions', {
      id: 'q9',
      date: '2026-08-05',
      employeeName: 'أحمد',
      type: 'booking_error',
      description: 'خطأ حجز',
      evidenceItems: sixItemCollection(),
    });
    assert.ok(projected);
    const evidenceFields = projected!.fields.filter((f) => f.label.startsWith('دليل '));
    assert.equal(evidenceFields.length, 6);
    assert.equal(evidenceFields[0].value, 'https://example.com/customer-chat');
    assert.equal(evidenceFields[0].href, 'https://example.com/customer-chat');
    assert.equal(evidenceFields[1].value, '12345');
    assert.ok(evidenceFields[2].value.startsWith('صورة دليل 1: /api/evidence/image/'));
    assert.ok(evidenceFields[2].href!.startsWith('/api/evidence/image/'));
    assert.equal(evidenceFields[5].value, 'https://example.com/voucher');
  });

  it('records without evidence project no evidence fields (nothing invented)', () => {
    const projected = projectEvidenceRecord('qualityDeductions', { id: 'q10', date: '2026-08-05' });
    assert.equal(projected!.fields.filter((f) => f.label.startsWith('دليل ')).length, 0);
  });
});
