// ══════════════════════════════════════════════════════════════
//  Authorization Core — the canonical decision layer.
//
//  Covers:
//    • canDoAction: explicit-flag resolution, level requirement,
//      admin bypass, new-action fail-closed default
//    • validatePermissionEntry: legacy entries stay valid; corrupt
//      actions/scope/sections are rejected
//    • authorize(): page → section → action → field composition,
//      deny-beats-grant, admin bypass, machine rules + explanation
//    • explainAuthorization: tier trace + per-action sources +
//      section levels — from the SAME resolver as the decision
//    • findInvalidTemplateKeys: full-shape position template guard
//    • Employee 360 section gate: inheritance, restriction, timeline
//      filtering — legacy maps unchanged
//
//  Run: npx tsx --test src/lib/permissions/__tests__/authorization-core.test.ts
// ══════════════════════════════════════════════════════════════

// MUST be the first import: installs JWT_SECRET (auth.ts refuses to
// load without it) and the in-memory db stubs (verify-permission
// imports the db layer, though these tests never touch it).
import '../../__tests__/m01-test-support';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canDoAction,
  validatePermissionEntry,
  explainAuthorization,
  resolveEffectivePermissions,
  getPermissionsForRole,
  migratePermission,
  type PermissionsMap,
} from '@/config/permissions';
import { authorize, type AuthenticatedCaller } from '@/lib/verify-permission';
import { findInvalidTemplateKeys } from '@/lib/organization/positions';
import {
  resolveEmployee360SectionGate,
  filterTimelineByGate,
} from '@/lib/permissions/employee360-access';

function callerFor(
  role: string,
  stored: Record<string, unknown> | null,
  positionTemplate?: Record<string, unknown> | null,
): AuthenticatedCaller {
  return {
    userId: 'u-test',
    role,
    permissions: resolveEffectivePermissions(role, stored, positionTemplate ?? undefined),
    linkedEmployeeId: null,
    storedPermissions: stored,
    positionTemplate: positionTemplate ?? null,
  };
}

describe('canDoAction — the canonical action resolution', () => {
  const map: PermissionsMap = {
    employees: { level: 'edit', actions: { create: true, delete: false } },
    reports: 'read',
  };

  it('explicit true flag allows; explicit false and absent flags deny', () => {
    assert.equal(canDoAction(map, 'employees', 'create'), true);
    assert.equal(canDoAction(map, 'employees', 'delete'), false);
    assert.equal(canDoAction(map, 'employees', 'export'), false); // absent = denied
  });

  it('read level can never perform actions — page visibility is not mutation authority', () => {
    assert.equal(canDoAction(map, 'reports', 'export'), false);
  });

  it('admin bypass resolves through the role parameter only', () => {
    assert.equal(canDoAction(map, 'employees', 'delete', 'admin'), true);
    assert.equal(canDoAction(map, 'employees', 'delete', 'manager'), false);
  });

  it('new ActionKey vocabulary fails closed for legacy maps', () => {
    // 'archive'/'reopen' post-date every stored map — absent flags deny.
    assert.equal(canDoAction(map, 'employees', 'archive'), false);
    assert.equal(canDoAction(getPermissionsForRole('hr'), 'employees', 'reopen'), false);
  });
});

describe('validatePermissionEntry — full-shape configuration boundary', () => {
  it('legacy string and plain-object entries remain valid', () => {
    assert.deepEqual(validatePermissionEntry('read'), []);
    assert.deepEqual(validatePermissionEntry({ level: 'edit' }), []);
    assert.deepEqual(validatePermissionEntry({ level: 'read', actions: { create: true } }), []);
  });

  it('valid extended shapes (scope / sections / new actions) validate', () => {
    assert.deepEqual(
      validatePermissionEntry({
        level: 'read',
        scope: 'team',
        sections: { hrDeductions: 'none', capa: 'read' },
        actions: { archive: true, reopen: false },
      }),
      [],
    );
  });

  it('corrupt shapes are reported, not silently repaired', () => {
    assert.ok(validatePermissionEntry({ level: 'superuser' }).length > 0);
    assert.ok(validatePermissionEntry({ level: 'edit', actions: { create: 'yes' } }).length > 0);
    assert.ok(validatePermissionEntry({ level: 'edit', actions: { galaxy: true } }).length > 0);
    assert.ok(validatePermissionEntry({ level: 'read', scope: 'galaxy' }).length > 0);
    assert.ok(validatePermissionEntry({ level: 'read', sections: { capa: 'all' } }).length > 0);
    assert.ok(validatePermissionEntry(42).length > 0);
  });
});

describe('authorize() — the single decision path', () => {
  it('page none denies view with the canonical message + rule', () => {
    const d = authorize(callerFor('user', { controlPanel: 'none' }), { page: 'controlPanel' });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'صلاحية غير كافية');
    assert.equal(d.matchedRule, 'page:none');
  });

  it('view passes on read; edit pseudo-action requires edit level', () => {
    const caller = callerFor('hr', null);
    assert.equal(authorize(caller, { page: 'home', action: 'view' }).allowed, true);
    const d = authorize(caller, { page: 'home', action: 'edit' });
    assert.equal(d.allowed, false);
    assert.equal(d.reason, 'صلاحية غير كافية - يتطلب صلاحية تعديل');
  });

  it('action requires edit level AND the explicit flag (legacy messages preserved)', () => {
    // HR preset: employees edit with create/update/delete/export.
    const caller = callerFor('hr', null);
    assert.equal(authorize(caller, { page: 'employees', action: 'create' }).allowed, true);
    // quality preset: employees is read → action denied on level.
    const quality = callerFor('quality', null);
    const levelDenied = authorize(quality, { page: 'employees', action: 'create' });
    assert.equal(levelDenied.allowed, false);
    assert.equal(levelDenied.matchedRule, 'action:page-not-edit');
    // edit level but absent flag → flag-denied.
    const flagDenied = authorize(callerFor('hr', { employees: { level: 'edit', actions: {} } }), {
      page: 'employees',
      action: 'create',
    });
    assert.equal(flagDenied.allowed, false);
    assert.equal(flagDenied.matchedRule, 'action:flag-denied');
  });

  it('deny-beats-grant: a stored restriction outranks broader inherited grants', () => {
    // Position grants employees edit+delete; the user's stored entry denies delete.
    const position = { employees: { level: 'edit', actions: { create: true, delete: true } } };
    const stored = { employees: { level: 'edit', actions: { create: true, delete: false } } };
    const d = authorize(callerFor('user', stored, position), { page: 'employees', action: 'delete' });
    assert.equal(d.allowed, false);
    // …and a stored 'none' beats the position grant entirely.
    const restricted = authorize(callerFor('user', { employees: 'none' }, position), { page: 'employees' });
    assert.equal(restricted.allowed, false);
  });

  it('section gate denies the request when the section is restricted', () => {
    const caller = callerFor('hr', {
      employee360: { level: 'read', sections: { hrDeductions: 'none' } },
    });
    const d = authorize(caller, { page: 'employee360', section: 'hrDeductions' });
    assert.equal(d.allowed, false);
    assert.equal(d.matchedRule, 'section:none');
    assert.equal(d.sectionLevel, 'none');
    // A visible section on the same map passes.
    assert.equal(authorize(caller, { page: 'employee360', section: 'attendance' }).allowed, true);
  });

  it('field gate denies hidden sensitive fields', () => {
    const reader = callerFor('manager', null); // employees read → mobile hidden
    const d = authorize(reader, { page: 'employees', field: 'mobile' });
    assert.equal(d.allowed, false);
    assert.equal(d.matchedRule, 'field:hidden');
    assert.equal(d.fieldAccess, 'hidden');
    // Editors see the field as editable.
    const editor = authorize(callerFor('hr', null), { page: 'employees', field: 'mobile' });
    assert.equal(editor.allowed, true);
    assert.equal(editor.fieldAccess, 'editable');
  });

  it('admin bypass is one rule, reported on the decision', () => {
    const d = authorize(callerFor('admin', null), { page: 'controlPanel', action: 'delete' });
    assert.equal(d.allowed, true);
    assert.equal(d.matchedRule, 'admin-bypass');
    assert.equal(d.isAdminBypass, true);
  });

  it('the decision and its explanation never diverge', () => {
    const stored: PermissionsMap = { kpiReports: { level: 'read', scope: 'department', sections: { capa: 'none' } } };
    const caller = callerFor('manager', stored);
    const d = authorize(caller, { page: 'kpiReports', section: 'capa' });
    assert.equal(d.allowed, false);
    assert.equal(d.effectiveLevel, migratePermission(caller.permissions.kpiReports).level);
    assert.equal(d.scope, 'department');
    assert.equal(d.scopeSource, 'configured');
    assert.equal(d.explanation.level, d.effectiveLevel);
    assert.equal(d.explanation.scope, d.scope);
  });
});

describe('explainAuthorization — one canonical explanation', () => {
  it('traces role → position → stored with per-action sources', () => {
    const position = { kpiReports: { level: 'edit', actions: { export: true } } };
    const stored = { kpiReports: 'read' };
    const e = explainAuthorization('quality', stored, 'kpiReports', position);
    assert.equal(e.level, 'read'); // stored beats position
    assert.equal(e.winner, 'stored');
    const view = e.actions.find((a) => a.action === 'view');
    assert.equal(view?.allowed, true);
    const exportAction = e.actions.find((a) => a.action === 'export');
    assert.equal(exportAction?.allowed, false); // read level → no export
  });

  it('resolves known sections through the single section rule', () => {
    const e = explainAuthorization('hr', {
      employee360: { level: 'read', sections: { capa: 'none' } },
    }, 'employee360');
    assert.equal(e.sections['capa'], 'none');
    assert.equal(e.sections['attendance'], 'read'); // inherited page level
  });

  it('admin explanation covers the full action surface', () => {
    const e = explainAuthorization('admin', null, 'employees');
    assert.equal(e.isAdminBypass, true);
    for (const a of e.actions) assert.equal(a.allowed, true);
  });
});

describe('findInvalidTemplateKeys — position templates carry the full shape', () => {
  it('templates with sections/scope/actions validate', () => {
    assert.deepEqual(
      findInvalidTemplateKeys({
        employees: { level: 'read', scope: 'team', sections: { hrDeductions: 'none' } },
        reports: 'read',
      }),
      [],
    );
  });

  it('corrupt entries are named', () => {
    assert.deepEqual(
      findInvalidTemplateKeys({
        employees: { level: 'edit', scope: 'galaxy' },
        reports: 'sometimes',
      }),
      ['employees', 'reports'],
    );
  });
});

describe('Employee 360 section gate — server-side withholding', () => {
  it('legacy maps (no sections) keep every section visible', () => {
    const gate = resolveEmployee360SectionGate(getPermissionsForRole('hr'));
    for (const visible of Object.values(gate)) assert.equal(visible, true);
  });

  it('explicit restrictions withhold only their sections', () => {
    const map: PermissionsMap = {
      employee360: { level: 'read', sections: { hrDeductions: 'none', capa: 'none' } },
    };
    const gate = resolveEmployee360SectionGate(map);
    assert.equal(gate.hrDeductions, false);
    assert.equal(gate.capa, false);
    assert.equal(gate.attendance, true);
    assert.equal(gate.basicInfo, true);
  });

  it('page none hides every section (page gate wins)', () => {
    const gate = resolveEmployee360SectionGate({ employee360: 'none' });
    for (const visible of Object.values(gate)) assert.equal(visible, false);
  });

  it('timeline events of denied sections are filtered out', () => {
    const map: PermissionsMap = {
      employee360: { level: 'read', sections: { capa: 'none' } },
    };
    const gate = resolveEmployee360SectionGate(map);
    const events = [
      { type: 'attendance', title: 'a' },
      { type: 'capa', title: 'c' },
      { type: 'request', title: 'r' },
    ];
    const kept = filterTimelineByGate(events, gate, map);
    assert.deepEqual(kept.map((e) => e.title), ['a', 'r']);
  });
});
