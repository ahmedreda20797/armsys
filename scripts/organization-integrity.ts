// ══════════════════════════════════════════════════════════════
//  M0.6-A — Organization link-integrity DRY RUN (READ-ONLY)
//
//  Reports the state of every organizational relationship without
//  writing a single byte:
//
//    A. Employee.orgNodeId      → org nodes
//    B. User.linkedEmployeeId   → employees (+ duplicate claims)
//    C. OrgNode.parentId        → parent existence / cycle members
//    D. Legacy employee.department free text → proposed node mapping
//    E. Historical tables .employeeId → missing employee records
//
//  Classification vocabulary: VALID | MISSING | INACTIVE_REFERENCE |
//  ORPHAN | AMBIGUOUS. Ambiguous mappings are REPORTED, never auto-
//  resolved (phase rule §23-24). This script performs ZERO writes —
//  run it any time against production data safely.
//
//  Usage: npm run integrity:organization
//         npx tsx scripts/organization-integrity.ts
// ══════════════════════════════════════════════════════════════

import { getAdminDb } from '../src/lib/firebase-server';
import {
  buildOrgIndex,
  classifyEmployeeNodeReferences,
  classifyUserEmployeeLinks,
  findDuplicateEmployeeLinks,
  findDanglingNodeParents,
  findCycleQuarantinedNodes,
  buildLegacyDepartmentNameMapping,
  classifyHistoricalEmployeeReferences,
} from '../src/lib/organization';

/** Historical employee-linked tables audited for dangling references. */
const HISTORICAL_TABLES = [
  'attendance',
  'requests',
  'biometrics',
  'qualityDeductions',
  'hrDeductions',
  'travelDeals',
  'followUps',
  'capaCases',
  'complaints',
  'qualityObservations',
] as const;

type Row = Record<string, any>;

function rows(snapshotVal: unknown): Row[] {
  if (!snapshotVal || typeof snapshotVal !== 'object') return [];
  return Object.entries(snapshotVal as Record<string, any>).map(([id, val]) => ({
    id,
    ...(val && typeof val === 'object' ? val : {}),
  }));
}

function sample<T>(items: T[], max = 10): T[] {
  return items.slice(0, max);
}

async function main() {
  console.log('═'.repeat(64));
  console.log('  ARM ERP — Organization Integrity Dry Run (M0.6-A)');
  console.log('  READ-ONLY analysis — nothing will be written');
  console.log('═'.repeat(64), '\n');

  const db = getAdminDb();
  const tablesToLoad = ['users', 'employees', 'orgNodes', ...HISTORICAL_TABLES];
  const loaded = new Map<string, Row[]>();

  await Promise.all(
    tablesToLoad.map(async (table) => {
      try {
        const snap = await db.ref(`arm_erp/${table}`).get();
        loaded.set(table, rows(snap.exists() ? snap.val() : null));
      } catch {
        loaded.set(table, []); // missing table is not an error here
      }
    }),
  );

  const users = loaded.get('users')!;
  const employees = loaded.get('employees')!;
  const orgNodes = loaded.get('orgNodes')!;
  const nodesById = new Map(orgNodes.map((n) => [n.id, n]));

  let findingBuckets = 0;
  const noteIfAny = (count: number): void => {
    if (count > 0) findingBuckets++;
  };

  // ── A. Employee → org node membership ────────────────────────
  console.log('A. Employee → Organization Node');
  const nodeRefs = classifyEmployeeNodeReferences(employees, nodesById as Map<string, any>);
  const byStatus = (status: string) => nodeRefs.filter((f) => f.status === status);
  const orphanCount = byStatus('ORPHAN').length;
  const missingNodeCount = byStatus('MISSING').length;
  const inactiveRefCount = byStatus('INACTIVE_REFERENCE').length;
  noteIfAny(missingNodeCount + inactiveRefCount);
  console.log(`   total employees           : ${employees.length}`);
  console.log(`   VALID                     : ${byStatus('VALID').length}`);
  console.log(`   ORPHAN (no assignment)    : ${orphanCount}`);
  console.log(`   MISSING (unknown node)    : ${missingNodeCount}`);
  console.log(`   INACTIVE_REFERENCE        : ${inactiveRefCount}`);
  if (missingNodeCount + inactiveRefCount > 0) {
    for (const f of sample(byStatus('MISSING').concat(byStatus('INACTIVE_REFERENCE')))) {
      console.log(`     - employee ${f.subjectId} → ${f.targetId ?? '∅'} [${f.status}] ${f.note ?? ''}`);
    }
  }

  // ── B. User ↔ Employee linkage ────────────────────────────────
  console.log('\nB. User.linkedEmployeeId → Employee');
  const employeeIds = new Set(employees.map((e) => e.id));
  const linkFindings = classifyUserEmployeeLinks(users, employeeIds);
  const duplicates = findDuplicateEmployeeLinks(users);
  noteIfAny(linkFindings.length + duplicates.length);
  console.log(`   total users               : ${users.length}`);
  console.log(`   linked to an employee     : ${users.filter((u) => u.linkedEmployeeId).length}`);
  console.log(`   MISSING (dangling link)   : ${linkFindings.length}`);
  console.log(`   AMBIGUOUS (multi-claims)  : ${duplicates.length}`);
  for (const f of sample(linkFindings)) {
    console.log(`     - user ${f.subjectId} → employee ${f.targetId ?? '∅'} [MISSING]`);
  }
  for (const d of sample(duplicates)) {
    console.log(`     - employee ${d.employeeId} claimed by users ${d.holderUserIds.join(', ')} [AMBIGUOUS]`);
  }

  // ── C. Structure sanity ───────────────────────────────────────
  console.log('\nC. Org structure');
  const danglingParents = findDanglingNodeParents(nodesById as Map<string, any>);
  const index = buildOrgIndex(orgNodes as any);
  const cycleMembers = findCycleQuarantinedNodes(orgNodes as any, index);
  noteIfAny(danglingParents.length + cycleMembers.length);
  console.log(`   nodes                     : ${orgNodes.length}`);
  console.log(`   MISSING parent references : ${danglingParents.length}`);
  console.log(`   AMBIGUOUS (cycle members) : ${cycleMembers.length}`);
  for (const d of sample(danglingParents)) {
    console.log(`     - node ${d.nodeId} has missing parent ${d.parentId}`);
  }
  for (const id of sample(cycleMembers)) {
    console.log(`     - node ${id} is part of a parentId cycle [AMBIGUOUS]`);
  }

  // ── D. Legacy free-text departments (dry-run mapping) ─────────
  console.log('\nD. Legacy employee.department text → department-node mapping proposal');
  const mapping = buildLegacyDepartmentNameMapping(
    employees,
    orgNodes.filter((n) => n.type === 'department'),
  );
  noteIfAny(mapping.ambiguous.length + mapping.unresolved.length);
  console.log(`   blank/null department     : ${mapping.blankCount}`);
  console.log(
    `   exact-unique (proposable) : ${mapping.proposed.reduce((s, p) => s + p.employeeCount, 0)} records across ${mapping.proposed.length} name(s)`,
  );
  console.log(
    `   AMBIGUOUS names           : ${mapping.ambiguous.reduce((s, a) => s + a.employeeCount, 0)} records across ${mapping.ambiguous.length} name(s)`,
  );
  console.log(
    `   UNRESOLVED names          : ${mapping.unresolved.reduce((s, u) => s + u.employeeCount, 0)} records across ${mapping.unresolved.length} name(s)`,
  );
  for (const p of sample(mapping.proposed)) {
    console.log(`     [PROPOSE ] "${p.departmentName}" → node ${p.nodeId} (${p.employeeCount} employees)`);
  }
  for (const a of sample(mapping.ambiguous)) {
    console.log(`     [AMBIG   ] "${a.departmentName}" matches nodes ${a.candidateNodeIds.join(', ')} (${a.employeeCount} employees) — manual decision required`);
  }
  for (const u of sample(mapping.unresolved)) {
    console.log(`     [UNRESOLV] "${u.departmentName}" (${u.employeeCount} employees) — no matching node`);
  }

  // ── E. Historical reference integrity ─────────────────────────
  console.log('\nE. Historical records → Employee');
  const recordsByTable: Record<string, Row[]> = {};
  for (const table of HISTORICAL_TABLES) recordsByTable[table] = loaded.get(table)!;
  const hist = classifyHistoricalEmployeeReferences(recordsByTable, employeeIds);
  if (hist.totalMissingDistinct > 0) findingBuckets++;
  console.log(`   distinct dangling ids     : ${hist.totalMissingDistinct}`);
  for (const entry of sample(hist.missingByTable)) {
    console.log(`     - ${entry.table}: ${entry.employeeIds.length} missing → ${sample(entry.employeeIds).join(', ')}`);
  }

  // ── Verdict ───────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(64));
  if (findingBuckets === 0) {
    console.log('  RESULT: CLEAN — all relationships classify as VALID.');
  } else {
    console.log(`  RESULT: ${findingBuckets} finding bucket(s) require attention.`);
    console.log('  NOTHING was written or repaired. Report these findings and');
    console.log('  resolve ambiguous cases manually before any migration.');
  }
  console.log('═'.repeat(64));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Integrity dry-run failed:', err);
    process.exit(1);
  });
