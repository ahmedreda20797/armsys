// ══════════════════════════════════════════════════════════════
//  Milestone 6 — Runtime Verification (READ-ONLY)
//
//  Exercises the REAL Attendance KPI service against the REAL
//  Firebase RTDB WITHOUT WRITING anything (spec §25):
//
//    1. PRODUCTION PREFLIGHT — inventory the persisted
//       attendanceResults. If none exist, report
//       "ATTENDANCE KPI RUNTIME DATA — NOT GENERATED" and verify
//       ONLY the explicit not_generated path. Nothing is generated
//       automatically here.
//    2. Pick a REAL stored month + employee and run
//       getAttendanceKpi() end-to-end.
//    3. Verify KPI score === stored compliance ===
//       performanceFactor.score (parity, spec §24).
//    4. Verify PerformanceFactor metadata (factorId, factorName,
//       maxScore, normalized, weight placeholder, breakdown
//       verbatim from the stored counters).
//    5. Verify policy traceability (engineVersion +
//       policyFingerprint preserved from the stored result).
//    6. Verify time-scope isolation: the KPI carries its own
//       selected_month scope; a month with no stored result
//       returns null (explicit not_generated, never inherited).
//    7. Batch read: getAttendanceKpisForMonth() count matches the
//       direct collection read, parity per record.
//
//  SAFETY: strictly read-only. No create/update/delete calls, no
//  generation, no close/reopen, no cache invalidation. The project
//  has only a production Firebase environment, so anything
//  requiring authenticated HTTP or state changes is NOT exercised
//  here (the HTTP-layer permission gate is code-identical to the
//  established /api/attendance-results routes).
//
//  Run: npx tsx --env-file=.env scripts/milestone-6-runtime-verification.ts [month] [employeeId]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { ATTENDANCE_RESULTS_TABLE } from '../src/lib/attendance';
import type { StoredAttendanceResult } from '../src/lib/attendance';
import {
  ATTENDANCE_KPI_FACTOR_ID,
  ATTENDANCE_KPI_FACTOR_NAME,
  ATTENDANCE_KPI_MAX_SCORE,
  getAttendanceKpi,
  getAttendanceKpisForMonth,
} from '../src/lib/attendance/kpi';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function report(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const monthArg = process.argv[2] || '';
  const employeeArg = process.argv[3] || '';
  console.log(`══ Milestone 6 Runtime Verification (READ-ONLY) ══\n`);

  // ── 1. Production preflight: inventory persisted attendanceResults ──
  // A failed read must NOT be mistaken for an empty collection —
  // only a successful read reporting zero records is "NOT GENERATED".
  const attendanceResults = await getAll<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE);
  const months = [...new Set(attendanceResults.map((r) => r.month))].sort();
  console.log(`Persisted attendanceResults: ${attendanceResults.length} record(s) across month(s): [${months.join(', ') || 'none'}]\n`);

  if (attendanceResults.length === 0) {
    console.log('ATTENDANCE KPI RUNTIME DATA — NOT GENERATED');
    console.log('No persisted attendanceResults exist in this environment.');
    console.log('Per spec: the KPI layer must NOT generate data automatically.');
    console.log('An authorized Admin may generate a completed month separately via');
    console.log('POST /api/attendance-results/generate.\n');

    // The only behavior verifiable without data: the explicit not_generated path.
    console.log('── not_generated path (no stored data anywhere) ──');
    const kpi = await getAttendanceKpi(monthArg || '2026-08', employeeArg || 'any-employee');
    report('ungenerated employee-month returns explicit null (not_generated)', kpi === null);
    const kpis = await getAttendanceKpisForMonth(monthArg || '2026-08');
    report('ungenerated month batch read returns []', Array.isArray(kpis) && kpis.length === 0);

    const failed = results.filter((r) => !r.pass).length;
    console.log(`\n══ Result: ${results.length - failed}/${results.length} checks passed (data-dependent checks skipped — nothing generated) ══`);
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  }
  // ── 2. Pick a real stored month + employee ──
  const monthKey = monthArg || months[months.length - 1];
  const monthRecords = attendanceResults.filter((r) => r.month === monthKey);
  const target =
    (employeeArg && monthRecords.find((r) => r.employeeId === employeeArg)) ||
    monthRecords[0];

  if (!target) {
    console.error(`No stored attendance result found for month ${monthKey}${employeeArg ? ` / employee ${employeeArg}` : ''}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Target: ${target.employeeSnapshot?.employeeName || target.employeeId} (${target.employeeId}) — month ${monthKey}`);
  console.log(`Stored compliance: ${target.compliance}%\n`);

  // ── 3. End-to-end single KPI read ──
  console.log('── 1. getAttendanceKpi (end-to-end) ──');
  const kpi = await getAttendanceKpi(monthKey, target.employeeId);
  report('service resolves a KPI for the real employee-month', kpi !== null);
  if (!kpi) {
    console.error('KPI service returned null for a stored result — aborting.');
    process.exitCode = 1;
    return;
  }

  report(
    'parity: kpi.score === stored compliance === performanceFactor.score',
    kpi.score === target.compliance && kpi.performanceFactor.score === target.compliance,
    `${kpi.score} / ${target.compliance} / ${kpi.performanceFactor.score}`,
  );
  report(
    'scale: score within 0–100 and maxScore = 100',
    kpi.score >= 0 && kpi.score <= 100 && kpi.maxScore === ATTENDANCE_KPI_MAX_SCORE,
    `score=${kpi.score}, maxScore=${kpi.maxScore}`,
  );
  report(
    'normalized = score / maxScore',
    Math.abs(kpi.normalized - target.compliance / 100) < 1e-12,
    `normalized=${kpi.normalized}`,
  );

  // ── 4. PerformanceFactor metadata ──
  console.log('\n── 2. PerformanceFactor metadata ──');
  report('factorId = attendance', kpi.performanceFactor.factorId === ATTENDANCE_KPI_FACTOR_ID, kpi.performanceFactor.factorId);
  report('factorName = الحضور', kpi.performanceFactor.factorName === ATTENDANCE_KPI_FACTOR_NAME, kpi.performanceFactor.factorName);
  report('weight is the default-safe placeholder (1 — engine owns weights)', kpi.performanceFactor.weight === 1);
  report(
    'breakdown counters are verbatim from the stored result',
    kpi.performanceFactor.breakdown?.presentDays === target.presentDays &&
      kpi.performanceFactor.breakdown?.lateDays === target.lateDays &&
      kpi.performanceFactor.breakdown?.absentDays === target.absentDays &&
      kpi.performanceFactor.breakdown?.exemptDays === target.exemptDays &&
      kpi.performanceFactor.breakdown?.lateDeductionDays === target.lateDeductionDays &&
      kpi.performanceFactor.breakdown?.absenceDeductionDays === target.absenceDeductionDays &&
      kpi.performanceFactor.breakdown?.attendanceDeductionDays === target.attendanceDeductionDays &&
      kpi.performanceFactor.breakdown?.compliance === target.compliance,
  );
  report('source = attendanceResults (the persisted result, not raw data)', kpi.source === 'attendanceResults');

  // ── 5. Policy traceability ──
  console.log('\n── 3. Policy traceability ──');
  report(
    'engineVersion preserved from the stored result',
    kpi.engineVersion === target.engineVersion,
    `${kpi.engineVersion} (${typeof target.engineVersion === 'string' ? 'stored' : 'MISSING on stored record'})`,
  );
  report(
    'policyFingerprint preserved from the stored result',
    typeof kpi.policyFingerprint === 'string' && kpi.policyFingerprint === target.policyFingerprint,
    String(kpi.policyFingerprint ?? '(none)'),
  );

  // ── 6. Time-scope isolation ──
  console.log('\n── 4. Time scope ──');
  report(
    'KPI carries an explicit selected_month scope for its own month',
    kpi.scope.kind === 'selected_month' && kpi.scope.monthKey === monthKey,
    `${kpi.scope.kind}:${kpi.scope.monthKey}`,
  );
  const missingMonth = '2030-01'; // guaranteed future/ungenerated month — read returns null
  const missingKpi = await getAttendanceKpi(missingMonth, target.employeeId);
  report(
    'ungenerated month returns explicit null — never the previous month\'s KPI',
    missingKpi === null,
    `${missingMonth} → null`,
  );
  if (months.length > 1) {
    const otherMonth = months.find((m) => m !== monthKey)!;
    const otherKpi = await getAttendanceKpi(otherMonth, target.employeeId);
    const otherStored = attendanceResults.find((r) => r.employeeId === target.employeeId && r.month === otherMonth);
    report(
      `second real month (${otherMonth}) resolves independently with its own score`,
      otherStored ? otherKpi?.score === otherStored.compliance : otherKpi === null,
      otherStored ? `score=${otherKpi?.score}` : 'no stored result for this employee → null',
    );
  }

  // ── 7. Batch read ──
  console.log('\n── 5. Batch read ──');
  const kpis = await getAttendanceKpisForMonth(monthKey);
  report(
    'batch count matches the direct collection read for the month',
    kpis.length === monthRecords.length,
    `kpis=${kpis.length}, stored=${monthRecords.length}`,
  );
  const allParity = kpis.every((k) => {
    const stored = monthRecords.find((r) => r.employeeId === k.employeeId);
    return stored ? k.score === stored.compliance && k.maxScore === 100 : false;
  });
  report('every batch KPI equals its stored compliance at maxScore 100', allParity);

  // ── Summary ──
  const failed = results.filter((r) => !r.pass);
  console.log(`\n══ Result: ${results.length - failed.length}/${results.length} checks passed ══`);
  if (failed.length > 0) {
    console.log('Failed checks:');
    for (const f of failed) console.log(`  ✖ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
    process.exitCode = 1;
  }
}

main().then(() => {
  // The admin RTDB connection keeps the event loop alive — exit
  // explicitly once verification completes.
  process.exit(process.exitCode ?? 0);
}).catch((error) => {
  console.error('Runtime verification crashed:', error);
  process.exit(1);
});
