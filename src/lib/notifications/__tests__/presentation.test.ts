// ══════════════════════════════════════════════════════════════
//  §UX-STRUCTURE PART 9 — notification presentation model
//
//  Verifies the PURE severity + grouping helpers consumed by the
//  notification popover (no network, no data-layer involvement —
//  the canonical unread state stays server-owned):
//    • severity derives from existing fields, red reserved for
//      critical only
//    • unrelated notifications are NEVER grouped
//    • 3+ same-event items inside the window collapse into one
//      group row (with unread roll-up) and expand back exactly
//    • small runs (<3) and out-of-window repeats stay individual
//    • interleaved rows keep chronological order
//
//  Run: npx tsx --test src/lib/notifications/__tests__/presentation.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveNotificationSeverity,
  groupNotifications,
  timeAgo,
} from '@/lib/notifications/presentation';
import type { AppNotification } from '@/types';

const NOW = Date.parse('2026-09-23T12:00:00.000Z');

function notif(overrides: Partial<AppNotification> & { id: string }): AppNotification {
  return {
    title: 'ملاحظة جودة بانتظار الاعتماد',
    description: '',
    priority: 'medium',
    status: 'unread',
    category: 'quality',
    sourceModule: 'quality',
    sourceRecordId: null,
    employeeId: null,
    employeeName: null,
    assignedTo: null,
    assignedToName: null,
    ruleId: null,
    ruleName: null,
    actionUrl: null,
    sourceType: null,
    targetPage: null,
    createdAt: new Date(NOW - 60_000).toISOString(),
    readAt: null,
    acknowledgedAt: null,
    resolvedAt: null,
    ...overrides,
  } as AppNotification;
}

describe('deriveNotificationSeverity', () => {
  it('critical priority → critical (red reserved for it)', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '1', priority: 'critical' })), 'critical');
  });
  it('high priority → action_required', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '2', priority: 'high' })), 'action_required');
  });
  it('risk/complaint at medium → warning', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '3', category: 'risk' })), 'warning');
    assert.equal(deriveNotificationSeverity(notif({ id: '4', category: 'complaint', priority: 'low' })), 'info');
  });
  it('acknowledged/resolved lifecycle → success', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '5', status: 'resolved' })), 'success');
    assert.equal(deriveNotificationSeverity(notif({ id: '6', status: 'acknowledged' })), 'success');
  });
  it('normal events stay quiet info', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '7' })), 'info');
  });
  it('critical beats lifecycle success', () => {
    assert.equal(deriveNotificationSeverity(notif({ id: '8', priority: 'critical', status: 'resolved' })), 'critical');
  });
});

describe('groupNotifications (§9B)', () => {
  it('3+ same-event items collapse into one group with unread roll-up', () => {
    const items = [
      notif({ id: 'a', createdAt: new Date(NOW - 60_000).toISOString() }),
      notif({ id: 'b', status: 'read', readAt: new Date(NOW).toISOString(), createdAt: new Date(NOW - 120_000).toISOString() }),
      notif({ id: 'c', createdAt: new Date(NOW - 180_000).toISOString() }),
    ];
    const rows = groupNotifications(items, NOW);
    assert.equal(rows.length, 1);
    const group = rows[0]!;
    assert.equal(group.kind, 'group');
    assert.equal(group.count, 3);
    assert.equal(group.unreadCount, 2);
    assert.equal(group.items.length, 3);
  });

  it('unrelated notifications are never grouped', () => {
    const items = [
      notif({ id: 'a', title: 'ملاحظة جودة' }),
      notif({ id: 'b', title: 'شكوى جديدة', category: 'complaint' }),
      notif({ id: 'c', title: 'رحلة عاجلة', category: 'travel' }),
    ];
    const rows = groupNotifications(items, NOW);
    assert.equal(rows.filter((r) => r.kind === 'group').length, 0);
    assert.equal(rows.length, 3);
  });

  it('two same-event items stay individual (< group minimum)', () => {
    const items = [
      notif({ id: 'a' }),
      notif({ id: 'b' }),
    ];
    const rows = groupNotifications(items, NOW);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.kind === 'single'));
  });

  it('same event outside the window stays individual', () => {
    const items = [
      notif({ id: 'a', createdAt: new Date(NOW - 60_000).toISOString() }),
      notif({ id: 'b', createdAt: new Date(NOW - 72 * 60 * 60 * 1000).toISOString() }),
      notif({ id: 'c', createdAt: new Date(NOW - 73 * 60 * 60 * 1000).toISOString() }),
    ];
    const rows = groupNotifications(items, NOW);
    assert.equal(rows.filter((r) => r.kind === 'group').length, 0);
  });

  it('interleaved events keep chronological order and do not merge across gaps', () => {
    const items = [
      notif({ id: 'q1' }),
      notif({ id: 'x1', title: 'شكوى جديدة', category: 'complaint' }),
      notif({ id: 'q2' }),
      notif({ id: 'x2', title: 'شكوى جديدة', category: 'complaint' }),
      notif({ id: 'q3' }),
    ];
    const rows = groupNotifications(items, NOW);
    const kinds = rows.map((r) => (r.kind === 'group' ? `group:${r.key}` : `single:${r.key}`));
    assert.deepEqual(kinds, [
      'single:q1', 'single:x1', 'single:q2', 'single:x2', 'single:q3',
    ]);
  });

  it('group severity is the loudest member', () => {
    const items = [
      notif({ id: 'a' }),
      notif({ id: 'b', priority: 'critical' }),
      notif({ id: 'c' }),
    ];
    const rows = groupNotifications(items, NOW);
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { severity: string }).severity, 'critical');
  });
});

describe('timeAgo', () => {
  it('renders compact relative time', () => {
    assert.equal(timeAgo(new Date(NOW - 30_000).toISOString(), 'ar', NOW), 'الآن');
    assert.equal(timeAgo(new Date(NOW - 5 * 60_000).toISOString(), 'ar', NOW), 'منذ 5 د');
    assert.equal(timeAgo(new Date(NOW - 3 * 3_600_000).toISOString(), 'ar', NOW), 'منذ 3 س');
  });
});
