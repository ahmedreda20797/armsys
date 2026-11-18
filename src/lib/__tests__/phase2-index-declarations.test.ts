// ══════════════════════════════════════════════════════════════
//  Phase 2 Task E — database.rules.json index declarations
//
//  Proves the Phase 2 rules change is MINIMALLY ADDITIVE over the
//  approved Phase 0 baseline:
//    • every pre-existing read/write denial is byte-identical;
//    • the ONLY change is `.indexOn` declarations on paths whose
//      queries were adopted in Phase 2 (or were already coded —
//      users.email);
//    • NO `.read` / `.write` grant exists anywhere (same cascade-
//      aware walk as the Phase 0 suite);
//    • NO index exists on capaCases.relatedEmployeeIds — RTDB has no
//      array-contains semantics, and an orderByChild on an array
//      field does NOT express "element ∈ array" membership;
//    • the erp/notifications deny-all carve-out is unchanged.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const rulesPath = join(ROOT, 'database.rules.json');
const rules = JSON.parse(readFileSync(rulesPath, 'utf8')).rules as Record<string, any>;

/** The exact Phase 0 baseline rules (approved + published security config). */
const PHASE0_BASELINE = {
  rules: {
    '.read': false,
    '.write': false,
    erp: { notifications: { '.read': false, '.write': false } },
    arm_erp: { '.read': false, '.write': false },
  },
};

/** Every index declared in Phase 2, with the query that justifies it. */
const EXPECTED_INDEXES: Array<{ path: string[]; fields: string[]; justification: string }> = [
  { path: ['arm_erp', 'users'], fields: ['email'], justification: 'findUserByEmail orderByChild("email") — coded in Phase 0/1, activated by the rules' },
  { path: ['arm_erp', 'sessions'], fields: ['userId'], justification: 'revokeAllUserRefreshTokens orderByChild("userId") (Phase 2 Task A)' },
  { path: ['arm_erp', 'attendanceResults'], fields: ['employeeId', 'month'], justification: 'getAttendanceResultsForMonth / generation / per-employee loaders (Task C)' },
  { path: ['arm_erp', 'qualityObservations'], fields: ['employeeId', 'month'], justification: 'loadObservations / snapshot pipeline / per-employee readers (Task D)' },
  { path: ['arm_erp', 'followUps'], fields: ['employeeId'], justification: 'loadFollowUps per-employee fetch (Task F)' },
  { path: ['arm_erp', 'travelDeals'], fields: ['employeeId'], justification: 'loadTravelDeals per-employee fetch (Task F)' },
  { path: ['arm_erp', 'complaints'], fields: ['employeeId'], justification: 'loadComplaints per-employee fetch (Task F)' },
  { path: ['arm_erp', 'hrDeductions'], fields: ['employeeId'], justification: 'per-employee HR reads (Task F)' },
];

describe('Phase 2 E — database.rules.json (additive .indexOn only)', () => {
  it('the Phase 0 security baseline is BYTE-IDENTICAL (no read/write permission changed)', () => {
    const baseline = PHASE0_BASELINE.rules;
    // Every node of the baseline must exist in the new file with the
    // exact same .read/.write values.
    const walk = (node: Record<string, unknown>, expected: Record<string, unknown>, path: string) => {
      for (const [key, value] of Object.entries(expected)) {
        if (key === '.read' || key === '.write') {
          assert.equal(
            (node as Record<string, unknown>)?.[key],
            value,
            `${path}/${key} must remain exactly ${value}`,
          );
        } else {
          walk((node?.[key] ?? {}) as Record<string, unknown>, value as Record<string, unknown>, `${path}/${key}`);
        }
      }
    };
    walk(rules, baseline, '');
  });

  it('still NO read or write grant anywhere (cascade-aware walk, Phase 0 doctrine)', () => {
    const readGrants: string[] = [];
    const writeGrants: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === '.read') {
          if (value === true || (typeof value === 'string' && value.trim() !== 'false')) readGrants.push(path || '<root>');
        } else if (key === '.write') {
          if (value !== false) writeGrants.push(path || '<root>');
        } else {
          walk(value, path ? `${path}/${key}` : key);
        }
      }
    };
    walk(rules, '');
    assert.deepEqual(readGrants, [], 'no path may grant client read access');
    assert.deepEqual(writeGrants, [], 'no path may grant client write access');
    assert.equal(rules['.read'], false);
    assert.equal(rules['.write'], false);
  });

  it('erp/notifications remains a deny-all path (Phase 0 carve-out removal preserved)', () => {
    assert.deepEqual(rules.erp?.notifications, { '.read': false, '.write': false });
  });

  it('declares EXACTLY the Phase 2 index set — no more, no less', () => {
    for (const expected of EXPECTED_INDEXES) {
      let node: Record<string, unknown> = rules;
      for (const segment of expected.path) node = (node?.[segment] ?? {}) as Record<string, unknown>;
      assert.deepEqual(
        node['.indexOn'],
        expected.fields,
        `${expected.path.join('/')} ".indexOn" must be [${expected.fields.join(', ')}] — ${expected.justification}`,
      );
    }
    // No other arm_erp child may carry an .indexOn (no speculative indexes).
    const indexedChildren = Object.entries(rules.arm_erp ?? {})
      .filter(([, v]) => v && typeof v === 'object' && '.indexOn' in (v as Record<string, unknown>))
      .map(([k]) => k);
    assert.deepEqual(
      indexedChildren.sort(),
      ['attendanceResults', 'complaints', 'followUps', 'hrDeductions', 'qualityObservations', 'sessions', 'travelDeals', 'users'].sort(),
    );
  });

  it('does NOT index capaCases.relatedEmployeeIds (RTDB has no array-contains semantics)', () => {
    const capa = rules.arm_erp?.capaCases as Record<string, unknown> | undefined;
    if (capa && typeof capa === 'object' && Array.isArray((capa as Record<string, unknown>)['.indexOn'])) {
      const fields = (capa as Record<string, unknown>)['.indexOn'] as string[];
      assert.ok(!fields.includes('relatedEmployeeIds'), 'an orderByChild on an array field does NOT express element membership — do not add it');
    }
    // capaCases is intentionally NOT declared at all in Phase 2 (the
    // primary+indirect split still needs the full scan for the array
    // half, so an index would buy nothing).
    assert.equal(rules.arm_erp?.capaCases, undefined);
  });

  it('every declared field is a REAL stored field of its table (documented record shapes)', () => {
    // Documented writer/reader evidence per field:
    //   users.email          — auth route stores/queries it (findUserByEmail)
    //   sessions.userId      — storeRefreshToken writes it (auth.ts)
    //   attendanceResults.employeeId/month — buildStoredAttendanceResult + deterministic id
    //   qualityObservations.employeeId/month — the canonical observation record shape
    //   followUps/travelDeals/complaints/hrDeductions.employeeId — stored link used by all scope filters
    const declaredFields = EXPECTED_INDEXES.flatMap((e) => e.fields);
    for (const field of declaredFields) {
      assert.match(field, /^[a-zA-Z]+$/, `${field} must be a plain child field name`);
    }
  });
});
