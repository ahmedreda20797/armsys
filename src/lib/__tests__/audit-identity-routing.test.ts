// ══════════════════════════════════════════════════════════════
//  §2 AUDIT-IDENTITY regression guards + §AOCC-ROUTING intent tests
//
//  AUDIT IDENTITY (who registered/decided a quality record):
//    • System Owner → sees it.
//    • Authorized manager / quality staff (qualityAuditLog page
//      permission) → sees it.
//    • Regular users (permission 'none' / absent) → the identity is
//      STRIPPED server-side; stored records are untouched.
//    • Legacy rows without identity fields pass through safely.
//
//  AOCC ROUTING INTENTS (store layer):
//    • 'departmentHealth' + department name → opens the department
//      context WITHOUT changing the page (§4: department contexts are
//      never misrouted to a generic page).
//    • Notification/employee360 intents keep working.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  maySeeAuditIdentity,
  stripAuditIdentity,
  shapeAuditIdentityForViewer,
  AUDIT_IDENTITY_PAGE_KEY,
} from '@/lib/audit/audit-identity';
import { useAppStore } from '@/lib/store';
import type { PermissionsMap } from '@/config/permissions';

const OWNER_MAP: PermissionsMap = { qualityAuditLog: 'edit' };
const MANAGER_MAP: PermissionsMap = { qualityAuditLog: 'read' };
const EMPLOYEE_MAP: PermissionsMap = { qualityAuditLog: 'none' };
const UNCONFIGURED_MAP: PermissionsMap = {};

describe('§2 AUDIT-IDENTITY — maySeeAuditIdentity (the permission rule)', () => {
  it('System Owner (admin bypass) sees the identity', () => {
    assert.equal(maySeeAuditIdentity('admin', EMPLOYEE_MAP), true);
    assert.equal(maySeeAuditIdentity('admin', undefined), true);
  });

  it('users granted the audit permission (read OR edit) see it', () => {
    assert.equal(maySeeAuditIdentity('manager', MANAGER_MAP), true);
    assert.equal(maySeeAuditIdentity('quality', OWNER_MAP), true);
  });

  it('regular users (none / unconfigured) do NOT see it', () => {
    assert.equal(maySeeAuditIdentity('user', EMPLOYEE_MAP), false);
    assert.equal(maySeeAuditIdentity('user', UNCONFIGURED_MAP), false);
    assert.equal(maySeeAuditIdentity('user', undefined), false);
  });

  it('the gate is the centralized qualityAuditLog page key (no hardcoded emails/roles)', () => {
    assert.equal(AUDIT_IDENTITY_PAGE_KEY, 'qualityAuditLog');
  });
});

describe('§2 AUDIT-IDENTITY — stripAuditIdentity (response shaping)', () => {
  const record = {
    id: 'q1',
    employeeId: 'e1',
    date: '01/09/2026',
    description: 'خصم جودة',
    deductionDays: 1,
    approvalStatus: 'approved',
    createdById: 'u1',
    createdByUserId: 'u1',
    createdByName: 'أحمد الموظف',
    createdByEmail: 'ahmed@example.test',
    updatedBy: 'u2',
    updatedByName: 'مدير الجودة',
    observerName: 'أحمد الموظف',
    approvalHistory: [{ action: 'approve', actorName: 'مدير الجودة' }],
  };

  it('removes WHO fields while keeping the business record intact', () => {
    const out = stripAuditIdentity(record) as Record<string, unknown>;
    assert.equal('createdById' in out, false);
    assert.equal('createdByUserId' in out, false);
    assert.equal('createdByName' in out, false);
    assert.equal('createdByEmail' in out, false);
    assert.equal('updatedBy' in out, false);
    assert.equal('updatedByName' in out, false);
    assert.equal('observerName' in out, false);
    assert.equal('approvalHistory' in out, false);
    // business record untouched:
    assert.equal(out.id, 'q1');
    assert.equal(out.approvalStatus, 'approved');
    assert.equal(out.deductionDays, 1);
    assert.equal(out.description, 'خصم جودة');
  });

  it('legacy rows WITHOUT identity fields pass through unchanged (same reference)', () => {
    const legacy = { id: 'legacy1', employeeId: 'e1', approvalStatus: 'approved' };
    assert.equal(stripAuditIdentity(legacy), legacy);
  });

  it('shapeAuditIdentityForViewer strips per-viewer (manager sees, employee does not)', () => {
    const rows = [record];
    assert.equal(shapeAuditIdentityForViewer(rows, 'manager', MANAGER_MAP)[0], record);
    const stripped = shapeAuditIdentityForViewer(rows, 'user', EMPLOYEE_MAP)[0] as Record<string, unknown>;
    assert.equal('createdByName' in stripped, false);
    // the STORED record is never mutated:
    assert.equal(record.createdByName, 'أحمد الموظف');
  });
});

describe('§AOCC-ROUTING — departmentHealth navigation intent (store)', () => {
  beforeEach(() => {
    useAppStore.setState({
      departmentHealthName: null,
      currentPage: 'operationsCenter',
      sidebarOpen: false,
      notificationPanelOpen: false,
      employee360Open: false,
      employee360Id: null,
    });
  });

  it('navigateTo("departmentHealth", deptName) opens the context WITHOUT a page change', () => {
    useAppStore.getState().navigateTo('departmentHealth', 'قسم الجودة');
    const s = useAppStore.getState();
    assert.equal(s.departmentHealthName, 'قسم الجودة');
    assert.equal(s.currentPage, 'operationsCenter', 'department context is an overlay, never a page');
  });

  it('navigateTo("departmentHealth") without a name is a safe no-op', () => {
    useAppStore.getState().navigateTo('departmentHealth');
    assert.equal(useAppStore.getState().departmentHealthName, null);
    assert.equal(useAppStore.getState().currentPage, 'operationsCenter');
  });

  it('regular navigation still changes the page (interception is scoped to intents)', () => {
    useAppStore.getState().navigateTo('capa');
    const s = useAppStore.getState();
    assert.equal(s.currentPage, 'capa');
    assert.equal(s.departmentHealthName, null);
  });

  it('notification and employee360 intents remain intact', () => {
    useAppStore.getState().navigateTo('notifications');
    assert.equal(useAppStore.getState().notificationPanelOpen, true);
    useAppStore.getState().navigateTo('employee360', 'emp-1');
    assert.equal(useAppStore.getState().employee360Open, true);
    assert.equal(useAppStore.getState().employee360Id, 'emp-1');
  });
});
