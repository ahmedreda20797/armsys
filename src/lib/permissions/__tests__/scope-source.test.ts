// ══════════════════════════════════════════════════════════════
//  §Scope-source trace — explainScopeSource
//
//  The Permission Manager must show WHERE a page's effective data
//  scope came from (role / position / user override / fail-closed)
//  and the shown scope must equal the enforced one. These tests pin
//  explainScopeSource to the SAME tier behavior as
//  resolveEffectivePermissions + explainScopeResolution for every
//  combination, so the displayed source can never diverge from
//  enforcement.
//
//  Run: npx tsx --test src/lib/permissions/__tests__/scope-source.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  explainScopeSource,
  explainScopeResolution,
  resolveEffectivePermissions,
  getPermissionsForRole,
  type PermissionsMap,
} from '@/config/permissions';

const PAGE = 'employees';

/** Cross-check: the traced scope always equals the enforced scope. */
function assertAgreesWithEnforcement(
  role: string,
  stored: Record<string, unknown> | null,
  positionTemplate?: Record<string, unknown> | null,
) {
  const traced = explainScopeSource(role, stored, PAGE, positionTemplate);
  const effective = resolveEffectivePermissions(role, stored, positionTemplate ?? undefined);
  const enforced = explainScopeResolution(effective, PAGE, role);
  assert.equal(traced.scope, enforced.scope, `scope mismatch for role=${role}`);
  return traced;
}

describe('explainScopeSource — tier precedence (stored → position → role)', () => {
  it('manager preset carries the scope → source "role"', () => {
    const traced = assertAgreesWithEnforcement('manager', null);
    assert.equal(traced.scope, 'subtree');
    assert.equal(traced.source, 'role');
    assert.deepEqual(traced.chain.map((c) => c.source), ['role']);
  });

  it('a position template scope outranks the role', () => {
    const positionTemplate = { employees: { level: 'read', scope: 'team' } };
    const traced = assertAgreesWithEnforcement('manager', null, positionTemplate);
    assert.equal(traced.scope, 'team');
    assert.equal(traced.source, 'position');
    assert.deepEqual(traced.chain.map((c) => c.source), ['role', 'position']);
  });

  it('a direct user override scope outranks both tiers', () => {
    const stored = { employees: { level: 'read', scope: 'own' } };
    const positionTemplate = { employees: { level: 'read', scope: 'team' } };
    const traced = assertAgreesWithEnforcement('manager', stored, positionTemplate);
    assert.equal(traced.scope, 'own');
    assert.equal(traced.source, 'stored');
    assert.deepEqual(traced.chain.map((c) => c.source), ['role', 'position', 'stored']);
  });

  it('an override entry WITHOUT a scope inherits the tier below it', () => {
    const stored = { employees: { level: 'edit' } }; // level override only
    const traced = assertAgreesWithEnforcement('manager', stored);
    assert.equal(traced.scope, 'subtree', 'role scope survives a scope-less level override');
    assert.equal(traced.source, 'role');
  });

  it('an override STRING entry (legacy shape) inherits the tier below it', () => {
    const stored = { employees: 'edit' };
    const traced = assertAgreesWithEnforcement('manager', stored);
    assert.equal(traced.scope, 'subtree');
    assert.equal(traced.source, 'role');
  });

  it('position entry without a scope inherits the role scope', () => {
    const positionTemplate = { employees: { level: 'edit' } };
    const traced = assertAgreesWithEnforcement('manager', null, positionTemplate);
    assert.equal(traced.scope, 'subtree');
    assert.equal(traced.source, 'role');
  });
});

describe('explainScopeSource — fail-closed and bypass', () => {
  it('a generic user with no configured scope resolves fail-closed', () => {
    // The default preset carries `employees: 'read'` — no scope anywhere.
    const traced = assertAgreesWithEnforcement('user', null);
    assert.equal(traced.scope, 'own');
    assert.equal(traced.source, 'fail-closed');
    assert.equal(traced.chain.length, 0);
  });

  it('an override with an INVALID scope resolves fail-closed (never inherit)', () => {
    // The merge keeps an invalid scope; migratePermission drops it at
    // read time — the enforced result is the fail-closed default.
    const stored = { employees: { level: 'read', scope: 'everything' as never } };
    const traced = assertAgreesWithEnforcement('manager', stored);
    assert.equal(traced.scope, 'own');
    assert.equal(traced.source, 'fail-closed');
  });

  it('admin resolves all from the bypass', () => {
    const traced = explainScopeSource('admin', { employees: { level: 'read', scope: 'own' } }, PAGE);
    assert.equal(traced.scope, 'all');
    assert.equal(traced.source, 'admin');
  });
});

describe('explainScopeSource — configured ALL trace (§ALL must be explainable)', () => {
  it('a stored ALL override reports source "stored" and scope "all"', () => {
    const stored = { employees: { level: 'read', scope: 'all' } };
    const traced = assertAgreesWithEnforcement('manager', stored);
    assert.equal(traced.scope, 'all');
    assert.equal(traced.source, 'stored');
  });

  it('an HR preset scope "all" reports source "role"', () => {
    const preset = getPermissionsForRole('hr') as PermissionsMap;
    const entry = preset.employees;
    assert.equal(typeof entry === 'object' && entry !== null ? entry.scope : undefined, 'all');
    const traced = assertAgreesWithEnforcement('hr', null);
    assert.equal(traced.scope, 'all');
    assert.equal(traced.source, 'role');
  });
});

describe('explainScopeSource — non-canonical page keys stay tier-faithful', () => {
  it('a page with no entry in any tier resolves fail-closed', () => {
    const traced = explainScopeSource('user', null, 'knowledgeBase');
    assert.equal(traced.scope, 'own');
    assert.equal(traced.source, 'fail-closed');
  });
});
