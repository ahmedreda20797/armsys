// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Position templates & permission inheritance
//
//  Covers (milestone test plan B):
//    • role → position template → stored override layering inside
//      the SINGLE resolver (resolveEffectivePermissions)
//    • template parsing / validation / normalization
//    • backward compatibility: no template = byte-identical legacy
//      resolution
//
//  Run: npx tsx --test src/lib/organization/__tests__/positions.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePositionTemplate, findInvalidTemplateKeys, normalizePositionTemplate,
} from '@/lib/organization';
import {
  resolveEffectivePermissions, migratePermission, getPermissionsForRole,
} from '@/config/permissions';

describe('position template parsing', () => {
  it('parses object and JSON-string templates (users convention)', () => {
    assert.deepEqual(parsePositionTemplate({ observations: { level: 'edit' } }), { observations: { level: 'edit' } });
    assert.deepEqual(parsePositionTemplate(JSON.stringify({ employees: 'read' })), { employees: 'read' });
  });

  it('returns null for empty/invalid templates', () => {
    assert.equal(parsePositionTemplate(null), null);
    assert.equal(parsePositionTemplate(''), null);
    assert.equal(parsePositionTemplate('not-json'), null);
    assert.equal(parsePositionTemplate({}), null);
    assert.equal(parsePositionTemplate([1, 2]), null);
  });

  it('findInvalidTemplateKeys rejects junk entries and accepts valid ones', () => {
    assert.deepEqual(findInvalidTemplateKeys({ a: 'read', b: { level: 'edit' } }), []);
    assert.deepEqual(
      findInvalidTemplateKeys({ a: 'sometimes', b: 42, c: { level: 'maybe' }, d: null }),
      ['a', 'b', 'c', 'd'],
    );
  });

  it('normalizePositionTemplate migrates every entry to the object form', () => {
    const out = normalizePositionTemplate({ a: 'read', b: { level: 'edit', actions: { delete: true } } });
    assert.deepEqual(out.a, { level: 'read', actions: {} });
    assert.deepEqual(out.b, { level: 'edit', actions: { delete: true } });
  });
});

describe('permission inheritance — role < position template < stored override', () => {
  const template = {
    observations: { level: 'edit' } as const,          // quality role already edit — no change
    kpiSettings: { level: 'edit' } as const,           // quality role 'none' → template grants
    employees: 'read' as const,                        // quality role read → stays read
  };

  it('template grants pages the role denies (middle tier)', () => {
    const effective = resolveEffectivePermissions('quality', null, template);
    assert.equal(migratePermission(effective.kpiSettings).level, 'edit');
    assert.equal(migratePermission(effective.employees).level, 'read');
  });

  it('stored override outranks BOTH role and position template', () => {
    const stored = { kpiSettings: 'none' }; // admin restriction beats the template grant
    const effective = resolveEffectivePermissions('quality', stored, template);
    assert.equal(migratePermission(effective.kpiSettings).level, 'none');
  });

  it('template cannot remove a stored grant', () => {
    const stored = { observations: { level: 'edit', actions: { approve: true } } };
    const denyTemplate = { observations: 'none' };
    const effective = resolveEffectivePermissions('quality', stored, denyTemplate);
    assert.equal(migratePermission(effective.observations).level, 'edit');
  });

  it('keys absent from the template keep the role preset', () => {
    const effective = resolveEffectivePermissions('quality', null, template);
    const preset = getPermissionsForRole('quality');
    assert.deepEqual(effective.followUps, preset.followUps);
  });

  it('WITHOUT a template, resolution is byte-identical to legacy behavior', () => {
    const stored = { employees: 'edit' };
    assert.deepEqual(
      resolveEffectivePermissions('quality', stored),
      resolveEffectivePermissions('quality', stored, null),
    );
    assert.deepEqual(
      resolveEffectivePermissions('quality', stored),
      resolveEffectivePermissions('quality', stored, undefined),
    );
  });
});
