// ══════════════════════════════════════════════════════════════
//  KPI pipeline diagnostic — READ-ONLY (zero writes).
//
//  Runs the REAL eligibility + scheme-resolution logic for a month
//  against the live database and reports, per employee:
//    status / hireDate raw + sliced / folded period start / verdict
//    / Sep observation count / scheme resolution outcome.
//
//  Usage: npx tsx --env-file=.env.local scripts/kpi-pipeline-diagnose.ts [YYYY-MM]
// ══════════════════════════════════════════════════════════════

import { getAll } from '../src/lib/db';
import { getMonthSnapshot } from '../src/lib/month-lock';
import {
  isEmployeeEligibleForPeriod,
} from '../src/lib/kpi-framework/employee-result';
import { resolveSchemeForEmployee } from '../src/lib/kpi-framework/resolution';
import { monthDayRange } from '../src/lib/kpi-framework/validation';
import { normalizeEmployeeStatus } from '../src/lib/organization/employee-status';

const PERIOD = process.argv[2] ?? '2026-09';
const { start, end } = monthDayRange(PERIOD);

async function main() {
  const [employees, events, schemes, overrides, observations, snapshot] = await Promise.all([
    getAll<any>('employees'),
    getAll<any>('employmentEvents'),
    getAll<any>('kpiSchemes'),
    getAll<any>('kpiSchemeOverrides'),
    getAll<any>('qualityObservations'),
    getMonthSnapshot(PERIOD),
  ]);

  const eventsByEmployee = new Map<string, Array<{ kind: 'archived' | 'restored'; effectiveAt: string }>>();
  for (const e of events) {
    if (e && typeof e.employeeId === 'string' && (e.kind === 'archived' || e.kind === 'restored')) {
      const list = eventsByEmployee.get(e.employeeId) ?? [];
      list.push({ kind: e.kind, effectiveAt: String(e.effectiveAt ?? '') });
      eventsByEmployee.set(e.employeeId, list);
    }
  }
  const obsCount = new Map<string, number>();
  for (const o of observations) {
    if (o?.month === PERIOD && typeof o.employeeId === 'string') {
      obsCount.set(o.employeeId, (obsCount.get(o.employeeId) ?? 0) + 1);
    }
  }

  console.log(`\n=== KPI PIPELINE DIAGNOSTIC — period ${PERIOD} [${start} .. ${end}] ===`);
  console.log(`snapshot: ${snapshot ? snapshot.status : 'NONE'} | schemes ACTIVE: ${
    schemes.filter((s: any) => s.status === 'ACTIVE').length
  } (default: ${schemes.filter((s: any) => s.isDefault && s.status === 'ACTIVE').length}) | overrides: ${overrides.length}`);
  console.log(`employees: ${employees.length} | with Sep observations: ${obsCount.size}\n`);

  const rows = employees.map((e: any) => {
    const fw = {
      id: String(e.id),
      name: String(e.name ?? ''),
      department: typeof e.department === 'string' ? e.department : null,
      status: e.status,
      hireDate: typeof e.hireDate === 'string' ? e.hireDate : null,
      createdAt: typeof e.createdAt === 'string' ? e.createdAt : undefined,
      archivedAt: typeof e.archivedAt === 'string' ? e.archivedAt : null,
    };
    const evs = eventsByEmployee.get(fw.id) ?? [];
    const eligible = isEmployeeEligibleForPeriod(fw as any, evs, PERIOD);
    const fallbackStart = fw.hireDate ?? fw.createdAt ?? null;
    const startDay = fallbackStart ? String(fallbackStart).slice(0, 10) : null;
    const resolution = eligible
      ? resolveSchemeForEmployee({ employee: fw, overrides, schemes, period: PERIOD })
      : null;
    return {
      code: e.code ?? '—',
      name: fw.name,
      status: normalizeEmployeeStatus(e.status),
      hireDateRaw: fw.hireDate,
      startDay,
      hiredAfterEnd: startDay !== null ? startDay > end : null,
      eligible,
      obs: obsCount.get(fw.id) ?? 0,
      scheme: resolution ? resolution.status : '—',
    };
  });

  console.log('--- FOCUS: employees WITH September observations ---');
  for (const r of rows.filter((r) => r.obs > 0)) {
    console.log(
      `${r.eligible ? 'ELIG' : '❌INELIG'} | obs=${String(r.obs).padStart(3)} | scheme=${r.scheme.padEnd(12)} | ${r.status.padEnd(8)} | startDay=${String(r.startDay).padEnd(12)} hireDate=${String(r.hireDateRaw).padEnd(12)} | ${r.code} ${r.name}`,
    );
  }

  console.log('\n--- Summary ---');
  const withObs = rows.filter((r) => r.obs > 0);
  const ineligWithObs = withObs.filter((r) => !r.eligible);
  console.log(`with-obs total=${withObs.length}, of which INELIGIBLE=${ineligWithObs.length}`);
  const nonIso = rows.filter((r) => r.startDay !== null && !/^\d{4}-\d{2}-\d{2}$/.test(r.startDay));
  console.log(`employees with NON-ISO effective start day-key: ${nonIso.length}`);
  for (const r of nonIso.slice(0, 40)) {
    console.log(`  nonISO startDay="${r.startDay}" hireDate="${r.hireDateRaw}" eligible=${r.eligible} | ${r.code} ${r.name}`);
  }
  console.log(`\nverdict counts: eligible=${rows.filter((r) => r.eligible).length} ineligible=${rows.filter((r) => !r.eligible).length}`);

  const target = rows.find((r) => r.code === 'EMP-075');
  if (target) {
    console.log(`\n=== EMP-075 DETAIL ===`);
    console.log(JSON.stringify(target, null, 2));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('diagnostic failed:', err);
  process.exit(1);
});
