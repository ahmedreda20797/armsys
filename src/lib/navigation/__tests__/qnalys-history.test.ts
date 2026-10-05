// ══════════════════════════════════════════════════════════════
//  Qnalys Navigation History — controller regression suite
//  (SPA Navigation History fix, spec §26-§28)
//
//  Pure-controller tests: the browser surfaces (history, popstate,
//  storage, scroll) are fakes; the test drives popstate manually so
//  the "no history loop during popstate" guarantee (§8) is asserted
//  explicitly, not hoped for.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createQnalysHistoryController,
  normalizeNavParams,
  parseQnalysEntry,
  type QnalysHistoryEntryState,
  type QnalysHistoryEnvironment,
  type HistorySurface,
} from '../qnalys-history';
import type { NavigationBridgeEvent } from '../navigation-bridge';
import type { ScrollRestorer } from '../scroll-restore';
import type { SnapshotStorageEnv } from '../page-state-snapshot';

// ── Fakes ──────────────────────────────────────────────────────

function makeFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => { map.delete(k); },
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

function makeStorageEnv(): { session: Storage; local: Storage } {
  return { session: makeFakeStorage(), local: makeFakeStorage() };
}

interface HistoryLog {
  states: unknown[];
  index: number;
  pushes: number;
  replaces: number;
  backs: number;
}

function makeFakeHistory(): { history: HistorySurface; log: HistoryLog } {
  const log: HistoryLog = { states: [null], index: 0, pushes: 0, replaces: 0, backs: 0 };
  const history: HistorySurface = {
    get state() { return log.states[log.index] ?? null; },
    pushState(data: unknown) {
      log.states = [...log.states.slice(0, log.index + 1), data];
      log.index += 1;
      log.pushes += 1;
    },
    replaceState(data: unknown) {
      log.states[log.index] = data;
      log.replaces += 1;
    },
    back() {
      log.backs += 1;
      // Real history.back() is async; tests fire popstate manually.
      if (log.index > 0) log.index -= 1;
    },
    scrollRestoration: 'auto',
  };
  return { history, log };
}

function makeFakeScroll(): ScrollRestorer & { restores: Array<{ entryId: string; top: number }>; tops: number[] } {
  const restores: Array<{ entryId: string; top: number }> = [];
  const tops: number[] = [];
  return {
    restores,
    tops,
    requestRestore(entryId: string, top: number) {
      restores.push({ entryId, top });
    },
    cancelPending() {},
    scrollToTopNow() {
      tops.push(0);
    },
  };
}

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(options?: { initialState?: unknown; userId?: string | null }) {
  const { history, log } = makeFakeHistory();
  if (options?.initialState !== undefined) {
    log.states = [options.initialState];
  }
  const storage = makeStorageEnv();
  const scroll = makeFakeScroll();
  const applied: QnalysHistoryEntryState[] = [];
  const resets: number[] = [];
  let userId = options?.userId ?? null;
  const popHandlers: Array<(event: { state: unknown }) => void> = [];
  let idCounter = 0;
  let clock = 1_000;

  const env: QnalysHistoryEnvironment = {
    history,
    onPopState(handler) {
      popHandlers.push(handler);
      return () => {
        const i = popHandlers.indexOf(handler);
        if (i >= 0) popHandlers.splice(i, 1);
      };
    },
    storage,
    scroll,
    getScrollY: () => 0,
    getUserId: () => userId,
    applyEntry: (entry) => applied.push(entry),
    resetNavigation: () => resets.push(1),
    newId: () => `e-${++idCounter}`,
    now: () => ++clock,
  };

  const controller = createQnalysHistoryController(env);
  controller.initialize();

  return {
    controller,
    env,
    log,
    storage,
    scroll,
    applied,
    resets,
    firePop(state: unknown) {
      for (const handler of [...popHandlers]) handler({ state });
    },
    setUserId(id: string | null) {
      userId = id;
    },
    get userId() {
      return userId;
    },
  };
}

function pageEvent(page: string, highlightId: string | null = null, navParams: Record<string, string> = {}): NavigationBridgeEvent {
  return { type: 'page', page, highlightId, navParams };
}

function currentUserEntry(log: HistoryLog): QnalysHistoryEntryState | null {
  return parseQnalysEntry(log.states[log.index]);
}

// ── §7 Initial entry ───────────────────────────────────────────

describe('§NAVIGATION-HISTORY — initialization (§7)', () => {
  it('establishes a Qnalys home boundary via replaceState on a fresh load', () => {
    const h = makeHarness();
    assert.equal(h.log.pushes, 0, 'initialize must never push');
    assert.equal(h.log.replaces, 1, 'initialize replaces the current entry once');
    const entry = currentUserEntry(h.log);
    assert.ok(entry);
    assert.equal(entry.page, 'home');
    assert.equal(entry.qnalys, true);
    assert.equal(entry.userId, null);
    assert.equal(h.log.states.length, 1, 'no forward branch is created');
  });

  it('marks the history scroll mode manual (§17 — the app owns scroll)', () => {
    const h = makeHarness();
    assert.equal((h.env.history as HistorySurface).scrollRestoration, 'manual');
  });

  it('adopts an existing Qnalys entry on reload without pushing', () => {
    const adopted: QnalysHistoryEntryState = {
      qnalys: true, entryId: 'e-42', userId: 'u1', seq: 7, page: 'employees',
      overlay: null, contextId: null, highlightId: 'emp-1', navParams: null, createdAt: 1,
    };
    const h = makeHarness({ initialState: adopted, userId: 'u1' });
    assert.equal(h.log.pushes, 0);
    assert.equal(h.log.replaces, 0, 'a valid adopted entry is kept verbatim');
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.entryId, 'e-42');
  });

  it('ignores a foreign history.state and establishes the boundary', () => {
    const h = makeHarness({ initialState: { something: 'else' } });
    const entry = currentUserEntry(h.log);
    assert.ok(entry?.qnalys);
  });
});

// ── §6 Internal navigation → pushState ─────────────────────────

describe('§NAVIGATION-HISTORY — internal navigation (§6/§9)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
  });

  it('pushes one entry per distinct page navigation', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify(pageEvent('travel'));
    h.controller.notify(pageEvent('smartQualityReport'));
    assert.equal(h.log.pushes, 3);
    const seq = [0, 1, 2, 3].map((i) => parseQnalysEntry(h.log.states[i])?.page);
    assert.deepEqual(seq, ['home', 'employees', 'travel', 'smartQualityReport']);
  });

  it('keeps history.state SMALL (§5): page + params + identity only', () => {
    h.controller.notify(pageEvent('smartQualityReport', 'emp-1', { month: '2026-09' }));
    const raw = h.log.states[h.log.index] as Record<string, unknown>;
    assert.deepEqual(Object.keys(raw).sort(), [
      'contextId', 'createdAt', 'entryId', 'highlightId', 'navParams', 'overlay', 'page', 'qnalys', 'seq', 'userId',
    ]);
    assert.deepEqual(raw.navParams, { month: '2026-09' });
  });

  it('does NOT scroll-restore on a fresh push (fresh instance starts at top, §17)', () => {
    h.controller.notify(pageEvent('employees'));
    assert.deepEqual(h.scroll.restores, [], 'no restore requested on push');
    assert.deepEqual(h.scroll.tops, [0], 'explicit scroll-to-top on push');
  });

  it('suppresses duplicate navigation to the same destination (§20)', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify(pageEvent('employees'));
    h.controller.notify(pageEvent('employees'));
    assert.equal(h.log.pushes, 1, 'identical destination → one entry');
  });

  it('updates the CURRENT entry in place for same-page context shifts (§21)', () => {
    h.controller.notify(pageEvent('employees'));
    const pushesAfterFirst = h.log.pushes;
    h.controller.notify(pageEvent('employees', 'emp-84', { month: '2026-09' }));
    assert.equal(h.log.pushes, pushesAfterFirst, 'same page never pushes');
    assert.equal(h.log.replaces >= 1, true, 'entry updated in place');
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.highlightId, 'emp-84');
    assert.equal(entry?.page, 'employees');
  });

  it('keeps distinct contexts on DIFFERENT pages as real entries (§21)', () => {
    h.controller.notify(pageEvent('employees', 'emp-84'));
    h.controller.notify(pageEvent('smartQualityReport', 'emp-84', { month: '2026-09' }));
    h.controller.notify(pageEvent('travel'));
    assert.equal(h.log.pushes, 3);
  });
});

// ── §SETTINGS-SECTIONS — internal Settings section sub-destinations ──

describe('§SETTINGS-SECTIONS — Settings workspace internal navigation', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
    // Land on the Settings workspace (a normal page navigation).
    h.controller.notify(pageEvent('settings', null, {}));
  });

  it('a section shift pushes a REAL sub-destination entry (never exits Settings)', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    h.controller.notify(pageEvent('settings', null, { section: 'controlPanel' }));

    const pages = [0, 1, 2, 3].map((i) => parseQnalysEntry(h.log.states[i])?.page);
    assert.deepEqual(pages, ['home', 'settings', 'settings', 'settings'],
      'every entry stays on the settings page');
    assert.deepEqual(
      [1, 2, 3].map((i) => parseQnalysEntry(h.log.states[i])?.navParams),
      [{}, { section: 'masterData' }, { section: 'controlPanel' }],
      'each section is its own entry',
    );
    assert.deepEqual(h.scroll.tops, [0, 0, 0], 'content swaps start at the top');
  });

  it('re-selecting the ACTIVE section never duplicates an entry (§20)', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    const pushesAfterShift = h.log.pushes;
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    assert.equal(h.log.pushes, pushesAfterShift);
  });

  it('non-section param shifts on settings still replace in place (§21)', () => {
    const pushesAfterLanding = h.log.pushes;
    h.controller.notify(pageEvent('settings', null, { intent: 'highlight-x' }));
    assert.equal(h.log.pushes, pushesAfterLanding, 'no section key → no sub-destination');
    assert.equal(h.log.replaces >= 1, true, 'updated in place');
  });

  it('Back moves to the PREVIOUS section and stays inside Settings (§13/Test C)', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    h.controller.notify(pageEvent('settings', null, { section: 'controlPanel' }));

    assert.equal(h.controller.requestBack(), true);
    h.firePop(h.log.states[h.log.index]);
    const restored = h.applied.at(-1);
    assert.equal(restored?.page, 'settings', 'still inside Settings');
    assert.deepEqual(restored?.navParams, { section: 'masterData' },
      'the previous section is restored');

    assert.equal(h.controller.requestBack(), true);
    h.firePop(h.log.states[h.log.index]);
    assert.deepEqual(h.applied.at(-1)?.navParams, {},
      'Back past the first section returns to where Settings was entered');
  });

  it('Forward re-enters the later section (§13)', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    h.controller.notify(pageEvent('settings', null, { section: 'controlPanel' }));
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);

    const forwardState = h.log.states[h.log.index + 1];
    h.firePop(forwardState);
    const restored = h.applied.at(-1);
    assert.equal(restored?.page, 'settings');
    assert.deepEqual(restored?.navParams, { section: 'controlPanel' });
  });

  it('leaving Settings from a section pushes the global page; Back restores the section (Test D)', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'masterData' }));
    h.controller.notify(pageEvent('employees'));

    assert.equal(h.controller.requestBack(), true);
    h.firePop(h.log.states[h.log.index]);
    const restored = h.applied.at(-1);
    assert.equal(restored?.page, 'settings');
    assert.deepEqual(restored?.navParams, { section: 'masterData' },
      'returning from a global page restores the previous Settings section');
  });

  it('a section entry captured in history.state parses back intact', () => {
    h.controller.notify(pageEvent('settings', null, { section: 'workflowDesigner' }));
    const entry = parseQnalysEntry(h.log.states[h.log.index]);
    assert.equal(entry?.page, 'settings');
    assert.deepEqual(entry?.navParams, { section: 'workflowDesigner' });
  });
});

// ── §8 Back / §9 Forward ───────────────────────────────────────

describe('§NAVIGATION-HISTORY — Back / Forward (§8/§9)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
    h.controller.notify(pageEvent('employees'));
    h.controller.notify(pageEvent('travel'));
    h.controller.notify(pageEvent('smartQualityReport', 'emp-1', { month: '2026-09' }));
  });

  it('Back walks the in-app sequence without leaving Qnalys', () => {
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.equal(h.log.backs, 1);
    assert.deepEqual(h.applied.map((e) => e.page), ['travel']);
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.deepEqual(h.applied.map((e) => e.page), ['travel', 'employees']);
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.deepEqual(h.applied.map((e) => e.page), ['travel', 'employees', 'home']);
  });

  it('restores highlightId through popstate (§28)', () => {
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // travel
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // employees (no highlight)
    const appliedEmployees = h.applied.at(-1);
    assert.equal(appliedEmployees?.highlightId, null);
    // Forward again to the report entry restores its highlight.
    h.log.index += 1; // simulate browser Forward
    h.firePop(h.log.states[h.log.index]);
    assert.equal(h.applied.at(-1)?.page, 'travel');
    h.log.index += 1;
    h.firePop(h.log.states[h.log.index]);
    const forwardToReport = h.applied.at(-1);
    assert.equal(forwardToReport?.page, 'smartQualityReport');
    assert.equal(forwardToReport?.highlightId, 'emp-1');
  });

  it('requestBack at the first in-app entry reports false (no browser exit)', () => {
    // From the report entry: back ×3 lands on the home boundary.
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // travel
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // employees
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // home (cursor 0)
    assert.equal(h.controller.requestBack(), false);
    assert.equal(h.log.backs, 3, 'no history.back() dispatched at the boundary');
  });

  it('NEVER pushes or re-dispatches back while applying popstate (§8 no-loop)', () => {
    const pushesBefore = h.log.pushes;
    const backsBefore = h.log.backs;
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.equal(h.log.pushes, pushesBefore, 'popstate must not push');
    assert.equal(h.log.backs, backsBefore + 1, 'exactly one back per request');
  });

  it('a new navigation after Back replaces the forward branch (§9)', () => {
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // travel
    h.controller.notify(pageEvent('employees'));
    // [home, employees, travel] + the new push (forward report dropped)
    assert.equal(h.log.states.length, 4);
    const seq = [0, 1, 2, 3].map((i) => parseQnalysEntry(h.log.states[i])?.page);
    assert.deepEqual(seq, ['home', 'employees', 'travel', 'employees']);
  });
});

// ── §12 Per-entry page-state restoration ───────────────────────

describe('§NAVIGATION-HISTORY — per-entry page state (§12/§13)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
  });

  it('captures the leaving entry and restores it on Back — two Smart Report contexts never clobber', () => {
    const keyOf = (page: string, slot: string) =>
      `arm-erp:page-state:s:u1:${page}:${slot}:v1`;

    // Instance 1: Smart Report / EMP-084 / September
    h.controller.notify(pageEvent('smartQualityReport'));
    h.storage.session.setItem(keyOf('smartQualityReport', 'view'), JSON.stringify({
      v: 1, env: 1, savedAt: '2026-09-01T00:00:00.000Z', state: { employeeId: 'EMP-084', month: '2026-09' },
    }));
    h.controller.notify(pageEvent('travel')); // leaves report instance 1 → captured

    // Instance 2: Smart Report / EMP-090 / August
    h.controller.notify(pageEvent('smartQualityReport'));
    h.storage.session.setItem(keyOf('smartQualityReport', 'view'), JSON.stringify({
      v: 1, env: 1, savedAt: '2026-08-01T00:00:00.000Z', state: { employeeId: 'EMP-090', month: '2026-08' },
    }));
    h.controller.notify(pageEvent('employees')); // leaves instance 2 → captured

    // Back → instance 2 (EMP-090 / August)
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    let restored = JSON.parse(h.storage.session.getItem(keyOf('smartQualityReport', 'view'))!);
    assert.deepEqual(restored.state, { employeeId: 'EMP-090', month: '2026-08' });

    // Back again → instance 1 (EMP-084 / September):
    // index 4 → 3 (report/EMP-090) → 2 (travel) → 1 (report/EMP-084)
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // travel
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]); // smartQualityReport instance 1
    restored = JSON.parse(h.storage.session.getItem(keyOf('smartQualityReport', 'view'))!);
    assert.deepEqual(restored.state, { employeeId: 'EMP-084', month: '2026-09' });
    assert.deepEqual(h.applied.map((e) => e.page).at(-1), 'smartQualityReport');
  });

  it('requests a scroll restore on popstate with the captured offset (§17)', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify(pageEvent('travel'));
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.equal(h.scroll.restores.length, 1);
    assert.equal(h.scroll.restores[0].top, 0);
    assert.equal(h.scroll.restores[0].entryId, parseQnalysEntry(h.log.states[h.log.index])?.entryId);
  });
});

// ── §19 Overlays ───────────────────────────────────────────────

describe('§NAVIGATION-HISTORY — meaningful overlays (§19)', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
  });

  it('an overlay open pushes a page-level entry riding on the underlying page', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify({ type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-084' });
    assert.equal(h.log.pushes, 2);
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.overlay, 'employee360');
    assert.equal(entry?.contextId, 'EMP-084');
    assert.equal(entry?.page, 'employees');
  });

  it('Back from the overlay restores the underlying page entry', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify({ type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-084' });
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    const applied = h.applied.at(-1);
    assert.equal(applied?.overlay, null);
    assert.equal(applied?.page, 'employees');
  });

  it('re-opening the SAME overlay context does not duplicate (§20)', () => {
    h.controller.notify(pageEvent('employees'));
    h.controller.notify({ type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-084' });
    h.controller.notify({ type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-084' });
    assert.equal(h.log.pushes, 2);
  });

  it('a DIFFERENT overlay context is a real navigation (dialog → dialog)', () => {
    h.controller.notify(pageEvent('operationsCenter'));
    h.controller.notify({ type: 'overlay-open', overlay: 'departmentHealth', contextId: 'Sales' });
    h.controller.notify({ type: 'overlay-open', overlay: 'departmentHealth', contextId: 'Ops' });
    assert.equal(h.log.pushes, 3);
    h.controller.requestBack();
    h.firePop(h.log.states[h.log.index]);
    assert.equal(h.applied.at(-1)?.contextId, 'Sales');
  });
});

// ── §15 Identity boundaries ────────────────────────────────────

describe('§NAVIGATION-HISTORY — identity boundaries (§15)', () => {
  it('reload adoption restores the page when the SAME user resolves', () => {
    const adopted: QnalysHistoryEntryState = {
      qnalys: true, entryId: 'e-42', userId: 'u1', seq: 7, page: 'employees',
      overlay: null, contextId: null, highlightId: null, navParams: null, createdAt: 1,
    };
    const h = makeHarness({ initialState: adopted });
    h.controller.onUserIdChanged('u1');
    assert.deepEqual(h.applied.map((e) => e.page), ['employees'], 'reload restores the page');
    assert.deepEqual(h.resets, [], 'no reset for the same user');
  });

  it('keeps the adopted entry when auth resolves through a transient null', () => {
    const adopted: QnalysHistoryEntryState = {
      qnalys: true, entryId: 'e-42', userId: 'u1', seq: 7, page: 'travel',
      overlay: null, contextId: null, highlightId: null, navParams: null, createdAt: 1,
    };
    const h = makeHarness({ initialState: adopted });
    h.controller.onUserIdChanged(null); // hydration phase
    h.controller.onUserIdChanged('u1'); // session restored
    assert.deepEqual(h.applied.map((e) => e.page), ['travel']);
  });

  it('first login over a fresh entry resets to a clean boundary', () => {
    const h = makeHarness({ userId: null });
    h.controller.onUserIdChanged('u1');
    assert.deepEqual(h.applied, [], 'nothing to restore on a fresh load');
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.userId, 'u1');
    assert.equal(entry?.page, 'home');
  });

  it('logout resets the navigation surface and never restores authenticated pages', () => {
    const h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
    h.controller.notify(pageEvent('employees'));
    h.controller.onUserIdChanged(null);
    assert.deepEqual(h.resets, [1]);
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.page, 'home');
    assert.equal(entry?.userId, null);
  });

  it('Back after logout cannot resurrect the previous identity’s entry (Scenario I)', () => {
    const h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
    h.controller.notify(pageEvent('employees'));
    const employeesEntry = currentUserEntry(h.log);
    h.setUserId(null);
    h.controller.onUserIdChanged(null); // logout
    h.setUserId('u2');
    h.controller.onUserIdChanged('u2'); // login as B

    // User B presses Back into User A's entry.
    h.log.index -= 1; // browser goes to A's employees entry
    h.firePop(h.log.states[h.log.index]);
    assert.deepEqual(h.applied, [], 'foreign entry never applied');
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.page, 'home', 'position sanitized to home');
    assert.equal(entry?.userId, 'u2');
    assert.notEqual(entry?.entryId, employeesEntry?.entryId);
  });

  it('popstate while logged out never applies authenticated entries', () => {
    const h = makeHarness({ userId: null });
    const stale: QnalysHistoryEntryState = {
      qnalys: true, entryId: 'e-9', userId: 'u1', seq: 3, page: 'employees',
      overlay: null, contextId: null, highlightId: null, navParams: null, createdAt: 1,
    };
    h.firePop(stale);
    assert.deepEqual(h.applied, []);
    const entry = currentUserEntry(h.log);
    assert.equal(entry?.page, 'home');
  });

  it('popstate on a foreign (non-Qnalys) state does nothing — the browser owns it', () => {
    const h = makeHarness({ userId: 'u1' });
    h.controller.onUserIdChanged('u1');
    const pushesBefore = h.log.pushes;
    h.firePop(null);
    assert.deepEqual(h.applied, []);
    assert.equal(h.log.pushes, pushesBefore);
  });
});

// ── Entry parsing + param normalization (§12) ──────────────────

describe('§NAVIGATION-HISTORY — entry parsing + normalization', () => {
  it('parseQnalysEntry rejects malformed states', () => {
    assert.equal(parseQnalysEntry(null), null);
    assert.equal(parseQnalysEntry('string'), null);
    assert.equal(parseQnalysEntry({ qnalys: true }), null);
    assert.equal(parseQnalysEntry({ qnalys: false, entryId: 'e', page: 'home', seq: 1, createdAt: 1 }), null);
    assert.equal(parseQnalysEntry({ qnalys: true, entryId: '', page: 'home', seq: 1, createdAt: 1 }), null);
    assert.equal(parseQnalysEntry({ qnalys: true, entryId: 'e', page: 'home', overlay: 'bogus', seq: 1, createdAt: 1 }), null);
    assert.equal(parseQnalysEntry({ qnalys: true, entryId: 'e', page: 'home', userId: 42, seq: 1, createdAt: 1 }), null);
  });

  it('normalizeNavParams is deterministic and key-order independent (§12)', () => {
    assert.equal(normalizeNavParams({ a: '1', b: '2' }), normalizeNavParams({ b: '2', a: '1' }));
    assert.equal(normalizeNavParams(null), normalizeNavParams(undefined));
    assert.notEqual(
      normalizeNavParams({ employeeId: 'A', month: '2026-09' }),
      normalizeNavParams({ employeeId: 'B', month: '2026-09' }),
    );
  });
});
