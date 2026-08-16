// ══════════════════════════════════════════════════════════════
//  KPI Dashboard semantics — READ-ONLY runtime verification
//
//  Calls the REAL dashboard service against the REAL Firebase data
//  (no fake data) and prints the business values for manual
//  verification of the corrected semantics:
//    • totalEmployees = unique employees with ≥1 observation in scope
//    • topEmployees / needsImprovement disjoint, baseline rule
//    • deductions / bonuses / pending approvals semantics
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { getKpiDashboard } from '../src/lib/kpi-dashboard/index';
import type { QualityObservation } from '../src/types/quality-kpi';

async function main() {
  const observations = await getAll<QualityObservation>('qualityObservations');
  const currentMonth = new Date().toISOString().slice(0, 7);

  // Independent ground truth from raw observations (same scope rule).
  const inScope = observations.filter((o) => o.month === currentMonth);
  const uniqueEmployees = new Set(inScope.map((o) => o.employeeId));
  const pendingPointObs = inScope.filter(
    (o) => o.applyPointDeduction && o.approvalStatus === 'pending',
  ).length;

  console.log('══ KPI Dashboard Semantics — Runtime (read-only) ══\n');
  console.log(`current month: ${currentMonth}`);
  console.log(`raw observations in scope: ${inScope.length}`);
  console.log(`ground truth — unique employees with observations: ${uniqueEmployees.size}`);
  console.log(`ground truth — pending point-applying observations: ${pendingPointObs}\n`);

  const { response: dash, error } = await getKpiDashboard('current_month');
  if (error) {
    console.log(`dashboard error: ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log('── Dashboard response (real data) ──');
  console.log(`الموظفون المشمولون (totalEmployees): ${dash.totalEmployees}`);
  console.log(`إجمالي الخصومات (totalDeductions): ${dash.totalDeductions}`);
  console.log(`إجمالي المكافآت (totalBonuses): ${dash.totalBonuses}`);
  console.log(`بانتظار الاعتماد (pendingApprovals): ${dash.pendingApprovals}`);
  console.log(`متوسط درجة الأداء (avgScore): ${dash.avgScore}`);
  console.log(`baseline defaultScore: ${dash.settings.defaultScore}`);
  console.log(`isLive: ${dash.isLive}`);
  console.log(`topEmployees: [${dash.topEmployees.map((e) => `${e.employeeName}(${e.score})`).join(', ')}]`);
  console.log(`needsImprovement: [${dash.needsImprovement.map((e) => `${e.employeeName}(${e.score})`).join(', ')}]`);
  console.log(`bottomEmployees (ranking view): [${dash.bottomEmployees.map((e) => `${e.employeeName}(${e.score})`).join(', ')}]`);

  // ── Assertions against ground truth ──
  console.log('\n── Consistency checks ──');
  const ok = (name: string, pass: boolean, detail = '') =>
    console.log(`  ${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);

  ok('totalEmployees == unique employees with observations in scope',
    dash.totalEmployees === uniqueEmployees.size,
    `dash=${dash.totalEmployees}, truth=${uniqueEmployees.size}`);
  ok('totalEmployees != observation count',
    inScope.length === 0 || dash.totalEmployees !== inScope.length,
    `obs=${inScope.length}`);
  ok('pendingApprovals == pending point-applying observations',
    dash.pendingApprovals === pendingPointObs,
    `dash=${dash.pendingApprovals}, truth=${pendingPointObs}`);

  const topIds = new Set(dash.topEmployees.map((e) => e.employeeId));
  ok('no employee in both top and needsImprovement',
    !dash.needsImprovement.some((e) => topIds.has(e.employeeId)));
  ok('needsImprovement scores all below baseline',
    dash.needsImprovement.every((e) => e.score < dash.settings.defaultScore));
  ok('topEmployees scores all at/above baseline',
    dash.topEmployees.every((e) => e.score >= dash.settings.defaultScore));

  // Screenshot scenario (§20) when only one employee has data.
  if (uniqueEmployees.size === 1 && dash.totalDeductions === 0 && dash.totalBonuses === 0) {
    ok('screenshot scenario: single employee, no deductions → top has them, improvement EMPTY',
      dash.topEmployees.length === 1 && dash.needsImprovement.length === 0 && dash.avgScore === dash.settings.defaultScore);
  }

  console.log('\n══ Probe complete ══');
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exitCode = 1;
});
