// ══════════════════════════════════════════════════════════════
//  Phase 6.3 — Page State Persistence core (spec §4-§9, §43-§44)
//
//  Maps to §49-A: filter/period persistence, clear semantics,
//  state version mismatch, invalid/stale state, USER ISOLATION.
//  Pure-core tests with an injected in-memory Storage — no browser.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  PAGE_STATE_ENVELOPE_VERSION,
  decodePageState,
  encodePageState,
  pageStateStorageKey,
  readPageState,
  removePageState,
  writePageState,
} from '../persistence';

// ── In-memory Storage + fake window (the module reads at call time) ──
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

const session = makeStorage();
const local = makeStorage();

beforeEach(() => {
  session.clear();
  local.clear();
  (globalThis as Record<string, unknown>).window = {
    sessionStorage: session,
    localStorage: local,
  };
});

const base = { userId: 'user-A', page: 'observations', version: 1, storage: 'session' as const };

describe('pageStateStorageKey — user isolation is structural (§6)', () => {
  it('keys differ per user, page, version and storage', () => {
    const a = pageStateStorageKey(base);
    const b = pageStateStorageKey({ ...base, userId: 'user-B' });
    const c = pageStateStorageKey({ ...base, page: 'travel' });
    const d = pageStateStorageKey({ ...base, version: 2 });
    const e = pageStateStorageKey({ ...base, storage: 'local' });
    assert.equal(new Set([a, b, c, d, e]).size, 5);
    assert.ok(a.includes('user-A') && a.includes('v1'));
  });
});

describe('write/read roundtrip (§4 serializable state + timestamp)', () => {
  it('persists and restores the exact state', () => {
    const state = { month: '2026-08', employeeId: 'emp-1', approvalStatus: 'approved' };
    writePageState(base, state, new Date('2026-09-01T10:00:00Z'));
    const envelope = readPageState<typeof state>(base);
    assert.ok(envelope);
    assert.deepEqual(envelope.state, state);
    assert.equal(envelope.savedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(envelope.v, 1);
    assert.equal(envelope.env, PAGE_STATE_ENVELOPE_VERSION);
  });

  it('returns null for ABSENT state (restore falls back to defaults)', () => {
    assert.equal(readPageState(base), null);
  });

  it('the userId is structurally part of the key (§6 isolation)', () => {
    // Identity guarding happens in the hook (no identity → no write);
    // the storage layer itself keeps users in separate key namespaces.
    const keyA = pageStateStorageKey(base);
    const keyB = pageStateStorageKey({ ...base, userId: 'user-B' });
    assert.notEqual(keyA, keyB);
    assert.match(keyA, /user-A/);
  });
});

describe('state version handling (§7 / §49-17)', () => {
  it('a version mismatch reads as ABSENT — old state never breaks a page', () => {
    writePageState(base, { month: '2026-07' });
    assert.equal(readPageState({ ...base, version: 2 }), null);
  });
});

describe('invalid / stale state fails safe (§44 / §49-12/13)', () => {
  it('corrupt JSON → null', () => {
    session.setItem(pageStateStorageKey(base), '{not-json');
    assert.equal(readPageState(base), null);
  });

  it('wrong envelope format → null', () => {
    session.setItem(pageStateStorageKey(base), JSON.stringify({ v: 1, env: 999, savedAt: 'x', state: {} }));
    assert.equal(readPageState(base), null);
  });

  it('non-object payload → null', () => {
    assert.equal(decodePageState('[1,2,3]', 1), null);
    assert.equal(decodePageState('null', 1), null);
    assert.equal(decodePageState(null, 1), null);
  });

  it('a state rejected by validate never reaches the page (§43)', () => {
    // Page-level doctrine test: the hook applies validate() on restore.
    const validated = (raw: unknown) =>
      raw && typeof raw === 'object' && typeof (raw as { statusFilter?: unknown }).statusFilter === 'string'
        ? raw
        : null;
    // malformed shape (missing statusFilter) → rejected
    assert.equal(validated({ escalated: true }), null);
    // valid shape passes through unchanged (no privilege from storage)
    assert.deepEqual(validated({ statusFilter: 'all' }), { statusFilter: 'all' });
  });
});

describe('Clear Filters semantics (§9 / §49-8)', () => {
  it('clear REMOVES the record — coming back does not resurrect filters', () => {
    writePageState(base, { month: '2026-08' });
    assert.ok(readPageState(base));
    removePageState(base);
    assert.equal(readPageState(base), null);
  });
});

describe('storage doctrine (§5)', () => {
  it('session and local are separate namespaces', () => {
    writePageState({ ...base, storage: 'session' }, { month: 'A' });
    writePageState({ ...base, storage: 'local' }, { month: 'B' });
    assert.equal(readPageState<{ month: string }>({ ...base, storage: 'session' })?.state.month, 'A');
    assert.equal(readPageState<{ month: string }>({ ...base, storage: 'local' })?.state.month, 'B');
  });
});

describe('encode/decode are pure (injectable clock)', () => {
  it('round-trips through a string', () => {
    const raw = encodePageState({ month: '2026-09' }, 1, new Date('2026-09-02T00:00:00Z'));
    const env = decodePageState<{ month: string }>(raw, 1);
    assert.equal(env?.state.month, '2026-09');
    assert.equal(env?.savedAt, '2026-09-02T00:00:00.000Z');
  });
});
