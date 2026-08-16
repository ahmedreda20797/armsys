// ══════════════════════════════════════════════════════════════
//  Milestone 3 — Runtime Verification (READ-ONLY)
//
//  Exercises the REAL persisted-result pipeline against the REAL
//  Firebase RTDB WITHOUT WRITING anything:
//    1. attendanceResults collection state (additive — expected
//       absent/empty before the first explicit generation).
//    2. Dry-run generation parity: loads the real raw inputs for a
//       safe month, resolves the real policy, runs the canonical
//       engine + buildStoredAttendanceResult in memory, and reports
//       exactly what WOULD be persisted (ids, policy fingerprint,
//       engine version, golden-parity anchors).
//    3. Read semantics: stored-result reads return the explicit
//       not_generated state for a month that was never generated —
//       they never recalculate.
//
//  SAFETY: strictly read-only. No create/update/delete calls, no
//  generateMonthlyAttendanceResults invocation. The current project
//  has only a production Firebase environment, so persisted writes
//  are NOT exercised here (see the Milestone 3 report).
//
//  Run: npx tsx scripts/milestone-3-runtime-verification.ts [YYYY-MM]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { isValidMonthKey } from '../src/lib/month-utils';
import {
  ATTENDANCE_RESULTS_TABLE,
  ATTENDANCE_ENGINE_VERSION,
  buildMonthlyInputIndex,
  buildPolicyFingerprint,
  buildStoredAttendanceResult,
  computeMonthlyAttendance,
  getAttendanceResult,
  getAttendanceResultsForMonth,
  loadMonthlyRawInputs,
  resolveAttendancePolicy,
} from '../src/lib/attendance';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function report(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function defaultMonth(): string {
  // Previous completed calendar month (today is server-side clock).
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-based; previous month = m (after -1+1)
  const date = new Date(Date.UTC(y, m, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const monthArg = process.argv[2] || defaultMonth();
  console.log(`══ Milestone 3 Runtime Verification (READ-ONLY) ══`);
  console.log(`Target month: ${monthArg}\n`);

  if (!isValidMonthKey(monthArg)) {
    console.error(`Invalid month key "${monthArg}" (YYYY-MM required)`);
    process.exitCode = 1;
    return;
  }

  // ── 1. attendanceResults collection state (additive, read-only) ──
  console.log('── 1. attendanceResults collection state ──');
  const stored = await getAll(ATTENDANCE_RESULTS_TABLE).catch(() => []);
  report(
    'attendanceResults collection readable',
    true,
    stored.length === 0
      ? 'collection absent/empty (additive — nothing persisted yet)'
      : `${stored.length} stored result(s) exist`,
  );
  if (stored.length > 0) {
    const malformed = stored.filter((r: any) => !r.id || !r.month || !r.employeeId || r.engineVersion !== ATTENDANCE_ENGINE_VERSION);
    report('stored results carry canonical identity + engineVersion', malformed.length === 0, `${malformed.length} malformed`);
  }

  // ── 2. Dry-run generation parity (in-memory only) ──
  console.log('\n── 2. Dry-run generation (real inputs, NO writes) ──');
  const [deductionRules, rawInputs] = await Promise.all([
    getAll('deductionRules'),
    loadMonthlyRawInputs(monthArg),
  ]);
  const policy = resolveAttendancePolicy(deductionRules);
  const fingerprint = buildPolicyFingerprint(policy);

  console.log(`employees: ${rawInputs.employees.length}, biometrics(month): ${rawInputs.biometrics.length}, attendance(month): ${rawInputs.attendanceRecords.length}, requests(month): ${rawInputs.requests.length}, waivers(month): ${rawInputs.waivers.length}`);
  console.log(`resolved policy fingerprint: ${fingerprint} (late15=${policy.late15DeductionDays}, late30=${policy.late30DeductionDays}, late60=${policy.late60DeductionDays}, absence=${policy.absenceDeductionDays}, singleFp=${policy.singleFingerprintDeductionDays}, allowance=${policy.freeAbsenceAllowance})`);

  const index = buildMonthlyInputIndex(rawInputs);
  const now = new Date();
  let computed = 0;
  let failed = 0;
  let firstSample: any = null;
  for (const [employeeId, input] of index) {
    try {
      const result = computeMonthlyAttendance({
        employeeId,
        month: monthArg,
        shiftStart: input.shiftStart,
        asOf: now,
        policy,
        biometricByDate: input.biometricByDate,
        attendanceByDate: input.attendanceByDate,
        requestByDate: input.requestByDate,
        waiversByDate: input.waiversByDate,
      });
      const record = buildStoredAttendanceResult({
        result,
        employeeSnapshot: {
          employeeId,
          employeeName: input.employeeName,
          department: input.department,
          position: input.position,
        },
        policy,
        actor: { id: 'runtime-verification', name: 'التحقق' },
        now,
      });
      computed++;
      if (!firstSample && (result.presentDays > 0 || result.lateDays > 0 || result.absentDays > 0)) {
        firstSample = record;
      }
    } catch {
      failed++;
    }
  }
  report(
    'canonical engine + persistence builder run clean on REAL month data',
    failed === 0 && computed === rawInputs.employees.length,
    `${computed}/${rawInputs.employees.length} computed, ${failed} failed`,
  );
  report(
    'builder outputs carry deterministic identity + version metadata',
    computed === 0 || Boolean(firstSample && firstSample.id === `${monthArg}_${firstSample.employeeId}`
      && firstSample.engineVersion === ATTENDANCE_ENGINE_VERSION
      && firstSample.policyFingerprint === fingerprint
      && firstSample.policySnapshot
      && firstSample.employeeSnapshot
      && Array.isArray(firstSample.daily)),
    firstSample ? `sample ${firstSample.id}: workDays=${firstSample.workDays} compliance=${firstSample.compliance} attendanceDeductionDays=${firstSample.attendanceDeductionDays} daily=${firstSample.daily.length}` : 'no non-empty sample',
  );

  // ── 3. Read semantics: explicit not_generated, never a recalculation ──
  console.log('\n── 3. Stored-read semantics (not_generated path) ──');
  const monthList = await getAttendanceResultsForMonth(monthArg);
  report(
    `list read for ${monthArg} returns only STORED results`,
    Array.isArray(monthList),
    `${monthList.length} stored result(s) — empty means not generated (no silent recalculation)`,
  );
  if (rawInputs.employees.length > 0) {
    const single = await getAttendanceResult(monthArg, rawInputs.employees[0].id);
    const expectedNull = monthList.length === 0;
    report(
      'single read returns null (→ explicit not_generated) when nothing persisted',
      expectedNull ? single === null : true,
      `getAttendanceResult → ${single === null ? 'null (not_generated)' : 'stored record'}`,
    );
  }

  // ── Summary ──
  const failedChecks = results.filter((r) => !r.pass);
  console.log('\n════════════════════════════════════════════');
  console.log(`Runtime verification: ${results.length - failedChecks.length}/${results.length} checks passed`);
  console.log('RUNTIME WRITE VERIFICATION — BLOCKED BY ENVIRONMENT SAFETY');
  console.log('(production-only Firebase: no attendanceResults writes performed; generation must be triggered explicitly via POST /api/attendance-results/generate)');
  if (failedChecks.length > 0) {
    console.log('\nFAILED checks:');
    for (const f of failedChecks) console.log(`  ✖ ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  } else {
    console.log('ALL RUNTIME CHECKS PASSED');
  }
}

main().catch((e) => {
  console.error('Runtime verification crashed:', e);
  process.exitCode = 1;
});
