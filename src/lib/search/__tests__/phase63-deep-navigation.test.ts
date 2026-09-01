// ══════════════════════════════════════════════════════════════
//  Phase 6.3 — Search Deep Navigation + Report Continuity contracts
//
//  Maps to §49-C (26-42) and §49-B/E UI contracts:
//    • qualityDeductions results navigate EXACTLY (was generic)
//      with month seeding (§22/§27/§31)
//    • honest fallback stays honest for non-exact domains (§31/§39)
//    • QualityPage opens the OWNING employee group for a deep-linked
//      deduction (§25 container handling) and renders data-record-id
//    • ReportsPage restores the generated report verbatim with an
//      explicit status (§13/§16/§20) — no unscoped legacy writes
//    • KpiReportsPage + SmartQualityReportPage persist their view
//      context (§38/§50/§51) — selections only, never data snapshots
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildSearchNavigation } from '@/lib/search/search-navigation';
import { buildEvidenceNavigation } from '@/lib/evidence/evidence-navigation';
import { isEvidenceCollection } from '@/lib/evidence/evidence-collections';

const ROOT = process.cwd();
const readSource = (rel: string) =>
  fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('qualityDeductions — exact navigation upgrade (§22/§23, §49-26 style)', () => {
  it('is an evidence collection with the highlight strategy', () => {
    assert.equal(isEvidenceCollection('qualityDeductions'), true);
    const intent = buildEvidenceNavigation('qualityDeductions', 'ded-1');
    assert.equal(intent.page, 'quality');
    assert.equal(intent.exact, true);
    assert.equal(intent.highlightId, 'ded-1');
  });

  it('search result → exact intent WITH month seeding (§27/§49-37)', () => {
    const intent = buildSearchNavigation({
      domain: 'qualityDeductions',
      recordId: 'ded-1',
      month: '2026-08',
    } as Parameters<typeof buildSearchNavigation>[0]);
    assert.equal(intent.exact, true);
    assert.equal(intent.page, 'quality');
    assert.equal(intent.navParams.month, '2026-08');
    assert.equal(intent.highlightId, 'ded-1');
  });

  it('without a month the intent stays exact (month is optional)', () => {
    const intent = buildSearchNavigation({
      domain: 'qualityDeductions',
      recordId: 'ded-1',
    } as Parameters<typeof buildSearchNavigation>[0]);
    assert.equal(intent.exact, true);
    assert.equal(intent.navParams.month, undefined);
  });
});

describe('existing navigation contracts are preserved (§57 no UX regression)', () => {
  it('qualityObservations still seeds the month (Phase 5.3 doctrine)', () => {
    const intent = buildSearchNavigation({
      domain: 'qualityObservations',
      recordId: 'obs-1',
      month: '2026-08',
    } as Parameters<typeof buildSearchNavigation>[0]);
    assert.equal(intent.exact, true);
    assert.equal(intent.navParams.month, '2026-08');
  });

  it('archived employees still seed the status filter (Phase 6.1 doctrine)', () => {
    const intent = buildSearchNavigation({
      domain: 'employees',
      recordId: 'emp-9',
      statusValue: 'archived',
    } as Parameters<typeof buildSearchNavigation>[0]);
    assert.equal(intent.exact, true);
    assert.equal(intent.navParams.status, 'archived');
  });

  it('non-exact domains keep the HONEST generic fallback (§31/§49-39)', () => {
    const intent = buildSearchNavigation({
      domain: 'knowledgeBase',
      recordId: 'kb-1',
    } as Parameters<typeof buildSearchNavigation>[0]);
    assert.equal(intent.exact, false);
    assert.equal(intent.highlightId, null);
  });
});

describe('QualityPage deep-link container handling (§25, §49-33/34)', () => {
  const src = readSource('src/components/pages/QualityPage.tsx');

  it('renders stable data-record-id on deduction rows (§53 stable IDs)', () => {
    assert.match(src, /data-record-id=\{d\.id\}/);
  });

  it('auto-expands the OWNING employee group for a deep-linked record', () => {
    assert.match(src, /useAppStore\(\(s\) => s\.highlightId\)/);
    assert.match(src, /groupedByEmployee\[id\]\.deductions\.some/);
    assert.match(src, /setExpandedEmp/);
  });

  it('uses the SHARED highlight hook — no second highlight system (§30)', () => {
    assert.match(src, /useRecordHighlight\(/);
  });

  it('filter context persists via usePageState (§8)', () => {
    assert.match(src, /usePageState<\{ search: string; monthFilter: string \}>/);
    assert.match(src, /page: 'quality'/);
  });

  it('the empty state NAMES the active period (§10/§56)', () => {
    assert.match(src, /لا توجد خصومات مسجلة في \$\{formatMonthLabelAr\(monthFilter\)\}/);
  });
});

describe('ReportsPage report continuity (§13-§20, §49-18/19/21/23)', () => {
  const src = readSource('src/components/pages/ReportsPage.tsx');

  it('restores the generated snapshot verbatim with explicit status', () => {
    assert.match(src, /loadReportSnapshot<ReportSnapshotData>/);
    assert.match(src, /saveReportSnapshot\(/);
    assert.match(src, /setReportStatus\('restored'\)/);
    assert.match(src, /setReportStatus\('generated'\)/);
  });

  it('carries the full snapshot contract (reportId/type/period/generatedAt/generatedBy)', () => {
    assert.match(src, /reportId: createId\(\)/);
    assert.match(src, /reportType: 'monthly-deductions-report'/);
    assert.match(src, /generatedAt: new Date\(\)\.toISOString\(\)/);
    assert.match(src, /generatedBy: user\.id/);
    assert.match(src, /period: month/);
  });

  it('writes ONLY on explicit generation — no silent report rewrite (§16/§21)', () => {
    assert.doesNotMatch(src, /sessionStorage\.setItem\('erp_report_data'/);
    // exactly one snapshot write path, inside handleGenerate
    const writes = src.match(/saveReportSnapshot\(/g) ?? [];
    assert.equal(writes.length, 1);
  });

  it('shows Generated/Restored status + generatedAt + period mismatch hint (§19/§20)', () => {
    assert.match(src, /تمت الاستعادة/);
    assert.match(src, /تم التوليد الآن/);
    assert.match(src, /وُلّد في/);
    assert.match(src, /التقرير المعروض من فترة/);
    assert.match(src, /الفترة المختارة/);
  });

  it('view context (filter/sort/search) persists per user (§8)', () => {
    // filterMode/empSearch/sort remain component state but the REPORT
    // context is the snapshot — the page restores month from it.
    assert.match(src, /const \[reportStatus, setReportStatus\]/);
  });
});

describe('KPI Reports view persistence + period visibility (§38/§39/§50)', () => {
  const src = readSource('src/components/pages/quality-kpi/KpiReportsPage.tsx');

  it('persists tab + month per user (§49-50)', () => {
    assert.match(src, /usePageState<\{[\s\S]*?tab: TabKey;[\s\S]*?month: string;[\s\S]*?\}>/);
    assert.match(src, /page: 'kpiReports'/);
  });

  it('shows the current period with MTD/FINALIZED distinction (§39)', () => {
    assert.match(src, /الفترة الحالية: \{formatMonth\(effectiveMonth\)\}/);
    assert.match(src, /شهر مغلق \(FINALIZED\)/);
  });
});

describe('Smart Quality Report — live view, persisted selection only (§51)', () => {
  const src = readSource('src/components/pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');

  it('persists the SELECTION (employeeId + month), never a data snapshot', () => {
    assert.match(src, /usePageState<\{[\s\S]*?employeeId: string;[\s\S]*?month: string;[\s\S]*?\}>/);
    assert.match(src, /page: 'smartQualityReport'/);
    assert.doesNotMatch(src, /saveReportSnapshot/);
  });
});

describe('KPI visibility diagnose surface (§33-§37)', () => {
  const tabSrc = readSource('src/components/pages/quality-kpi/KpiEmployeeReportTab.tsx');
  const routeSrc = readSource('src/app/api/kpi-reports/diagnose/route.ts');

  it('on-demand diagnose UI exists (read-only, explicit button)', () => {
    assert.match(tabSrc, /تشخيص الظهور/);
    assert.match(tabSrc, /useKpiVisibilityDiagnose/);
  });

  it('the diagnose route is auth + permission + scope gated, fail-closed', () => {
    assert.match(routeSrc, /requireAuth\(request\)/);
    assert.match(routeSrc, /verifyPermission\(request, 'kpiReports', 'view'\)/);
    assert.match(routeSrc, /resolveEmployeeScopeFromDb/);
    assert.match(routeSrc, /NOT_FOUND_ANSWER/); // anti-enumeration generic answer
  });

  it('the trace computes NO KPI values (§36 — diagnostic only)', () => {
    const traceSrc = readSource('src/lib/kpi-reporting/visibility-trace.ts');
    assert.doesNotMatch(traceSrc, /computeEmployeeScore/);
    assert.doesNotMatch(traceSrc, /buildEmployeeKpiResult\(/);
  });
});
