// ══════════════════════════════════════════════════════════════
//  §UX-STRUCTURE PART 12 / PART 23 — Home widget persistence
//  REGRESSION TEST (deterministic, no network).
//
//  Proves the full layout lifecycle the user experienced as
//  "drag → save → success toast → reload → defaults":
//
//    UI draft (draftOrder + hidden)
//      → sanitizeUserPreferencesInput   (what the API accepts)
//      → server-side merge              (what /api/user-preferences
//                                        PUT persists — the same
//                                        merge the route performs)
//      → re-read                        (GET after reload)
//      → resolveWidgetLayout hydration  (what the page renders)
//
//  …ends with EXACTLY the saved order. Also pins the hydration
//  race: hydrating BEFORE the persisted record loads must never
//  masquerade as a valid user layout that a later save could
//  write back over the real one.
// ══════════════════════════════════════════════════════════════

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveWidgetLayout,
  sanitizeUserPreferencesInput,
  effectiveHiddenWidgets,
  type UserPreferences,
} from '@/lib/personalization';
import { DASHBOARD_WIDGETS, type WidgetConfig } from '@/config/dashboard-widgets';

const all = () => true;

/** The merge performed by PUT /api/user-preferences (route.ts) —
 *  partial PUTs merge over the previous record; arrays replace
 *  wholesale when present. Kept literally in sync with the route. */
function serverMerge(existing: UserPreferences | null, incoming: UserPreferences): UserPreferences {
  return {
    sidebar: { ...(existing?.sidebar ?? {}), ...(incoming.sidebar ?? {}) },
    dashboard: { ...(existing?.dashboard ?? {}), ...(incoming.dashboard ?? {}) },
    favorites: incoming.favorites ?? existing?.favorites ?? [],
    pins: incoming.pins ?? existing?.pins ?? [],
    ui: { ...(existing?.ui ?? {}), ...(incoming.ui ?? {}) },
    updatedAt: new Date().toISOString(),
  };
}

describe('dashboard layout persistence lifecycle (§12A/§12B)', () => {
  it('save → persist → reload/hydrate → EXACT same order and visibility', () => {
    // 0) A user who already saved once: persisted order + two hidden
    //    sections (this is the state any later session hydrates from).
    const persisted0: UserPreferences = {
      dashboard: {
        hiddenWidgets: ['quickAccess', 'recentActivity'],
        widgetOrder: [
          'attentionRequired', 'operationalTimeline', 'departmentsOverview', 'performancePulse',
          'recentActivity', 'travelAlerts', 'quickAccess',                    // quickAccess/recentActivity hidden
          'pendingRequests', 'todaysFollowUps', 'attendanceToday', 'qualitySnapshot',
          'requestTypeAnalytics', 'performanceDetail', 'qualityDeductionsDetail', 'travelItineraryDetail',
        ],
      },
    };

    // 1) The user re-enters the editor: enterEditMode seeds the draft
    //    from the HYDRATED layout (visible first) + hidden appended.
    const widgetLayout = resolveWidgetLayout(DASHBOARD_WIDGETS, persisted0, all);
    const draftHidden = effectiveHiddenWidgets(DASHBOARD_WIDGETS, persisted0);
    const hiddenIds = DASHBOARD_WIDGETS.filter((w) => draftHidden.has(w.id)).map((w) => w.id);
    const visibleIds = widgetLayout.map((w) => w.id);
    // …then drags operationalTimeline to the front.
    const reordered = [...visibleIds.filter((id) => id !== 'operationalTimeline')];
    reordered.unshift('operationalTimeline');
    const draftOrder = [...reordered, ...hiddenIds];
    assert.equal(draftOrder.length, DASHBOARD_WIDGETS.length);

    // 2) The client PUTs the draft; the API sanitizes it.
    const sanitized = sanitizeUserPreferencesInput({
      dashboard: { widgetOrder: draftOrder, hiddenWidgets: [...draftHidden] },
    });
    assert.ok(sanitized, 'draft must survive sanitization');

    // 3) The server merges over the previous record and persists.
    const persisted = serverMerge(persisted0, sanitized);
    assert.deepEqual(persisted.dashboard?.widgetOrder, draftOrder);

    // 4) RELOAD: the client GETs the persisted record and hydrates.
    const hydrated = resolveWidgetLayout(DASHBOARD_WIDGETS, persisted, all);

    // 5) The visible layout must be exactly the saved order minus the
    //    saved hidden set — no defaults, no drift, no reordering.
    assert.deepEqual(hydrated.map((w) => w.id), draftOrder.filter((id) => !draftHidden.has(id)));
  });

  it('partial PUT (sidebar only) never wipes the saved dashboard layout', () => {
    const saved: UserPreferences = {
      dashboard: {
        hiddenWidgets: ['recentActivity'],
        widgetOrder: ['travelAlerts', 'attentionRequired', 'quickAccess'],
      },
      sidebar: { order: ['travel', 'home'] },
    };
    const incoming = sanitizeUserPreferencesInput({ sidebar: { order: ['home', 'travel'] } })!;
    const persisted = serverMerge(saved, incoming);
    assert.deepEqual(persisted.dashboard?.widgetOrder, saved.dashboard?.widgetOrder);
    assert.deepEqual(persisted.dashboard?.hiddenWidgets, saved.dashboard?.hiddenWidgets);
    assert.deepEqual(persisted.sidebar?.order, ['home', 'travel']);
  });

  it('reset (empty order + hidden) persists and hydrates back to DEFAULT_LAYOUT', () => {
    const saved: UserPreferences = {
      dashboard: {
        hiddenWidgets: ['recentActivity', 'qualitySnapshot'],
        widgetOrder: ['quickAccess', 'attentionRequired'],
      },
    };
    const resetPayload = sanitizeUserPreferencesInput({
      dashboard: { widgetOrder: [], hiddenWidgets: [] },
    });
    assert.ok(resetPayload, 'reset payload must survive sanitization');
    // Empty arrays ARE present → replace the saved values wholesale.
    const persisted = serverMerge(saved, resetPayload);
    assert.deepEqual(persisted.dashboard?.widgetOrder, []);
    assert.deepEqual(persisted.dashboard?.hiddenWidgets, []);
    // Hydration falls back to the registry default visibility/order.
    const hydrated = resolveWidgetLayout(DASHBOARD_WIDGETS, persisted, all);
    assert.deepEqual(
      hydrated.map((w) => w.id),
      DASHBOARD_WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id),
    );
  });
});

describe('hydration race guards (§12B/§12C)', () => {
  it('hydrating before the record loads yields the DEFAULT layout, never a stored-order interpretation', () => {
    const raceLayout = resolveWidgetLayout(DASHBOARD_WIDGETS, undefined, all);
    assert.deepEqual(
      raceLayout.map((w) => w.id),
      DASHBOARD_WIDGETS.filter((w) => w.defaultVisible).map((w) => w.id),
    );
    // The effective hidden set in that state is the registry default —
    // the UI reads the same helper, so edit drafts are seeded from the
    // SAME source the renderer used (no default/user blending).
    const raceHidden = effectiveHiddenWidgets(DASHBOARD_WIDGETS, undefined);
    assert.equal(raceHidden.size, DASHBOARD_WIDGETS.filter((w) => !w.defaultVisible).length);
  });

  it('a persisted layout ALWAYS wins over defaults once loaded (no async overwrite)', () => {
    const persisted: UserPreferences = {
      dashboard: {
        widgetOrder: ['travelAlerts', 'attentionRequired', 'operationalTimeline', 'departmentsOverview', 'performancePulse', 'recentActivity', 'quickAccess'],
        hiddenWidgets: [],
      },
    };
    const hydrated = resolveWidgetLayout(DASHBOARD_WIDGETS, persisted, all);
    // Saved order (7 ranked) first; explicit hiddenWidgets:[] keeps even
    // default-invisible sections visible — user customization wins.
    assert.deepEqual(hydrated.map((w) => w.id).slice(0, 3), ['travelAlerts', 'attentionRequired', 'operationalTimeline']);
    assert.equal(hydrated.length, DASHBOARD_WIDGETS.length);
  });
});
