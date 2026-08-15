// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Runtime Verification (READ-ONLY)
//
//  Exercises the REAL data flow against the REAL Firebase RTDB:
//    1. Snapshot integrity (closed months frozen, keyed by employeeId)
//    2. Numerical parity (frozen score vs canonical engine recomputation
//       using frozen settings + locked observations)
//    3. Approval parity (pending/rejected never contribute on live data)
//    4. Dashboard parity (employee-scoped avgScore == engine score)
//    5. Closed-month lock state (closeMonthLock active)
//
//  SAFETY: strictly read-only. No create/update/delete calls.
//
//  Run: npx tsx scripts/milestone-9-runtime-verification.ts
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { getKpiSettings } from '../src/lib/kpi-settings/index';
import { getMonthDetail } from '../src/lib/month-snapshots';
import { getKpiDashboard } from '../src/lib/kpi-dashboard/index';
import {
  computeEmployeeScore,
  isApprovedKpiObs,
} from '../src/lib/metrics/kpiMetrics';
import type { ObservationLike } from '../src/lib/metrics/kpiMetrics';
import type { QualityObservation, MonthSnapshot } from '../src/types/quality-kpi';

// ─── Tiny result collector ───────────────────────────────────
const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function report(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  const icon = pass ? '✔' : '✖';
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('══ Milestone 9 Runtime Verification (read-only) ══\n');

  // ── Load real data ──
  const settings = await getKpiSettings();
  const observations = await getAll<QualityObservation>('qualityObservations');
  const snapshotDocs = await getAll<MonthSnapshot>('monthSnapshots');

  console.log(`Firebase: ${observations.length} observations, ${snapshotDocs.length} month snapshots\n`);
  console.log(`Settings: defaultScore=${settings.defaultScore}, minimumScore=${settings.minimumScore}, allowBonus=${settings.allowBonus}, maximumBonus=${settings.maximumBonus}, closeMonthLock=${settings.closeMonthLock}\n`);

  // ═══ 1. Snapshot Integrity ═══
  console.log('── 1. Snapshot Integrity ──');
  const closedMonths = snapshotDocs.filter((s) => s.status === 'closed');
  report(
    'closed snapshots exist',
    closedMonths.length > 0,
    `${closedMonths.length} closed month(s): ${closedMonths.map((s) => s.monthKey).join(', ')}`,
  );

  for (const snap of closedMonths) {
    const hasSettings = !!snap.settingsSnapshot;
    const scores = snap.employeeScores ?? {};
    const keys = Object.keys(scores);
    const allHaveFrozenMeta = keys.every(
      (k) => scores[k].employeeSnapshot && scores[k].employeeSnapshot.employeeId === k,
    );
    report(
      `snapshot ${snap.monthKey}: settingsSnapshot frozen`,
      hasSettings,
      hasSettings ? `defaultScore=${snap.settingsSnapshot.defaultScore}` : 'MISSING',
    );
    report(
      `snapshot ${snap.monthKey}: employeeScores keyed by employeeId with frozen metadata`,
      allHaveFrozenMeta,
      `${keys.length} employee entr(ies)`,
    );
  }

  // ═══ 2. Numerical Parity — closed month ═══
  //  Observations in closed months are LOCKED (cannot change), so recomputing
  //  with the FROZEN settings must reproduce the FROZEN score exactly.
  console.log('\n── 2. Numerical Parity (closed months) ──');
  for (const snap of closedMonths) {
    const monthObs = observations.filter((o) => o.month === snap.monthKey) as unknown as ObservationLike[];
    const frozenSettings = snap.settingsSnapshot;
    let parity = true;
    let checked = 0;
    let mismatchDetail = '';
    for (const [empId, entry] of Object.entries(snap.employeeScores ?? {})) {
      const empObs = monthObs.filter((o) => o.employeeId === empId);
      const recomputed = computeEmployeeScore(empObs, frozenSettings, empId);
      checked++;
      if (recomputed.score !== entry.score) {
        parity = false;
        mismatchDetail = `emp ${empId}: frozen=${entry.score} recomputed=${recomputed.score}`;
        break;
      }
    }
    report(
      `snapshot ${snap.monthKey}: frozen score == canonical recomputation`,
      parity,
      parity ? `${checked} employee(s) verified` : mismatchDetail,
    );
  }

  // ═══ 3. Approval Parity — live current month ═══
  console.log('\n── 3. Approval Parity (current month) ──');
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentObs = observations.filter((o) => o.month === currentMonth) as unknown as ObservationLike[];
  const nonApproved = currentObs.filter((o) => o.applyPointDeduction && o.approvalStatus !== 'approved');
  if (currentObs.length === 0) {
    report('current month has observations to verify', false, `no observations in ${currentMonth}`);
  } else {
    // Recompute score WITHOUT pending/rejected and verify engine treats them as zero-impact:
    // run once with all obs, once with only approved — scores must match exactly.
    const employees = new Set(currentObs.map((o) => o.employeeId));
    let parityOk = true;
    let mismatch = '';
    for (const empId of employees) {
      const empObs = currentObs.filter((o) => o.employeeId === empId);
      const withAll = computeEmployeeScore(empObs, settings, empId);
      const approvedOnly = empObs.filter(isApprovedKpiObs);
      const withApproved = computeEmployeeScore(approvedOnly, settings, empId);
      if (withAll.score !== withApproved.score) {
        parityOk = false;
        mismatch = `emp ${empId}: all=${withAll.score} approvedOnly=${withApproved.score}`;
        break;
      }
    }
    report(
      'pending/rejected observations have zero score impact',
      parityOk,
      parityOk
        ? `${employees.size} employee(s), ${nonApproved.length} non-approved obs excluded correctly`
        : mismatch,
    );
  }

  // ═══ 4. Dashboard Parity — employee-scoped ═══
  //  Employee 360's live score comes from /api/kpi-dashboard?employeeId=X.
  //  Verify avgScore == canonical engine score for the same employee/month.
  console.log('\n── 4. Dashboard Parity (employee-scoped, live month) ──');
  const liveEmployees = new Set(currentObs.map((o) => o.employeeId));
  const sampleEmployee = liveEmployees.values().next().value as string | undefined;
  if (!sampleEmployee) {
    report('a live employee to compare', false, 'no employees with current-month observations');
  } else {
    const dash = await getKpiDashboard({ range: 'current_month', employeeId: sampleEmployee });
    const empObs = currentObs.filter((o) => o.employeeId === sampleEmployee);
    const engine = computeEmployeeScore(empObs, settings, sampleEmployee);
    const dashScore = Math.round(dash.avgScore);
    report(
      `employee ${sampleEmployee}: dashboard avgScore == engine score`,
      dashScore === engine.score,
      `dashboard=${dashScore}, engine=${engine.score}, isLive=${dash.isLive}`,
    );
    report(
      `employee ${sampleEmployee}: dashboard deductions == engine deductions`,
      Math.round(dash.totalDeductions) === engine.deductionPoints,
      `dashboard=${Math.round(dash.totalDeductions)}, engine=${engine.deductionPoints}`,
    );
    report(
      `employee ${sampleEmployee}: dashboard bonuses == engine bonuses`,
      Math.round(dash.totalBonuses) === engine.bonusPoints,
      `dashboard=${Math.round(dash.totalBonuses)}, engine=${engine.bonusPoints}`,
    );
  }

  // ═══ 5. getMonthDetail behavior — closed months verbatim ═══
  console.log('\n── 5. getMonthDetail (closed → frozen verbatim) ──');
  for (const snap of closedMonths.slice(0, 3)) {
    const detail = await getMonthDetail(snap.monthKey);
    report(
      `getMonthDetail(${snap.monthKey}) returns frozen doc verbatim`,
      !!detail
        && detail.status === 'closed'
        && detail.closedAt === snap.closedAt
        && detail.generatedAt === snap.generatedAt,
    );
  }

  // ═══ 6. Closed-month lock state ═══
  console.log('\n── 6. Closed-Month Lock ──');
  report(
    'closeMonthLock enabled — observation mutations in closed months are blocked',
    settings.closeMonthLock === true,
  );

  // ═══ 7. Snapshot history preservation (reopen/re-close trail) ═══
  console.log('\n── 7. Reopen/Re-close trail ──');
  const withHistory = snapshotDocs.filter((s) => (s.snapshotHistory?.length ?? 0) > 0);
  report(
    'months with snapshotHistory (re-close archives)',
    true, // informational
    `${withHistory.length} month(s) carry archived versions, ${snapshotDocs.filter((s) => s.reopenCount > 0).length} reopened at least once`,
  );

  // ═══ Summary ═══
  const failed = results.filter((r) => !r.pass);
  console.log('\n════════════════════════════════════════════');
  console.log(`Runtime verification: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log('\nFAILED checks:');
    for (const f of failed) console.log(`  ✖ ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log('ALL RUNTIME CHECKS PASSED');
  }
}

main().catch((e) => {
  console.error('Runtime verification crashed:', e);
  process.exitCode = 1;
});
