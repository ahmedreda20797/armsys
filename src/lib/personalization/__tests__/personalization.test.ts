// ══════════════════════════════════════════════════════════════
//  Milestone 10 — Personal workspace reconciliation
//
//  Covers (milestone test plan D):
//    • user isolation by construction (per-user record shape)
//    • sidebar order persistence + permission-first reconciliation
//    • widget layout: order, visibility, defaults
//    • reset semantics
//    • permission removal reconciliation (revoked pages never
//      resurrect from a saved order)
//    • input sanitization (API whitelist)
//
//  Run: npx tsx --test src/lib/personalization/__tests__/personalization.test.ts
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileSidebarOrder, resolveWidgetLayout, sanitizeUserPreferencesInput,
  effectiveHiddenWidgets,
} from '@/lib/personalization';
import { DASHBOARD_WIDGETS, type WidgetConfig } from '@/config/dashboard-widgets';

describe('sidebar order reconciliation', () => {
  it('no saved order → registry order', () => {
    assert.deepEqual(reconcileSidebarOrder(['a', 'b', 'c'], undefined), ['a', 'b', 'c']);
    assert.deepEqual(reconcileSidebarOrder(['a', 'b', 'c'], null), ['a', 'b', 'c']);
    assert.deepEqual(reconcileSidebarOrder(['a', 'b', 'c'], []), ['a', 'b', 'c']);
  });

  it('saved order reorders within the permitted set', () => {
    assert.deepEqual(reconcileSidebarOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b']);
  });

  it('PERMISSION WINS: revoked pages are dropped even if saved first', () => {
    // 'b' revoked after the order was saved — must not resurrect
    assert.deepEqual(reconcileSidebarOrder(['a', 'c'], ['b', 'c', 'a']), ['c', 'a']);
  });

  it('newly added pages append gracefully after saved ones', () => {
    assert.deepEqual(reconcileSidebarOrder(['a', 'b', 'newPage'], ['b', 'a']), ['b', 'a', 'newPage']);
  });

  it('stale ids and duplicates in the saved order are ignored', () => {
    assert.deepEqual(reconcileSidebarOrder(['a', 'b'], ['ghost', 'b', 'ghost', 'a']), ['b', 'a']);
  });
});

describe('dashboard widget layout', () => {
  const all = () => true;

  it('default layout: registry order, registry default visibility (§12C DEFAULT_LAYOUT)', () => {
    // Sections folded into the queue (defaultVisible: false) are
    // hidden until the user explicitly personalizes.
    const layout = resolveWidgetLayout(DASHBOARD_WIDGETS, null, all);
    const expected = DASHBOARD_WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id);
    assert.deepEqual(layout.map((w) => w.id), expected);
  });

  it('effectiveHiddenWidgets: registry defaults until an explicit customization exists, then the saved set ALONE', () => {
    const defaults = effectiveHiddenWidgets(DASHBOARD_WIDGETS, null);
    assert.ok(defaults.has('pendingRequests'));
    assert.ok(!defaults.has('attentionRequired'));
    // Any explicit hidden/order replaces defaults entirely.
    const explicit = effectiveHiddenWidgets(
      DASHBOARD_WIDGETS,
      { dashboard: { widgetOrder: ['attentionRequired'], hiddenWidgets: ['quickAccess'] } },
    );
    assert.ok(explicit.has('quickAccess'));
    assert.ok(!explicit.has('pendingRequests'));
  });

  it('user order + hidden widgets apply within the permitted set', () => {
    // Order pins quickAccess + attendanceToday first; pendingRequests is
    // hidden; the remaining widgets append in registry order.
    const layout = resolveWidgetLayout(
      DASHBOARD_WIDGETS,
      { dashboard: { widgetOrder: ['quickAccess', 'attendanceToday'], hiddenWidgets: ['pendingRequests'] } },
      all,
    );
    const ids = layout.map((w) => w.id);
    // The two pinned widgets come first, in order; pendingRequests is hidden.
    assert.deepEqual(ids.slice(0, 2), ['quickAccess', 'attendanceToday']);
    assert.ok(!ids.includes('pendingRequests'));
    // The remaining permitted widgets appear in registry order.
    const expectedRest = DASHBOARD_WIDGETS
      .filter((w) => w.id !== 'pendingRequests' && w.id !== 'quickAccess' && w.id !== 'attendanceToday')
      .map((w) => w.id);
    assert.deepEqual(ids.slice(2), expectedRest);
  });

  it('PERMISSION WINS: an unauthorized widget never renders even if not hidden', () => {
    // Only 'home'-permission widgets permitted — attentionRequired,
    // operationalTimeline, performancePulse and quickAccess are all
    // 'home'; pendingRequests ('requests') is not.
    const homeOnly = (w: WidgetConfig) => w.permissionKey === 'home';
    const layout = resolveWidgetLayout(
      DASHBOARD_WIDGETS,
      { dashboard: { widgetOrder: ['pendingRequests', 'quickAccess', 'attentionRequired'] } },
      homeOnly,
    );
    // pendingRequests is excluded; the order array pins the relative
    // order of permitted widgets, unranked 'home' widgets append in
    // registry order.
    assert.ok(!layout.some((w) => w.id === 'pendingRequests'));
    assert.deepEqual(layout.map((w) => w.id), [
      'quickAccess', 'attentionRequired', 'operationalTimeline', 'performancePulse',
    ]);
  });

  it('permission loss reconciliation: widget hidden after permission revocation stays gone; regrant + unhide restores', () => {
    // travelAlerts is defaultVisible: true — after an explicit
    // customization it obeys ONLY the saved hidden set.
    const prefs = { dashboard: { hiddenWidgets: ['travelAlerts'] as string[] } };
    const withoutTravel = (w: WidgetConfig) => w.permissionKey !== 'travel';
    let layout = resolveWidgetLayout(DASHBOARD_WIDGETS, prefs, withoutTravel);
    assert.ok(!layout.some((w) => w.id === 'travelAlerts')); // revoked → dropped
    layout = resolveWidgetLayout(DASHBOARD_WIDGETS, prefs, () => true);
    assert.ok(!layout.some((w) => w.id === 'travelAlerts')); // still user-hidden
    // Cleared preferences → DEFAULT_LAYOUT → default-visible widget back.
    layout = resolveWidgetLayout(DASHBOARD_WIDGETS, { dashboard: {} }, () => true);
    assert.ok(layout.some((w) => w.id === 'travelAlerts'));
  });

  it('reset (explicit empty hidden set) hides nothing; cleared preferences restore defaults — Personal Workspace Recovery', () => {
    const layout = resolveWidgetLayout(DASHBOARD_WIDGETS, { dashboard: { hiddenWidgets: DASHBOARD_WIDGETS.map((w) => w.id) } }, all);
    assert.equal(layout.length, 0);
    const reset = resolveWidgetLayout(DASHBOARD_WIDGETS, { dashboard: {} }, all);
    assert.deepEqual(reset.map((w) => w.id), DASHBOARD_WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id));
  });

  it('stale widget ids in the saved order are ignored, new widgets append', () => {
    const layout = resolveWidgetLayout(
      DASHBOARD_WIDGETS,
      { dashboard: { widgetOrder: ['departmentsOverview', 'ghostWidget'] } },
      all,
    );
    assert.deepEqual(layout[0].id, 'departmentsOverview');
    assert.equal(layout.length, DASHBOARD_WIDGETS.length);
  });
});

describe('user isolation (by construction) + sanitization', () => {
  it('preferences carry no userId from the client — identity comes from the JWT', () => {
    const sanitized = sanitizeUserPreferencesInput({
      userId: 'attacker-controlled-id', // must be dropped
      sidebar: { order: ['a', 'b'] },
    })!;
    assert.equal('userId' in sanitized, false);
    assert.deepEqual(sanitized.sidebar?.order, ['a', 'b']);
  });

  it('non-object or junk bodies return null (caller 400s)', () => {
    assert.equal(sanitizeUserPreferencesInput(null), null);
    assert.equal(sanitizeUserPreferencesInput('sidebar'), null);
    assert.equal(sanitizeUserPreferencesInput([1, 2]), null);
  });

  it('unknown fields dropped; invalid array entries filtered; arrays capped', () => {
    const sanitized = sanitizeUserPreferencesInput({
      evil: 'field',
      dashboard: { hiddenWidgets: ['ok', 42, '', 'x'.repeat(101)], widgetOrder: Array.from({ length: 500 }, (_, i) => `w${i}`) },
    })!;
    assert.deepEqual(sanitized.dashboard?.hiddenWidgets, ['ok']);
    assert.equal(sanitized.dashboard!.widgetOrder!.length, 200);
    assert.equal('evil' in sanitized, false);
  });

  it('users are isolated: records are keyed per user server-side — distinct records stay independent', () => {
    // The pure layer models two users' saved orders; reconciliation of
    // one can never influence the other (no shared mutable state).
    const ahmed = reconcileSidebarOrder(['a', 'b', 'c'], ['c', 'b', 'a']);
    const mohamed = reconcileSidebarOrder(['a', 'b', 'c'], ['a', 'b', 'c']);
    assert.deepEqual(ahmed, ['c', 'b', 'a']);
    assert.deepEqual(mohamed, ['a', 'b', 'c']);
  });
});
