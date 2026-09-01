// ══════════════════════════════════════════════════════════════
//  Phase 6.3 — Report Continuity Layer (spec §13-§20)
//
//  Maps to §49-B: generated report survives navigation (18), restores
//  with original period (19), never silently regenerated (21),
//  explicit regenerate replaces (22), stale indication (23), user
//  isolation (24). Pure tests over an injected Storage.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearReportSnapshot,
  loadReportSnapshot,
  saveReportSnapshot,
  snapshotMatchesContext,
  type ReportSnapshot,
} from '../report-snapshot';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
  } as unknown as Storage;
}

const local = makeStorage();

beforeEach(() => {
  local.clear();
  (globalThis as Record<string, unknown>).window = { localStorage: local };
});

const slot = { userId: 'user-A', page: 'reports', version: 1 };

function snapshotOf(overrides: Partial<ReportSnapshot<{ rows: number[] }>> = {}): ReportSnapshot<{ rows: number[] }> {
  return {
    reportId: 'rep-1',
    reportType: 'monthly-deductions-report',
    subject: null,
    period: '2026-08',
    filters: {},
    generatedAt: '2026-09-01T09:00:00.000Z',
    generatedBy: 'user-A',
    stateVersion: 1,
    data: { rows: [1, 2, 3] },
    ...overrides,
  };
}

describe('save → load roundtrip (§14 snapshot contract, §49-18/19)', () => {
  it('restores the report VERBATIM with restored status', () => {
    const snap = snapshotOf();
    saveReportSnapshot(slot, snap);
    const restored = loadReportSnapshot<{ rows: number[] }>(slot);
    assert.ok(restored);
    assert.equal(restored.status, 'restored');
    assert.deepEqual(restored.snapshot, snap);
    assert.deepEqual(restored.snapshot.data.rows, [1, 2, 3]);
    assert.equal(restored.snapshot.period, '2026-08'); // original period
    assert.equal(restored.snapshot.generatedAt, '2026-09-01T09:00:00.000Z');
    assert.equal(restored.snapshot.generatedBy, 'user-A');
  });

  it('absent snapshot → null (fresh page, no phantom report)', () => {
    assert.equal(loadReportSnapshot(slot), null);
  });
});

describe('explicit regenerate REPLACES the current report (§16/§18, §49-21/22)', () => {
  it('a new generation overwrites the slot — latest wins', () => {
    saveReportSnapshot(slot, snapshotOf({ reportId: 'rep-1', period: '2026-08' }));
    saveReportSnapshot(slot, snapshotOf({ reportId: 'rep-2', period: '2026-09', data: { rows: [9] } }));
    const restored = loadReportSnapshot<{ rows: number[] }>(slot);
    assert.equal(restored?.snapshot.reportId, 'rep-2');
    assert.equal(restored?.snapshot.period, '2026-09');
    assert.deepEqual(restored?.snapshot.data.rows, [9]);
  });

  it('loading does NOT regenerate or rewrite — pure read', () => {
    const rawBefore = local.getItem('arm-erp:page-state:l:user-A:reports:v1');
    saveReportSnapshot(slot, snapshotOf());
    const before = local.getItem('arm-erp:page-state:l:user-A:reports:v1');
    loadReportSnapshot(slot);
    const after = local.getItem('arm-erp:page-state:l:user-A:reports:v1');
    assert.ok(before);
    assert.equal(before, after);
    assert.notEqual(rawBefore, after ?? undefined);
  });
});

describe('user isolation (§6/§24-15, §49-24)', () => {
  it("user B never sees user A's report", () => {
    saveReportSnapshot(slot, snapshotOf());
    assert.equal(
      loadReportSnapshot({ userId: 'user-B', page: 'reports', version: 1 }),
      null,
    );
  });
});

describe('version handling (§7)', () => {
  it('a snapshot from an older schema version is ignored, not crashed on', () => {
    saveReportSnapshot(slot, snapshotOf());
    assert.equal(loadReportSnapshot({ ...slot, version: 2 }), null);
  });
});

describe('clear (§13 inverse — the user may discard the report)', () => {
  it('removes the snapshot', () => {
    saveReportSnapshot(slot, snapshotOf());
    clearReportSnapshot(slot);
    assert.equal(loadReportSnapshot(slot), null);
  });
});

describe('stale/context detection (§17/§19, §49-23)', () => {
  it('snapshotMatchesContext: same period + filters → true', () => {
    const snap = snapshotOf({ filters: { department: 'IT' } });
    assert.equal(snapshotMatchesContext(snap, '2026-08', { department: 'IT' }), true);
  });

  it('different period or filters → false (the UI must flag the mismatch)', () => {
    const snap = snapshotOf({ filters: { department: 'IT' } });
    assert.equal(snapshotMatchesContext(snap, '2026-09', { department: 'IT' }), false);
    assert.equal(snapshotMatchesContext(snap, '2026-08', { department: 'HR' }), false);
    assert.equal(snapshotMatchesContext(null, '2026-08', {}), false);
  });
});
