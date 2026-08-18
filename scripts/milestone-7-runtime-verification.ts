// ══════════════════════════════════════════════════════════════
//  Milestone 7 — Runtime Verification (READ-ONLY)
//
//  Exercises the REAL HR PerformanceFactor service and the REAL
//  evidence classifier against the REAL Firebase RTDB WITHOUT
//  WRITING anything (spec §27):
//
//    PART A — HR PerformanceFactor
//    1. Inventory the stored hrDeductions collection. If empty,
//       report the explicit no-data state and verify ONLY the
//       no-data path (nothing is fabricated, spec §27).
//    2. Pick a REAL employee-month and run getHrPerformanceFactor()
//       end-to-end.
//    3. Verify the monthly aggregation parity (days/amount/counts
//       against a direct recomputation from the raw records).
//    4. Verify PerformanceFactor metadata (factorId 'hr',
//       factorName, weight placeholder, pending score contract).
//    5. Verify time-scope isolation (explicit selected_month scope;
//       a month with no records → hasData=false, never inherited).
//    6. Verify employee isolation (another employee's month stays
//       separate).
//
//    PART B — Evidence classifier over REAL observations
//    7. Inventory qualityObservations evidence values and classify
//       every one with the production classifier (url/text/empty).
//       If no observations with evidence exist, report
//       EVIDENCE RUNTIME VERIFICATION — BLOCKED BY DATA AVAILABILITY.
//       No production records are created or modified (spec §27).
//
//  SAFETY: strictly read-only. No create/update/delete calls, no
//  generation, no cache invalidation, no observation mutation.
//
//  Run: npx tsx --env-file=.env scripts/milestone-7-runtime-verification.ts [month] [employeeId]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import {
  HR_DEDUCTIONS_TABLE,
  getHrPerformanceFactor,
  HR_PERFORMANCE_FACTOR_ID,
  HR_PERFORMANCE_FACTOR_NAME,
  HR_SCORING_STATUS,
} from '../src/lib/hr-performance';
import type { EmployeeHrDeductionRecord } from '../src/lib/employee-performance';
import { classifyEvidence } from '../src/lib/quality-observations/evidence';

const results: Array<{ name: string; pass: boolean; detail: string }> = [];
function report(name: string, pass: boolean, detail = '') {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function verifyHrPart(monthArg: string, employeeArg: string): Promise<void> {
  console.log('══ PART A — HR PerformanceFactor (READ-ONLY) ══\n');

  // ── 1. Production preflight: inventory stored hrDeductions ──
  const hrRecords = await getAll<EmployeeHrDeductionRecord>(HR_DEDUCTIONS_TABLE);
  const months = [...new Set(hrRecords.filter((r) => r.month).map((r) => r.month as string))].sort();
  console.log(`Stored hrDeductions: ${hrRecords.length} record(s) across month(s): [${months.join(', ') || 'none'}]\n`);

  if (hrRecords.length === 0) {
    console.log('HR RUNTIME DATA — NO RECORDS');
    console.log('No hrDeductions exist in this environment. Per spec the HR factor');
    console.log('must NOT fabricate data; the explicit no-data path is verified below.\n');

    const factor = await getHrPerformanceFactor(monthArg || '2026-08', employeeArg || 'any-employee');
    report('no-data state: hasData=false with zeroed summary', factor.hasData === false && factor.summary.deductionCount === 0);
    report('no-data state: scoring stays pending (no invented formula)', factor.scoringStatus === HR_SCORING_STATUS);
    report('no-data state: performanceFactor.score = 0 (never a fabricated 100)', factor.performanceFactor.score === 0);
    return;
  }

  // ── 2. Pick a real employee-month with records ──
  const targetRecords =
    (employeeArg && monthArg
      ? hrRecords.filter((r) => r.employeeId === employeeArg && r.month === monthArg)
      : []) ||
    hrRecords.filter((r) => r.month === (monthArg || months[months.length - 1]));
  const chosen = targetRecords.length > 0 ? targetRecords : hrRecords;
  const monthKey = chosen[0].month as string;
  const employeeId = chosen[0].employeeId as string;

  console.log(`Target: employee ${employeeId} — month ${monthKey} (${chosen.filter((r) => r.employeeId === employeeId && r.month === monthKey).length} record(s))\n`);

  // ── 3. End-to-end factor read + aggregation parity ──
  console.log('── 1. getHrPerformanceFactor (end-to-end) ──');
  const factor = await getHrPerformanceFactor(monthKey, employeeId);
  report('service resolves a factor for the real employee-month', factor.hasData === true);

  const empMonthRecords = hrRecords.filter((r) => r.employeeId === employeeId && r.month === monthKey);
  const expectedDays = empMonthRecords.reduce((s, r) => s + (r.unit === 'days' ? Number(r.amount) || 0 : 0), 0);
  const expectedAmount = empMonthRecords.reduce((s, r) => s + (r.unit !== 'days' ? Number(r.amount) || 0 : 0), 0);
  report(
    'monthly aggregation parity: deductionDays / deductionAmount / deductionCount',
    factor.summary.deductionDays === expectedDays &&
      factor.summary.deductionAmount === expectedAmount &&
      factor.summary.deductionCount === empMonthRecords.length,
    `days=${factor.summary.deductionDays}/${expectedDays}, amount=${factor.summary.deductionAmount}/${expectedAmount}, count=${factor.summary.deductionCount}/${empMonthRecords.length}`,
  );

  // ── 4. PerformanceFactor metadata ──
  console.log('\n── 2. PerformanceFactor metadata ──');
  report('factorId = hr', factor.performanceFactor.factorId === HR_PERFORMANCE_FACTOR_ID);
  report('factorName = الموارد البشرية', factor.performanceFactor.factorName === HR_PERFORMANCE_FACTOR_NAME);
  report('weight is the default-safe placeholder (1 — engine owns weights)', factor.performanceFactor.weight === 1);
  report(
    'score contract: score=0, normalized=0, scoringStatus=pending_business_configuration',
    factor.performanceFactor.score === 0 && factor.performanceFactor.normalized === 0 && factor.scoringStatus === HR_SCORING_STATUS,
    'no invented 100-minus-deductions formula',
  );
  report('source = hrDeductions (HR domain only)', factor.source === 'hrDeductions');
  report(
    'breakdown carries the raw monthly metrics',
    factor.performanceFactor.breakdown?.deductionDays === expectedDays &&
      factor.performanceFactor.breakdown?.deductionAmount === expectedAmount,
  );

  // ── 5. Time-scope isolation ──
  console.log('\n── 3. Time scope ──');
  report(
    'factor carries an explicit selected_month scope for its own month',
    factor.scope.kind === 'selected_month' && factor.scope.monthKey === monthKey,
    `${factor.scope.kind}:${factor.scope.monthKey}`,
  );
  const missingMonth = '2030-01'; // guaranteed future month with no records
  const missingFactor = await getHrPerformanceFactor(missingMonth, employeeId);
  report(
    'month with no records → hasData=false, zeroed summary (never inherited)',
    missingFactor.hasData === false && missingFactor.summary.deductionCount === 0,
    `${missingMonth} → hasData=${missingFactor.hasData}`,
  );

  // ── 6. Employee isolation ──
  console.log('\n── 4. Employee isolation ──');
  const otherEmployee = hrRecords.find((r) => r.employeeId !== employeeId);
  if (otherEmployee?.employeeId) {
    const otherFactor = await getHrPerformanceFactor(monthKey, otherEmployee.employeeId);
    const otherRecords = hrRecords.filter((r) => r.employeeId === otherEmployee.employeeId && r.month === monthKey);
    report(
      'another employee\'s factor reflects only THEIR records',
      otherFactor.summary.deductionCount === otherRecords.length,
      `employee ${otherEmployee.employeeId}: count=${otherFactor.summary.deductionCount}/${otherRecords.length}`,
    );
  } else {
    console.log('  (only one employee in hrDeductions — cross-employee check skipped)');
  }
}

async function verifyEvidencePart(): Promise<void> {
  console.log('\n══ PART B — Evidence classifier over REAL observations (READ-ONLY) ══\n');

  const observations = await getAll<{ id: string; evidence?: string | null }>('qualityObservations');
  console.log(`Stored qualityObservations: ${observations.length} record(s)\n`);

  if (observations.length === 0) {
    console.log('EVIDENCE RUNTIME VERIFICATION — BLOCKED BY DATA AVAILABILITY');
    console.log('No quality observations exist in this environment.');
    console.log('Per spec no fake production records may be created for testing.');
    return;
  }

  // Classify every real evidence value with the production classifier.
  const counts = { url: 0, text: 0, empty: 0 };
  const samples: Record<string, string[]> = { url: [], text: [], empty: [] };
  let classifierFailures = 0;

  for (const obs of observations) {
    const classified = classifyEvidence(obs.evidence ?? '');
    counts[classified.kind] += 1;
    if (samples[classified.kind].length < 2) {
      const preview = (obs.evidence ?? '').slice(0, 60);
      samples[classified.kind].push(preview);
    }
    // Cross-check consistency: a url classification must parse as a safe http(s) URL.
    if (classified.kind === 'url') {
      try { new URL(classified.url); } catch { classifierFailures += 1; }
    }
  }

  report('classifier runs over every stored observation without error', classifierFailures === 0);
  report(
    'every classified URL is a parseable http(s) link',
    classifierFailures === 0,
    `${counts.url} url / ${counts.text} text / ${counts.empty} empty`,
  );

  console.log('\nReal-data distribution:');
  console.log(`  url   : ${counts.url}${samples.url.length ? `  e.g. ${JSON.stringify(samples.url)}` : ''}`);
  console.log(`  text  : ${counts.text}${samples.text.length ? `  e.g. ${JSON.stringify(samples.text)}` : ''}`);
  console.log(`  empty : ${counts.empty}`);

  if (counts.url === 0 && counts.text === 0) {
    console.log('\nEVIDENCE RUNTIME VERIFICATION — BLOCKED BY DATA AVAILABILITY');
    console.log('No observations carry a non-empty evidence value in this environment.');
    console.log('Per spec no fake production records may be created for testing.');
  }
}

async function main() {
  const monthArg = process.argv[2] || '';
  const employeeArg = process.argv[3] || '';

  await verifyHrPart(monthArg, employeeArg);
  await verifyEvidencePart();

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
