// src/components/print/__tests__/smart-report-identity-parity.test.ts
// ══════════════════════════════════════════════════════════════
//  §PRINT-IDENTITY-PARITY — screen/PDF identity parity regression.
//
//  The bug: the performance print adapter read phantom field names
//  (`employee.name` / `employee.code`) off the canonical dataset
//  (EmployeeIdentityFacts → employeeName / employeeCode), so
//  identity.name was always undefined and the printed header fell
//  into the generic scope fallback — rendering
//      النطاق: Salah' Sales Team
//  (the department/team) INSTEAD OF the employee as the report
//  subject.
//
//  The contract proven here: ONE canonical dataset feeds BOTH the
//  live header (buildReportHeader) and the print adapter, and the
//  printed identity resolves to the SAME facts — employee primary,
//  team/manager strictly contextual — for EVERY employee shape.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { performanceDatasetToPrintModel } from '../print-adapters';
import { buildReportHeader } from '@/components/pages/quality-kpi/smart-report/view-model';
import type { EmployeePerformanceDataset } from '@/lib/performance-intelligence';
import { setDisplayLocale, formatMonthKey, formatNumber } from '@/lib/i18n/format';

/** The canonical EmployeeIdentityFacts exactly as the API assembles them. */
const EMP084_IDENTITY = {
  employeeId: 'emp-084',
  employeeName: 'رحمه ايمن',
  employeeCode: 'EMP-084',
  // The stored department field may literally carry the team name —
  // this reproduces the exact bug condition (scope fallback showed it).
  department: "Salah' Sales Team",
  team: "Salah' Sales Team",
  manager: 'Ahmed Salah',
  position: 'Sales',
  employmentStatus: 'active',
  eligibleForPeriod: true,
  archivedButEligible: false,
  archivedAt: null,
  restoredAt: null,
  relationship: 'CONFIRMED',
} as const;

/** Employee-shape overrides for the multi-employee safety cases. */
type IdentityOverrides = Partial<{
  employeeName: string;
  employeeCode: string | null;
  department: string | null;
  team: string | null;
  manager: string | null;
  position: string | null;
  employmentStatus: string;
}>;

/** Minimal canonical dataset shape both consumers read (same object). */
function makeDataset(employee: IdentityOverrides): EmployeePerformanceDataset {
  return {
    employee: { ...EMP084_IDENTITY, ...employee },
    period: { monthKey: '2026-09', valueBasis: 'MTD', finalized: false, finalizedAt: null },
    kpi: {
      quality: {
        componentId: 'quality',
        name: 'الجودة',
        status: 'AVAILABLE',
        rawScore: 88,
        weight: 40,
        weightedContribution: 35.2,
        maxContribution: 40,
        observationCount: 3,
        deductionPoints: 0,
        bonusPoints: 0,
      },
      weightedTotal: 35.2,
    },
    generatedAt: '2026-09-29T10:00:00.000Z',
  } as unknown as EmployeePerformanceDataset;
}

describe('§PRINT-IDENTITY-PARITY — live report = print/PDF report', () => {
  it('EMP-084: print identity resolves to the SAME facts the live header shows', () => {
    setDisplayLocale('ar');
    const dataset = makeDataset({});
    const live = buildReportHeader(dataset, 'ar');
    const printed = performanceDatasetToPrintModel(dataset, { title: 'تقرير الجودة والأداء الذكي' });

    // PDF/header employeeName === live employeeName
    assert.equal(printed.identity?.name, live.employeeName);
    assert.equal(printed.identity?.name, 'رحمه ايمن');
    // PDF/header employeeId(code) === live employeeCode
    assert.equal(printed.identity?.code, live.employeeCode);
    assert.equal(printed.identity?.code, 'EMP-084');
    // PDF/header team === live team fact
    assert.equal(printed.identity?.team, "Salah' Sales Team");
    // PDF/header manager === live manager fact
    assert.equal(printed.identity?.manager, live.facts.find((f) => f.label === 'المدير المباشر')?.value);
    assert.equal(printed.identity?.manager, 'Ahmed Salah');
    // PDF/header position === live position fact
    assert.equal(printed.identity?.position, 'Sales');
  });

  it('the primary printed identity is the EMPLOYEE, never the team', () => {
    setDisplayLocale('ar');
    const dataset = makeDataset({});
    const printed = performanceDatasetToPrintModel(dataset);

    assert.notEqual(printed.identity?.name, printed.identity?.team);
    assert.notEqual(printed.identity?.name, printed.identity?.department);
    // The scope-fallback subject must LEAD with the employee too.
    assert.ok(printed.subject?.startsWith('رحمه ايمن'), `subject must lead with the employee, got: ${printed.subject}`);
    assert.ok(!printed.subject?.startsWith("Salah' Sales Team"));
  });

  it('employee with NO team / NO manager keeps the employee primary (null context, never substitution)', () => {
    setDisplayLocale('ar');
    const dataset = makeDataset({ team: null, manager: null, department: null });
    const live = buildReportHeader(dataset, 'ar');
    const printed = performanceDatasetToPrintModel(dataset);

    assert.equal(printed.identity?.name, live.employeeName);
    assert.equal(printed.identity?.team, null);
    assert.equal(printed.identity?.manager, null);
    assert.equal(printed.identity?.department, null);
    assert.notEqual(printed.identity?.name, 'غير متاح');
  });

  it('unnamed employee gets the explicit unnamed label — the team NEVER substitutes for the name', () => {
    setDisplayLocale('ar');
    const dataset = makeDataset({ employeeName: '' });
    const printed = performanceDatasetToPrintModel(dataset);
    assert.equal(printed.identity?.name, 'موظف بدون اسم');

    setDisplayLocale('en');
    const printedEn = performanceDatasetToPrintModel(dataset);
    assert.equal(printedEn.identity?.name, 'Unnamed employee');
    // Never the team/department value.
    assert.notEqual(printedEn.identity?.name, "Salah' Sales Team");
  });

  it('English-named employee and English locale pass through verbatim', () => {
    setDisplayLocale('en');
    const dataset = makeDataset({ employeeName: 'Rahma Ayman' });
    const printed = performanceDatasetToPrintModel(dataset);
    assert.equal(printed.identity?.name, 'Rahma Ayman');
    assert.equal(printed.identity?.code, 'EMP-084');
  });

  it('employment status surfaces ONLY when it applies (non-active), localized like the live badge', () => {
    setDisplayLocale('ar');
    const active = performanceDatasetToPrintModel(makeDataset({ employmentStatus: 'active' }));
    assert.equal(active.identity?.employmentStatusLabel, null);

    const archived = performanceDatasetToPrintModel(makeDataset({ employmentStatus: 'archived' }));
    assert.equal(archived.identity?.employmentStatusLabel, 'مؤرشف');

    setDisplayLocale('en');
    const inactive = performanceDatasetToPrintModel(makeDataset({ employmentStatus: 'inactive' }));
    assert.equal(inactive.identity?.employmentStatusLabel, 'Inactive');
  });

  it('period and KPI stats carry the canonical values (no phantom-field dashes)', () => {
    setDisplayLocale('ar');
    const dataset = makeDataset({});
    const printed = performanceDatasetToPrintModel(dataset);

    assert.equal(printed.period, formatMonthKey('2026-09'));
    // weightedContribution (canonical field) — previously read a phantom
    // `contribution` and always printed '—'. The value follows the
    // locale's canonical number formatting (Arabic digits in ar).
    const contribution = printed.stats?.find((s) => s.label === 'مساهمة الجودة');
    assert.equal(contribution?.value, formatNumber(35.2));
    assert.notEqual(contribution?.value, '—');
  });
});

describe('§PRINT-IDENTITY-PARITY — source contract', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const read = (rel: string): string => readFileSync(join(here, rel), 'utf8');

  it('the adapter consumes the canonical EmployeeIdentityFacts field names', () => {
    const adapters = read('../print-adapters.ts');
    assert.ok(adapters.includes('employee?.employeeName'), 'adapter must read employee.employeeName');
    assert.ok(adapters.includes('employee?.employeeCode'), 'adapter must read employee.employeeCode');
    assert.ok(!adapters.includes('employee?.name'), 'phantom employee.name read must never return');
    assert.ok(!adapters.includes('dataset.employee?.name'), 'phantom dataset.employee.name read must never return');
  });

  it('the renderer renders the employee name/code as the PRIMARY header identity', () => {
    const doc = read('../PrintReportDocument.tsx');
    assert.ok(doc.includes('print-doc-subject-name">{identity.name}'), 'identity.name must be the primary subject');
    assert.ok(doc.includes('print-doc-subject-code'), 'the employee code renders on its own line under the name');
    assert.ok(doc.includes('{identity.code}'), 'identity.code must render');
    // النطاق exists ONLY in the no-identity fallback branch (scope
    // reports) — never as an employee report's identity.
    assert.equal((doc.match(/النطاق/g) ?? []).length, 1, 'النطاق may appear only in the scope fallback');
  });

  it('the smart report page prints under the LIVE report title', () => {
    const page = read('../../pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');
    assert.ok(page.includes("translateUIText('تقرير الجودة والأداء الذكي', locale)"),
      'print title must be the live header title تقرير الجودة والأداء الذكي');
    assert.ok(!page.includes("'تقرير الجودة الذكي'"), 'the old divergent print title must be gone');
  });

  it('no second employee-resolution pipeline exists for printing', () => {
    const page = read('../../pages/quality-kpi/smart-report/SmartQualityReportPage.tsx');
    assert.ok(!page.includes('getById'), 'the page must not query employees for printing');
    assert.ok(!page.includes('firebase'), 'the page must not hit Firebase for printing');
    assert.ok(page.includes('performanceDatasetToPrintModel(datasetQuery.data'),
      'printing must project the SAME dataset the screen renders');
  });
});
