// ══════════════════════════════════════════════════════════════
//  KPI report end-to-end verification — READ-ONLY.
//  Runs the REAL report builders for a code against the live DB.
//  Usage: npx tsx --tsconfig tsconfig.test.json --env-file=.env.local
//         scripts/kpi-report-verify.ts EMP-075 2026-09
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { buildEmployeeKpiReport } from '../src/lib/kpi-reporting/employee-report';
import { buildMonthlyKpiReport } from '../src/lib/kpi-reporting/monthly-report';

async function main() {
  const code = process.argv[2] ?? 'EMP-075';
  const period = process.argv[3] ?? '2026-09';

  const employees = await getAll<any>('employees');
  const target = employees.find((e: any) => e.code === code);
  if (!target) {
    console.error(`employee ${code} not found`);
    process.exit(1);
  }

  console.log(`\n=== EMPLOYEE REPORT — ${code} ${target.name} — ${period} ===`);
  const report = await buildEmployeeKpiReport({ employeeId: String(target.id), monthKey: period });
  console.log(JSON.stringify({
    outcomeStatus: report.outcomeStatus,
    message: report.message,
    rowStatus: report.rowStatus,
    scheme: report.scheme ? { id: report.scheme.schemeId, name: report.scheme.schemeName } : null,
    weightedTotal: report.weightedTotal,
    overallStatus: report.overallStatus,
    employee: {
      code: report.employee.employeeCode,
      department: report.employee.department,
      team: report.employee.team,
      employmentStatus: report.employee.employmentStatus,
      eligibleNow: report.outcomeStatus !== 'NOT_ELIGIBLE_PERIOD' && report.outcomeStatus !== 'EMPLOYEE_NOT_FOUND',
    },
    evidenceCounts: report.evidence.counts,
    trend: report.trend.months.map((p) => ({ m: p.monthKey, available: p.available, score: p.rawScore, status: p.rowStatus })),
  }, null, 2));

  console.log(`\n=== MONTHLY ${period} — population check ===`);
  const monthly = await buildMonthlyKpiReport({ monthKey: period, reportKind: 'MONTHLY' });
  const rowForTarget = monthly.rows.find((r) => r.employeeCode === code);
  console.log(`total rows: ${monthly.rows.length} | totals: ${JSON.stringify(monthly.totals)}`);
  console.log(`${code} row present: ${rowForTarget ? 'YES' : 'NO'}${rowForTarget ? ` — rowStatus=${rowForTarget.rowStatus} resultSource=${rowForTarget.resultSource} score=${rowForTarget.quality?.rawScore ?? null}` : ''}`);
  const bySource = monthly.rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.resultSource] = (acc[r.resultSource] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`rows by resultSource: ${JSON.stringify(bySource)}`);
  const targetRow = monthly.rows.find((r) => r.employeeCode === code);
  if (targetRow) {
    console.log(`target row: ${JSON.stringify({ name: targetRow.employeeName, dept: targetRow.department, status: targetRow.rowStatus, source: targetRow.resultSource, score: targetRow.quality?.rawScore ?? null })}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('verification failed:', err);
  process.exit(1);
});
