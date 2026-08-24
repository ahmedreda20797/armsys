// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Notification routing (write side) + the new
//  directed dimensions of the read-side rule.
//
//  Covers (milestone test plan F):
//    • recipient resolution per dimension (user / role / org node
//      manager / employee reporting chain / assignee)
//    • deduplication across dimensions
//    • permission filtering of routed recipients (content gate)
//    • read-side: recipientUserIds match + linkedEmployeeId match
//      (closes the Milestone 9 data-model gap)
//
//  Run: npx tsx --test src/lib/notifications/__tests__/routing.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveNotificationRecipients, type RoutingUser, type RoutingContext,
} from '@/lib/notifications/routing';
import {
  canSeeNotification, isDirectedNotification, type NotificationViewer,
} from '@/lib/notifications/recipient-visibility';
import { getPermissionsForRole } from '@/config/permissions';
import type { OrgNode, OrgEmployeeRef } from '@/lib/organization';

function node(id: string, type: OrgNode['type'], parentId: string | null, managerUserId: string | null = null): OrgNode {
  return {
    id, name: id, type, parentId, managerUserId, managerUserName: null,
    status: 'active', order: 0, description: null,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function user(id: string, role: string): RoutingUser {
  return { id, role, permissions: getPermissionsForRole(role) };
}

/**
 * company ── sales (manager: uSalesMgr)
 *             └── teamA — employee empAhmed
 *           ── quality (manager: uQualityMgr)
 */
function ctx(): RoutingContext {
  return {
    users: [
      user('uAdmin', 'admin'),
      user('uSalesMgr', 'manager'),
      user('uQualityMgr', 'quality'),
      user('uHr1', 'hr'),
      user('uPlain', 'user'),
    ],
    orgNodes: [
      node('company', 'company', null),
      node('sales', 'department', 'company', 'uSalesMgr'),
      node('teamA', 'team', 'sales'),
      node('quality', 'department', 'company', 'uQualityMgr'),
    ],
    employees: [{ id: 'empAhmed', orgNodeId: 'teamA' }],
  };
}

describe('routing — recipient resolution dimensions', () => {
  it('directUserIds resolve exactly (no ghosts)', () => {
    const out = resolveNotificationRecipients(
      { directUserIds: ['uHr1', 'ghost', 'uPlain'] }, ctx(),
    );
    assert.deepEqual(out, ['uHr1', 'uPlain']);
  });

  it('roles resolve every holder', () => {
    const out = resolveNotificationRecipients({ roles: ['quality', 'hr'] }, ctx());
    assert.deepEqual([...out].sort(), ['uHr1', 'uQualityMgr']);
  });

  it('orgNodeIds resolve the nodes\' managers', () => {
    const out = resolveNotificationRecipients({ orgNodeIds: ['sales', 'quality'] }, ctx());
    assert.deepEqual([...out].sort(), ['uQualityMgr', 'uSalesMgr']);
  });

  it('managerOfEmployeeId resolves the reporting chain (nearest first)', () => {
    const out = resolveNotificationRecipients({ managerOfEmployeeId: 'empAhmed' }, ctx());
    assert.deepEqual(out, ['uSalesMgr']);
  });

  it('dimensions union and deduplicate deterministically', () => {
    const out = resolveNotificationRecipients(
      { directUserIds: ['uSalesMgr'], roles: ['manager'], orgNodeIds: ['sales'] }, ctx(),
    );
    assert.deepEqual(out, ['uSalesMgr']);
  });

  it('unlinked employee resolves no chain (fail-safe)', () => {
    const out = resolveNotificationRecipients({ managerOfEmployeeId: 'empUnknown' }, ctx());
    assert.deepEqual(out, []);
  });
});

describe('routing — permission filter (content gate parity)', () => {
  it('candidates without access to the routed page are dropped', () => {
    // hrDeductions: manager read, quality NONE (role presets)
    const out = resolveNotificationRecipients(
      { directUserIds: ['uSalesMgr', 'uQualityMgr'], pageKey: 'hrDeductions' }, ctx(),
    );
    assert.deepEqual(out, ['uSalesMgr']);
  });

  it('no pageKey → no content gate', () => {
    const out = resolveNotificationRecipients(
      { directUserIds: ['uQualityMgr'], pageKey: null }, ctx(),
    );
    assert.deepEqual(out, ['uQualityMgr']);
  });
});

describe('read-side rule — new directed dimensions', () => {
  const baseViewer = (over: Partial<NotificationViewer> = {}): NotificationViewer => ({
    userId: 'uX', role: 'quality', permissions: getPermissionsForRole('quality'), ...over,
  });

  it('recipientUserIds: routed recipients see the notification, others do not', () => {
    const notif = { title: 'تغيير هيكلي', category: 'system' as const, recipientUserIds: ['uX'] };
    assert.equal(canSeeNotification(notif, baseViewer()), true);
    assert.equal(canSeeNotification(notif, baseViewer({ userId: 'uOther' })), false);
  });

  it('recipientUserIds marks a notification as directed (no broadcast)', () => {
    assert.equal(isDirectedNotification({ recipientUserIds: ['a'] } as never), true);
    assert.equal(isDirectedNotification({ recipientUserIds: [] } as never), false);
  });

  it('linkedEmployeeId: the subject employee\'s linked user receives it (M9 gap closed)', () => {
    // quality role + system category → not page-bound, content gate passes
    const notif = { title: 'ملاحظة جودة', category: 'system' as const, employeeId: 'empAhmed' };
    assert.equal(canSeeNotification(notif, baseViewer({ linkedEmployeeId: 'empAhmed' })), true);
    assert.equal(canSeeNotification(notif, baseViewer({ linkedEmployeeId: 'empOther' })), false);
  });

  it('legacy directed semantics unchanged: userId / assignedTo exact match', () => {
    const notif = { title: 'x', category: 'system' as const, employeeId: 'uX', assignedTo: null };
    assert.equal(canSeeNotification(notif, baseViewer()), true);
    const assigned = { title: 'x', category: 'system' as const, assignedTo: 'uX', employeeId: null };
    assert.equal(canSeeNotification(assigned, baseViewer()), true);
    assert.equal(canSeeNotification(assigned, baseViewer({ userId: 'nope' })), false);
  });

  it('content permission gate still hides routed notifications for denied pages', () => {
    const notif = {
      title: 'x', category: 'hr' as const, // hrDeductions page key — quality role: none
      recipientUserIds: ['uX'],
    };
    assert.equal(canSeeNotification(notif, baseViewer()), false);
  });

  it('admin bypass remains absolute', () => {
    const notif = { title: 'x', category: 'hr' as const };
    assert.equal(canSeeNotification(notif, baseViewer({ role: 'admin' })), true);
  });
});
