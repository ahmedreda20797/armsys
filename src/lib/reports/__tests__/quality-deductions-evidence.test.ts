// ══════════════════════════════════════════════════════════════
//  §EVIDENCE-PRESENTATION — Quality Deductions REPORT regression.
//
//  Pins the complete-collection rule through the SAME pure pipeline
//  the report page, Excel export and print use:
//    filterQualityDeductionRecords → groupQualityDeductionsByEmployee
//    → buildReasonsCell (Excel/print cell)
//  and the KPI employee report print adapter (evidence column).
//
//  Pure imports only — no db, no HTTP, no Firebase.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getReportDefinition } from '../registry';
import { resolveReportRequest } from '../scope';
import { filterQualityDeductionRecords } from '../runners/quality-deductions';
import { buildReasonsCell, groupQualityDeductionsByEmployee } from '../grouping/quality-deductions-grouped';
import { employeeKpiReportToPrintModel } from '@/components/print/print-adapters';
import { buildFinalStoragePath } from '@/lib/evidence-items';
import type { EvidenceItem, QualityDeduction } from '@/types';

// ── Fixtures ─────────────────────────────────────────────────

const QUALITY_DEDUCTIONS_DEF = getReportDefinition('quality-deductions');
assert.ok(QUALITY_DEDUCTIONS_DEF, 'reference report must be registered');

function resolvedFor(overrides: Record<string, unknown> = {}) {
  const result = resolveReportRequest(QUALITY_DEDUCTIONS_DEF!, {
    reportId: 'quality-deductions',
    monthKey: '2026-08',
    ...overrides,
  } as never);
  assert.ok(result.ok, 'fixture request must resolve');
  return result.value;
}

const EMPLOYEES = [
  { id: 'e1', name: 'أحمد', code: '101', department: 'Operations', team: null, orgNodeId: null, searchKey: 'احمد 101' },
];

const IMG = (itemId: string) =>
  buildFinalStoragePath('qualityDeductions', 'multi', itemId);

/** 6 evidence items: link, number, image, image, link, link (stored order). */
const SIX_ITEMS: EvidenceItem[] = [
  { id: 'ev-a', type: 'link', url: 'https://example.com/chat' },
  { id: 'ev-b', type: 'number', number: '12345' },
  { id: 'ev-c', type: 'image', image: { storagePath: IMG('ev-c'), fileName: 'chat.webp', mimeType: 'image/webp', size: 1024 } },
  { id: 'ev-d', type: 'image', image: { storagePath: IMG('ev-d'), fileName: 'receipt.webp', mimeType: 'image/webp', size: 2048 } },
  { id: 'ev-e', type: 'link', url: 'https://example.com/booking' },
  { id: 'ev-f', type: 'link', url: 'https://example.com/voucher' },
];

const MULTI_ITEM_RECORD: QualityDeduction = {
  id: 'multi', employeeId: 'e1', date: '2026-08-12', type: 'booking_error',
  description: 'خطأ حجز', deductionDays: 2, deductionAmount: 300,
  evidence: 'https://example.com/chat', // write-path legacy projection (first link)
  evidenceItems: SIX_ITEMS, month: '2026-08', relatedCapaId: null, createdAt: '2026-08-12T10:00:00Z',
};

const LEGACY_RECORD: QualityDeduction = {
  id: 'legacy', employeeId: 'e1', date: '2026-08-05', type: 'late_followup',
  description: 'تأخر متابعة', deductionDays: 1, deductionAmount: 0,
  evidence: 'https://example.com/legacy-note', month: '2026-08', relatedCapaId: null, createdAt: '2026-08-05T10:00:00Z',
};

// ── Runner — rows carry the COMPLETE collection ───────────────

describe('quality-deductions report runner — evidence collection', () => {
  it('a 6-item record produces a row whose evidenceItems carry ALL 6 items in order', () => {
    const rows = filterQualityDeductionRecords([MULTI_ITEM_RECORD], EMPLOYEES, resolvedFor());
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.evidenceItems.length, 6);
    assert.deepEqual(
      row.evidenceItems.map((i) => i.id),
      ['ev-a', 'ev-b', 'ev-c', 'ev-d', 'ev-e', 'ev-f'],
    );
  });

  it('the printable evidence cell (Excel/print) contains ALL 6 values — not only the first', () => {
    const [row] = filterQualityDeductionRecords([MULTI_ITEM_RECORD], EMPLOYEES, resolvedFor());
    assert.ok(row.evidence);
    const lines = row.evidence!.split('\n');
    assert.equal(lines.length, 6);
    assert.match(lines[0], /^1\. https:\/\/example\.com\/chat$/);
    assert.equal(lines[1], '2. 12345');
    assert.match(lines[2], /^3\. صورة دليل 1: \/api\/evidence\/image\//);
    assert.match(lines[3], /^4\. صورة دليل 2: \/api\/evidence\/image\//);
    assert.equal(lines[4], '5. https://example.com/booking');
    assert.equal(lines[5], '6. https://example.com/voucher');
  });

  it('legacy single-value records adapt through the same resolver (one item, not dropped)', () => {
    const [row] = filterQualityDeductionRecords([LEGACY_RECORD], EMPLOYEES, resolvedFor());
    assert.equal(row.evidenceItems.length, 1);
    assert.equal(row.evidenceItems[0].type, 'link');
    assert.equal(row.evidence, '1. https://example.com/legacy-note');
  });

  it('no-evidence records stay null/empty — nothing invented', () => {
    const none: QualityDeduction = { ...LEGACY_RECORD, id: 'none', evidence: null, evidenceItems: null };
    const [row] = filterQualityDeductionRecords([none], EMPLOYEES, resolvedFor());
    assert.equal(row.evidence, null);
    assert.deepEqual(row.evidenceItems, []);
  });
});

// ── Grouped projection — the Excel/print reasons cell ─────────

describe('quality-deductions grouped report — reasons cell', () => {
  it('carries every evidence item of a multi-item deduction (numbered sub-lines, stored order)', () => {
    const groups = groupQualityDeductionsByEmployee(
      filterQualityDeductionRecords([MULTI_ITEM_RECORD], EMPLOYEES, resolvedFor()),
    );
    assert.equal(groups.length, 1);
    const entry = groups[0].details[0];
    assert.equal(entry.evidenceItems.length, 6);

    const cell = buildReasonsCell([entry]);
    assert.ok(cell.includes('https://example.com/chat'));
    assert.ok(cell.includes('12345'));
    assert.ok(cell.includes(`صورة دليل 1: /api/evidence/image/${IMG('ev-c')}`));
    assert.ok(cell.includes(`صورة دليل 2: /api/evidence/image/${IMG('ev-d')}`));
    assert.ok(cell.includes('https://example.com/booking'));
    assert.ok(cell.includes('https://example.com/voucher'));
    // numbered sub-lines for the collection
    assert.ok(cell.includes('\n  1. https://example.com/chat'));
    assert.ok(cell.includes('\n  6. https://example.com/voucher'));
  });

  it('a single evidence item stays inline on the deduction line (legacy shape preserved)', () => {
    const groups = groupQualityDeductionsByEmployee(
      filterQualityDeductionRecords([LEGACY_RECORD], EMPLOYEES, resolvedFor()),
    );
    const cell = buildReasonsCell(groups[0].details);
    assert.ok(cell.includes('الدليل: https://example.com/legacy-note'));
    assert.ok(!cell.includes('\n  1.'));
  });
});

// ── Print adapter — the KPI employee report evidence column ───

describe('employee KPI report print model — evidence column', () => {
  const report = {
    employee: { employeeName: 'أحمد', department: 'Operations', position: null },
    evidence: {
      counts: { total: 1, approved: 1 },
      observations: [
        {
          observationDate: '05/08/2026',
          categoryName: 'فئة',
          severity: 'high',
          notes: 'ملاحظة',
          status: 'open',
          approvalStatus: 'approved',
          effect: { applies: true, counted: true, signedPoints: -3 },
          evidenceItems: SIX_ITEMS,
        },
      ],
    },
  };

  it('the printed table keeps the evidence column and carries ALL 6 items', () => {
    const model = employeeKpiReportToPrintModel(report as never, '2026-08');
    const section = model.sections.find((s) => s.heading?.includes('أدلة الجودة'));
    assert.ok(section?.table, 'evidence section must exist');
    assert.ok(section!.table!.columns.includes('الدليل'), 'evidence column must not vanish in print');

    const row = section!.table!.rows[0];
    const evidenceCell = String(row[row.length - 1]);
    const lines = evidenceCell.split('\n');
    assert.equal(lines.length, 6);
    assert.match(lines[0], /^1\. https:\/\/example\.com\/chat$/);
    assert.equal(lines[1], '2. 12345');
    assert.match(lines[2], /^3\. صورة دليل 1: \/api\/evidence\/image\//);
    assert.equal(lines[5], '6. https://example.com/voucher');
  });

  it('no evidence prints an explicit dash (never fabricated)', () => {
    const model = employeeKpiReportToPrintModel(
      { ...report, evidence: { counts: { total: 1 }, observations: [{ observationDate: '05/08/2026', notes: 'x' }] } } as never,
      '2026-08',
    );
    const section = model.sections.find((s) => s.heading?.includes('أدلة الجودة'))!;
    const row = section.table!.rows[0];
    assert.equal(row[row.length - 1], '—');
  });
});
