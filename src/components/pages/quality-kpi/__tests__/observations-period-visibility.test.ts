// ══════════════════════════════════════════════════════════════
//  Phase 6.2 §68 — Quality Observations PERIOD VISIBILITY regression
//
//  BACKGROUND (critical incident): the page defaults its month
//  filter to the CURRENT calendar month and the filter used to be
//  invisible (collapsed panel) — so every month rollover made the
//  records "disappear" behind a misleading zero state, and
//  "مسح الفلاتر" kept the month anyway. The data was never lost.
//
//  THE CONTRACT PINNED HERE:
//    1. The active period is ALWAYS visible in the toolbar (§68).
//    2. The empty state NAMES the period: "لا توجد ملاحظات مسجلة في …".
//    3. A one-click escape exists: "عرض كل الأشهر".
//    4. "مسح الفلاتر" actually clears (including the month).
//    5. Server-side: with N records, zero results are returned ONLY
//       as the documented effect of an EXPLICIT month filter —
//       never an unexplained empty pipeline (data-integrity guard).
// ══════════════════════════════════════════════════════════════

import '../../../../lib/__tests__/m01-test-support';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  resetTestData,
  registerFixtures,
  setTable,
  bearerHeaders,
} from '../../../../lib/__tests__/m01-test-support';
import { formatMonthLabelAr } from '@/lib/month-label';

const routeModule = import('@/app/api/quality-observations/route');

const ROOT = process.cwd();
const PAGE_PATH = 'src/components/pages/quality-kpi/ObservationsPage.tsx';
const MONTH_CURRENT = '2026-09';
const MONTH_PREVIOUS = '2026-08';

let adminToken = '';

/** 80 observations — the exact incident shape: a busy team, many
 *  months, mixed statuses/employees + one archived employee. */
async function seedIncidentWorld(): Promise<void> {
  resetTestData();
  const tokens = await registerFixtures();
  adminToken = tokens.adminToken;
  setTable('employees', [
    { id: 'emp-obs', code: 'EMP-900', name: 'فريق الجودة موظف', department: 'الجودة', position: 'مفتش', status: 'active' },
    { id: 'emp-arch', code: 'EMP-901', name: 'موظف مؤرشف', department: 'الجودة', position: 'مفتش', status: 'archived', archivedAt: '2026-08-01T00:00:00.000Z' },
  ]);
  const rows: Array<Record<string, unknown>> = [];
  const months = ['2026-04', '2026-05', '2026-06', '2026-07', MONTH_PREVIOUS, MONTH_CURRENT];
  const statuses = ['open', 'in_review', 'resolved', 'closed'];
  const severities = ['low', 'medium', 'high'];
  for (let i = 0; i < 80; i++) {
    const archivedTarget = i === 79; // one historical record for the archived employee
    const month = months[i % months.length];
    rows.push({
      id: `obs-bulk-${i + 1}`,
      employeeId: archivedTarget ? 'emp-arch' : 'emp-obs',
      employeeName: archivedTarget ? 'موظف مؤرشف' : 'فريق الجودة موظف',
      categoryName: i % 2 === 0 ? 'متابعة العملاء' : 'دقة الحجز',
      categoryId: i % 2 === 0 ? 'cat-followup' : 'cat-booking',
      type: 'تأخير المتابعة',
      notes: `ملاحظة تشغيلية رقم ${i + 1}`,
      severity: severities[i % severities.length],
      status: statuses[i % statuses.length],
      approvalStatus: i % 3 === 0 ? 'approved' : i % 3 === 1 ? 'pending' : 'rejected',
      observationDate: `${(i % 27) + 1}/${month.split('-')[1]}/${month.split('-')[0]}`,
      month,
    });
  }
  setTable('qualityObservations', rows);
}

beforeEach(async () => {
  await seedIncidentWorld();
});

// ── 5) server-side data-integrity guard ─────────────────────────
describe('observations pipeline — zero results only WITH an explicit filter', () => {
  it('80 records across months: full read returns ALL of them', async () => {
    const { GET } = await routeModule;
    const request = new Request('http://localhost/api/quality-observations', {
      headers: bearerHeaders(adminToken),
    });
    const res = await GET!(request as never);
    assert.equal(res.status, 200);
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    assert.equal(rows.length, 80, 'unfiltered read must surface every stored observation');
  });

  it('an explicit month filter returns exactly that month (documented, intentional)', async () => {
    const { GET } = await routeModule;
    const res = await GET!(new Request(
      `http://localhost/api/quality-observations?month=${MONTH_CURRENT}`,
      { headers: bearerHeaders(adminToken) },
    ) as never);
    const rows = (await res.json()) as Array<{ month: string }>;
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => r.month === MONTH_CURRENT));
  });

  it('a month with NO records returns zero ONLY because of the filter — and the UI must say so (§68 pairing)', async () => {
    const { GET } = await routeModule;
    const res = await GET!(new Request(
      'http://localhost/api/quality-observations?month=2030-01',
      { headers: bearerHeaders(adminToken) },
    ) as never);
    const rows = (await res.json()) as unknown[];
    assert.equal(rows.length, 0);
    // The UI contract below (empty state names the period) is what makes
    // this zero HONEST instead of "data disappeared".
  });

  it('multi-month + multi-status + archived-employee historical record all present', async () => {
    const { GET } = await routeModule;
    const res = await GET!(new Request('http://localhost/api/quality-observations', {
      headers: bearerHeaders(adminToken),
    }) as never);
    const rows = (await res.json()) as Array<{ employeeId: string; month: string; approvalStatus: string }>;
    assert.equal(new Set(rows.map((r) => r.month)).size, 6);
    assert.ok(rows.some((r) => r.employeeId === 'emp-arch')); // archived historical data stays readable
    assert.equal(new Set(rows.map((r) => r.approvalStatus)).size, 3);
  });

  it('a malformed/unattributed record (no month) is NOT silently dropped from the unfiltered read', async () => {
    const { GET } = await routeModule;
    setTable('qualityObservations', [
      { id: 'obs-legacy', employeeId: 'emp-obs', employeeName: 'قديم', categoryName: 'ق', categoryId: 'c', type: 'ق', notes: 'سجل بدون حقل شهر', severity: 'low', status: 'open', observationDate: '05/05/2026' },
    ]);
    const res = await GET!(new Request('http://localhost/api/quality-observations', {
      headers: bearerHeaders(adminToken),
    }) as never);
    const rows = (await res.json()) as Array<{ id?: string }>;
    assert.ok(rows.some((r) => r.id === 'obs-legacy'));
  });
});

// ── §68 UI contracts — the incident can never silently recur ────
describe('observations page — period visibility contracts (§68)', () => {
  const source = fs.readFileSync(path.join(ROOT, PAGE_PATH), 'utf8');

  it('the ACTIVE period is always visible in the toolbar (not only inside the collapsed panel)', () => {
    assert.match(source, /observations-period-indicator/);
    assert.match(source, /فترة العرض:/);
    assert.match(source, /filters\.month \? formatMonth\(filters\.month\) : 'كل الأشهر'/);
  });

  it('the empty state NAMES the period — never a bare misleading zero state (§68)', () => {
    assert.match(source, /لا توجد ملاحظات مسجلة في \$\{monthLabel\}/);
    assert.ok(!source.includes('>لا توجد ملاحظات</p>'), 'the old misleading zero state must stay dead');
  });

  it('one-click escape: "عرض كل الأشهر" clears the month from BOTH the toolbar and the empty state', () => {
    assert.match(source, /observations-show-all-months/);
    assert.match(source, /observations-empty-show-all/);
    assert.match(source, /month: undefined/);
  });

  it('"مسح الفلاتر" actually clears everything — including the month (no fake clear)', () => {
    const clearFn = source.match(/function clearFilters\(\)[\s\S]*?\n  \}/);
    assert.ok(clearFn);
    assert.match(clearFn![0], /setFilters\(\{\}\)/);
    assert.ok(!clearFn![0].includes('CURRENT_MONTH'), 'clear must not reset to the current month');
  });

  it('the current-month DEFAULT remains the fresh-load behavior (intentional business default)', () => {
    assert.match(source, /month: navMonth \?\? CURRENT_MONTH/);
  });

  it('the period chip is clickable and opens the filter panel (changeable filter)', () => {
    const chip = source.match(/<button[^>]*observations-period-indicator[\s\S]*?<\/button>/);
    assert.ok(chip);
    assert.match(chip![0], /setShowFilters/);
  });
});

// ── Arabic month label helper (shared with the AI section) ──────
describe('formatMonthLabelAr', () => {
  it('formats 2026-09 as سبتمبر 2026 and degrades to the raw key', () => {
    assert.equal(formatMonthLabelAr('2026-09'), 'سبتمبر 2026');
    assert.equal(formatMonthLabelAr('2026-01'), 'يناير 2026');
    assert.equal(formatMonthLabelAr('garbage'), 'garbage');
  });
});
