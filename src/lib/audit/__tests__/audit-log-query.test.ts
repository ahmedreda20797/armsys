// ══════════════════════════════════════════════════════════════
//  Tests for src/lib/audit/audit-log-query.ts (pure reader helpers)
//
//  Regression cover for the Quality Audit Log hotfix: observations
//  created from Quality Notes must reach the Audit Log immediately —
//  independent of approval status and independent of Month Close.
//
//  Run: npx tsx --test src/lib/audit/__tests__/audit-log-query.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { unwrapAuditLogPayload, filterAuditRecords } from '../audit-log-query';
import { makeAuditEvent } from '../server-audit-logger';
import { sortByDateField } from '@/lib/db';
import type { QualityAuditLogEntry } from '@/types/quality-kpi';

// ─── Fixture ──────────────────────────────────────────────────
let seq = 0;
function makeEntry(overrides: Partial<QualityAuditLogEntry> = {}): QualityAuditLogEntry {
  seq += 1;
  return {
    id: `audit-${String(seq).padStart(3, '0')}`,
    schemaVersion: 1,
    timestamp: `2026-08-15T10:00:${String(seq).padStart(2, '0')}.000Z`,
    actorId: 'observer-1',
    actorName: 'مراجع الجودة',
    action: 'create',
    entityType: 'observation',
    entityId: `obs-${seq}`,
    monthKey: '2026-08',
    before: null,
    after: null,
    reason: '',
    details: 'إنشاء ملاحظة جودة للموظف احمد لطفي',
    createdAt: `2026-08-15T10:00:${String(seq).padStart(2, '0')}.000Z`,
    ...overrides,
  };
}

describe('unwrapAuditLogPayload', () => {
  it('REGRESSION: paginated envelope { data, total, limit, offset } unwraps to the entry array — a newly created observation reaches the Audit Log', () => {
    // Shape produced by GET /api/quality-audit-log (verified against the live route).
    const newlyCreated = makeEntry({ action: 'create', entityType: 'observation' });
    const payload = { data: [newlyCreated], total: 1, limit: 50, offset: 0 };

    const entries = unwrapAuditLogPayload(payload);

    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'create');
    assert.equal(entries[0].entityType, 'observation');
    assert.equal(entries[0].entityId, newlyCreated.entityId);
  });

  it('REGRESSION: multiple observations all appear', () => {
    const payload = {
      data: [makeEntry(), makeEntry(), makeEntry()],
      total: 3,
      limit: 50,
      offset: 0,
    };
    assert.equal(unwrapAuditLogPayload(payload).length, 3);
  });

  it('bare array payloads pass through unchanged (direct DB reads / legacy callers)', () => {
    const arr = [makeEntry(), makeEntry()];
    const out = unwrapAuditLogPayload(arr);
    assert.equal(out, arr as unknown as QualityAuditLogEntry[]);
  });

  it('null / undefined / malformed payloads yield an empty trail instead of crashing', () => {
    assert.deepEqual(unwrapAuditLogPayload(null), []);
    assert.deepEqual(unwrapAuditLogPayload(undefined), []);
    assert.deepEqual(unwrapAuditLogPayload({}), []);
    assert.deepEqual(unwrapAuditLogPayload({ data: 'not-an-array' }), []);
    assert.deepEqual(unwrapAuditLogPayload('garbage'), []);
  });

  it('empty envelope (no records yet) yields an empty trail', () => {
    assert.deepEqual(unwrapAuditLogPayload({ data: [], total: 0, limit: 50, offset: 0 }), []);
  });

  it('is pure: unwrapping never duplicates or mutates the source payload', () => {
    const entry = makeEntry();
    const payload = { data: [entry], total: 1, limit: 50, offset: 0 };
    const first = unwrapAuditLogPayload(payload);
    const second = unwrapAuditLogPayload(payload);
    assert.equal(first.length, second.length);
    assert.equal(first[0], second[0]);
    assert.equal((payload as { data: unknown[] }).data.length, 1);
  });
});

describe('filterAuditRecords — reader has NO status gate and NO implicit date window', () => {
  it('PENDING review activity appears: a create entry with pending approval status passes default (filterless) query', () => {
    const pending = makeEntry({
      action: 'create',
      after: { approvalStatus: 'pending', employeeName: 'احمد لطفي' },
    });
    const out = filterAuditRecords([pending], {});
    assert.equal(out.length, 1);
    assert.equal((out[0].after as { approvalStatus: string }).approvalStatus, 'pending');
  });

  it('APPROVED activity appears', () => {
    const approved = makeEntry({ action: 'approve' });
    assert.equal(filterAuditRecords([approved], {}).length, 1);
    assert.equal(filterAuditRecords([approved], { action: 'approve' }).length, 1);
  });

  it('REJECTED activity appears', () => {
    const rejected = makeEntry({ action: 'reject', reason: 'لا يستحق خصم' });
    assert.equal(filterAuditRecords([rejected], {}).length, 1);
    assert.equal(filterAuditRecords([rejected], { action: 'reject' }).length, 1);
  });

  it('current-month entries are returned by default and by explicit monthKey filter (no Month Close dependency)', () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const todaysObservation = makeEntry({
      monthKey: currentMonth,
      timestamp: now.toISOString(),
    });
    assert.equal(filterAuditRecords([todaysObservation], {}).length, 1);
    assert.equal(filterAuditRecords([todaysObservation], { monthKey: currentMonth }).length, 1);
  });

  it('historical monthKey filter returns only that month', () => {
    const july = makeEntry({ monthKey: '2026-07' });
    const august = makeEntry({ monthKey: '2026-08' });
    const out = filterAuditRecords([july, august], { monthKey: '2026-07' });
    assert.equal(out.length, 1);
    assert.equal(out[0].id, july.id);
  });

  it('entityType / entityId / actorId filters resolve the requested records', () => {
    const obs = makeEntry({ entityType: 'observation', entityId: 'obs-x', actorId: 'reviewer-9', actorName: 'Gehad Hamdy' });
    const month = makeEntry({ entityType: 'month', entityId: 'month-1' });
    assert.deepEqual(filterAuditRecords([obs, month], { entityType: 'observation' }).map((r) => r.id), [obs.id]);
    assert.deepEqual(filterAuditRecords([obs, month], { entityId: 'obs-x' }).map((r) => r.id), [obs.id]);
    assert.deepEqual(filterAuditRecords([obs, month], { actorId: 'reviewer-9' }).map((r) => r.id), [obs.id]);
    assert.deepEqual(filterAuditRecords([obs, month], { entityType: 'month' }).map((r) => r.id), [month.id]);
  });

  it('combined filters narrow jointly (AND semantics, same as the original route filters)', () => {
    const hit = makeEntry({ entityType: 'observation', action: 'create', monthKey: '2026-08' });
    const miss = makeEntry({ entityType: 'observation', action: 'delete', monthKey: '2026-08' });
    const out = filterAuditRecords([hit, miss], { entityType: 'observation', action: 'create', monthKey: '2026-08' });
    assert.deepEqual(out.map((r) => r.id), [hit.id]);
  });

  it('employee snapshot inside the entry payload is preserved for display', () => {
    const entry = makeEntry({
      after: { employeeId: 'emp-1', employeeName: 'احمد لطفي', department: "Eslam's Sales Team", severity: 'high' },
    });
    const out = filterAuditRecords([entry], {});
    const after = out[0].after as { employeeName: string; employeeId: string };
    assert.equal(after.employeeName, 'احمد لطفي');
    assert.equal(after.employeeId, 'emp-1');
  });
});

describe('writer → reader contract', () => {
  it('an entry built by the audit writer (makeAuditEvent shape) survives unwrap + query', () => {
    const event = makeAuditEvent({
      action: 'create',
      actorId: 'observer-1',
      actorName: 'Ahmed Reda',
      details: 'إنشاء ملاحظة جودة',
    });
    const entry = makeEntry({
      action: event.action,
      actorId: event.actorId,
      actorName: event.actorName,
      details: event.details,
      timestamp: event.timestamp,
    });
    const entries = unwrapAuditLogPayload({ data: [entry], total: 1, limit: 50, offset: 0 });
    const filtered = filterAuditRecords(entries, { action: 'create' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].actorName, 'Ahmed Reda');
  });
});

describe('audit trail ordering (timestamp display contract)', () => {
  it('sortByDateField orders newest-first so the latest review activity appears first', () => {
    const older = makeEntry({ timestamp: '2026-08-01T08:00:00.000Z' });
    const newer = makeEntry({ timestamp: '2026-08-20T09:00:00.000Z' });
    const sorted = sortByDateField([older, newer], 'timestamp', 'desc');
    assert.equal(sorted[0].id, newer.id);
    assert.equal(sorted[1].id, older.id);
  });

  it('missing timestamps sort last instead of throwing', () => {
    const broken = makeEntry({ timestamp: undefined as unknown as string });
    const normal = makeEntry({ timestamp: '2026-08-10T08:00:00.000Z' });
    const sorted = sortByDateField([broken, normal], 'timestamp', 'desc');
    assert.equal(sorted[0].id, normal.id);
  });
});
