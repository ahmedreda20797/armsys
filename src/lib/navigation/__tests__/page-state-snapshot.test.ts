// ══════════════════════════════════════════════════════════════
//  Page-State Snapshots — per-entry continuity tests
//  (SPA Navigation History §12/§13/§23)
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPageStateSnapshot,
  capturePageStateSnapshot,
  EntrySnapshotStore,
  type SnapshotStorageEnv,
} from '../page-state-snapshot';
import { flushPageStateWriters, registerPageStateFlusher } from '@/lib/page-state/flush-registry';

function makeStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

function makeEnv(session?: Record<string, string>, local?: Record<string, string>): {
  session: Storage;
  local: Storage;
  sessionStore: Storage;
  localStore: Storage;
} {
  const sessionStore = makeStorage(session);
  const localStore = makeStorage(local);
  return {
    session: sessionStore,
    local: localStore,
    sessionStore,
    localStore,
  };
}

const key = (kind: 's' | 'l', userId: string, page: string, slot: string, v = 1) =>
  `arm-erp:page-state:${kind}:${userId}:${page}:${slot}:v${v}`;

// ── EntrySnapshotStore (§23 bounded mirror) ────────────────────

describe('EntrySnapshotStore — bounded in-session store (§23)', () => {
  it('stores and retrieves by entry id', () => {
    const store = new EntrySnapshotStore(3);
    store.set('a', { pageState: {}, scrollY: 10, capturedAt: 'x' });
    assert.deepEqual(store.get('a')?.scrollY, 10);
  });

  it('evicts the OLDEST entry beyond the bound (LRU)', () => {
    const store = new EntrySnapshotStore(3);
    store.set('a', { pageState: {}, scrollY: 1, capturedAt: 'x' });
    store.set('b', { pageState: {}, scrollY: 2, capturedAt: 'x' });
    store.set('c', { pageState: {}, scrollY: 3, capturedAt: 'x' });
    store.set('a', { pageState: {}, scrollY: 1, capturedAt: 'y' }); // refresh a
    store.set('d', { pageState: {}, scrollY: 4, capturedAt: 'x' }); // evicts b
    assert.equal(store.get('b'), undefined);
    assert.ok(store.get('a'));
    assert.ok(store.get('c'));
    assert.ok(store.get('d'));
    assert.equal(store.size, 3);
  });

  it('clear() removes everything (identity boundary)', () => {
    const store = new EntrySnapshotStore(5);
    store.set('a', { pageState: { k: 'v' }, scrollY: 0, capturedAt: 'x' });
    store.clear();
    assert.equal(store.get('a'), undefined);
    assert.equal(store.size, 0);
  });
});

// ── capture / apply round-trip ─────────────────────────────────

describe('capturePageStateSnapshot / applyPageStateSnapshot', () => {
  beforeEach(() => {
    // No cross-test flusher leakage.
  });

  it('captures ALL slots and versions of a page from BOTH storages', () => {
    const env = makeEnv({
      [key('s', 'u1', 'smartQualityReport', 'view')]: 'session-view',
      [key('s', 'u1', 'smartQualityReport', 'filters', 2)]: 'session-filters-v2',
      [key('s', 'u1', 'travel', 'main')]: 'another-page',
      [key('s', 'u2', 'smartQualityReport', 'view')]: 'another-user',
    }, {
      [key('l', 'u1', 'smartQualityReport', 'report')]: 'report-snapshot',
    });

    const captured = capturePageStateSnapshot(env, 'u1', 'smartQualityReport');
    assert.deepEqual(captured, {
      [key('s', 'u1', 'smartQualityReport', 'view')]: 'session-view',
      [key('s', 'u1', 'smartQualityReport', 'filters', 2)]: 'session-filters-v2',
      [key('l', 'u1', 'smartQualityReport', 'report')]: 'report-snapshot',
    });
  });

  it('flushes pending usePageState writers BEFORE capturing (§11)', () => {
    const env = makeEnv();
    let flushed = false;
    const unregister = registerPageStateFlusher('travel', () => {
      flushed = true;
      env.session.setItem(key('s', 'u1', 'travel', 'main'), 'flushed-latest');
    });
    try {
      const captured = capturePageStateSnapshot(env, 'u1', 'travel');
      assert.equal(flushed, true);
      assert.equal(captured[key('s', 'u1', 'travel', 'main')], 'flushed-latest');
    } finally {
      unregister();
    }
  });

  it('a failing flusher never breaks the capture', () => {
    const env = makeEnv();
    const unregister = registerPageStateFlusher('travel', () => {
      throw new Error('boom');
    });
    try {
      assert.doesNotThrow(() => capturePageStateSnapshot(env, 'u1', 'travel'));
    } finally {
      unregister();
    }
  });

  it('apply writes raw envelopes back verbatim (no decode/encode round-trip)', () => {
    const env = makeEnv();
    const raw = JSON.stringify({ v: 1, env: 1, savedAt: '2026-09-01T00:00:00.000Z', state: { a: 1 } });
    applyPageStateSnapshot(env, {
      [key('s', 'u1', 'smartQualityReport', 'view')]: raw,
      [key('l', 'u1', 'smartQualityReport', 'report')]: '{"v":2}',
    });
    assert.equal(env.session.getItem(key('s', 'u1', 'smartQualityReport', 'view')), raw);
    assert.equal(env.local.getItem(key('l', 'u1', 'smartQualityReport', 'report')), '{"v":2}');
  });

  it('apply routes local-marker keys to localStorage and session keys to sessionStorage', () => {
    const env = makeEnv();
    applyPageStateSnapshot(env, {
      [key('s', 'u1', 'page', 'main')]: 'S',
      [key('l', 'u1', 'page', 'main')]: 'L',
    });
    assert.equal(env.session.getItem(key('s', 'u1', 'page', 'main')), 'S');
    assert.equal(env.local.getItem(key('l', 'u1', 'page', 'main')), 'L');
    assert.equal(env.session.getItem(key('l', 'u1', 'page', 'main')), null);
    assert.equal(env.local.getItem(key('s', 'u1', 'page', 'main')), null);
  });

  it('null storages degrade to an empty capture / silent no-op apply', () => {
    const empty: SnapshotStorageEnv = { session: null, local: null };
    assert.deepEqual(capturePageStateSnapshot(empty, 'u1', 'page'), {});
    assert.doesNotThrow(() => applyPageStateSnapshot(empty, { 'arm-erp:page-state:s:u1:page:main:v1': 'x' }));
  });
});

// ── flush registry ─────────────────────────────────────────────

describe('flushPageStateWriters — registry semantics', () => {
  it('invokes every registered flusher for the page once', () => {
    const calls: string[] = [];
    const u1 = registerPageStateFlusher('page', () => calls.push('a'));
    const u2 = registerPageStateFlusher('page', () => calls.push('b'));
    try {
      flushPageStateWriters('page');
      assert.deepEqual(calls.sort(), ['a', 'b']);
    } finally {
      u1();
      u2();
    }
  });

  it('unregistered flushers are not invoked; other pages are untouched', () => {
    const calls: string[] = [];
    const u1 = registerPageStateFlusher('pageA', () => calls.push('A'));
    u1();
    const u2 = registerPageStateFlusher('pageB', () => calls.push('B'));
    try {
      flushPageStateWriters('pageA');
      assert.deepEqual(calls, []);
      flushPageStateWriters('pageB');
      assert.deepEqual(calls, ['B']);
    } finally {
      u2();
    }
  });
});
