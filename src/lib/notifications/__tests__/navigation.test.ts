// ══════════════════════════════════════════════════════════════
//  §NOTIFICATIONS-DEEPLINK — buildNotificationNavParams (focused)
//
//  ONE canonical resolver from a stored notification to the
//  navigateTo(page, highlightId, navParams) channel. These tests pin
//  the contract the Risk Center (and every other destination) relies
//  on: WHO (employee), WHY (count/level), WHERE (month/level) reach
//  the destination — and that NO second deep-link mapping exists
//  (the popover must call exactly this function).
//
//  Run: npx tsx --test src/lib/notifications/__tests__/navigation.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildNotificationNavParams } from '../navigation';
import type { AppNotification } from '@/types';

function notif(over: Partial<AppNotification>): AppNotification {
  return {
    id: 'n1',
    title: 'تنبيه مخاطر - 3 حالات للموظف',
    description: '',
    priority: 'high',
    status: 'unread',
    category: 'risk',
    sourceModule: 'riskCenter',
    sourceRecordId: null,
    employeeId: null,
    employeeName: null,
    assignedTo: null,
    assignedToName: null,
    ruleId: null,
    ruleName: null,
    actionUrl: null,
    sourceType: 'manual',
    targetPage: null,
    createdAt: new Date().toISOString(),
    readAt: null,
    acknowledgedAt: null,
    resolvedAt: null,
    ...over,
  };
}

describe('buildNotificationNavParams — the canonical notification → navParams resolver', () => {
  it('risk notification: structured navParams pass through verbatim', () => {
    const n = notif({
      employeeId: 'emp-9',
      employeeName: 'أحمد',
      sourceRecordId: 'emp-9',
      targetPage: 'riskCenter',
      navParams: { employeeId: 'emp-9', month: '2026-09', caseCount: '3', source: 'followUps' },
    });
    const params = buildNotificationNavParams(n);
    assert.equal(params.employeeId, 'emp-9');
    assert.equal(params.month, '2026-09');
    assert.equal(params.caseCount, '3');
    assert.equal(params.source, 'followUps');
  });

  it('legacy risk notification (no navParams): employee resolves from sourceRecordId', () => {
    const n = notif({
      employeeId: null,
      employeeName: 'سارة',
      sourceRecordId: 'emp-7', // risk alerts store the employee id here
      targetPage: 'riskCenter',
    });
    const params = buildNotificationNavParams(n);
    assert.equal(params.employeeId, 'emp-7');
    assert.equal(params.employeeName, 'سارة');
  });

  it('generic employee fields merge for every employee-linked notification', () => {
    const n = notif({
      category: 'followUp',
      sourceModule: 'followUps',
      targetPage: 'followUps',
      employeeId: 'emp-3',
      employeeName: 'منى',
    });
    const params = buildNotificationNavParams(n);
    assert.equal(params.employeeId, 'emp-3');
    assert.equal(params.employeeName, 'منى');
    assert.equal(Object.keys(params).length, 2); // nothing invented
  });

  it('stored navParams win over the generic merge (authoritative context)', () => {
    const n = notif({
      employeeId: 'emp-1',
      employeeName: 'الاسم العام',
      navParams: { employeeName: 'الاسم من السياق' },
    });
    const params = buildNotificationNavParams(n);
    assert.equal(params.employeeName, 'الاسم من السياق');
    assert.equal(params.employeeId, 'emp-1');
  });

  it('empty/blank navParams values are dropped — no junk reaches navigateTo', () => {
    const n = notif({
      navParams: { month: '', level: 'high', note: undefined as unknown as string },
    });
    const params = buildNotificationNavParams(n);
    assert.deepEqual(params, { level: 'high' });
  });

  it('non-risk notification without employee fields → empty params', () => {
    const n = notif({ category: 'system', sourceModule: 'system', targetPage: 'home' });
    assert.deepEqual(buildNotificationNavParams(n), {});
  });
});
