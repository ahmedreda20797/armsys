// ══════════════════════════════════════════════════════════════
//  Phase 5.2 — Evidence Preview tests (spec §43 items 24-35)
//
//  Convention (repo-wide): node:test + node:assert/strict via
//  `tsx --test`. Pure builders are exercised directly; UI wiring is
//  verified with static source-contract scans (the same doctrine as
//  smart-quality-report-ui.test.ts).
//
//  Covers:
//   24. Human-readable evidence summary
//   25. Raw ID secondary only
//   26. Preview opens (modal wired into the report page)
//   27. Correct source loaded (request targets the exact collection)
//   28. Correct fields displayed (only fields that exist)
//   29. Unauthorized source blocked (no record contents)
//   30. Exact navigation (highlight / detailParam strategies)
//   31. Auto-open (target pages auto-expand the record)
//   32. Scroll into view
//   33. Temporary highlight (self-clearing, non-destructive)
//   34. Generic fallback (labeled differently, still functional)
//   35. No duplicate records (canonical tables only, zero writes)
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  EVIDENCE_COLLECTIONS,
  evidenceTableOf,
  isEvidenceCollection,
} from '@/lib/evidence/evidence-collections';
import {
  projectEvidenceRecord,
} from '@/lib/evidence/record-projection';
import {
  buildEvidenceSummary,
  summaryPrimaryText,
  EVIDENCE_FORBIDDEN_MESSAGE,
  EVIDENCE_NOT_FOUND_MESSAGE,
} from '@/lib/evidence/evidence-summaries';
import { buildEvidenceNavigation } from '@/lib/evidence/evidence-navigation';
import {
  parseEvidencePreviewBody,
  scopeOptionsFor,
  MAX_IDS_PER_REQUEST,
} from '@/lib/evidence/preview-request';

const srcOf = (rel: string): string =>
  fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// ══════════════════════════════════════════════════════════════
//  §32/§43-24/25 — human-readable summaries, raw id secondary
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — evidence summaries (§32)', () => {
  const observation = {
    id: 'hmet9c32q38nwcy4i655j48k',
    observationDate: '28/08/2026',
    employeeName: 'أحمد',
    categoryName: 'متابعة العملاء',
    type: 'Follow-up Timing',
    approvalStatus: 'approved',
    notes: 'تفاصيل الملاحظة',
  };

  it('24. summary is human-readable (title + date + type + status), not a raw id', () => {
    const projected = projectEvidenceRecord('qualityObservations', observation);
    assert.ok(projected);
    const summary = buildEvidenceSummary(
      EVIDENCE_COLLECTIONS.qualityObservations.title, observation.id, projected, 'granted');
    assert.equal(summary.title, 'ملاحظة جودة');
    assert.ok(summary.metaLines.includes('28/08/2026')); // date
    assert.ok(summary.metaLines.includes('متابعة العملاء')); // category/type
    assert.ok(summary.metaLines.includes('معتمدة')); // status is LABELLED
    const primary = summaryPrimaryText(summary);
    assert.equal(primary.includes(observation.id), false);
    assert.match(primary, /ملاحظة جودة/);
  });

  it('25. the raw id is secondary only — never the primary presentation', () => {
    const projected = projectEvidenceRecord('qualityObservations', observation);
    const summary = buildEvidenceSummary(
      EVIDENCE_COLLECTIONS.qualityObservations.title, observation.id, projected, 'granted');
    assert.equal(summary.rawId, observation.id); // kept for the secondary slot
    assert.notEqual(summary.title, observation.id);
    assert.notEqual(summaryPrimaryText(summary), observation.id);
    // The section renders the raw id in a dedicated small mono line.
    const sectionsSource = srcOf(
      'src/components/pages/quality-kpi/smart-report/report-sections.tsx');
    assert.match(sectionsSource, /font-mono text-\[9px\][^\n]*\{recordId\}/);
  });

  it('24b. forbidden / not_found degrade explicitly with NO invented content', () => {
    const forbidden = buildEvidenceSummary('شكوى عميل', 'x1', null, 'forbidden');
    assert.equal(forbidden.metaLines[0], EVIDENCE_FORBIDDEN_MESSAGE);
    assert.equal(JSON.stringify(forbidden).includes('customerName'), false);
    const missing = buildEvidenceSummary('شكوى عميل', 'x1', null, 'not_found');
    assert.equal(missing.metaLines[0], EVIDENCE_NOT_FOUND_MESSAGE);
  });
});

// ══════════════════════════════════════════════════════════════
//  §31/§43-27/28 — correct source + only existing fields
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — record projection (§31/§32)', () => {
  it('27. preview requests target the exact evidence collection', () => {
    const parsed = parseEvidencePreviewBody({
      collection: 'followUps',
      recordIds: ['f1', 'f2', 'f3'],
    });
    assert.ok(parsed.ok);
    if (parsed.ok) {
      assert.equal(parsed.value.collection, 'followUps');
      assert.deepEqual(parsed.value.recordIds, ['f1', 'f2', 'f3']);
    }
    // Canonical table name == collection name (no shadow mapping).
    for (const collection of Object.keys(EVIDENCE_COLLECTIONS)) {
      assert.equal(evidenceTableOf(collection as never), collection);
    }
  });

  it('27b. invalid preview requests are rejected (unknown collection, bad ids, cap)', () => {
    assert.equal(parseEvidencePreviewBody({ collection: 'users', recordIds: ['x'] }).ok, false);
    assert.equal(parseEvidencePreviewBody({ collection: 'complaints', recordIds: [] }).ok, false);
    assert.equal(parseEvidencePreviewBody({ collection: 'complaints', recordIds: ['ok', ''] }).ok, false);
    assert.equal(parseEvidencePreviewBody({ collection: 'complaints', recordIds: ['x'.repeat(200)] }).ok, false);
    assert.equal(parseEvidencePreviewBody({
      collection: 'complaints',
      recordIds: Array.from({ length: MAX_IDS_PER_REQUEST + 1 }, (_, i) => `id-${i}`),
    }).ok, false);
  });

  it('28. only fields that actually exist are displayed', () => {
    const projected = projectEvidenceRecord('complaints', {
      id: 'c1',
      customerName: 'عميل',
      status: 'resolved',
      // no description, no resolution, no createdAt on this record
    });
    assert.ok(projected);
    const labels = projected.fields.map((f) => f.label);
    assert.ok(labels.includes('العميل'));
    assert.ok(labels.includes('تم الحل') === false); // status rendered as labelled VALUE
    assert.equal(labels.includes('تفاصيل الشكوى'), false, 'missing field must be omitted');
    assert.equal(labels.includes('الإجراء/الحل'), false, 'missing field must be omitted');
    const status = projected.fields.find((f) => f.label === 'الحالة');
    assert.equal(status?.value, 'تم الحل');
  });

  it('28b. per-collection projections label Arabic values correctly', () => {
    const capa = projectEvidenceRecord('capaCases', {
      capaId: 'CAPA-2026-001', title: 'خطأ تسعير', correctiveStatus: 'in_progress',
    });
    assert.equal(capa?.fields.find((f) => f.label === 'رقم الحالة')?.value, 'CAPA-2026-001');
    assert.equal(capa?.fields.find((f) => f.label === 'حالة الإجراء التصحيحي')?.value, 'قيد التنفيذ');

    const deal = projectEvidenceRecord('travelDeals', {
      destination: 'القاهرة', status: 'completed',
    });
    assert.equal(deal?.title, 'صفقة سفر');
    assert.equal(deal?.fields.find((f) => f.label === 'الحالة')?.value, 'مكتملة');

    const followUp = projectEvidenceRecord('followUps', {
      date: '28/08/2026', followUpType: 'quality', status: 'open',
    });
    assert.equal(followUp?.fields.find((f) => f.label === 'النوع')?.value, 'جودة');
  });

  it('28c. monthSnapshots projection exposes MONTH METADATA only — never scores', () => {
    const projected = projectEvidenceRecord('monthSnapshots', {
      id: '2026-08',
      monthKey: '2026-08',
      status: 'closed',
      closedByName: 'مدير النظام',
      employeeScores: { emp1: { rawScore: 99 } },   // SENSITIVE
      topEmployees: [{ name: 'أحمد' }],              // SENSITIVE
      settingsSnapshot: { qualityWeight: 15 },       // SENSITIVE
    });
    assert.ok(projected);
    const json = JSON.stringify(projected);
    assert.equal(json.includes('emp1'), false);
    assert.equal(json.includes('أحمد'), false);
    assert.equal(json.includes('qualityWeight'), false);
    assert.equal(projected.fields.find((f) => f.label === 'الشهر')?.value, '2026-08');
    assert.equal(projected.fields.find((f) => f.label === 'الحالة')?.value, 'شهر مقفل');
  });

  it('28d. a malformed record degrades to a title-only projection (never crashes)', () => {
    const projected = projectEvidenceRecord('kpiSchemes', 'not-an-object');
    assert.equal(projected, null);
    const bomb = projectEvidenceRecord('complaints', { get customerName(): string {
      throw new Error('boom');
    } });
    assert.ok(bomb);
    assert.deepEqual(bomb.fields, []);
  });
});

// ══════════════════════════════════════════════════════════════
//  §37/§43-29 — permissions block unauthorized sources
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — evidence permissions (§37)', () => {
  it('29. the route verifies SOURCE permission and returns contents only when granted', () => {
    const route = srcOf('src/app/api/evidence/preview/route.ts');
    // Auth + per-source permission + employee scope all precede reads.
    const authPos = route.indexOf('requireAuth(request)');
    const permPos = route.indexOf("verifyPermission(request, descriptor.permissionKey, 'view')");
    const scopePos = route.indexOf('resolveEmployeeScopeFromDb');
    const readPos = route.indexOf('await getById');
    for (const [name, pos] of [['auth', authPos], ['permission', permPos], ['scope', scopePos]] as Array<[string, number]>) {
      assert.ok(pos >= 0, `${name} check must exist`);
      assert.ok(pos < readPos, `${name} must precede the first record read`);
    }
    // Denial path returns NO record contents — the forbidden mapping
    // carries only the recordId + access marker, never a record field.
    assert.match(route, /access: 'forbidden' as const/);
    assert.doesNotMatch(route, /forbidden' as const,\s*\n\s*record:/);
  });

  it('29b. out-of-scope resolves as not_found — anti-enumeration, same as detail routes', () => {
    const route = srcOf('src/app/api/evidence/preview/route.ts');
    assert.match(route, /linkedRecordInScope/);
    assert.match(route, /access: 'not_found'/);
  });

  it('29c. every collection maps to a REAL sidebar permissionKey + page', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { APP_PAGES } = require('@/config/permissions') as {
      APP_PAGES: Array<{ id: string; permissionKey: string }>;
    };
    const pageIds = new Set(APP_PAGES.map((p) => p.id));
    const permKeys = new Set(APP_PAGES.map((p) => p.permissionKey));
    for (const descriptor of Object.values(EVIDENCE_COLLECTIONS)) {
      assert.ok(pageIds.has(descriptor.page), `page ${descriptor.page} must exist`);
      assert.ok(permKeys.has(descriptor.permissionKey),
        `permissionKey ${descriptor.permissionKey} must exist`);
    }
  });

  it('29d. scope doctrine per collection mirrors each source detail route', () => {
    assert.deepEqual(scopeOptionsFor('complaints'), { optionalLink: true });
    assert.deepEqual(scopeOptionsFor('capaCases'),
      { optionalLink: true, relatedEmployeeIdsField: 'relatedEmployeeIds' });
    assert.deepEqual(scopeOptionsFor('monthSnapshots'), { optionalLink: true });
    assert.deepEqual(scopeOptionsFor('qualityObservations'), { optionalLink: false });
    assert.deepEqual(scopeOptionsFor('followUps'), { optionalLink: false });
  });
});

// ══════════════════════════════════════════════════════════════
//  §33-§36/§43-30/31/32/33/34 — navigation, auto-open, highlight
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — evidence navigation (§33-§36)', () => {
  it('30. exact navigation for highlight-strategy collections', () => {
    const intent = buildEvidenceNavigation('qualityObservations', 'obs-1');
    assert.deepEqual(intent, {
      page: 'observations', highlightId: 'obs-1', navParams: {}, exact: true,
    });
  });

  it('30b. CAPA exact navigation opens the case detail via navParams', () => {
    const intent = buildEvidenceNavigation('capaCases', 'CAPA-2026-001');
    assert.equal(intent.exact, true);
    assert.equal(intent.page, 'capa');
    assert.deepEqual(intent.navParams, { id: 'CAPA-2026-001' });
    assert.equal(intent.highlightId, 'CAPA-2026-001');
  });

  it('34. generic fallback for collections without exact navigation — labeled differently', () => {
    // Phase 6.3 (§22-§25): qualityDeductions UPGRADED to the highlight
    // strategy (stable data-record-id rows + group auto-expand) — it is
    // now exact and lives in the test above; the truly generic set:
    for (const collection of ['attendanceResults', 'monthSnapshots', 'kpiSchemes'] as const) {
      const intent = buildEvidenceNavigation(collection, 'whatever');
      assert.equal(intent.exact, false);
      assert.equal(intent.highlightId, null);
      assert.equal(intent.page, EVIDENCE_COLLECTIONS[collection].page);
    }
    // The UI distinguishes the two cases by label (Phase 5.3 §30).
    const modal = srcOf(
      'src/components/pages/quality-kpi/smart-report/EvidencePreviewModal.tsx');
    assert.match(modal, /فتح السجل في المصدر/);
    assert.match(modal, /الانتقال إلى الصفحة/);
    // §30/§32: the navigation buttons render ONLY for granted access.
    assert.match(modal, /access === 'granted'/);
  });

  it('31/32/33. target pages locate + scroll + auto-expand + temporary highlight', () => {
    const hook = srcOf('src/hooks/use-record-highlight.ts');
    // locate via data-record-id
    assert.match(hook, /data-record-id/);
    // scroll into view
    assert.match(hook, /scrollIntoView/);
    // temporary highlight: the shared Qnalys highlight attribute is
    // applied then removed + state cleared (§QNALYS-HIGHLIGHT tokens)
    assert.match(hook, /data-qn-highlight/);
    assert.match(hook, /removeAttribute\('data-qn-highlight'\)/);
    assert.match(hook, /setHighlightId\(null\)/);

    // Observations/Complaints/FollowUps mark their rows with the attribute.
    for (const page of [
      'src/components/pages/quality-kpi/ObservationsPage.tsx',
      'src/components/pages/ComplaintsPage.tsx',
      'src/components/pages/FollowUpsPage.tsx',
    ]) {
      assert.match(srcOf(page), /data-record-id=/, `${page} must mark records`);
      assert.match(srcOf(page), /useRecordHighlight\(\)/, `${page} must receive highlights`);
    }

    // Travel auto-expands the deep-linked trip card (§35 auto-open).
    const travel = srcOf('src/components/pages/TravelPage.tsx');
    assert.match(travel, /setExpandedCardId\(highlightId\)/);
  });

  it('26. the preview modal is wired into the Smart Quality Report', () => {
    const page = srcOf(
      'src/components/pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');
    assert.match(page, /EvidencePreviewModal/);
    assert.match(page, /handleViewEvidence/);
    assert.match(page, /buildEvidenceNavigation/);
    // Sections hand selections to the page-level modal handler.
    const sections = srcOf(
      'src/components/pages/quality-kpi/smart-report/report-sections.tsx');
    assert.match(sections, /عرض الدليل/);
    assert.match(sections, /onViewEvidence/);
  });
});

// ══════════════════════════════════════════════════════════════
//  §39/§43-35 — no duplication, canonical records only
// ══════════════════════════════════════════════════════════════

describe('Phase 5.2 — no duplication (§39)', () => {
  it('35. the evidence route is strictly read-only over canonical tables', () => {
    const route = srcOf('src/app/api/evidence/preview/route.ts');
    for (const forbiddenWrite of ['createRecord', 'updateRecord', 'deleteRecord', 'invalidateCache']) {
      assert.equal(route.includes(forbiddenWrite), false,
        `the evidence preview must never write (${forbiddenWrite})`);
    }
    // Reads go through the existing canonical db layer only.
    assert.match(route, /getById/);
    // No shadow collection names anywhere in the evidence lib.
    for (const rel of [
      'src/lib/evidence/evidence-collections.ts',
      'src/lib/evidence/record-projection.ts',
      'src/lib/evidence/evidence-summaries.ts',
      'src/lib/evidence/evidence-navigation.ts',
      'src/lib/evidence/preview-request.ts',
    ]) {
      const source = srcOf(rel);
      for (const shadow of ['evidencePreview', 'evidenceCopies', 'evidenceCacheCollection']) {
        assert.equal(source.includes(`'${shadow}'`), false, `${rel} must not reference ${shadow}`);
      }
    }
  });

  it('35b. the registry covers exactly the nine evidence collections', () => {
    assert.equal(Object.keys(EVIDENCE_COLLECTIONS).length, 9);
    for (const collection of [
      'qualityObservations', 'qualityDeductions', 'complaints', 'capaCases',
      'followUps', 'travelDeals', 'attendanceResults', 'monthSnapshots', 'kpiSchemes',
    ]) {
      assert.equal(isEvidenceCollection(collection), true);
    }
    assert.equal(isEvidenceCollection('users'), false);
    assert.equal(isEvidenceCollection(''), false);
  });
});
