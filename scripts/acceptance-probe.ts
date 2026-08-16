// ══════════════════════════════════════════════════════════════
//  Acceptance Probe — READ-ONLY environment + parity validation
//
//  1. Confirms required collections exist and are readable
//  2. Re-runs dashboard parity with the CORRECT getKpiDashboard
//     call signature (range, { filters }) → .response
//  3. Lists months present in observations (open/closed)
//
//  SAFETY: strictly read-only.
// ══════════════════════════════════════════════════════════════

import { getAll, getById } from '../src/lib/db';
import { getKpiSettings } from '../src/lib/kpi-settings/index';
import { getMonthSnapshot } from '../src/lib/month-lock';
import { getKpiDashboard } from '../src/lib/kpi-dashboard/index';
import {
  computeEmployeeScore,
  isApprovedKpiObs,
} from '../src/lib/metrics/kpiMetrics';
import type { ObservationLike } from '../src/lib/metrics/kpiMetrics';
import type { QualityObservation } from '../src/types/quality-kpi';

function report(name: string, pass: boolean, detail = '') {
  const icon = pass ? '✔' : '✖';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('══ Acceptance Probe (read-only) ══\n');

  // ── 1. Environment validation: required collections ──
  console.log('── 1. Collection validation ──');
  const collections: Array<[string, string]> = [
    ['employees', 'employees'],
    ['qualityObservations', 'qualityObservations'],
    ['observationCategories', 'observationCategories'],
    ['monthSnapshots', 'monthSnapshots'],
    ['kpiSettings', 'kpiSettings'],
    ['qualityAuditLog', 'qualityAuditLog'],
  ];
  for (const [label, table] of collections) {
    try {
      const rows = await getAll<Record<string, unknown>>(table);
      report(`collection "${label}" readable`, true, `${rows.length} record(s)`);
    } catch (e) {
      report(`collection "${label}" readable`, false, (e as Error).message);
    }
  }

  // ── 2. Load data ──
  const settings = await getKpiSettings();
  const observations = await getAll<QualityObservation>('qualityObservations');
  console.log(`\n── 2. Data overview ──`);
  console.log(`  observations total: ${observations.length}`);

  const months = new Map<string, number>();
  for (const o of observations) months.set(o.month, (months.get(o.month) || 0) + 1);
  for (const [m, count] of months) {
    const snap = await getMonthSnapshot(m);
    console.log(`  month ${m}: ${count} obs, snapshot status=${snap?.status ?? 'none'}`);
  }

  // ── 3. Dashboard parity with CORRECT call signature ──
  console.log('\n── 3. Dashboard parity (correct signature) ──');
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentObs = observations.filter((o) => o.month === currentMonth) as unknown as ObservationLike[];

  if (currentObs.length === 0) {
    console.log(`  no observations in current month ${currentMonth} — using any month with obs`);
    // Fall back to whichever month has observations
    const fallback = [...months.keys()][0];
    if (fallback) {
      const fallbackObs = observations.filter((o) => o.month === fallback) as unknown as ObservationLike[];
      const employees = [...new Set(fallbackObs.map((o) => o.employeeId))];
      for (const empId of employees) {
        const empObs = fallbackObs.filter((o) => o.employeeId === empId);
        const engine = computeEmployeeScore(empObs, settings, empId);

        // Correct signature: (range, { filters }) → { response, error }
        const { response: dash, error } = await getKpiDashboard('current_month', {
          filters: { employeeId: empId },
        });
        if (error) { console.log(`  dashboard error: ${error}`); continue; }

        report(
          `emp ${empId} (${fallback}): dashboard avgScore == engine score`,
          Math.round(dash.avgScore) === engine.score,
          `dash=${dash.avgScore} (isLive=${dash.isLive}), engine=${engine.score}`,
        );
        report(
          `emp ${empId}: dashboard deductions == engine`,
          Math.round(dash.totalDeductions) === engine.deductionPoints,
          `dash=${dash.totalDeductions}, engine=${engine.deductionPoints}`,
        );
        report(
          `emp ${empId}: dashboard bonuses == engine`,
          Math.round(dash.totalBonuses) === engine.bonusPoints,
          `dash=${dash.totalBonuses}, engine=${engine.bonusPoints}`,
        );
      }
    }
  } else {
    const employees = [...new Set(currentObs.map((o) => o.employeeId))];
    for (const empId of employees) {
      const empObs = currentObs.filter((o) => o.employeeId === empId);
      const engine = computeEmployeeScore(empObs, settings, empId);
      const approvedOnly = empObs.filter(isApprovedKpiObs);
      const engineApproved = computeEmployeeScore(approvedOnly, settings, empId);

      report(
        `emp ${empId}: pending/rejected zero-impact`,
        engine.score === engineApproved.score,
        `all=${engine.score}, approvedOnly=${engineApproved.score}`,
      );

      const { response: dash, error } = await getKpiDashboard('current_month', {
        filters: { employeeId: empId },
      });
      if (error) { console.log(`  dashboard error: ${error}`); continue; }

      report(
        `emp ${empId}: dashboard avgScore == engine score`,
        Math.round(dash.avgScore) === engine.score,
        `dash=${dash.avgScore} (isLive=${dash.isLive}), engine=${engine.score}`,
      );
      report(
        `emp ${empId}: dashboard deductions == engine`,
        Math.round(dash.totalDeductions) === engine.deductionPoints,
        `dash=${dash.totalDeductions}, engine=${engine.deductionPoints}`,
      );
      report(
        `emp ${empId}: dashboard bonuses == engine`,
        Math.round(dash.totalBonuses) === engine.bonusPoints,
        `dash=${dash.totalBonuses}, engine=${engine.bonusPoints}`,
      );
    }
  }

  // ── 4. Audit log sample ──
  console.log('\n── 4. Audit log ──');
  try {
    const auditRows = await getAll<Record<string, unknown>>('qualityAuditLog');
    report('qualityAuditLog readable', true, `${auditRows.length} event(s)`);
    const actions = new Map<string, number>();
    for (const a of auditRows) {
      const act = String(a.action || 'unknown');
      actions.set(act, (actions.get(act) || 0) + 1);
    }
    console.log(`  actions: ${[...actions.entries()].map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
  } catch (e) {
    report('qualityAuditLog readable', false, (e as Error).message);
  }

  // ── 5. kpiSettings identity check ──
  console.log('\n── 5. KPI settings ──');
  console.log(`  defaultScore=${settings.defaultScore}, minimumScore=${settings.minimumScore}, allowBonus=${settings.allowBonus}, maximumBonus=${settings.maximumBonus}, closeMonthLock=${settings.closeMonthLock}, trendCalculation=${settings.trendCalculation}`);

  console.log('\n══ Probe complete ══');
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exitCode = 1;
});
