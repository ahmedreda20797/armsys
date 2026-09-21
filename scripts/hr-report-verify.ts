// ══════════════════════════════════════════════════════════════
//  HR performance report end-to-end verification — READ-ONLY.
//  Usage: npx tsx --tsconfig tsconfig.test.json --env-file=.env.local
//         scripts/hr-report-verify.ts [month]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { buildMonthlyKpiReport } from '../src/lib/kpi-reporting';
import { buildHrPerformanceReport } from '../src/lib/report-audience';

async function main() {
  const month = process.argv[2] ?? '2026-09';

  console.log(`\n=== HR PERFORMANCE REPORT — ${month} ===`);

  const monthly = await buildMonthlyKpiReport({
    monthKey: month,
    reportKind: 'MONTHLY',
    filters: {},
    sort: { key: 'employeeName', direction: 'asc' },
  });

  const hr = buildHrPerformanceReport(monthly);

  console.log(`rows: ${hr.rows.length}`);
  console.log(`totals: ${JSON.stringify(hr.totals)}`);
  console.log(`audience: ${hr.audience}`);
  console.log(`valueBasis: ${hr.valueBasis}`);
  console.log(`finalized: ${hr.finalized}`);

  console.log('\n=== FIRST 10 ROWS (sanitized) ===');
  for (const r of hr.rows.slice(0, 10)) {
    console.log(
      `${r.performanceScore === null ? '—' : r.performanceScore} | ${r.performanceStatus.padEnd(10)} | ` +
      `${(r.department ?? '—').padEnd(20)} | ${(r.team ?? '—').padEnd(20)} | ` +
      `${(r.schemeName ?? '—').slice(0, 25)} | ${r.employeeName}`,
    );
  }

  // Verify NO technical fields leaked
  const serialized = JSON.stringify(hr);
  const technical = [
    'quality', 'observationCount', 'deductionPoints', 'bonusPoints',
    'availableWeight', 'weightedTotal', 'componentId', 'maxContribution',
    'weightedContribution', 'weight', 'overallStatus', 'resultSource',
    'schemeId', 'schemeVersion', 'finalizedAt',
  ];
  for (const t of technical) {
    if (serialized.includes(`"${t}"`)) {
      console.error(`\n❌ LEAKED technical field: ${t}`);
      process.exit(1);
    }
  }
  console.log('\n✅ No technical fields leaked (verified)');

  // HR-allowed fields present
  const row = hr.rows[0];
  const allowed = ['employeeId', 'employeeName', 'employeeCode', 'department', 'team', 'position',
    'employmentStatus', 'archivedButEligible', 'period', 'performanceScore',
    'performanceStatus', 'finalized', 'valueBasis', 'schemeName'];
  for (const a of allowed) {
    if (!(a in row)) {
      console.error(`\n❌ Missing allowed field: ${a}`);
      process.exit(1);
    }
  }
  console.log('✅ All HR-allowed fields present (verified)');

  console.log('\n=== SAMPLE HR ROW ===');
  console.log(JSON.stringify(row, null, 2));

  process.exit(0);
}

main().catch((err) => {
  console.error('verification failed:', err);
  process.exit(1);
});