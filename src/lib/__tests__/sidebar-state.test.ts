// ══════════════════════════════════════════════════════════════
//  §SIDEBAR-V2 regression guards — the TWO-AXIS sidebar state model
//
//  Guard 1: the persisted `sidebar.pinOpen` preference maps onto the
//  (pinned, expanded) axes through ONE canonical rule
//  (resolveInitialSidebarState) — hydration, the Control Center and
//  the tests all speak the same language. A user who pinned the
//  sidebar must come back pinned; a user who unpinned must come back
//  unpinned; the §SIDEBAR-DEFAULT-HIDDEN product rule makes the
//  absent preference resolve to HIDDEN (no layout width — the
//  hamburger opens the drawer, pin makes it persistent).
//
//  Guard 2: navigation closes the overlay DRAWER but never mutates
//  the pinned/expanded axes — navigating is not a layout decision.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveInitialSidebarState, useAppStore } from '@/lib/store';

describe('§SIDEBAR-V2 — two-axis sidebar state', () => {
  describe('resolveInitialSidebarState (the ONE pinOpen mapping rule)', () => {
    it('pinOpen=true → pinned AND expanded (the user pinned it open)', () => {
      assert.deepEqual(resolveInitialSidebarState(true), { pinned: true, expanded: true });
    });

    it('pinOpen=false → unpinned (floating drawer, no layout width)', () => {
      assert.deepEqual(resolveInitialSidebarState(false), { pinned: false, expanded: false });
    });

    it('absent preference → DEFAULT HIDDEN (§SIDEBAR-DEFAULT-HIDDEN): content owns the viewport until the user opens/pins', () => {
      assert.deepEqual(resolveInitialSidebarState(undefined), { pinned: false, expanded: false });
      assert.deepEqual(resolveInitialSidebarState(null), { pinned: false, expanded: false });
    });

    it('the mapping is total over the boolean domain (never throws, always both axes)', () => {
      for (const input of [true, false, undefined, null] as const) {
        const state = resolveInitialSidebarState(input);
        assert.equal(typeof state.pinned, 'boolean');
        assert.equal(typeof state.expanded, 'boolean');
      }
    });
  });

  describe('store layout semantics', () => {
    beforeEach(() => {
      // Reset the axes to the DEFAULT-HIDDEN baseline before each assertion.
      useAppStore.setState({ sidebarPinned: false, sidebarExpanded: false, sidebarOpen: false });
    });

    it('navigation closes the overlay drawer WITHOUT touching pin/expand axes', () => {
      useAppStore.setState({ sidebarPinned: false, sidebarExpanded: true, sidebarOpen: true });
      useAppStore.getState().navigateTo('employees');
      const s = useAppStore.getState();
      assert.equal(s.sidebarOpen, false, 'drawer closes on navigation');
      assert.equal(s.sidebarPinned, false, 'pin axis untouched by navigation');
      assert.equal(s.sidebarExpanded, true, 'expand axis untouched by navigation');
    });

    it('pin/unpin toggles only the layout axis', () => {
      useAppStore.getState().toggleSidebarPin();
      assert.equal(useAppStore.getState().sidebarPinned, true);
      useAppStore.getState().toggleSidebarPin();
      assert.equal(useAppStore.getState().sidebarPinned, false);
      assert.equal(useAppStore.getState().sidebarExpanded, false, 'expand axis untouched by pin toggle');
    });

    it('expand/collapse toggles only the width axis', () => {
      useAppStore.getState().toggleSidebarExpand();
      assert.equal(useAppStore.getState().sidebarExpanded, true);
      assert.equal(
        useAppStore.getState().sidebarPinned,
        false,
        'pin axis untouched by expand toggle (default-hidden baseline is unpinned)',
      );
    });
  });
});
