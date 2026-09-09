// ══════════════════════════════════════════════════════════════
//  Personal workspace — Milestone 10 (PURE reconciliation) +
//  Milestone 7 (Favorites · Pins — one coherent architecture)
//
//  Each USER (not role) owns an independent UI configuration:
//  sidebar order, dashboard widget layout, FAVORITES and PINS.
//  These pure functions merge SAVED preferences with the CURRENT
//  permission-filtered component set. The order is mandatory:
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
//
//  MILESTONE 7 SEMANTIC SEPARATION (binding):
//    • SIDEBAR ORDER — navigation presentation order.
//    • FAVORITE (⭐) — "this is important to me" (bookmark).
//    • PIN (📌) — persistent quick access to a page/record.
//  They share ONE storage record, ONE user identity, ONE permission
//  reconciliation, ONE navigation-descriptor shape — but keep their
//  own arrays and their own UI semantics. Never collapsed.
// ══════════════════════════════════════════════════════════════

import type { WidgetConfig } from '@/config/dashboard-widgets';

/** RTDB table: arm_erp/userPreferences/{userId} — ONE record per user. */
export const USER_PREFERENCES_TABLE = 'userPreferences';

export interface SidebarPreferences {
  /** Page ids in the user's preferred order (permission-filtered at read). */
  order?: string[];
  /**
   * UX Corrections §3 — the user's PINNED sidebar state: true = keep
   * expanded, false = keep collapsed (hover still expands temporarily).
   * Absent = system default (collapsed + hover expand).
   */
  pinOpen?: boolean;
}

export interface DashboardPreferences {
  /** Widget ids the user chose to hide. */
  hiddenWidgets?: string[];
  /** Widget ids in the user's preferred order. */
  widgetOrder?: string[];
}

/**
 * §10 GLOBAL ALERT CONTRACT — per-user UI flags (boolean only).
 * The unified AttentionPanel stores its collapsed/expanded state
 * under `ui.<persistKey>` so a panel the user opened/collapsed stays
 * that way across navigation and reloads. STRICTLY boolean values —
 * anything else is dropped by the sanitizer (fail-safe to default).
 */
export interface UiPreferences {
  [flagKey: string]: boolean;
}

/** Hard cap — protects the preferences record from unbounded growth. */
export const UI_PREFS_MAX_KEYS = 64;

/**
 * Compact navigation descriptor for a favorite/pin target — the
 * OUTPUT of the existing navigation builders captured at save time,
 * so navigation NEVER needs a second router: consume with
 * navigateTo(route, targetId ?? undefined, navParams) and the
 * existing useRecordHighlight does locate/scroll/highlight.
 * Minimal by design — never a duplicated record.
 */
export interface NavigationDescriptor {
  /** Target kind: a page or a specific record/card. */
  targetType: 'page' | 'record';
  /** Record id when targetType='record'. */
  targetId?: string;
  /** The PageRouter page key (route). */
  route: string;
  /** Compact deep-link context (e.g. employeeId/month/id params). */
  navigationContext?: Record<string, string>;
  /** Human label captured at save time (permission-safe display). */
  label: string;
}

export interface FavoriteEntry extends NavigationDescriptor {
  /** Stable entry id (cuid2 at save time). */
  id: string;
  addedAt: string;
}

export interface PinEntry extends NavigationDescriptor {
  id: string;
  addedAt: string;
}

export interface UserPreferences {
  userId?: string;
  sidebar?: SidebarPreferences;
  dashboard?: DashboardPreferences;
  favorites?: FavoriteEntry[];
  pins?: PinEntry[];
  /** §10 — per-user UI flags (AttentionPanel collapsed state, …). */
  ui?: UiPreferences;
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

// ─── Favorites / Pins reconciliation (Milestone 7) ─────────────
// Permission-safe at READ: an entry whose route the user can no
// longer see is HIDDEN but kept stored (permission may return) —
// the same doctrine as reconcileSidebarOrder. De-dup by descriptor.
// Deletion policy: entries are only ever removed by the OWNER's
// explicit action or the reset endpoint — never silently mass-deleted.

const MAX_ENTRIES = 60;
const MAX_LABEL_LENGTH = 120;
const MAX_NAV_PARAM_LENGTH = 100;
const MAX_NAV_PARAMS = 6;

/**
 * Filter favorites/pins down to the CURRENTLY permitted set, stable
 * by addedAt (newest first). Pure — the single reconciliation both
 * the sidebar and the header menus consume.
 */
export function reconcileNavigationEntries<T extends NavigationDescriptor>(
  entries: ReadonlyArray<T> | null | undefined,
  isRouteVisible: (route: string) => boolean,
): T[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => {
    if (!entry || typeof entry.route !== 'string') return false;
    if (entry.targetType !== 'page' && entry.targetType !== 'record') return false;
    if (entry.targetType === 'record' && (typeof entry.targetId !== 'string' || !entry.targetId)) return false;
    return isRouteVisible(entry.route);
  });
}

/** Pure toggle: add (front, de-duped) or remove by descriptor match. */
export function toggleNavigationEntry<T extends NavigationDescriptor>(
  entries: ReadonlyArray<T> | null | undefined,
  descriptor: Omit<T, 'id' | 'addedAt'>,
  makeId: () => string,
  now: string,
  matches: (a: NavigationDescriptor, b: NavigationDescriptor) => boolean,
): T[] {
  const list = Array.isArray(entries) ? [...entries] : [];
  const existingIdx = list.findIndex((e) => matches(e, descriptor));
  if (existingIdx >= 0) {
    list.splice(existingIdx, 1);
    return list;
  }
  const entry = { ...descriptor, id: makeId(), addedAt: now } as unknown as T;
  return [entry, ...list].slice(0, MAX_ENTRIES);
}

/** Descriptor equality: same route + target type + target id. */
export function navigationEntriesEqual(a: NavigationDescriptor, b: NavigationDescriptor): boolean {
  return (
    a.route === b.route &&
    a.targetType === b.targetType &&
    (a.targetId ?? '') === (b.targetId ?? '')
  );
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

/** Sanitize one navigation entry (favorites/pins share the shape). */
function sanitizeNavigationEntry(value: unknown): (NavigationDescriptor & { id: string; addedAt: string }) | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > MAX_ID_LENGTH) return null;
  if (typeof raw.route !== 'string' || raw.route.length === 0 || raw.route.length > MAX_ID_LENGTH) return null;
  if (raw.targetType !== 'page' && raw.targetType !== 'record') return null;
  if (raw.targetType === 'record' && (typeof raw.targetId !== 'string' || !raw.targetId || raw.targetId.length > MAX_ID_LENGTH)) return null;
  if (typeof raw.label !== 'string' || raw.label.length === 0 || raw.label.length > MAX_LABEL_LENGTH) return null;
  if (typeof raw.addedAt !== 'string' || raw.addedAt.length === 0 || raw.addedAt.length > 40) return null;

  let navigationContext: Record<string, string> | undefined;
  if (raw.navigationContext && typeof raw.navigationContext === 'object' && !Array.isArray(raw.navigationContext)) {
    const ctx: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw.navigationContext as Record<string, unknown>)) {
      if (Object.keys(ctx).length >= MAX_NAV_PARAMS) break;
      if (typeof k === 'string' && k.length <= 40 && typeof v === 'string' && v.length <= MAX_NAV_PARAM_LENGTH) {
        ctx[k] = v;
      }
    }
    if (Object.keys(ctx).length > 0) navigationContext = ctx;
  }

  return {
    id: raw.id,
    addedAt: raw.addedAt,
    targetType: raw.targetType,
    ...(raw.targetType === 'record' ? { targetId: raw.targetId as string } : {}),
    route: raw.route,
    ...(navigationContext ? { navigationContext } : {}),
    label: raw.label,
  };
}

function sanitizeNavigationArray(value: unknown): (NavigationDescriptor & { id: string; addedAt: string })[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: (NavigationDescriptor & { id: string; addedAt: string })[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, MAX_ENTRIES)) {
    const entry = sanitizeNavigationEntry(raw);
    if (!entry) continue;
    const key = `${entry.route}:${entry.targetType}:${entry.targetId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
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
    const sidebarRaw = raw.sidebar as Record<string, unknown>;
    const order = sanitizeIdArray(sidebarRaw.order);
    // §3: boolean-only; anything else is dropped (fail-safe to default).
    const pinOpen = typeof sidebarRaw.pinOpen === 'boolean' ? sidebarRaw.pinOpen : undefined;
    if (order || pinOpen !== undefined) {
      out.sidebar = {
        ...(order ? { order } : {}),
        ...(pinOpen !== undefined ? { pinOpen } : {}),
      };
    }
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
  // Milestone 7 — favorites/pins arrays replace wholesale when present.
  const favorites = sanitizeNavigationArray(raw.favorites);
  if (favorites) out.favorites = favorites as FavoriteEntry[];
  const pins = sanitizeNavigationArray(raw.pins);
  if (pins) out.pins = pins as PinEntry[];
  // §10 GLOBAL ALERT CONTRACT — the `ui` flags namespace: boolean-only,
  // key-capped. Previously this namespace was silently stripped, which
  // made every AttentionPanel's collapse state evaporate on refetch
  // (panels looked "permanently expanded").
  if (raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui)) {
    const uiRaw = raw.ui as Record<string, unknown>;
    const uiOut: UiPreferences = {};
    let accepted = 0;
    for (const [k, v] of Object.entries(uiRaw)) {
      if (accepted >= UI_PREFS_MAX_KEYS) break;
      if (typeof k !== 'string' || k.length === 0 || k.length > 64) continue;
      if (typeof v === 'boolean') {
        uiOut[k] = v;
        accepted += 1;
      }
    }
    if (accepted > 0) out.ui = uiOut;
  }
  return out;
}
