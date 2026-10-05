// ══════════════════════════════════════════════════════════════
//  Scroll Restoration — readiness-driven pipeline tests (§17)
//
//  The injected frame/timer dependencies make the whole pipeline
//  deterministic: frames and timers only advance when the test
//  advances them, so the suite proves there are NO arbitrary
//  restore timers — every wait is event- or readiness-driven with
//  only a bounded give-up.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createScrollRestorer,
  type QueryReadinessSource,
  type ScrollSurface,
} from '../scroll-restore';

// ── Deterministic scheduler ────────────────────────────────────

function makeScheduler() {
  const frames: Array<() => void> = [];
  const timers: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  return {
    requestFrame(cb: () => void) {
      frames.push(cb);
      return () => {
        const i = frames.indexOf(cb);
        if (i >= 0) frames.splice(i, 1);
      };
    },
    setTimer(cb: () => void, ms: number) {
      const entry = { at: now + ms, fn: cb };
      timers.push(entry);
      return () => {
        const i = timers.indexOf(entry);
        if (i >= 0) timers.splice(i, 1);
      };
    },
    runFrame() {
      const next = frames.shift();
      next?.();
    },
    hasFrames() {
      return frames.length > 0;
    },
    advance(ms: number) {
      now += ms;
      for (const t of [...timers].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) {
          timers.splice(timers.indexOf(t), 1);
          t.fn();
        }
      }
    },
  };
}

type MockSurface = ScrollSurface & { positions: number[]; setY(v: number): void };

function makeSurface(scrollY = 0, maxScrollY = 2000): MockSurface {
  const positions: number[] = [];
  let current = scrollY;
  return {
    positions,
    get scrollY() { return current; },
    scrollTo({ top }) {
      current = Math.min(top, maxScrollY);
      positions.push(current);
    },
    maxScrollY: () => maxScrollY,
    setY: (v: number) => { current = v; },
  };
}

type MockQueries = QueryReadinessSource & {
  setFetching(v: boolean): void;
  emit(): void;
};

function makeQueries(fetching = false): MockQueries {
  let isFetching = fetching;
  const listeners: Array<() => void> = [];
  return {
    setFetching(v: boolean) {
      isFetching = v;
      for (const l of [...listeners]) l();
    },
    emit() {
      for (const l of [...listeners]) l();
    },
    subscribe(callback) {
      listeners.push(callback);
      return () => {
        const i = listeners.indexOf(callback);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
    allActiveSettled: () => !isFetching,
  };
}

function makeDeps(overrides?: {
  surface?: MockSurface;
  queries?: MockQueries;
  pageReady?: boolean;
  giveUpMs?: number;
}) {
  const scheduler = makeScheduler();
  const surface = overrides?.surface ?? makeSurface();
  const queries = overrides?.queries ?? makeQueries();
  let pageReady = overrides?.pageReady ?? true;
  return {
    scheduler,
    surface,
    queries,
    setPageReady: (v: boolean) => { pageReady = v; },
    deps: {
      surface,
      queries,
      requestFrame: scheduler.requestFrame,
      setTimer: scheduler.setTimer,
      giveUpMs: overrides?.giveUpMs ?? 15_000,
      isPageReady: () => pageReady,
    },
  };
}

// ── The pipeline ───────────────────────────────────────────────

describe('§17 scroll restoration pipeline', () => {
  it('restores the captured offset once the page mounted AND queries settled', () => {
    const { deps, scheduler, surface } = makeDeps();
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');

    scheduler.runFrame(); // page-ready poll passes
    scheduler.runFrame(); // layout frame after settle
    assert.deepEqual(surface.positions, [480]);
  });

  it('waits for the page DOM target (dynamic chunk), never a fixed frame count', () => {
    const { deps, scheduler, surface, setPageReady } = makeDeps({ pageReady: false });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');

    for (let i = 0; i < 25; i++) scheduler.runFrame();
    assert.deepEqual(surface.positions, [], 'not ready → nothing applied');

    setPageReady(true);
    scheduler.runFrame(); // readiness poll passes
    scheduler.runFrame(); // layout frame
    assert.deepEqual(surface.positions, [480]);
  });

  it('waits for ACTIVE queries to settle before applying (event-driven)', () => {
    const { deps, scheduler, surface, queries } = makeDeps({ queries: makeQueries(true) });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 300, 'employees');

    scheduler.runFrame(); // page-ready
    for (let i = 0; i < 10; i++) scheduler.runFrame();
    assert.deepEqual(surface.positions, [], 'fetching queries hold the restore');

    queries.setFetching(false); // cache event: settled
    scheduler.runFrame(); // layout frame
    assert.deepEqual(surface.positions, [300]);
  });

  it('gives up (bounded) when readiness never arrives — never guesses', () => {
    const { deps, scheduler, surface, setPageReady } = makeDeps({ pageReady: false, giveUpMs: 1000 });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');

    scheduler.advance(1500);
    assert.deepEqual(surface.positions, [], 'give-up skips, no scroll guess');
    assert.equal(scheduler.hasFrames(), false, 'pending work cancelled');

    // Late readiness after give-up must NOT apply.
    setPageReady(true);
    for (let i = 0; i < 5; i++) scheduler.runFrame();
    assert.deepEqual(surface.positions, []);
  });

  it('re-applies at most twice when late data grows the document', () => {
    const { deps, scheduler, surface, queries } = makeDeps();
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');
    scheduler.runFrame();
    scheduler.runFrame();
    assert.deepEqual(surface.positions, [480]);

    for (let i = 0; i < 2; i++) {
      queries.emit(); // late data arrival
      scheduler.runFrame(); // stability re-apply
      assert.equal(surface.positions.length, i + 2);
    }
    queries.emit(); // third arrival — ignored (bounded)
    scheduler.runFrame();
    assert.equal(surface.positions.length, 3, 're-apply bound respected');
  });

  it('stops re-applying once the user scrolled away (user owns the position)', () => {
    const { deps, scheduler, surface, queries } = makeDeps({ surface: makeSurface(0, 5000) });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');
    scheduler.runFrame();
    scheduler.runFrame();
    assert.deepEqual(surface.positions, [480]);

    // The user scrolls far from the restored offset.
    surface.setY(1200);
    queries.emit();
    scheduler.runFrame();
    assert.equal(surface.positions.length, 1, 'user takeover cancels stability re-apply');
  });

  it('cancelPending drops the pending restore without scrolling', () => {
    const { deps, scheduler, surface, setPageReady } = makeDeps({ pageReady: false });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 480, 'travel');
    restorer.cancelPending();
    setPageReady(true);
    for (let i = 0; i < 5; i++) scheduler.runFrame();
    assert.deepEqual(surface.positions, []);
  });

  it('scrollToTopNow applies immediately (fresh navigation, §17)', () => {
    const { deps, scheduler, surface } = makeDeps({ surface: makeSurface(820, 5000) });
    const restorer = createScrollRestorer(deps);
    restorer.scrollToTopNow();
    assert.deepEqual(surface.positions, [0]);
    assert.equal(scheduler.hasFrames(), false);
  });

  it('a new requestRestore cancels the previous pending one (no double apply)', () => {
    const { deps, scheduler, surface, setPageReady } = makeDeps({ pageReady: false });
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 100, 'employees');
    restorer.requestRestore('e2', 900, 'travel');
    setPageReady(true);
    scheduler.runFrame();
    scheduler.runFrame();
    assert.deepEqual(surface.positions, [900]);
  });

  it('restoring top (0) still applies deterministically', () => {
    const { deps, scheduler, surface } = makeDeps();
    const restorer = createScrollRestorer(deps);
    restorer.requestRestore('e1', 0, 'home');
    scheduler.runFrame();
    scheduler.runFrame();
    assert.deepEqual(surface.positions, [0]);
  });
});
