// ══════════════════════════════════════════════════════════════
//  Milestone 9 — Notification recipient & permission routing
//
//  Verifies the single server-side visibility rule
//  (lib/notifications/recipient-visibility) against the audited
//  role presets:
//    • Admin bypass preserved
//    • Broadcast notifications reach eligible staff (the fix for
//      the previous admin-only behavior) but ONLY when they hold
//      the governing page permission (Part B — no information leak)
//    • Directed notifications reach the exact recipient, still
//      gated by content permission
//    • Regular users receive neither broadcasts nor foreign
//      directed notifications
//
//  Run: npx tsx --test src/lib/notifications/__tests__/recipient-visibility.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canSeeNotification,
  filterVisibleNotifications,
  isDirectedNotification,
  resolveNotificationPageKey,
} from '@/lib/notifications/recipient-visibility';
import {
  MANAGER_PERMISSIONS,
  QUALITY_PERMISSIONS,
  HR_PERMISSIONS,
  DEFAULT_PERMISSIONS,
  ADMIN_PERMISSIONS,
  type PermissionsMap,
} from '@/config/permissions';
import type { AppNotification } from '@/types';

// ─────────────────────────────────────────────────────────────
//  Fixtures
// ─────────────────────────────────────────────────────────────

function makeViewer(role: string, userId: string, permissions: PermissionsMap) {
  return { userId, role, permissions };
}

const admin = makeViewer('admin', 'u-admin', ADMIN_PERMISSIONS);
const manager = makeViewer('manager', 'u-mgr', MANAGER_PERMISSIONS);
const quality = makeViewer('quality', 'u-qa', QUALITY_PERMISSIONS);
const hr = makeViewer('hr', 'u-hr', HR_PERMISSIONS);
const regular = makeViewer('user', 'u-emp', DEFAULT_PERMISSIONS);

/** A broadcast quality-observation notification (the exact shape
 *  lib/notifications/quality-events creates). */
const observationBroadcast: Partial<AppNotification> = {
  id: 'n-obs-1',
  title: 'ملاحظة جودة بانتظار الاعتماد',
  category: 'quality',
  sourceModule: 'observations',
  targetPage: 'observations',
  employeeId: null,
  assignedTo: null,
};

/** A broadcast risk alert (follow-ups critical case). */
const riskBroadcast: Partial<AppNotification> = {
  id: 'n-risk-1',
  title: 'حالة حرجة - متابعة جديدة',
  category: 'risk',
  sourceModule: 'followUps',
  targetPage: 'followUps',
  employeeId: null,
  assignedTo: null,
};

/** A directed notification addressed to a user id (rules-engine
 *  assign_user stores real user ids). */
function directedTo(userId: string): Partial<AppNotification> {
  return {
    id: 'n-dir-1',
    title: 'تم تعيينك لحالة كابا',
    category: 'capa',
    sourceModule: 'capa',
    targetPage: 'capa',
    employeeId: null,
    assignedTo: userId,
  };
}

// ─────────────────────────────────────────────────────────────
//  Page-key resolution
// ─────────────────────────────────────────────────────────────

describe('resolveNotificationPageKey', () => {
  it('uses explicit targetPage first', () => {
    assert.equal(resolveNotificationPageKey({ targetPage: 'capa', category: 'quality' }), 'capa');
  });

  it('falls back to category (quality → observations)', () => {
    assert.equal(resolveNotificationPageKey({ category: 'quality' }), 'observations');
  });

  it('falls back to sourceModule when category unmapped', () => {
    assert.equal(resolveNotificationPageKey({ sourceModule: 'riskCenter' }), 'riskCenter');
  });

  it('returns null for system notifications (no page check)', () => {
    assert.equal(resolveNotificationPageKey({ category: 'system' }), null);
  });
});

// ─────────────────────────────────────────────────────────────
//  Broadcast routing (the Admin-only fix)
// ─────────────────────────────────────────────────────────────

describe('broadcast notifications', () => {
  it('admin still sees everything (bypass preserved)', () => {
    assert.equal(canSeeNotification(observationBroadcast, admin), true);
    assert.equal(canSeeNotification(riskBroadcast, admin), true);
  });

  it('manager (observations access) now receives quality broadcasts — previously admin-only', () => {
    // Manager preset grants observations edit — eligible staff + page access
    assert.equal(canSeeNotification(observationBroadcast, manager), true);
  });

  it('quality role (observations access) receives quality broadcasts', () => {
    assert.equal(canSeeNotification(observationBroadcast, quality), true);
  });

  it('HR is staff BUT lacks observations permission → blocked (Part B: no leak)', () => {
    // HR preset has observations: 'none' — the notification exposes
    // quality-observation information HR cannot access
    assert.equal(canSeeNotification(observationBroadcast, hr), false);
  });

  it('regular users never receive broadcasts', () => {
    assert.equal(canSeeNotification(riskBroadcast, regular), false);
  });

  it('HR receives HR-governed broadcasts (hrDeductions access)', () => {
    const hrBroadcast: Partial<AppNotification> = {
      title: 'خصم موارد بشرية جديد',
      category: 'hr',
      targetPage: 'hrDeductions',
      employeeId: null,
      assignedTo: null,
    };
    assert.equal(canSeeNotification(hrBroadcast, hr), true);
    // Manager has hrDeductions read → eligible
    assert.equal(canSeeNotification(hrBroadcast, manager), true);
    // Quality has hrDeductions none → blocked even though staff
    assert.equal(canSeeNotification(hrBroadcast, quality), false);
  });
});

// ─────────────────────────────────────────────────────────────
//  Directed routing
// ─────────────────────────────────────────────────────────────

describe('directed notifications', () => {
  it('recipient (assignedTo === userId) sees their own notification', () => {
    assert.equal(canSeeNotification(directedTo('u-mgr'), manager), true);
  });

  it('non-recipient staff member does NOT see a directed notification', () => {
    assert.equal(canSeeNotification(directedTo('u-mgr'), quality), false);
  });

  it('subject recipient is still blocked when the governing page is denied', () => {
    // Directed at HR user, but content is a CAPA (hr preset: capa 'none')
    assert.equal(canSeeNotification(directedTo('u-hr'), hr), false);
  });

  it('employeeId match also resolves (rules may target employee id field)', () => {
    const byEmployee: Partial<AppNotification> = {
      id: 'n-emp-1',
      title: 'إشعار موجه',
      category: 'requests',
      targetPage: 'requests',
      employeeId: 'u-mgr',
      assignedTo: null,
    };
    assert.equal(canSeeNotification(byEmployee, manager), true);
    assert.equal(canSeeNotification(byEmployee, quality), false);
  });

  it('isDirectedNotification distinguishes directed vs broadcast', () => {
    assert.equal(isDirectedNotification(observationBroadcast), false);
    assert.equal(isDirectedNotification(directedTo('u-1')), true);
  });
});

// ─────────────────────────────────────────────────────────────
//  List filtering
// ─────────────────────────────────────────────────────────────

describe('filterVisibleNotifications', () => {
  const all = [observationBroadcast, riskBroadcast, directedTo('u-mgr')];

  it('manager sees broadcasts they may access + their directed ones', () => {
    const visible = filterVisibleNotifications(all, manager).map((n) => n.id);
    // observation (observations access) + risk (followUps read) + directed
    assert.deepEqual(visible.sort(), ['n-dir-1', 'n-obs-1', 'n-risk-1']);
  });

  it('HR sees only what their permissions allow (no observation leak)', () => {
    const visible = filterVisibleNotifications(all, hr).map((n) => n.id);
    assert.deepEqual(visible, []); // obs blocked (page), risk blocked (followUps none), directed to mgr
  });

  it('regular user sees nothing', () => {
    assert.equal(filterVisibleNotifications(all, regular).length, 0);
  });

  it('admin sees all three', () => {
    assert.equal(filterVisibleNotifications(all, admin).length, 3);
  });
});
