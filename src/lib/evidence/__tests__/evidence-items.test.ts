// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-ITEMS — pure model tests (sanitize / adapter /
//  projection / storage-path grammar / attachable-image guard)
//
//  Pure imports only — no db, no HTTP, no Firebase.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFinalStoragePath,
  buildPendingStoragePath,
  MAX_EVIDENCE_ITEMS,
  assertAttachableEvidenceImages,
  isCompleteEvidenceItem,
  newEvidenceItemId,
  normalizeCapaEvidenceItems,
  normalizeEvidenceItems,
  parseEvidenceStoragePath,
  projectLegacyEvidenceFields,
  sanitizeEvidenceItems,
  stampEvidenceItems,
  withFinalStoragePaths,
} from '@/lib/evidence-items';

const PENDING_PATH = buildPendingStoragePath('upload-1');
const FINAL_PATH = buildFinalStoragePath('qualityObservations', 'rec-1', 'item-1');

function linkItem(id = 'l1', url = 'https://example.com/deal') {
  return { id, type: 'link' as const, url };
}

describe('parseEvidenceStoragePath', () => {
  it('accepts a pending path', () => {
    assert.deepEqual(parseEvidenceStoragePath('evidence/pending/abc123.webp'), {
      kind: 'pending',
      uploadId: 'abc123',
    });
  });

  it('accepts a final parent-bound path', () => {
    assert.deepEqual(parseEvidenceStoragePath('evidence/followUps/rec-1/ev-1.webp'), {
      kind: 'final',
      table: 'followUps',
      recordId: 'rec-1',
      fileName: 'ev-1.webp',
    });
  });

  it('rejects traversal, wrong root, wrong extension and segment games', () => {
    assert.equal(parseEvidenceStoragePath('evidence/../../secret.webp'), null);
    assert.equal(parseEvidenceStoragePath('other/pending/abc.webp'), null);
    assert.equal(parseEvidenceStoragePath('evidence/pending/abc.png'), null);
    assert.equal(parseEvidenceStoragePath('evidence/pending/a/b.webp'), null);
    assert.equal(parseEvidenceStoragePath('evidence/followUps/rec-1.webp'), null);
    assert.equal(parseEvidenceStoragePath('evidence/followUps/rec-1/extra/ev-1.webp'), null);
    assert.equal(parseEvidenceStoragePath(''), null);
  });
});

describe('sanitizeEvidenceItems (server-authoritative §20)', () => {
  it('accepts a valid mixed collection and preserves exact values', () => {
    const result = sanitizeEvidenceItems([
      { id: 'l1', type: 'link', url: 'https://Example.com/Path?x=1' },
      { id: 'n1', type: 'number', number: '00045821' },
      { id: 'i1', type: 'image', image: { storagePath: PENDING_PATH, fileName: 'shot.png', mimeType: 'image/webp', size: 1234, width: 800, height: 600 } },
      { id: 't1', type: 'text', text: 'محضر اجتماع رقم 12' },
    ]);
    assert.ok(result.ok);
    assert.equal(result.items.length, 4);
    // Link value preserved EXACTLY (no canonicalization) — §5.
    assert.equal(result.items[0].url, 'https://Example.com/Path?x=1');
    // Leading zeros preserved as a string — §6.
    assert.equal(result.items[1].number, '00045821');
    assert.equal(result.items[2].image?.storagePath, PENDING_PATH);
    assert.equal(result.items[3].text, 'محضر اجتماع رقم 12');
  });

  it('rejects a non-array, oversized collection, duplicate ids and unknown types', () => {
    assert.ok(!sanitizeEvidenceItems('nope').ok);
    const many = Array.from({ length: MAX_EVIDENCE_ITEMS + 1 }, (_, i) => linkItem(`id-${i}`));
    assert.ok(!sanitizeEvidenceItems(many).ok);
    assert.ok(!sanitizeEvidenceItems([linkItem('a'), linkItem('a')]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'a', type: 'video' }]).ok);
  });

  it('rejects unsafe or oversized link URLs', () => {
    assert.ok(!sanitizeEvidenceItems([{ id: 'l', type: 'link', url: 'javascript:alert(1)' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'l', type: 'link', url: 'ftp://example.com/x' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'l', type: 'link', url: 'not a url' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'l', type: 'link', url: '' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'l', type: 'link', url: `https://example.com/${'x'.repeat(2100)}` }]).ok);
  });

  it('rejects an oversized or multi-line number, and an empty number', () => {
    assert.ok(!sanitizeEvidenceItems([{ id: 'n', type: 'number', number: '' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'n', type: 'number', number: 'x'.repeat(65) }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'n', type: 'number', number: '12\n34' }]).ok);
  });

  it('rejects bad image metadata (traversal, wrong mime, bad size)', () => {
    assert.ok(!sanitizeEvidenceItems([{ id: 'i', type: 'image' }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'i', type: 'image', image: { storagePath: 'evidence/../../etc/passwd', fileName: 'x.webp', mimeType: 'image/webp', size: 10 } }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'i', type: 'image', image: { storagePath: PENDING_PATH, fileName: 'x.webp', mimeType: 'image/png', size: 10 } }]).ok);
    assert.ok(!sanitizeEvidenceItems([{ id: 'i', type: 'image', image: { storagePath: PENDING_PATH, fileName: 'x.webp', mimeType: 'image/webp', size: -1 } }]).ok);
  });

  it('strips client-forged provenance then stampEvidenceItems stamps actor identity', () => {
    const result = sanitizeEvidenceItems([
      { id: 'l1', type: 'link', url: 'https://example.com', createdAt: '2026-01-01T00:00:00Z', createdBy: 'forged' },
    ]);
    assert.ok(result.ok);
    assert.equal(result.items[0].createdAt, '2026-01-01T00:00:00Z');
    assert.equal(result.items[0].createdBy, null);
    const stamped = stampEvidenceItems(result.items, '2026-10-18T00:00:00Z', 'user-9');
    assert.equal(stamped[0].createdBy, 'user-9');
  });
});

describe('normalizeEvidenceItems (read-time legacy adapter §17)', () => {
  it('stored evidenceItems win and invalid rows are dropped', () => {
    const items = normalizeEvidenceItems(
      {
        evidenceItems: [
          linkItem('l1'),
          { id: 'bad', type: 'nope' },
          { id: 'n1', type: 'number', number: '0007' },
        ] as unknown as Parameters<typeof normalizeEvidenceItems>[0]['evidenceItems'],
        evidence: 'https://old.example.com',
      },
      'nullable-string',
    );
    assert.equal(items.length, 2);
    assert.equal(items[0].id, 'l1');
    assert.equal(items[1].number, '0007');
  });

  it('a legacy URL evidence string becomes exactly ONE link item', () => {
    const items = normalizeEvidenceItems({ evidence: 'https://drive.example.com/file/1' }, 'required-string');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'link');
    assert.equal(items[0].url, 'https://drive.example.com/file/1');
  });

  it('legacy free-text is preserved VERBATIM as a text item — never re-guessed', () => {
    const raw = 'الدليل مذكور في المحضر؛ الرابط: example.com و 123456';
    const items = normalizeEvidenceItems({ evidence: raw }, 'required-string');
    assert.equal(items.length, 1);
    assert.equal(items[0].type, 'text');
    assert.equal(items[0].text, raw);
  });

  it('followup legacy attachments each become their own item', () => {
    const items = normalizeEvidenceItems(
      { evidence: 'https://evidence.example/a', attachments: ['https://att.example/1', 'not-a-url'] },
      'followup',
    );
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((i) => i.id), ['legacy-evidence', 'legacy-att-1', 'legacy-att-2']);
    assert.equal(items[1].type, 'link');
    assert.equal(items[2].type, 'text');
    assert.equal(items[2].text, 'not-a-url');
  });

  it('an empty legacy record yields an empty collection', () => {
    assert.deepEqual(normalizeEvidenceItems({}, 'nullable-string'), []);
  });
});

describe('normalizeCapaEvidenceItems', () => {
  it('legacy correctiveEvidence text + structured attachments become items', () => {
    const items = normalizeCapaEvidenceItems({
      correctiveEvidence: 'تم إعداد تقرير الفحص',
      attachments: [{ url: 'https://att.example/report', name: 'report.pdf' }, { name: 'no-url' }],
    });
    assert.equal(items.length, 2);
    assert.equal(items[0].type, 'text');
    assert.equal(items[1].type, 'link');
    assert.equal(items[1].url, 'https://att.example/report');
  });
});

describe('projectLegacyEvidenceFields (write-time projection)', () => {
  const items = [
    linkItem('l1', 'https://first.example'),
    linkItem('l2', 'https://second.example'),
    { id: 'n1', type: 'number' as const, number: '0007' },
  ];

  it('required-string modules always get a string', () => {
    const out = projectLegacyEvidenceFields(items, 'required-string');
    assert.equal(out.evidence, 'https://first.example');
    const empty = projectLegacyEvidenceFields([], 'required-string');
    assert.equal(empty.evidence, '');
  });

  it('followup projects evidence + the link url list onto attachments', () => {
    const out = projectLegacyEvidenceFields(items, 'followup');
    assert.equal(out.evidence, 'https://first.example');
    assert.deepEqual(out.attachments, ['https://first.example', 'https://second.example']);
  });
});

describe('assertAttachableEvidenceImages (§13 anti-attachment guard)', () => {
  it('allows pending paths and final paths already on the record', () => {
    const existing = [{ id: 'i0', type: 'image' as const, image: { storagePath: FINAL_PATH, fileName: 'x.webp', mimeType: 'image/webp', size: 10 } }];
    const incoming = [
      { id: 'i1', type: 'image' as const, image: { storagePath: PENDING_PATH, fileName: 'x.webp', mimeType: 'image/webp', size: 10 } },
      existing[0],
    ];
    assert.equal(assertAttachableEvidenceImages(incoming, existing), null);
  });

  it('rejects a final path belonging to ANOTHER record', () => {
    const incoming = [{ id: 'i1', type: 'image' as const, image: { storagePath: buildFinalStoragePath('complaints', 'other-record', 'x'), fileName: 'x.webp', mimeType: 'image/webp', size: 10 } }];
    const error = assertAttachableEvidenceImages(incoming, null);
    assert.ok(error);
    assert.match(error, /newly staged/);
  });
});

describe('withFinalStoragePaths + isCompleteEvidenceItem', () => {
  it('rewrites only PENDING image paths to the final parent-bound shape', () => {
    const items = [
      { id: 'i1', type: 'image' as const, image: { storagePath: PENDING_PATH, fileName: 'a.webp', mimeType: 'image/webp', size: 1 } },
      linkItem('l1'),
    ];
    const out = withFinalStoragePaths(items as never, 'qualityDeductions', 'rec-9');
    assert.equal(out[0].image?.storagePath, buildFinalStoragePath('qualityDeductions', 'rec-9', 'i1'));
    assert.equal(out[1].url, 'https://example.com/deal');
  });

  it('completeness: link needs a safe url, number needs a value, image needs a path', () => {
    assert.equal(isCompleteEvidenceItem(linkItem('l1')), true);
    assert.equal(isCompleteEvidenceItem({ id: 'l2', type: 'link', url: 'javascript:x' }), false);
    assert.equal(isCompleteEvidenceItem({ id: 'n1', type: 'number', number: '0007' }), true);
    assert.equal(isCompleteEvidenceItem({ id: 'n2', type: 'number', number: '' }), false);
    assert.equal(isCompleteEvidenceItem({ id: 'i1', type: 'image', image: { storagePath: PENDING_PATH, fileName: 'a', mimeType: 'image/webp', size: 1 } }), true);
    assert.equal(isCompleteEvidenceItem({ id: 'i2', type: 'image', image: null }), false);
  });

  it('newEvidenceItemId produces unique ev- ids', () => {
    const a = newEvidenceItemId();
    const b = newEvidenceItemId();
    assert.match(a, /^ev-/);
    assert.notEqual(a, b);
  });
});
