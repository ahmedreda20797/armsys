// src/lib/__tests__/connect-floating-ui.test.ts
// ══════════════════════════════════════════════════════════════
//  Connect 1.0.1 — FLOATING UI LOGIC CONTRACTS (pure units)
//
//  The project's node:test harness has no DOM renderer, so the React
//  components themselves are verified by the production build + the
//  live browser verification. The PURE logic behind the floating
//  redesign is fully contracted here:
//    • connect-animations — the launcher→panel emergence: DECLARATIVE
//      CSS-transition styles (final state styled at commit — never
//      dependent on animation frames), GPU-friendly properties only,
//      origin anchored at the launcher corner, prefers-reduced-motion
//      disables the transition;
//    • connect-floating-store — panel/window lifecycle, minimize vs
//      close, per-conversation draft preservation, full reset.
// ══════════════════════════════════════════════════════════════

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  overlayMotionStyle,
  CONNECT_PANEL_ORIGIN,
  CONNECT_PANEL_EASE,
  CONNECT_OPEN_MS,
  CONNECT_CLOSE_MS,
} from '@/components/connect/floating/connect-animations';
import { useConnectFloatingStore } from '@/components/connect/floating/connect-floating-store';

// ─── Animation contract ────────────────────────────────────────

/** Properties allowed on the overlay motion style (transform +
 *  opacity are GPU-composited; everything else risks layout thrash). */
const MOTION_KEYS = new Set(['opacity', 'transform', 'visibility', 'pointerEvents', 'transition', 'willChange']);

describe('Launcher→panel emergence animation (declarative CSS transitions)', () => {
  it('origin is anchored at the launcher (left/bottom corner)', () => {
    assert.equal(CONNECT_PANEL_ORIGIN, 'left bottom');
  });

  it('open state is fully styled at commit (no frame-loop dependency)', () => {
    const open = overlayMotionStyle(true, false, 'panel');
    assert.equal(open.opacity, 1);
    assert.equal(open.visibility, 'visible');
    assert.equal(open.pointerEvents, 'auto');
    assert.equal(open.transform, 'scale(1) translate(0px, 0px)');
    assert.ok(String(open.transition).includes(`${CONNECT_OPEN_MS}ms`), 'open duration applied');
    assert.ok(String(open.transition).includes('0ms linear 0ms'), 'visibility flips immediately on open');
  });

  it('closed state hides and re-emerges toward the launcher', () => {
    const closed = overlayMotionStyle(false, false, 'panel');
    assert.equal(closed.opacity, 0);
    assert.equal(closed.visibility, 'hidden');
    assert.equal(closed.pointerEvents, 'none', 'a closed panel never intercepts page interactions');
    assert.equal(closed.transform, 'scale(0.62) translate(-14px, 10px)', 'shrinks toward the launcher corner');
    assert.ok(String(closed.transition).includes(`${CONNECT_CLOSE_MS}ms`), 'close duration applied');
    assert.ok(
      String(closed.transition).includes(`visibility 0ms linear ${CONNECT_CLOSE_MS}ms`),
      'visibility flips only AFTER the close transition',
    );
  });

  it('close is faster than open (reversal feel)', () => {
    assert.ok(CONNECT_CLOSE_MS < CONNECT_OPEN_MS);
    assert.ok(CONNECT_OPEN_MS <= 300, 'fast — no sluggish theatrics');
  });

  it('prefers-reduced-motion: instant swap — transition none', () => {
    for (const open of [true, false]) {
      const style = overlayMotionStyle(open, true, 'panel');
      assert.equal(style.transition, 'none', 'no transition under reduced motion');
    }
  });

  it('all animated properties are compositor-friendly (no layout thrash)', () => {
    for (const kind of ['panel', 'window'] as const) {
      for (const open of [true, false]) {
        for (const reduced of [true, false]) {
          for (const key of Object.keys(overlayMotionStyle(open, reduced, kind))) {
            assert.ok(MOTION_KEYS.has(key), `${key} must not be animated (layout thrash risk)`);
          }
        }
      }
    }
  });

  it('the window shrinks less than the panel and settles upward', () => {
    const closed = overlayMotionStyle(false, false, 'window');
    assert.equal(closed.transform, 'scale(0.9) translateY(14px)');
    assert.match(String(overlayMotionStyle(true, false, 'window').transition), /220ms/);
  });

  it('the shared ease is a restrained cubic (no bounce/spring theatrics)', () => {
    assert.equal(CONNECT_PANEL_EASE, 'cubic-bezier(0.22, 1, 0.36, 1)');
  });
});

// ─── Floating overlay state (store) ────────────────────────────

describe('Connect floating store', () => {
  beforeEach(() => {
    useConnectFloatingStore.getState().reset();
  });

  it('panel opens and closes without touching the conversation window', () => {
    const s = useConnectFloatingStore.getState();
    s.openPanel();
    assert.equal(useConnectFloatingStore.getState().panelOpen, true);
    useConnectFloatingStore.getState().closePanel();
    assert.equal(useConnectFloatingStore.getState().panelOpen, false);
    assert.equal(useConnectFloatingStore.getState().windowOpen, false);
  });

  it('openConversation opens the window; the panel option controls list visibility', () => {
    const s = useConnectFloatingStore.getState();
    s.openConversation('conv_1');
    assert.equal(useConnectFloatingStore.getState().windowOpen, true);
    assert.equal(useConnectFloatingStore.getState().activeConversationId, 'conv_1');
    assert.equal(useConnectFloatingStore.getState().panelOpen, false, 'panel unchanged without the option');

    s.openConversation('conv_2', { openPanel: true });
    assert.equal(useConnectFloatingStore.getState().panelOpen, true);
    assert.equal(useConnectFloatingStore.getState().activeConversationId, 'conv_2');
  });

  it('MINIMIZE keeps the active conversation (draft preserved, reopen without data loss)', () => {
    const s = useConnectFloatingStore.getState();
    s.openConversation('conv_1');
    s.setDraft('conv_1', 'مسودة غير مرسلة');
    s.minimizeConversation();
    const after = useConnectFloatingStore.getState();
    assert.equal(after.windowOpen, false);
    assert.equal(after.activeConversationId, 'conv_1', 'conversation stays active');
    assert.equal(after.drafts.conv_1, 'مسودة غير مرسلة', 'draft survives minimize');

    // Reopening the same conversation restores it.
    after.openConversation('conv_1');
    assert.equal(useConnectFloatingStore.getState().windowOpen, true);
  });

  it('CLOSE clears the active conversation but KEEPS the draft for reopen', () => {
    const s = useConnectFloatingStore.getState();
    s.openConversation('conv_1');
    s.setDraft('conv_1', 'نص محفوظ');
    s.closeConversation();
    const after = useConnectFloatingStore.getState();
    assert.equal(after.windowOpen, false);
    assert.equal(after.activeConversationId, null);
    assert.equal(after.drafts.conv_1, 'نص محفوظ', 'draft persists across close');
  });

  it('drafts are per-conversation and clearable (cleared on send)', () => {
    const s = useConnectFloatingStore.getState();
    s.setDraft('conv_1', 'أ');
    s.setDraft('conv_2', 'ب');
    s.setDraft('conv_1', 'أ2');
    const mid = useConnectFloatingStore.getState();
    assert.equal(mid.drafts.conv_1, 'أ2');
    assert.equal(mid.drafts.conv_2, 'ب');

    s.clearDraft('conv_1');
    const after = useConnectFloatingStore.getState();
    assert.equal('conv_1' in after.drafts, false);
    assert.equal(after.drafts.conv_2, 'ب', 'other conversations unaffected');
  });

  it('reset clears everything (logout / cache identity change)', () => {
    const s = useConnectFloatingStore.getState();
    s.openConversation('conv_1', { openPanel: true });
    s.setDraft('conv_1', 'نص');
    s.reset();
    const after = useConnectFloatingStore.getState();
    assert.equal(after.panelOpen, false);
    assert.equal(after.windowOpen, false);
    assert.equal(after.activeConversationId, null);
    assert.deepEqual(after.drafts, {});
  });

  it('openWithConversation — the ONE deep-link entry: id opens panel+window; null opens the panel only', () => {
    const s = useConnectFloatingStore.getState();
    s.openWithConversation('conv_9');
    assert.equal(useConnectFloatingStore.getState().panelOpen, true);
    assert.equal(useConnectFloatingStore.getState().windowOpen, true);
    assert.equal(useConnectFloatingStore.getState().activeConversationId, 'conv_9');

    s.reset();
    useConnectFloatingStore.getState().openWithConversation(null);
    const after = useConnectFloatingStore.getState();
    assert.equal(after.panelOpen, true);
    assert.equal(after.windowOpen, false);
  });

  it('deep-link jump target: openWithConversation carries the messageId; reset clears it', () => {
    const s = useConnectFloatingStore.getState();
    s.openWithConversation('conv_9', 'msg_42');
    assert.equal(useConnectFloatingStore.getState().pendingJumpMessageId, 'msg_42');
    useConnectFloatingStore.getState().reset();
    assert.equal(useConnectFloatingStore.getState().pendingJumpMessageId, null);
  });
});
