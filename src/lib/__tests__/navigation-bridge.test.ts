// ══════════════════════════════════════════════════════════════
//  Store ⇄ Navigation Bridge — one canonical navigation boundary
//  (SPA Navigation History §6/§8/§15)
//
//  Guards the CONTRACT the history controller relies on:
//    • every routed navigation + meaningful overlay notifies the
//      bridge BEFORE the state change (capture-then-apply);
//    • ephemeral surfaces (notification popover) never notify;
//    • goBack delegates to browser history when the controller can
//      honor it, and falls back to the legacy swap at the boundary;
//    • the popstate path (applyHistoryEntry) NEVER notifies — that
//      is the no-history-loop guarantee;
//    • resetNavigationToHome is the hard identity reset surface.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { useAppStore } from '@/lib/store';
import {
  setNavigationBridge,
  type NavigationBridge,
  type NavigationBridgeEvent,
} from '@/lib/navigation/navigation-bridge';

function makeMockBridge(backResult = true) {
  const events: NavigationBridgeEvent[] = [];
  let backRequests = 0;
  const bridge: NavigationBridge = {
    notify(event) {
      events.push(event);
    },
    requestBack() {
      backRequests += 1;
      return backResult;
    },
  };
  return {
    bridge,
    events,
    get backRequests() { return backRequests; },
  };
}

function resetStore() {
  useAppStore.setState({
    currentPage: 'home',
    previousPage: 'home',
    sidebarOpen: false,
    highlightId: null,
    navParams: {},
    notificationPanelOpen: false,
    employee360Open: false,
    employee360Id: null,
    departmentHealthName: null,
  });
}

beforeEach(() => {
  setNavigationBridge(null);
  resetStore();
});

describe('store → bridge notifications', () => {
  it('navigateTo notifies the routed page navigation before applying state', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.getState().navigateTo('travel', 'deal-1', { month: '2026-09' });

    assert.deepEqual(mock.events, [{
      type: 'page',
      page: 'travel',
      highlightId: 'deal-1',
      navParams: { month: '2026-09' },
    }]);
    // State applied too — the bridge observes, it does not replace.
    const s = useAppStore.getState();
    assert.equal(s.currentPage, 'travel');
    assert.equal(s.highlightId, 'deal-1');
    assert.deepEqual(s.navParams, { month: '2026-09' });
  });

  it('setCurrentPage (sidebar navigation) joins the same boundary', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.getState().setCurrentPage('employees');
    assert.deepEqual(mock.events, [{ type: 'page', page: 'employees', highlightId: null, navParams: {} }]);
    assert.equal(useAppStore.getState().currentPage, 'employees');
  });

  it('employee360/departmentHealth notify overlay-open, not page navigations', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.getState().navigateTo('employee360', 'EMP-084');
    useAppStore.getState().openEmployee360('EMP-090');
    useAppStore.getState().navigateTo('departmentHealth', 'Sales');
    useAppStore.getState().openDepartmentHealth('Ops');

    assert.deepEqual(mock.events, [
      { type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-084' },
      { type: 'overlay-open', overlay: 'employee360', contextId: 'EMP-090' },
      { type: 'overlay-open', overlay: 'departmentHealth', contextId: 'Sales' },
      { type: 'overlay-open', overlay: 'departmentHealth', contextId: 'Ops' },
    ]);
    assert.equal(useAppStore.getState().employee360Open, true);
    assert.equal(useAppStore.getState().employee360Id, 'EMP-090');
    assert.equal(useAppStore.getState().departmentHealthName, 'Ops');
  });

  it('overlay opens WITHOUT context never notify (legacy no-op preserved)', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.getState().navigateTo('employee360');
    assert.deepEqual(mock.events, []);
    assert.equal(useAppStore.getState().employee360Open, false);
  });

  it('the notification popover is ephemeral — never a navigation event (§19)', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.getState().navigateTo('notifications');
    assert.deepEqual(mock.events, []);
    assert.equal(useAppStore.getState().notificationPanelOpen, true);
    assert.equal(useAppStore.getState().currentPage, 'home', 'no page change');
  });

  it('without a registered bridge everything is a silent no-op (tests/SSR)', () => {
    assert.doesNotThrow(() => {
      useAppStore.getState().navigateTo('travel');
      useAppStore.getState().goBack();
      useAppStore.getState().closeEmployee360();
    });
    assert.equal(useAppStore.getState().currentPage, 'home', 'goBack falls back to the legacy swap');
  });
});

describe('store → bridge back requests', () => {
  it('goBack delegates to browser history when the controller honors it', () => {
    const mock = makeMockBridge(true);
    setNavigationBridge(mock.bridge);
    useAppStore.setState({ currentPage: 'travel', previousPage: 'employees' });
    useAppStore.getState().goBack();
    assert.equal(mock.backRequests, 1);
    assert.equal(useAppStore.getState().currentPage, 'travel', 'restoration arrives via popstate, not the swap');
  });

  it('goBack falls back to the legacy previousPage swap at the history boundary', () => {
    const mock = makeMockBridge(false); // controller: no in-app entry before this one
    setNavigationBridge(mock.bridge);
    useAppStore.setState({ currentPage: 'travel', previousPage: 'employees' });
    useAppStore.getState().goBack();
    assert.equal(mock.backRequests, 1);
    assert.equal(useAppStore.getState().currentPage, 'employees');
    assert.equal(useAppStore.getState().highlightId, null);
    assert.deepEqual(useAppStore.getState().navParams, {});
  });
});

describe('store → bridge overlay close = history back', () => {
  it('closeEmployee360 / closeDepartmentHealth drive history back', () => {
    const mock = makeMockBridge(true);
    setNavigationBridge(mock.bridge);
    useAppStore.setState({ employee360Open: true, employee360Id: 'EMP-084' });
    useAppStore.getState().closeEmployee360();
    useAppStore.setState({ departmentHealthName: 'Sales' });
    useAppStore.getState().closeDepartmentHealth();
    assert.equal(mock.backRequests, 2);
    assert.equal(useAppStore.getState().employee360Open, true, 'closure arrives via popstate');
  });

  it('close falls back to direct dismissal without a controller', () => {
    useAppStore.setState({ employee360Open: true, employee360Id: 'EMP-084' });
    useAppStore.getState().closeEmployee360();
    assert.equal(useAppStore.getState().employee360Open, false);
  });
});

describe('popstate application path (no-loop guarantee, §8)', () => {
  it('applyHistoryEntry applies a page entry WITHOUT notifying the bridge', () => {
    const mock = makeMockBridge();
    setNavigationBridge(mock.bridge);
    useAppStore.setState({ currentPage: 'travel', employee360Open: true, employee360Id: 'E' });
    useAppStore.getState().applyHistoryEntry({
      page: 'employees',
      overlay: null,
      contextId: null,
      highlightId: 'emp-84',
    });

    assert.deepEqual(mock.events, [], 'popstate path never notifies → no pushState → no loop');
    const s = useAppStore.getState();
    assert.equal(s.currentPage, 'employees');
    assert.equal(s.highlightId, 'emp-84');
    assert.deepEqual(s.navParams, {});
    assert.equal(s.employee360Open, false, 'page entries close overlays');
    assert.equal(s.previousPage, 'travel');
  });

  it('applyHistoryEntry restores overlay entries (Back into an open dialog)', () => {
    useAppStore.setState({ employee360Open: false, currentPage: 'employees' });
    useAppStore.getState().applyHistoryEntry({
      page: 'employees',
      overlay: 'employee360',
      contextId: 'EMP-084',
      highlightId: null,
    });
    const s = useAppStore.getState();
    assert.equal(s.employee360Open, true);
    assert.equal(s.employee360Id, 'EMP-084');
    assert.equal(s.currentPage, 'employees');

    useAppStore.getState().applyHistoryEntry({
      page: 'operationsCenter',
      overlay: 'departmentHealth',
      contextId: 'Sales',
      highlightId: null,
    });
    assert.equal(useAppStore.getState().departmentHealthName, 'Sales');
  });

  it('§SETTINGS-SECTIONS — popstate restores the active settings section', () => {
    useAppStore.setState({ currentPage: 'employees', navParams: {} });
    useAppStore.getState().applyHistoryEntry({
      page: 'settings',
      overlay: null,
      contextId: null,
      highlightId: null,
      navParams: { section: 'masterData' },
    });
    const s = useAppStore.getState();
    assert.equal(s.currentPage, 'settings');
    assert.deepEqual(s.navParams, { section: 'masterData' },
      'the section is entry identity on the settings route');
  });

  it('§SETTINGS-SECTIONS — other pages keep transient navParams non-restored', () => {
    useAppStore.setState({ currentPage: 'home', navParams: {} });
    useAppStore.getState().applyHistoryEntry({
      page: 'employees',
      overlay: null,
      contextId: null,
      highlightId: null,
      navParams: { month: '2026-09' },
    });
    assert.deepEqual(useAppStore.getState().navParams, {},
      'popstate must not re-fire other pages\u2019 transient navParams (§13 history doctrine)');
  });

  it('resetNavigationToHome clears the whole navigation surface (§15)', () => {
    useAppStore.setState({
      currentPage: 'smartQualityReport',
      previousPage: 'employees',
      sidebarOpen: true,
      highlightId: 'emp-84',
      navParams: { month: '2026-09' },
      employee360Open: true,
      employee360Id: 'EMP-084',
      departmentHealthName: 'Sales',
    });
    useAppStore.getState().resetNavigationToHome();
    const s = useAppStore.getState();
    assert.equal(s.currentPage, 'home');
    assert.equal(s.previousPage, 'home');
    assert.equal(s.sidebarOpen, false);
    assert.equal(s.highlightId, null);
    assert.deepEqual(s.navParams, {});
    assert.equal(s.employee360Open, false);
    assert.equal(s.employee360Id, null);
    assert.equal(s.departmentHealthName, null);
  });
});
