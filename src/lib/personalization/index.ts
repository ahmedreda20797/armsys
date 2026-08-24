// ══════════════════════════════════════════════════════════════
//  Personal workspace — Milestone 10 (PURE reconciliation)
//
//  Each USER (not role) owns an independent UI configuration:
//  sidebar order and dashboard widget layout. These pure functions
//  merge SAVED preferences with the CURRENT permission-filtered
//  component set. The order is mandatory:
//
//    1. PERMISSION decides which pages/widgets EXIST for the user
//    2. PERSONALIZATION only reorders / hides within that set
//
//  Consequences (tested):
//    • A saved order can never resurrect a revoked page/widget.
//    • Pages added after the order was saved append gracefully.
//    • Pages removed from the order's permission set are dropped.
//    • One user's layout never affects another's (per-user record,
//      keyed by authenticated userId server-side).
// ══════════════════════════════════════════════════════════════

import type { WidgetConfig } from '@/config/dashboard-widgets';

/** RTDB table: arm_erp/userPreferences/{userId} — ONE record per user. */
export const USER_PREFERENCES_TABLE = 'userPreferences';

export interface SidebarPreferences {
  /** Page ids in the user's preferred order (permission-filtered at read). */
  order?: string[];
}

export interface DashboardPreferences {
  /** Widget ids the user chose to hide. */
  hiddenWidgets?: string[];
  /** Widget ids in the user's preferred order. */
  widgetOrder?: string[];
}

export interface UserPreferences {
  userId?: string;
  sidebar?: SidebarPreferences;
  dashboard?: DashboardPreferences;
  updatedAt?: string;
}

export const EMPTY_USER_PREFERENCES: UserPreferences = {};

/**
 * Merge a saved sidebar order with the permission-filtered page id
 * list. Saved ids that are no longer permitted are ignored (they
 * stay stored but have no effect until permission returns); pages
 * missing from the saved order keep registry order at the end.
 */
export function reconcileSidebarOrder(
  visiblePageIds: string[],
  savedOrder?: string[] | null,
): string[] {
  if (!savedOrder || savedOrder.length === 0) return [...visiblePageIds];
  const rank = new Map<string, number>();
  savedOrder.forEach((id, idx) => {
    if (!rank.has(id)) rank.set(id, idx); // first occurrence wins
  });
  return [...visiblePageIds].sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b) ? rank.get(b)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return 0; // stable — keeps registry order among unranked pages
  });
}

/**
 * Resolve the effective dashboard widget layout:
 *   permitted widgets → apply default visibility → apply the user's
 *   hidden set → sort by the user's order (unknown ids append in
 *   registry order).
 *
 * `isWidgetPermitted` is the PERMISSION gate (step 1) supplied by
 * the caller from usePermissions — personalization cannot override
 * it in either direction: unauthorized widgets never render, and a
 * widget the user hid stays hidden.
 */
export function resolveWidgetLayout(
  widgets: WidgetConfig[],
  preferences: UserPreferences | null | undefined,
  isWidgetPermitted: (widget: WidgetConfig) => boolean,
): WidgetConfig[] {
  const hidden = new Set(preferences?.dashboard?.hiddenWidgets ?? []);
  const order = preferences?.dashboard?.widgetOrder;

  const available = widgets.filter((w) => isWidgetPermitted(w));
  const visible = available.filter((w) => !hidden.has(w.id));

  if (!order || order.length === 0) {
    return [...visible].sort((a, b) => a.order - b.order);
  }
  const rank = new Map<string, number>();
  order.forEach((id, idx) => {
    if (!rank.has(id)) rank.set(id, idx);
  });
  return [...visible].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.order - b.order;
  });
}

// ─── API input sanitization ────────────────────────────────────
// The preferences API accepts ONLY this shape; unknown fields are
// dropped and arrays are size/string capped so a malicious payload
// cannot bloat storage or inject arbitrary keys.

const MAX_ORDER_ENTRIES = 200;
const MAX_ID_LENGTH = 100;

function sanitizeIdArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH)
    .slice(0, MAX_ORDER_ENTRIES);
}

/**
 * Whitelist + validate a preferences PUT body. Returns null when
 * the body is not a usable object (caller replies 400).
 */
export function sanitizeUserPreferencesInput(body: unknown): UserPreferences | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const raw = body as Record<string, unknown>;
  const out: UserPreferences = {};

  if (raw.sidebar && typeof raw.sidebar === 'object' && !Array.isArray(raw.sidebar)) {
    const order = sanitizeIdArray((raw.sidebar as Record<string, unknown>).order);
    if (order) out.sidebar = { order };
  }
  if (raw.dashboard && typeof raw.dashboard === 'object' && !Array.isArray(raw.dashboard)) {
    const dash = raw.dashboard as Record<string, unknown>;
    const hiddenWidgets = sanitizeIdArray(dash.hiddenWidgets);
    const widgetOrder = sanitizeIdArray(dash.widgetOrder);
    if (hiddenWidgets || widgetOrder) {
      out.dashboard = {
        ...(hiddenWidgets ? { hiddenWidgets } : {}),
        ...(widgetOrder ? { widgetOrder } : {}),
      };
    }
  }
  return out;
}
