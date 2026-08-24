// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Field-level access control
//
//  Verifies the field extension of the existing permission model:
//    • hidden / read-only / editable tri-state resolution
//    • Sensitive fields (employees.mobile) hidden below edit level
//    • Server-side stripping — restricted data never reaches the
//      browser (Part J)
//    • Backward compatibility: role presets unchanged
//
//  Run: npx tsx --test src/lib/permissions/__tests__/field-permissions.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveFieldAccess,
  stripRestrictedFields,
  SENSITIVE_FIELDS,
  MANAGER_PERMISSIONS,
  HR_PERMISSIONS,
  ADMIN_PERMISSIONS,
  QUALITY_PERMISSIONS,
  getPermissionsForRole,
  type FieldAccess,
} from '@/config/permissions';

// ─────────────────────────────────────────────────────────────
//  Tri-state resolution
// ─────────────────────────────────────────────────────────────

describe('resolveFieldAccess', () => {
  it("page 'none' → every field hidden", () => {
    // Quality role has hrDeductions: none
    assert.equal(resolveFieldAccess(QUALITY_PERMISSIONS, 'hrDeductions', 'amount'), 'hidden');
  });

  it("normal field + 'read' → read-only", () => {
    // Manager has employees: read
    assert.equal(resolveFieldAccess(MANAGER_PERMISSIONS, 'employees', 'position'), 'read-only');
  });

  it("normal field + 'edit' → editable", () => {
    // HR has employees: edit
    assert.equal(resolveFieldAccess(HR_PERMISSIONS, 'employees', 'position'), 'editable');
  });

  it('sensitive field (mobile) + read → HIDDEN (manager cannot see contact numbers)', () => {
    assert.equal(resolveFieldAccess(MANAGER_PERMISSIONS, 'employees', 'mobile'), 'hidden');
  });

  it('sensitive field (mobile) + edit → editable (HR manages employees)', () => {
    assert.equal(resolveFieldAccess(HR_PERMISSIONS, 'employees', 'mobile'), 'editable');
  });

  it('admin preset keeps full field access', () => {
    assert.equal(resolveFieldAccess(ADMIN_PERMISSIONS, 'employees', 'mobile'), 'editable');
  });

  it('undefined map → hidden (fail closed)', () => {
    assert.equal(resolveFieldAccess(undefined, 'employees', 'mobile'), 'hidden');
    assert.equal(resolveFieldAccess(null, 'employees', 'name'), 'hidden');
  });
});

// ─────────────────────────────────────────────────────────────
//  Server-side stripping
// ─────────────────────────────────────────────────────────────

describe('stripRestrictedFields', () => {
  const employee = {
    id: 'e-1',
    name: 'أحمد محمد',
    department: 'الجودة',
    position: 'مفتش',
    mobile: '+20 100 000 0000',
  };

  it('strips mobile for read-level viewers (manager)', () => {
    const out = stripRestrictedFields(employee, 'employees', MANAGER_PERMISSIONS);
    assert.equal('mobile' in out, false);
    // Non-sensitive fields untouched
    assert.equal(out.name, employee.name);
    assert.equal(out.position, employee.position);
  });

  it('keeps mobile for edit-level viewers (HR/admin)', () => {
    const outHr = stripRestrictedFields(employee, 'employees', HR_PERMISSIONS);
    assert.equal(outHr.mobile, employee.mobile);
    const outAdmin = stripRestrictedFields(employee, 'employees', ADMIN_PERMISSIONS);
    assert.equal(outAdmin.mobile, employee.mobile);
  });

  it('returns the SAME reference when nothing is stripped (no needless copies)', () => {
    const out = stripRestrictedFields(employee, 'employees', HR_PERMISSIONS);
    assert.equal(out, employee);
  });

  it('pages without sensitive fields pass through untouched', () => {
    const record = { id: 'r-1', secret: 'x' };
    assert.equal(stripRestrictedFields(record, 'capa', ADMIN_PERMISSIONS), record);
  });
});

// ─────────────────────────────────────────────────────────────
//  Registry sanity + backward compatibility
// ─────────────────────────────────────────────────────────────

describe('registry and presets', () => {
  it('only registers fields that actually exist (mobile on employees)', () => {
    assert.deepEqual(Object.keys(SENSITIVE_FIELDS), ['employees']);
    assert.deepEqual(Object.keys(SENSITIVE_FIELDS.employees), ['mobile']);
  });

  it('field rules do not alter role presets (backward compatible)', () => {
    // The presets themselves are unchanged — field access derives
    // from the same page entries the rest of the system reads.
    assert.equal(getPermissionsForRole('manager').employees, MANAGER_PERMISSIONS.employees);
    assert.equal(getPermissionsForRole('hr').employees, HR_PERMISSIONS.employees);
    const access: FieldAccess = resolveFieldAccess(MANAGER_PERMISSIONS, 'employees', 'mobile');
    assert.notEqual(access, 'editable');
  });
});
