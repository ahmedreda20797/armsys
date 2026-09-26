// ══════════════════════════════════════════════════════════════
//  Sidebar layout engine — the Personalizable Navigation Workspace
//
//  A per-user layout is REFERENCES to navigation items (never labels,
//  icons, routes or permissions — those stay in the canonical registry,
//  src/config/permissions.ts). The layout answers the presentation
//  questions only: WHICH GROUPS exist, WHAT belongs where, IN WHAT
//  ORDER, and (§22) each group's open/closed state — persisted per
//  user through the ONE preference system (the user-preferences API;
//  no localStorage mirror). Authorization is NEVER an input here:
//  every function takes the permission-filtered visible page ids and
//  fails closed — an item the user cannot see can neither survive nor
//  be resurrected by this engine (the same doctrine as
//  reconcileSidebarOrder/favorites).
//
//  All functions are PURE (no reads, no writes, no timers) and return
//  NEW layouts — the Sidebar edits a local draft during customization
//  and persists once, only on the user's explicit Done.
//
//  §MIGRATION — the previous model stored `sidebar.order` (flat page
//  order) + `sidebar.groupOrder` (system group order) +
//  `sidebar.itemGroups` (page → system-group overrides). Layouts from
//  that era migrate through migrateLegacySidebarLayout; a user who
//  never moved an item across groups had no personal group structure,
//  so they flatten into ONE main group with their item order preserved.
//  A user who DID reorganize keeps their groups (as named groups —
//  the organization is theirs now), and the main group is created as
//  the system fallback.
//
//  §USER-CONTENT — group names of CUSTOM groups are user content:
//  stored verbatim and never passed through localization. Only the
//  system-generated main group carries a localized UI label.
// ══════════════════════════════════════════════════════════════

import { translate, type Locale } from '@/lib/i18n/dictionary';

export const SIDEBAR_LAYOUT_VERSION = 1;

/** The system-generated fallback group: deletion/rename-proof, the
 *  destination for new navigation items and deleted-group survivors. */
export const MAIN_GROUP_ID = 'main';

/** Hard caps — protect the preferences record from unbounded growth. */
export const MAX_SIDEBAR_GROUPS = 24;
export const MAX_SIDEBAR_ITEMS = 200;
export const MAX_GROUP_NAME_LENGTH = 60;
const MAX_GROUP_ID_LENGTH = 64;

export interface SidebarItemReference {
  id: string;
}

export interface SidebarLayoutGroup {
  id: string;
  name: string;
  items: SidebarItemReference[];
  /** §22 GROUP STATE — the user's open/closed choice for this group,
   *  persisted per user INSIDE the layout (one preference system, no
   *  localStorage mirror). Absent/false = open; `true` = collapsed.
   *  Survives sidebar collapse/expand, reloads and logout/login by
   *  construction (it IS the stored layout). */
  collapsed?: boolean;
}

export interface SidebarLayout {
  version: number;
  groups: SidebarLayoutGroup[];
}

/** Why a proposed group name was rejected (null = acceptable). */
export type GroupNameProblem = 'empty' | 'too_long' | 'duplicate';

/** Trimmed-name check shared by create + rename (UI shows the message;
 *  the engine re-checks defensively before mutating). */
export function validateGroupName(
  rawName: string,
  layout: SidebarLayout | null | undefined,
  excludeGroupId?: string,
): GroupNameProblem | null {
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (name.length === 0) return 'empty';
  if (name.length > MAX_GROUP_NAME_LENGTH) return 'too_long';
  const lower = name.toLowerCase();
  const duplicate = (layout?.groups ?? []).some(
    (g) => g.id !== excludeGroupId && g.name.trim().toLowerCase() === lower,
  );
  return duplicate ? 'duplicate' : null;
}

// ─── Constructors ──────────────────────────────────────────────

/** The system default: ONE main group holding every visible page in
 *  canonical registry order. Built from the registry — never hardcoded. */
export function createDefaultLayout(visiblePageIds: readonly string[]): SidebarLayout {
  return {
    version: SIDEBAR_LAYOUT_VERSION,
    groups: [
      {
        id: MAIN_GROUP_ID,
        name: '',
        items: [...visiblePageIds].slice(0, MAX_SIDEBAR_ITEMS).map((id) => ({ id })),
      },
    ],
  };
}

function cloneLayout(layout: SidebarLayout): SidebarLayout {
  return {
    version: layout.version,
    groups: layout.groups.map((g) => ({
      id: g.id,
      name: g.name,
      items: g.items.map((it) => ({ id: it.id })),
      ...(g.collapsed === undefined ? {} : { collapsed: g.collapsed }),
    })),
  };
}

function findGroup(layout: SidebarLayout, groupId: string): SidebarLayoutGroup | undefined {
  return layout.groups.find((g) => g.id === groupId);
}

/** Index of an item inside a group's items (−1 when absent). */
function itemIndex(group: SidebarLayoutGroup, itemId: string): number {
  return group.items.findIndex((it) => it.id === itemId);
}

// ─── Reconciliation (read path — authorization always wins) ────

/**
 * The ONE reconciliation rule (§30 state architecture): the layout
 * layer may only REORDER and GROUP the currently-visible pages.
 *   • stale/unknown/unauthorized item refs are ignored (never rendered);
 *   • duplicate refs collapse to their first occurrence;
 *   • items that became available after the layout was saved are
 *     appended to MAIN in the given (registry) order;
 *   • a missing MAIN group is created as the fallback.
 * Pure — the caller decides whether to persist the result.
 */
export function reconcileSidebarLayout(
  layout: SidebarLayout,
  visiblePageIds: readonly string[],
): SidebarLayout {
  const visible = new Set(visiblePageIds);
  const placed = new Set<string>();

  const groups: SidebarLayoutGroup[] = [];
  for (const group of layout.groups) {
    if (typeof group.id !== 'string' || group.id.length === 0) continue;
    const items: SidebarItemReference[] = [];
    for (const ref of group.items) {
      if (!ref || typeof ref.id !== 'string') continue;
      if (!visible.has(ref.id) || placed.has(ref.id)) continue;
      placed.add(ref.id);
      items.push({ id: ref.id });
    }
    groups.push({
      id: group.id,
      name: group.name,
      items,
      ...(group.collapsed === undefined ? {} : { collapsed: group.collapsed }),
    });
  }

  if (!groups.some((g) => g.id === MAIN_GROUP_ID)) {
    groups.push({ id: MAIN_GROUP_ID, name: '', items: [] });
  }

  // New pages land in MAIN in registry order.
  const main = findGroup({ version: layout.version, groups }, MAIN_GROUP_ID)!;
  for (const id of visiblePageIds) {
    if (!placed.has(id)) {
      placed.add(id);
      main.items.push({ id });
    }
  }

  return { version: SIDEBAR_LAYOUT_VERSION, groups };
}

/**
 * Structural validation + repair of an UNTRUSTED layout (storage read,
 * §34). Returns null when the payload is not a usable v1 layout at all
 * (unsupported/absent version — the caller falls back to migration or
 * the default). When a payload IS usable, malformed pieces are dropped
 * and the result is fully reconciled; `repaired` reports whether
 * structural damage was cleaned up (so the caller may persist the fix).
 */
export function normalizeSidebarLayout(
  raw: unknown,
  visiblePageIds: readonly string[],
): { layout: SidebarLayout; repaired: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as { version?: unknown; groups?: unknown };
  if (candidate.version !== SIDEBAR_LAYOUT_VERSION) return null;
  if (!Array.isArray(candidate.groups)) return null;

  let repaired = false;
  const groups: SidebarLayoutGroup[] = [];
  const seenGroups = new Set<string>();
  let itemCount = 0;

  for (const rawGroup of candidate.groups.slice(0, MAX_SIDEBAR_GROUPS)) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) {
      repaired = true;
      continue;
    }
    const g = rawGroup as { id?: unknown; name?: unknown; items?: unknown; collapsed?: unknown };
    if (typeof g.id !== 'string' || g.id.length === 0 || g.id.length > MAX_GROUP_ID_LENGTH) {
      repaired = true;
      continue;
    }
    if (seenGroups.has(g.id)) {
      repaired = true; // duplicate group id — first occurrence wins
      continue;
    }
    if (!Array.isArray(g.items)) {
      repaired = true;
      continue;
    }
    const name = typeof g.name === 'string' ? g.name.slice(0, MAX_GROUP_NAME_LENGTH) : '';
    if (name !== g.name) repaired = true;
    const collapsed = typeof g.collapsed === 'boolean' ? g.collapsed : undefined;
    if (collapsed !== g.collapsed && g.collapsed !== undefined) repaired = true;

    const items: SidebarItemReference[] = [];
    for (const rawItem of g.items.slice(0, MAX_SIDEBAR_ITEMS - itemCount)) {
      const id = rawItem && typeof rawItem === 'object' ? (rawItem as { id?: unknown }).id : undefined;
      if (typeof id !== 'string' || id.length === 0 || id.length > MAX_GROUP_ID_LENGTH) {
        repaired = true;
        continue;
      }
      items.push({ id });
    }
    itemCount += items.length;
    seenGroups.add(g.id);
    groups.push({
      id: g.id,
      name,
      items,
      ...(collapsed === undefined ? {} : { collapsed }),
    });
  }
  if (groups.length !== candidate.groups.length) repaired = true;
  if (groups.length === 0) repaired = true;
  const mainWasMissing = !groups.some((g) => g.id === MAIN_GROUP_ID);

  const layout = reconcileSidebarLayout(
    { version: SIDEBAR_LAYOUT_VERSION, groups },
    visiblePageIds,
  );
  // "Repaired" = STRUCTURAL damage was cleaned up (malformed groups,
  // duplicate group ids, a missing main group). Stale/unauthorized
  // refs, duplicate item refs and newly-available pages are the NORMAL
  // read contract (§14) — reconciliation handles them on every load
  // without counting as damage.
  return { layout, repaired: repaired || mainWasMissing };
}

// ─── Migration (legacy §21 model → layout model) ───────────────

export interface LegacySidebarPrefs {
  order?: string[];
  groupOrder?: string[];
  itemGroups?: Record<string, string>;
}

/** One canonical registry group, for migration input. */
export interface CanonicalSidebarGroup {
  id: string;
  name: string;
}

/**
 * Detect + migrate the previous sidebar model. Returns null when the
 * user has no legacy layout at all (fresh default applies instead).
 *
 *   • No legacy fields → null (nothing was ever customized).
 *   • Cross-group overrides exist → the user's group organization IS
 *     personal: preserve the legacy groups (in their saved order, then
 *     registry order), each as a named group, and create MAIN as the
 *     fallback. Item order and memberships are preserved; stale
 *     references and unauthorized items drop via reconciliation.
 *   • Only a flat item order exists → flatten into ONE main group
 *     (the system grouping was never the user's own organization).
 *
 * `pageGroups` is the registry's pageId → canonical groupId map (the
 * default membership of a page when no override exists).
 */
export function migrateLegacySidebarLayout(
  legacy: LegacySidebarPrefs | null | undefined,
  visiblePageIds: readonly string[],
  canonicalGroups: readonly CanonicalSidebarGroup[],
  pageGroups: ReadonlyMap<string, string>,
): SidebarLayout | null {
  if (!legacy) return null;
  const order = Array.isArray(legacy.order) ? legacy.order.filter((v): v is string => typeof v === 'string') : [];
  const groupOrder = Array.isArray(legacy.groupOrder)
    ? legacy.groupOrder.filter((v): v is string => typeof v === 'string')
    : [];
  const itemGroups = legacy.itemGroups && typeof legacy.itemGroups === 'object'
    ? Object.fromEntries(
        Object.entries(legacy.itemGroups).filter(
          (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      )
    : {};

  const hasCustomGroups = Object.keys(itemGroups).length > 0;
  if (!hasCustomGroups) {
    if (order.length === 0) return null;
    // Order-only personalization → one main group, order preserved by
    // reconciliation's rank (order first, registry order after).
    const layout = createDefaultLayout(visiblePageIds);
    const rank = new Map<string, number>();
    order.forEach((id, idx) => { if (!rank.has(id)) rank.set(id, idx); });
    layout.groups[0]!.items.sort((a, b) => {
      const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      return ra - rb;
    });
    return layout;
  }

  // Page order rank: saved order first, then registry order (same rule
  // as the legacy reconcileSidebarOrder — byte-compatible ordering).
  const rank = new Map<string, number>();
  order.forEach((id, idx) => { if (!rank.has(id)) rank.set(id, idx); });
  const orderedVisible = [...visiblePageIds].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  // Which legacy group each visible page belonged to: the override when
  // it targets a known group, else the page's canonical registry group,
  // else MAIN.
  const canonicalIds = new Set(canonicalGroups.map((g) => g.id));
  const groupOf = (pageId: string) => {
    const override = itemGroups[pageId];
    if (override && canonicalIds.has(override)) return override;
    return pageGroups.get(pageId) ?? MAIN_GROUP_ID;
  };

  // Group order: saved groupOrder first, then remaining canonical groups
  // in registry order — only groups that actually hold ≥1 visible page
  // (an empty legacy group carried no user organization).
  const orderedGroupIds: string[] = [];
  for (const id of groupOrder) {
    if (canonicalIds.has(id) && !orderedGroupIds.includes(id)) orderedGroupIds.push(id);
  }
  for (const g of canonicalGroups) {
    if (!orderedGroupIds.includes(g.id)) orderedGroupIds.push(g.id);
  }
  const nameOf = new Map(canonicalGroups.map((g) => [g.id, g.name] as const));
  const nonEmpty = orderedGroupIds.filter((id) => orderedVisible.some((p) => groupOf(p) === id));

  const groups: SidebarLayoutGroup[] = nonEmpty.map((id) => ({
    id,
    name: nameOf.get(id) ?? id,
    items: orderedVisible.filter((p) => groupOf(p) === id).map((pid) => ({ id: pid })),
  }));
  // MAIN exists as the system fallback (last; empty groups do not render).
  groups.push({ id: MAIN_GROUP_ID, name: '', items: [] });
  // §22 — freeze the legacy presentation default as persisted group
  // state: FIRST group open, the rest collapsed (the §21 sidebar opened
  // exactly this way; nothing is lost, the user can re-open freely).
  for (let i = 1; i < groups.length; i += 1) groups[i]!.collapsed = true;
  return reconcileSidebarLayout({ version: SIDEBAR_LAYOUT_VERSION, groups }, visiblePageIds);
}

// ─── Edit operations (draft mutations, all pure) ───────────────

/**
 * Move an item to `targetGroupId` at `insertIndex` — the slot in the
 * TARGET list as rendered DURING the drag (i.e. counted before the
 * dragged item leaves its original spot). Same-group reorder and
 * cross-group moves share this one rule. Returns the layout unchanged
 * for unknown ids/groups.
 */
export function moveSidebarItem(
  layout: SidebarLayout,
  itemId: string,
  targetGroupId: string,
  insertIndex: number,
): SidebarLayout {
  const next = cloneLayout(layout);
  const target = findGroup(next, targetGroupId);
  if (!target) return layout;
  const source = next.groups.find((g) => g.items.some((it) => it.id === itemId));
  if (!source) return layout;

  if (source.id === target.id) {
    const from = itemIndex(source, itemId);
    const adjusted = insertIndex > from ? insertIndex - 1 : insertIndex;
    const [moved] = source.items.splice(from, 1);
    source.items.splice(Math.max(0, Math.min(adjusted, source.items.length)), 0, moved);
    return next;
  }
  const [moved] = source.items.splice(itemIndex(source, itemId), 1);
  target.items.splice(Math.max(0, Math.min(insertIndex, target.items.length)), 0, moved);
  return next;
}

/** Reorder top-level groups (§6.F). MAIN may move like any group. */
export function moveSidebarGroup(
  layout: SidebarLayout,
  groupId: string,
  insertIndex: number,
): SidebarLayout {
  const from = layout.groups.findIndex((g) => g.id === groupId);
  if (from < 0) return layout;
  const adjusted = insertIndex > from ? insertIndex - 1 : insertIndex;
  const next = cloneLayout(layout);
  const [moved] = next.groups.splice(from, 1);
  next.groups.splice(Math.max(0, Math.min(adjusted, next.groups.length)), 0, moved);
  return next;
}

/**
 * §22 GROUP STATE — set one group's open/closed flag. The ONE group
 * state mutation (both sidebar surfaces call it through the hook; the
 * flag persists with the layout). `collapsed === false` DELETES the
 * key so the stored record stays compact. Unknown group → unchanged.
 */
export function setGroupCollapsed(
  layout: SidebarLayout,
  groupId: string,
  collapsed: boolean,
): SidebarLayout {
  const group = findGroup(layout, groupId);
  if (!group || group.collapsed === collapsed) return layout;
  const next = cloneLayout(layout);
  const target = findGroup(next, groupId)!;
  if (collapsed) target.collapsed = true;
  else delete target.collapsed;
  return next;
}

/** Append a new custom group (end of the list). Name is user content. */
export function addSidebarGroup(
  layout: SidebarLayout,
  rawName: string,
  makeId: () => string,
): SidebarLayout | null {
  if (validateGroupName(rawName, layout) !== null) return null;
  if (layout.groups.length >= MAX_SIDEBAR_GROUPS) return null;
  const next = cloneLayout(layout);
  next.groups.push({ id: makeId(), name: rawName.trim(), items: [] });
  return next;
}

/** Rename a custom group — the stable id NEVER changes (§9).
 *  The system main group is not renamable. */
export function renameSidebarGroup(
  layout: SidebarLayout,
  groupId: string,
  rawName: string,
): SidebarLayout | null {
  if (groupId === MAIN_GROUP_ID) return null;
  if (validateGroupName(rawName, layout, groupId) !== null) return null;
  const next = cloneLayout(layout);
  const group = findGroup(next, groupId);
  if (!group) return null;
  group.name = rawName.trim();
  return next;
}

/**
 * Delete a custom group WITHOUT losing its navigation items (§6.I):
 * every item moves to MAIN, relative order preserved, appended at the
 * end of MAIN's current items. The main group itself is not deletable.
 */
export function deleteSidebarGroup(layout: SidebarLayout, groupId: string): SidebarLayout {
  if (groupId === MAIN_GROUP_ID) return layout;
  const index = layout.groups.findIndex((g) => g.id === groupId);
  if (index < 0) return layout;
  const next = cloneLayout(layout);
  const [removed] = next.groups.splice(index, 1);
  let main = next.groups.find((g) => g.id === MAIN_GROUP_ID);
  if (!main) {
    main = { id: MAIN_GROUP_ID, name: '', items: [] };
    next.groups.push(main);
  }
  main.items.push(...removed.items);
  return next;
}

// ─── Persistence boundary (server-safe structural whitelist) ───

/**
 * Structural whitelist for an UNTRUSTED layout payload at the
 * preferences write boundary — registry-agnostic (the server does not
 * know the navigation registry; authorization reconciliation happens
 * on every READ through normalizeSidebarLayout). Malformed groups and
 * item refs are dropped, group ids de-duplicated, sizes capped. Null
 * when the payload is not a v1 layout at all.
 */
export function sanitizeSidebarLayoutPayload(raw: unknown): SidebarLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const candidate = raw as { version?: unknown; groups?: unknown };
  if (candidate.version !== SIDEBAR_LAYOUT_VERSION || !Array.isArray(candidate.groups)) return null;

  const groups: SidebarLayoutGroup[] = [];
  const seenGroups = new Set<string>();
  let itemCount = 0;
  for (const rawGroup of candidate.groups.slice(0, MAX_SIDEBAR_GROUPS)) {
    if (!rawGroup || typeof rawGroup !== 'object' || Array.isArray(rawGroup)) continue;
    const g = rawGroup as { id?: unknown; name?: unknown; items?: unknown; collapsed?: unknown };
    if (typeof g.id !== 'string' || g.id.length === 0 || g.id.length > MAX_GROUP_ID_LENGTH) continue;
    if (seenGroups.has(g.id)) continue;
    if (!Array.isArray(g.items)) continue;
    const items: SidebarItemReference[] = [];
    for (const rawItem of g.items.slice(0, MAX_SIDEBAR_ITEMS - itemCount)) {
      const id = rawItem && typeof rawItem === 'object' ? (rawItem as { id?: unknown }).id : undefined;
      if (typeof id !== 'string' || id.length === 0 || id.length > MAX_GROUP_ID_LENGTH) continue;
      items.push({ id });
    }
    itemCount += items.length;
    seenGroups.add(g.id);
    groups.push({
      id: g.id,
      name: typeof g.name === 'string' ? g.name.slice(0, MAX_GROUP_NAME_LENGTH) : '',
      items,
      ...(typeof g.collapsed === 'boolean' ? { collapsed: g.collapsed } : {}),
    });
  }
  if (groups.length === 0) return null;
  return { version: SIDEBAR_LAYOUT_VERSION, groups };
}

// ─── Display ───────────────────────────────────────────────────

/**
 * The display label of a group. The system main group uses the
 * localized UI label; a CUSTOM group's name is USER CONTENT and is
 * returned verbatim — never localized, never translated (§32).
 */
export function sidebarGroupLabel(group: Pick<SidebarLayoutGroup, 'id' | 'name'>, locale: Locale): string {
  if (group.id === MAIN_GROUP_ID) return translate('sidebar.mainGroup', locale);
  return group.name || group.id;
}

// ─── Drag geometry (pure — unit-testable) ──────────────────────

/**
 * The insertion slot for a pointer at `y`: the index of the first item
 * whose vertical center the pointer has passed (top-half semantics),
 * or the list length when past every item. Empty list → 0.
 */
export function insertionIndexForPointerY(y: number, itemCenterYs: readonly number[]): number {
  for (let i = 0; i < itemCenterYs.length; i += 1) {
    if (y < itemCenterYs[i]!) return i;
  }
  return itemCenterYs.length;
}
