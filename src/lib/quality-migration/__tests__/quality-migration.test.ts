// ══════════════════════════════════════════════════════════════
//  Milestone 6B — Legacy Quality Migration business-logic tests
//
//  Tests PURE functions only: planMigration, mapDeductionToObservation,
//  validateDeduction, extractLegacySourceId, buildMigratedSet,
//  deriveMigrationMonth, buildMigrationClientRequestId.
//  No Firebase mocking required.
//
//  Run: npx tsx --test src/lib/quality-migration/__tests__/quality-migration.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  planMigration,
  mapDeductionToObservation,
  validateDeduction,
  extractLegacySourceId,
  buildMigratedSet,
  deriveMigrationMonth,
  buildMigrationClientRequestId,
  MIGRATION_CLIENT_PREFIX,
} from '@/lib/quality-migration';
import type { MigrationContext, MigrationPlan } from '@/lib/quality-migration';
import type { QualityDeduction } from '@/types';
import type { QualityObservation } from '@/types/quality-kpi';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

const NOW = new Date('2026-08-01T10:00:00.000Z');

const ADMIN_CONTEXT: MigrationContext = {
  actorId: 'admin1',
  actorName: 'المسؤول',
};

/** Categories fixture — includes a "migrated" category. */
const CATEGORIES = [
  { id: 'cat1', name: 'غياب', weight: 2, defaultPointValue: 5 },
  { id: 'migrated', name: 'خصم مرحل', weight: 1, defaultPointValue: 3 },
];

/** Employee map fixture. */
function makeEmpMap(
  overrides?: Record<string, { name: string; department: string | null; position: string | null }>,
) {
  const base = new Map<string, { name: string; department: string | null; position: string | null }>();
  base.set('emp1', { name: 'أحمد محمد', department: 'مبيعات', position: 'مدير' });
  base.set('emp2', { name: 'سارة علي', department: 'عمليات', position: 'موظف' });
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      base.set(k, v);
    }
  }
  return base;
}

/** Create a valid legacy deduction record. */
function makeDeduction(
  overrides: Partial<QualityDeduction> = {},
): QualityDeduction {
  return {
    id: 'legacy_001',
    employeeId: 'emp1',
    date: '15/07/2026',
    type: 'deduction',
    description: 'تأخر عن العمل',
    deductionDays: 2,
    deductionAmount: 0,
    evidence: null,
    month: '2026-07',
    relatedCapaId: null,
    createdAt: '2026-07-15T08:00:00.000Z',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
//  buildMigrationClientRequestId
// ══════════════════════════════════════════════════════════════

describe('Migration — buildMigrationClientRequestId', () => {
  it('creates prefixed idempotency key', () => {
    const key = buildMigrationClientRequestId('legacy_001');
    assert.equal(key, `${MIGRATION_CLIENT_PREFIX}legacy_001`);
  });

  it('contains the source ID verbatim', () => {
    const key = buildMigrationClientRequestId('abc-123');
    assert.ok(key.endsWith('abc-123'));
    assert.ok(key.startsWith(MIGRATION_CLIENT_PREFIX));
  });
});

// ══════════════════════════════════════════════════════════════
//  extractLegacySourceId — dual convention detection
// ══════════════════════════════════════════════════════════════

describe('Migration — extractLegacySourceId', () => {
  it('detects new clientRequestId convention', () => {
    const obs = {
      clientRequestId: buildMigrationClientRequestId('legacy_001'),
      createdByName: 'المسؤول',
      notes: '',
    };
    assert.equal(extractLegacySourceId(obs), 'legacy_001');
  });

  it('detects old __system_migration__ convention with [source:id] in notes', () => {
    const obs = {
      clientRequestId: null,
      createdByName: '__system_migration__',
      notes: 'Some notes [source:legacy_001] end',
    };
    assert.equal(extractLegacySourceId(obs), 'legacy_001');
  });

  it('returns null for regular (non-migrated) observations', () => {
    const obs = {
      clientRequestId: 'user_xyz',
      createdByName: 'أحمد',
      notes: 'Regular observation',
    };
    assert.equal(extractLegacySourceId(obs), null);
  });

  it('returns null when createdByName matches but no [source:id] in notes', () => {
    const obs = {
      clientRequestId: null,
      createdByName: '__system_migration__',
      notes: 'No source marker here',
    };
    assert.equal(extractLegacySourceId(obs), null);
  });

  it('returns null when clientRequestId is null and no legacy marker', () => {
    const obs = {
      clientRequestId: null,
      createdByName: 'أحمد',
      notes: '',
    };
    assert.equal(extractLegacySourceId(obs), null);
  });
});

// ══════════════════════════════════════════════════════════════
//  buildMigratedSet
// ══════════════════════════════════════════════════════════════

describe('Migration — buildMigratedSet', () => {
  it('builds set from new convention observations', () => {
    const obs = [
      { clientRequestId: buildMigrationClientRequestId('a'), createdByName: '', notes: '' },
      { clientRequestId: buildMigrationClientRequestId('b'), createdByName: '', notes: '' },
    ];
    const set = buildMigratedSet(obs);
    assert.ok(set.has('a'));
    assert.ok(set.has('b'));
    assert.equal(set.size, 2);
  });

  it('builds set from mixed conventions', () => {
    const obs = [
      { clientRequestId: buildMigrationClientRequestId('x'), createdByName: '', notes: '' },
      { clientRequestId: null, createdByName: '__system_migration__', notes: '[source:y]' },
      { clientRequestId: null, createdByName: 'regular', notes: '' },
    ];
    const set = buildMigratedSet(obs);
    assert.ok(set.has('x'));
    assert.ok(set.has('y'));
    assert.equal(set.size, 2); // third is not migrated
  });

  it('returns empty set for no observations', () => {
    const set = buildMigratedSet([]);
    assert.equal(set.size, 0);
  });
});

// ══════════════════════════════════════════════════════════════
//  validateDeduction
// ══════════════════════════════════════════════════════════════

describe('Migration — validateDeduction', () => {
  it('valid record passes', () => {
    const result = validateDeduction(makeDeduction());
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it('missing id fails', () => {
    const result = validateDeduction(makeDeduction({ id: undefined as unknown as string }));
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('ID'));
  });

  it('missing employeeId fails', () => {
    const result = validateDeduction(makeDeduction({ employeeId: undefined as unknown as string }));
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('employeeId'));
  });

  it('missing date fails', () => {
    const result = validateDeduction(makeDeduction({ date: undefined as unknown as string }));
    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('date'));
  });
});

// ══════════════════════════════════════════════════════════════
//  deriveMigrationMonth
// ══════════════════════════════════════════════════════════════

describe('Migration — deriveMigrationMonth', () => {
  it('parses DD/MM/YYYY format', () => {
    assert.equal(deriveMigrationMonth('15/07/2026'), '2026-07');
  });

  it('parses YYYY-MM-DD format', () => {
    assert.equal(deriveMigrationMonth('2026-07-15'), '2026-07');
  });

  it('uses fallback month when provided', () => {
    assert.equal(deriveMigrationMonth('15/07/2026', '2026-08'), '2026-08');
  });

  it('falls back to current month for unparseable date', () => {
    const result = deriveMigrationMonth('not-a-date');
    // Should be a valid YYYY-MM string
    assert.ok(/^\d{4}-\d{2}$/.test(result));
  });
});

// ══════════════════════════════════════════════════════════════
//  mapDeductionToObservation
// ══════════════════════════════════════════════════════════════

describe('Migration — mapDeductionToObservation', () => {
  it('creates an observation with correct field mapping', () => {
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded,
      'أحمد محمد',
      'مبيعات',
      'مدير',
      CATEGORIES[0],
      ADMIN_CONTEXT,
      NOW,
    );

    assert.equal(obs.employeeId, 'emp1');
    assert.equal(obs.employeeName, 'أحمد محمد');
    assert.equal(obs.department, 'مبيعات');
    assert.equal(obs.positionSnapshot, 'مدير');
    assert.equal(obs.observerId, 'admin1');
    assert.equal(obs.observerName, 'المسؤول');
    assert.equal(obs.observationDate, '15/07/2026');
    assert.equal(obs.month, '2026-07');
    assert.equal(obs.type, 'deduction');
    assert.equal(obs.severity, 'medium');
    assert.equal(obs.categoryId, 'cat1');
    assert.equal(obs.categoryName, 'غياب');
    assert.equal(obs.notes, 'تأخر عن العمل');
    assert.equal(obs.evidence, '');
    assert.equal(obs.status, 'closed');
    assert.equal(obs.relatedCapaId, null);
    assert.equal(obs.applyPointDeduction, true);
    assert.equal(obs.points, 2); // deductionDays = 2
    assert.equal(obs.isBonus, false);
    assert.equal(obs.approvalStatus, 'approved');
    assert.equal(obs.resolvedDate, '2026-07-15T08:00:00.000Z');
  });

  it('uses deductionAmount when deductionDays is 0', () => {
    const ded = makeDeduction({ deductionDays: 0, deductionAmount: 5 });
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.points, 5);
  });

  it('points is 0 when neither deductionDays nor deductionAmount', () => {
    const ded = makeDeduction({ deductionDays: 0, deductionAmount: 0 });
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.points, 0);
  });

  it('every migrated observation has approval history', () => {
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.ok(Array.isArray(obs.approvalHistory));
    assert.ok(obs.approvalHistory!.length > 0, 'must have at least one approval event');
    assert.equal(obs.approvalHistory![0].action, 'approve');
    assert.ok(obs.approvalHistory![0].notes?.includes('Migrated'));
  });

  it('migrated records are approved (approvalStatus)', () => {
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.approvalStatus, 'approved');
  });

  it('clientRequestId uses the explicit migration prefix', () => {
    const ded = makeDeduction({ id: 'legacy_xyz' });
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.clientRequestId, `${MIGRATION_CLIENT_PREFIX}legacy_xyz`);
  });

  it('uses fallback category when category is null', () => {
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', null, ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.categoryId, '_migrated');
    assert.equal(obs.categoryName, 'خصم مرحل');
  });

  it('resolves "migrated" category when present in categories list', () => {
    // planMigration passes the full categories list and resolveDefaultCategory
    // prefers the "migrated" category. Verify that mapDeductionToObservation
    // uses whatever category is passed.
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير',
      { id: 'migrated', name: 'خصم مرحل', weight: 1 },
      ADMIN_CONTEXT, NOW,
    );
    assert.equal(obs.categoryId, 'migrated');
  });

  it('has audit log entry', () => {
    const ded = makeDeduction();
    const obs = mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.ok(Array.isArray(obs.auditLog));
    assert.ok(obs.auditLog.length > 0);
    assert.equal(obs.auditLog[0].action, 'create');
  });

  it('legacy records are never touched (map is pure — no input mutation)', () => {
    const ded = makeDeduction();
    const dedClone = JSON.parse(JSON.stringify(ded));
    mapDeductionToObservation(
      ded, 'أحمد محمد', 'مبيعات', 'مدير', CATEGORIES[0], ADMIN_CONTEXT, NOW,
    );
    assert.deepEqual(ded, dedClone, 'input must not be mutated');
  });
});

// ══════════════════════════════════════════════════════════════
//  planMigration — pure batch planner
// ══════════════════════════════════════════════════════════════

describe('Migration — planMigration', () => {
  it('migration creates observations from legacy records', () => {
    const deductions = [makeDeduction({ id: 'l1' }), makeDeduction({ id: 'l2' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 2);
    assert.equal(plan.summary.scanned, 2);
    assert.equal(plan.summary.migrated, 2);
    assert.equal(plan.summary.success, true);
    // Each created observation should be approved.
    for (const obs of plan.toCreate) {
      assert.equal(obs.approvalStatus, 'approved');
    }
  });

  it('every migrated observation has approval history', () => {
    const deductions = [makeDeduction({ id: 'l1' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.ok(plan.toCreate[0].approvalHistory.length > 0);
  });

  it('migration is idempotent (second run creates zero duplicates)', () => {
    const deductions = [makeDeduction({ id: 'l1' }), makeDeduction({ id: 'l2' })];
    const migratedSet = new Set(['l1']); // l1 already migrated
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 1, 'only l2 should be created');
    assert.equal(plan.summary.alreadyMigrated, 1);
    assert.equal(plan.summary.migrated, 1);
    assert.equal(plan.toCreate[0].employeeId, 'emp1');
  });

  it('full idempotency: second run with same set creates nothing', () => {
    const deductions = [makeDeduction({ id: 'l1' }), makeDeduction({ id: 'l2' })];
    const migratedSet = new Set(['l1', 'l2']);
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 0);
    assert.equal(plan.summary.alreadyMigrated, 2);
    assert.equal(plan.summary.migrated, 0);
    assert.equal(plan.summary.scanned, 2);
  });

  it('malformed legacy record reported without corrupting valid records', () => {
    const deductions = [
      makeDeduction({ id: 'valid1' }),
      makeDeduction({ id: undefined as unknown as string, employeeId: '' }),
      makeDeduction({ id: 'valid2' }),
    ];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.summary.scanned, 3);
    assert.equal(plan.summary.migrated, 2, 'two valid records migrated');
    assert.equal(plan.summary.skipped, 1, 'one malformed record skipped');
    assert.equal(plan.summary.failed, 0);
    assert.equal(plan.summary.errors.length, 1);
    assert.ok(plan.summary.errors[0].reason.includes('Missing'));
    // Valid records are in toCreate.
    assert.equal(plan.toCreate.length, 2);
  });

  it('missing employeeId is skipped', () => {
    const deductions = [
      makeDeduction({ id: 'no_emp', employeeId: undefined as unknown as string }),
    ];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.summary.skipped, 1);
    assert.equal(plan.summary.migrated, 0);
    assert.equal(plan.toCreate.length, 0);
  });

  it('missing date is skipped', () => {
    const deductions = [
      makeDeduction({ id: 'no_date', date: undefined as unknown as string }),
    ];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.summary.skipped, 1);
    assert.equal(plan.toCreate.length, 0);
  });

  it('legacy records remain untouched (input not mutated)', () => {
    const deductions = [makeDeduction({ id: 'l1' })];
    const clones = deductions.map(d => JSON.parse(JSON.stringify(d)));
    planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.deepEqual(deductions, clones);
  });

  it('invariant: scanned = migrated + alreadyMigrated + skipped + failed', () => {
    const deductions = [
      makeDeduction({ id: 'a' }),
      makeDeduction({ id: 'b' }),
      makeDeduction({ id: 'c' }), // already migrated
      makeDeduction({ id: undefined as unknown as string }), // malformed
    ];
    const migratedSet = new Set(['c']);
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    const { scanned, migrated, alreadyMigrated, skipped, failed } = plan.summary;
    assert.equal(scanned, 4);
    assert.equal(scanned, migrated + alreadyMigrated + skipped + failed,
      `invariant broken: ${scanned} != ${migrated} + ${alreadyMigrated} + ${skipped} + ${failed}`);
  });

  it('dry-run flag is reflected in summary', () => {
    const deductions = [makeDeduction({ id: 'l1' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT,
      { dryRun: true, now: NOW },
    );
    assert.equal(plan.summary.dryRun, true);
  });

  it('non-dry-run flag is reflected in summary', () => {
    const deductions = [makeDeduction({ id: 'l1' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT,
      { dryRun: false, now: NOW },
    );
    assert.equal(plan.summary.dryRun, false);
  });

  it('empty deductions returns empty plan', () => {
    const plan = planMigration(
      [], new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 0);
    assert.equal(plan.summary.scanned, 0);
    assert.equal(plan.summary.migrated, 0);
    assert.equal(plan.summary.success, true);
  });

  it('resolves employee name from empMap', () => {
    const deductions = [makeDeduction({ id: 'l1', employeeId: 'emp2' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate[0].employeeName, 'سارة علي');
    assert.equal(plan.toCreate[0].department, 'عمليات');
  });

  it('unknown employee gets fallback name and department', () => {
    const deductions = [makeDeduction({ id: 'l1', employeeId: 'unknown_emp' })];
    const plan = planMigration(
      deductions, new Set(), makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate[0].employeeName, 'غير معروف');
    assert.equal(plan.toCreate[0].department, 'غير محدد');
  });

  it('migration summary counts are accurate', () => {
    const deductions = [
      makeDeduction({ id: 'v1' }),
      makeDeduction({ id: 'v2' }),
      makeDeduction({ id: 'done1' }), // already migrated
      makeDeduction({ id: undefined as unknown as string, employeeId: '' }), // no id → skip
      makeDeduction({ id: 'nodate', date: undefined as unknown as string }), // no date → skip
    ];
    const migratedSet = new Set(['done1']);
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.summary.scanned, 5);
    assert.equal(plan.summary.migrated, 2);
    assert.equal(plan.summary.alreadyMigrated, 1);
    assert.equal(plan.summary.skipped, 2);
    assert.equal(plan.summary.failed, 0);
    assert.equal(plan.summary.errors.length, 2);
    assert.equal(plan.toCreate.length, 2);
  });
});

// ══════════════════════════════════════════════════════════════
//  Cross-endpoint idempotency
// ══════════════════════════════════════════════════════════════

describe('Migration — cross-endpoint idempotency', () => {
  it('observations from old migration route are recognised as already migrated', () => {
    // Simulate an observation created by the old /api/quality-migration route.
    const existingObs = [
      {
        clientRequestId: null,
        createdByName: '__system_migration__',
        notes: 'Migrated from legacy [source:legacy_001]',
      },
    ];
    const migratedSet = buildMigratedSet(existingObs);
    assert.ok(migratedSet.has('legacy_001'));

    const deductions = [makeDeduction({ id: 'legacy_001' })];
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 0);
    assert.equal(plan.summary.alreadyMigrated, 1);
  });

  it('observations from new route are recognised as already migrated', () => {
    const existingObs = [
      {
        clientRequestId: buildMigrationClientRequestId('legacy_002'),
        createdByName: 'المسؤول',
        notes: '',
      },
    ];
    const migratedSet = buildMigratedSet(existingObs);
    assert.ok(migratedSet.has('legacy_002'));

    const deductions = [makeDeduction({ id: 'legacy_002' })];
    const plan = planMigration(
      deductions, migratedSet, makeEmpMap(), CATEGORIES, ADMIN_CONTEXT, { now: NOW },
    );
    assert.equal(plan.toCreate.length, 0);
    assert.equal(plan.summary.alreadyMigrated, 1);
  });
});
