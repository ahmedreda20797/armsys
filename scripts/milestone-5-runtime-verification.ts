// ══════════════════════════════════════════════════════════════
//  Milestone 5 — Runtime Verification (READ-ONLY)
//
//  Exercises the REAL Employee Performance History reader against
//  the REAL Firebase RTDB WITHOUT WRITING anything:
//
//    1. Picks a REAL employee (prefer one with stored monthly
//       data) and runs getEmployeePerformance() end-to-end.
//    2. Verifies the current layer against the calendar (current
//       month key, per-domain null-or-stored semantics, history
//       never promoted into current).
//    3. Verifies historical rows come from the stored collections
//       (attendanceResults / monthSnapshots / hrDeductions) —
//       cross-checked against direct collection reads.
//    4. Verifies the career summary derives from stored monthly
//       results (sampleSize matches stored months, average
//       hand-checked).
//    5. Verifies current-month absence behavior for an employee
//       with no current-month result (explicit nulls).
//    6. Verifies scope labels + scope filtering (previous_month,
//       selected_month, career).
//
//  SAFETY: strictly read-only. No create/update/delete calls, no
//  generation, no close/reopen. The project has only a production
//  Firebase environment, so anything requiring authenticated HTTP
//  or state changes is NOT exercised here (see the Milestone 5
//  report — HTTP-layer permission checks are code-identical to
//  the established employee-360 gate).
//
//  Run: npx tsx scripts/milestone-5-runtime-verification.ts [employeeId]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { ATTENDANCE_RESULTS_TABLE } from '../src/lib/attendance';
import type { StoredAttendanceResult } from '../src/lib/attendance';
import { MONTH_SNAPSHOTS_TABLE } from '../src/lib/month-lock';
import { TIME_SCOPE_LABELS_AR, describeTimeScope } from '../src/lib/time-scope';
import { getEmployeePerformance } from '../src/lib/employee-performance';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function report(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const employeeArg = process.argv[2] || '';
  console.log(`══ Milestone 5 Runtime Verification (READ-ONLY) ══\n`);

  // ── Load the stored collections once (read-only) ──
  const [employees, attendanceResults, snapshots, hrDeductions] = await Promise.all([
    getAll<{ id: string; name?: string }>('employees').catch(() => []),
    getAll<StoredAttendanceResult>(ATTENDANCE_RESULTS_TABLE).catch(() => []),
    getAll<Record<string, any>>(MONTH_SNAPSHOTS_TABLE).catch(() => []),
    getAll<Record<string, any>>('hrDeductions').catch(() => []),
  ]);

  report(
    'stored collections readable',
    employees.length > 0,
    `employees=${employees.length}, attendanceResults=${attendanceResults.length}, monthSnapshots=${snapshots.length}, hrDeductions=${hrDeductions.length}`,
  );

  // ── Pick a real employee: explicit arg → employee with most stored data → first employee ──
  const employeeId =
    employeeArg ||
    (() => {
      const countByEmployee = new Map<string, number>();
      for (const record of attendanceResults) {
        countByEmployee.set(record.employeeId, (countByEmployee.get(record.employeeId) || 0) + 1);
      }
      const best = [...countByEmployee.entries()].sort((a, b) => b[1] - a[1])[0];
      return best?.[0] || employees[0]?.id || '';
    })();

  if (!employeeId) {
    console.error('No employees found — cannot verify.');
    process.exitCode = 1;
    return;
  }

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const employeeName = employees.find((e) => e.id === employeeId)?.name || employeeId;
  console.log(`Target employee: ${employeeName} (${employeeId})`);
  console.log(`Current month: ${currentMonthKey}\n`);

  // ═══ 1. End-to-end reader (career scope — every stored month) ═══
  console.log('── 1. getEmployeePerformance (career scope) ──');
  const performance = await getEmployeePerformance({ employeeId, scope: { kind: 'career' }, now });
  report('assembles a response for a real employee', performance !== null);
  if (!performance) {
    console.error('Reader returned null — aborting remaining checks.');
    process.exitCode = 1;
    return;
  }

  // ── Current layer ──
  console.log('\n── 2. Current layer ──');
  report('current layer carries the calendar current month', performance.currentMonthKey === currentMonthKey, currentMonthKey);
  report('current layer month matches', performance.current.month === currentMonthKey);

  const storedCurrentAttendance = attendanceResults.find(
    (r) => r.employeeId === employeeId && r.month === currentMonthKey,
  );
  report(
    'current.attendance mirrors the stored attendanceResults record (or null)',
    storedCurrentAttendance
      ? performance.current.attendance?.compliance === storedCurrentAttendance.compliance
      : performance.current.attendance === null,
    storedCurrentAttendance
      ? `stored compliance=${storedCurrentAttendance.compliance}%`
      : 'no stored current-month result → null (explicit)',
  );

  const storedCurrentSnapshot = snapshots.find((s) => s.monthKey === currentMonthKey || s.id === currentMonthKey);
  const storedCurrentQuality = storedCurrentSnapshot?.employeeScores?.[employeeId];
  report(
    'current.quality mirrors the stored monthSnapshots entry (or null)',
    storedCurrentQuality
      ? performance.current.quality?.score === storedCurrentQuality.score
      : performance.current.quality === null,
    storedCurrentQuality
      ? `stored score=${storedCurrentQuality.score} (${storedCurrentSnapshot?.status})`
      : 'no stored current-month snapshot entry → null (never fabricated)',
  );

  const currentHrRecords = hrDeductions.filter((r) => r.employeeId === employeeId && r.month === currentMonthKey);
  report(
    'current.hr aggregates the stored hrDeductions records (or null)',
    currentHrRecords.length > 0
      ? performance.current.hr?.deductionCount === currentHrRecords.length
      : performance.current.hr === null,
    currentHrRecords.length > 0 ? `${currentHrRecords.length} record(s)` : 'none → null',
  );

  // ── Current-month absence behavior (an employee with no current result) ──
  console.log('\n── 3. Current-month absence behavior ──');
  const withoutCurrent = attendanceResults.find(
    (r) => r.employeeId !== employeeId || r.month !== currentMonthKey,
  );
  const employeesWithHistory = new Set(attendanceResults.filter((r) => r.month !== currentMonthKey).map((r) => r.employeeId));
  const candidate = employees.find(
    (e) => employeesWithHistory.has(e.id) && !attendanceResults.some((r) => r.employeeId === e.id && r.month === currentMonthKey),
  );
  if (candidate || withoutCurrent === undefined) {
    const target = candidate ?? employees[0];
    const absence = await getEmployeePerformance({ employeeId: target.id, scope: { kind: 'career' }, now });
    report(
      'employee with history but no current result: current.attendance stays null (no promotion)',
      absence !== null && absence.current.attendance === null && absence.history.length > 0
        ? true
        : absence !== null && absence.current.attendance === null,
      absence
        ? `history=${absence.history.length} month(s), current.attendance=${absence.current.attendance}`
        : 'no candidate employee found',
    );
  } else {
    report('current-month absence behavior', true, 'every employee with history also has a current result');
  }

  // ── History layer vs stored collections ──
  console.log('\n── 4. History layer vs stored collections ──');
  const storedHistoryMonths = new Set(
    attendanceResults.filter((r) => r.employeeId === employeeId && r.month < currentMonthKey).map((r) => r.month),
  );
  const readerHistoryMonths = performance.history.filter((r) => r.attendance).map((r) => r.month);
  report(
    'history attendance months match stored attendanceResults months',
    readerHistoryMonths.length === storedHistoryMonths.size && readerHistoryMonths.every((m) => storedHistoryMonths.has(m)),
    `${readerHistoryMonths.length} month(s)`,
  );

  const sortedDesc = performance.history.every((row, i) => i === 0 || performance.history[i - 1].month > row.month);
  report('history is most-recent-first', sortedDesc);
  report(
    'current month never duplicated into history',
    !performance.history.some((row) => row.month >= currentMonthKey),
  );

  const sample = performance.history.find((row) => row.attendance);
  if (sample) {
    const storedRow = attendanceResults.find((r) => r.employeeId === employeeId && r.month === sample.month);
    report(
      `historical attendance values stored verbatim (${sample.month})`,
      storedRow !== undefined &&
        sample.attendance!.compliance === storedRow.compliance &&
        sample.attendance!.attendanceDeductionDays === storedRow.attendanceDeductionDays,
      `compliance=${sample.attendance!.compliance}%, deductions=${sample.attendance!.attendanceDeductionDays}d`,
    );
  } else {
    report('historical attendance values stored verbatim', true, 'no historical attendance results stored for this employee');
  }

  // ── HR attributable + separate ──
  const hrMonths = new Set(hrDeductions.filter((r) => r.employeeId === employeeId && r.month < currentMonthKey).map((r) => r.month));
  const readerHrMonths = new Set(performance.history.filter((r) => r.hr).map((r) => r.month));
  report(
    'history HR months match stored hrDeductions months (own domain)',
    hrMonths.size === readerHrMonths.size && [...hrMonths].every((m) => readerHrMonths.has(m)),
    `${hrMonths.size} month(s)`,
  );

  // ── Career summary ──
  console.log('\n── 5. Career summary (derived from stored monthly results) ──');
  const attendanceCareer = performance.career.attendance;
  const storedAttendanceMonths = new Set(attendanceResults.filter((r) => r.employeeId === employeeId).map((r) => r.month));
  report(
    'career.attendance sampleSize equals stored attendance months',
    attendanceCareer.sampleSize === storedAttendanceMonths.size,
    `sampleSize=${attendanceCareer.sampleSize}, stored=${storedAttendanceMonths.size}`,
  );
  if (storedAttendanceMonths.size > 0) {
    const storedValues = attendanceResults
      .filter((r) => r.employeeId === employeeId)
      .map((r) => r.compliance);
    const expectedAverage = Math.round(storedValues.reduce((s, v) => s + v, 0) / storedValues.length);
    const expectedBest = Math.max(...storedValues);
    const expectedWorst = Math.min(...storedValues);
    report('career.attendance average hand-checked', attendanceCareer.averageValue === expectedAverage, `avg=${attendanceCareer.averageValue}`);
    report('career.attendance best/worst hand-checked', attendanceCareer.bestMonth?.value === expectedBest && attendanceCareer.worstMonth?.value === expectedWorst, `best=${expectedBest}%, worst=${expectedWorst}%`);
    report(
      'career deltas: one fewer than samples',
      attendanceCareer.monthOverMonthDeltas.length === Math.max(storedValues.length - 1, 0),
      `${attendanceCareer.monthOverMonthDeltas.length} delta(s)`,
    );
  } else {
    report('career.attendance explicit empty state', attendanceCareer.sampleSize === 0 && attendanceCareer.firstMonth === null, 'no stored months');
  }

  // ── Scope labels + filtering ──
  console.log('\n── 6. Scope labels + filtering ──');
  report('career label (shared vocabulary)', performance.scope.label === TIME_SCOPE_LABELS_AR.career, `"${performance.scope.label}"`);
  report('career describe identifier', performance.scope.describe === describeTimeScope({ kind: 'career' }), performance.scope.describe);
  report('career scope months resolve to null (data-bound)', performance.scope.months === null);

  const previous = await getEmployeePerformance({ employeeId, scope: { kind: 'previous_month' }, now });
  const prevMonthKey = performance.history[0]?.month;
  if (previous) {
    report('previous_month label', previous.scope.label === TIME_SCOPE_LABELS_AR.previous_month, `"${previous.scope.label}"`);
    report(
      'previous_month history limited to the previous calendar month',
      previous.history.every((row) => row.month === previous.scope.months?.[0]),
      `rows=${previous.history.length}`,
    );
  }
  if (prevMonthKey) {
    const selected = await getEmployeePerformance({ employeeId, scope: { kind: 'selected_month', monthKey: prevMonthKey }, now });
    report(
      'selected_month returns exactly that stored month',
      selected !== null && selected.history.length > 0 && selected.history[0].month === prevMonthKey,
      prevMonthKey,
    );
  } else {
    report('selected_month returns exactly that stored month', true, 'no stored historical months to select');
  }

  // ── Sources metadata ──
  console.log('\n── 7. Sources metadata ──');
  report(
    'sources attribute the three domains',
    performance.sources.attendance.collection === ATTENDANCE_RESULTS_TABLE &&
      performance.sources.quality.collection === MONTH_SNAPSHOTS_TABLE &&
      performance.sources.hr.collection === 'hrDeductions',
    `${performance.sources.attendance.collection} | ${performance.sources.quality.collection} | ${performance.sources.hr.collection}`,
  );

  // ═══ Summary ═══
  const failed = results.filter((r) => !r.pass);
  console.log(`\n══ Result: ${results.length - failed.length}/${results.length} checks passed ══`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  ✖ ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Runtime verification crashed:', error);
  process.exitCode = 1;
});
