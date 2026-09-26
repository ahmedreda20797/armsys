'use client';

// ══════════════════════════════════════════════════════════════
//  Sidebar — Personalizable Navigation Workspace (§SIDEBAR-V2 + §SIDEBAR-WORKSPACE)
//
//  TWO INDEPENDENT AXES (store §SIDEBAR-V2):
//    PINNED ⇄ UNPINNED  — layout: pinned = sticky in-flow column the
//      content always respects; unpinned = NO layout width, opens as
//      an overlay drawer above the page (z above the header — the old
//      "sidebar hides behind the header" bug is a layering contract,
//      not a z-index hack: header z-30, overlay sidebar z-40/50).
//    EXPANDED ⇄ COLLAPSED — pinned width: full surface (288) vs icon
//      rail (72). Hover on the rail temporarily expands it as an
//      overlay (z-40) WITHOUT touching content width.
//
//  §SIDEBAR-WORKSPACE — the navigation structure comes from the
//  USER'S LAYOUT (useSidebarLayout): groups of REFERENCES into the
//  canonical, permission-filtered navigation registry. The registry
//  stays the single source of truth for labels/icons/routes/
//  permissions; the layout only answers "which group, which order".
//  A user without a layout gets ONE main group in registry order;
//  legacy §21 preferences (order/groupOrder/itemGroups) migrate
//  once, inside the hook.
//
//  §2 CUSTOMIZATION happens in a dedicated EDIT MODE
//  (SidebarEditNav): draft-based pointer drag & drop, group
//  create/rename/delete/reset, persisted only on Done. Normal mode
//  never drags — no handles, no drop targets.
//
//  §SIDEBAR-STATE group open/closed state persists through surface
//      swaps AND reloads (localStorage mirror) — collapsing the
//      sidebar never destroys which groups the user opened.
//
//  §4/§5 Favorites ⭐ / Pins 📌 live INSIDE the sidebar.
//  §SIDEBAR-BADGES unseen/activity badges are per-user, permission-
//      filtered server-side, and NEVER render as group counters.
// ══════════════════════════════════════════════════════════════

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  RotateCcw,
  Star,
  Pin as PinIcon,
  Folder,
  SlidersHorizontal,
} from 'lucide-react';
import { useUnseenCounts, unseenCountOf, pendingCountOf } from '@/hooks/use-unseen';
import { SidebarActivityBadge } from '@/components/shared/SidebarActivityBadge';
import { useIsMobile, useIsDesktop } from '@/hooks/use-mobile';
import { APP_PAGES, localizedPageLabel } from '@/config/permissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { useAppStore, resolveInitialSidebarState } from '@/lib/store';
import { SidebarLogo } from '@/components/layout/SidebarLogo';
import { SidebarGroupFrame } from '@/components/layout/SidebarGroupFrame';
import { SIDEBAR_ICON_MAP } from '@/components/layout/sidebar-icons';
import { SidebarEditNav } from '@/components/layout/SidebarEditNav';
import {
  useUserPreferences,
} from '@/hooks/use-user-preferences';
import { useSidebarLayout } from '@/hooks/use-sidebar-layout';
import {
  reconcileNavigationEntries,
  type FavoriteEntry,
  type NavigationDescriptor,
  type PinEntry,
} from '@/lib/personalization';
import {
  createDefaultLayout,
  sidebarGroupLabel,
  type SidebarLayout,
} from '@/lib/personalization/sidebar-layout';
import {
  useFavoriteToggleAction,
  usePinToggleAction,
  useMarkState,
} from '@/components/shared/NavigationMarks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/** Page id → config (current-page ⭐/📌 descriptors in the ⋮ menu). */
const APP_PAGES_BY_ID = new Map(APP_PAGES.map((p) => [p.id, p]));

const WIDTH_COLLAPSED = 72;
const WIDTH_EXPANDED = 288;

/** §27 SHOW-ALL — per-group preview cap in BOTH surfaces. A group
 *  longer than CAP + 1 renders its first CAP items plus a "Show all"
 *  control; the active page ALWAYS forces a full reveal (the current
 *  location is never hidden behind overflow). */
const GROUP_PREVIEW_ITEMS = 6;

/**
 * §27 — the visible slice of one group's pages. Groups at or under
 * CAP + 1 never overflow (no "+1" button for a single item); a
 * revealed or active group shows everything. Pure.
 */
function previewSlice<T>(pages: readonly T[], revealed: boolean): { shown: T[]; hiddenCount: number } {
  if (revealed || pages.length <= GROUP_PREVIEW_ITEMS + 1) {
    return { shown: [...pages], hiddenCount: 0 };
  }
  return { shown: pages.slice(0, GROUP_PREVIEW_ITEMS), hiddenCount: pages.length - GROUP_PREVIEW_ITEMS };
}

// ══════════════════════════════════════════════════════════════
//  Fixed-position Tooltip — rendered in a portal so it NEVER
//  affects layout flow or causes any horizontal shift.
//  §DIR-AWARE — anchors to the side the rail actually sits on:
//  RTL rail (right edge) → tooltip opens leftward into the viewport;
//  LTR rail (left edge)  → tooltip opens rightward. Physical left/
//  right values here rendered the tooltip off-screen in English.
// ══════════════════════════════════════════════════════════════
function SidebarTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const { dir } = useLanguage();
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, inlineStart: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard: state must flip after SSR completes; there is no render-safe alternative for mount-only flags.
  useEffect(() => { setMounted(true); }, []);

  const handleMouseEnter = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + rect.height / 2,
      // Distance from the viewport edge the tooltip grows AWAY from.
      inlineStart: dir === 'rtl'
        ? window.innerWidth - rect.left + 8   // grows leftward from the rail's left face
        : rect.right + 8,                     // grows rightward from the rail's right face
    });
    setShow(true);
  }, [dir]);

  const handleMouseLeave = useCallback(() => setShow(false), []);

  // Only portal after mount — avoids SSR document.body access
  const tooltip = mounted && show
    ? createPortal(
        <motion.div
          initial={{ opacity: 0, x: 8, scale: 0.95 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 8, scale: 0.95 }}
          transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
          style={{
            position: 'fixed',
            top: pos.top,
            // Logical anchor: inset-inline-start flips with direction, so
            // the tooltip always opens INTO the viewport, never outside.
            insetInlineStart: pos.inlineStart,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="px-3 py-1.5 rounded-lg bg-slate-800/98 backdrop-blur-xl border border-slate-600/50 text-white text-xs whitespace-nowrap shadow-xl shadow-black/30"
          role="tooltip"
        >
          {label}
          {/* Arrow pointing toward the rail (inline-end side) */}
          <div
            className={cn(
              'absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-slate-800/98 rotate-45 border-slate-600/50',
              dir === 'rtl'
                ? '-right-1.5 border-r border-t'
                : '-left-1.5 border-l border-b',
            )}
          />
        </motion.div>,
        document.body
      )
    : null;

  return (
    <div
      ref={triggerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative"
    >
      {children}
      <AnimatePresence>{tooltip}</AnimatePresence>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Workspace entries (⭐ Favorites / 📌 Pins) — dedicated section
// ══════════════════════════════════════════════════════════════
function WorkspaceSection<T extends NavigationDescriptor & { id: string }>({
  title,
  icon,
  entries,
  onNavigate,
  onRemove,
}: {
  title: string;
  icon: React.ReactNode;
  entries: T[];
  onNavigate: (entry: T) => void;
  onRemove: (entry: T) => void;
}) {
  const { locale, t } = useLanguage();
  if (entries.length === 0) return null;
  return (
    <div className="px-1">
      <p className="px-2 py-1 text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
        {icon}
        {title}
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => {
          // §ICON-PARITY — each entry shows ITS OWN page icon (looked up
          // from the page registry), not the section's star/pin glyph
          // (the section header already carries that).
          const EntryIcon = SIDEBAR_ICON_MAP[APP_PAGES_BY_ID.get(entry.route)?.icon ?? ''];
          // §I18N-BILINGUAL — the stored label is a page-title snapshot;
          // the registry-localized label renders for the active locale.
          const entryLabel = localizedPageLabel(entry.route, locale);
          return (
            <li key={entry.id} className="group/item relative">
              <button
                type="button"
                onClick={() => onNavigate(entry)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                title={entryLabel}
              >
                <span className="shrink-0 flex items-center justify-center size-3.5">
                  {EntryIcon ? <EntryIcon className="size-3.5" /> : icon}
                </span>
                <span className="truncate flex-1 min-w-0">{entryLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry)}
                aria-label={`${t('sidebar.removeEntry')} ${entryLabel}`}
                title={t('sidebar.removeEntry')}
                className="absolute end-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/item:opacity-100 transition-opacity"
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  QLogoToggle (§SIDEBAR-V3) — the SINGLE sidebar control.
//
//  COLLAPSED rail: the Q brand mark sits in the header; hovering it
//  cross-fades the glyph into an expand chevron (clear affordance —
//  "this opens the menu"), click expands the sidebar.
//  EXPANDED surface: the full Qnlys brand mark; a small collapse
//  chevron sits in its own layout slot BESIDE the logo (never
//  overlapping). Click collapses back to the rail.
//
//  Both states use SidebarLogo for the mark (consistent asset,
//  proper theme variants). The expanded state uses a flex row
//  so the chevron has its own space — no absolute positioning
//  that overlaps the logo.
// ═════════════════════════════════════════════════════════════
function QLogoToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t, dir } = useLanguage();
  const [hovered, setHovered] = useState(false);

  // §DIR-AWARE — the chevron must point where expansion actually goes:
  // RTL rail (right edge) expands leftward → ChevronLeft;
  // LTR rail (left edge) expands rightward → ChevronRight.
  const ExpandChevron = dir === 'rtl' ? ChevronLeft : ChevronRight;
  // …and the collapse chevron points back at the rail.
  const CollapseChevron = dir === 'rtl' ? ChevronRight : ChevronLeft;

  if (!expanded) {
    // ── Rail: square Q button; hover swaps the glyph for the expand chevron.
    // Uses SidebarLogo (collapsed) for the Q mark — consistent asset.
    return (
      <button
        type="button"
        onClick={onToggle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-label={t('sidebar.expand')}
        aria-expanded={false}
        title={t('sidebar.expand')}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 hover:bg-slate-800/60"
      >
        <motion.span
          aria-hidden="true"
          animate={{ opacity: hovered ? 0 : 1, scale: hovered ? 0.85 : 1 }}
          transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0 flex items-center justify-center"
        >
          <SidebarLogo variant="collapsed" />
        </motion.span>
        <motion.span
          aria-hidden="true"
          initial={false}
          animate={{ opacity: hovered ? 1 : 0, scale: hovered ? 1 : 0.7 }}
          transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          className="absolute inset-0 flex items-center justify-center text-brand-300"
        >
          <ExpandChevron className="h-5 w-5" />
        </motion.span>
      </button>
    );
  }

  // ── Expanded: logo and collapse chevron as SIBLINGS in a flex row.
  // The logo gets the available space; the chevron button sits at
  // the leading edge (left in LTR, right in RTL — logical via flex).
  // This guarantees NO overlap, NO clipping, clean transition.
  return (
    <button
      type="button"
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={t('sidebar.collapse')}
      aria-expanded
      title={t('sidebar.collapse')}
      className="group/qlogo relative flex h-11 items-center justify-between gap-2 rounded-lg px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 hover:bg-slate-800/60"
      dir="ltr"
    >
      {/* Logo area — flexible, centered within remaining space */}
      <motion.div
        aria-hidden="true"
        animate={{ opacity: hovered ? 0.75 : 1 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        className="flex-1 flex items-center justify-center min-w-0"
      >
        <SidebarLogo variant="expanded" />
      </motion.div>

      {/* Collapse chevron — own slot, fades in on hover.
          Points toward the rail: ChevronRight in RTL (rail on the
          right), ChevronLeft in LTR (rail on the left). */}
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: hovered ? 1 : 0, x: hovered ? 0 : 4 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/60 bg-slate-800 text-brand-300 shadow-md"
      >
        <CollapseChevron className="h-3.5 w-3.5" />
      </motion.span>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
//  Sidebar
// ══════════════════════════════════════════════════════════════

interface SidebarProps {
  currentPage: string;
  onNavigate: (page: string) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function Sidebar({
  currentPage,
  onNavigate,
  isOpen,
  onToggle,
}: SidebarProps) {
  // ── §SIDEBAR-WORKSPACE — the user's layout + the permission-
  //    filtered registry universe (hook; see file header). ──
  const {
    layout,
    visiblePages,
    saveLayout,
    toggleGroupCollapsed,
    saving: layoutSaving,
  } = useSidebarLayout();
  const isMobile = useIsMobile();
  // §SIDEBAR-TABLET — the pinned in-layout sidebar exists ONLY on
  // desktop (≥1024px, the `lg:` breakpoint). Below that (including the
  // 768–1023 tablet range that used to be a dead zone) the sidebar is
  // the overlay drawer, opened by the header hamburger.
  const isDesktop = useIsDesktop();

  const { data: preferences } = useUserPreferences();
  const { locale, t, dir } = useLanguage();

  // ── §SIDEBAR-V2 — the two axes live in the store ──
  const sidebarPinned = useAppStore((s) => s.sidebarPinned);
  const sidebarExpanded = useAppStore((s) => s.sidebarExpanded);
  const sidebarHoverExpand = useAppStore((s) => s.sidebarHoverExpand);
  const setSidebarPinned = useAppStore((s) => s.setSidebarPinned);
  const setSidebarExpanded = useAppStore((s) => s.setSidebarExpanded);
  const setSidebarHoverExpand = useAppStore((s) => s.setSidebarHoverExpand);

  // ── §SIDEBAR-BADGES — per-user unseen counters ──
  // ONE shared react-query for the whole sidebar: new records added by
  // OTHER users since THIS user last opened the page. The active page
  // is never badged (opening it marks it seen via the PageRouter).
  // `pending` carries action-needed counts (quality approvals) — those
  // are NOT cleared by visiting; only the decision clears them.
  const { data: unseen } = useUnseenCounts();
  const unseenBadgeFor = useCallback(
    (pageId: string) => {
      if (pageId === currentPage) return 0;
      return unseenCountOf(unseen?.counts, pageId);
    },
    [unseen, currentPage],
  );
  const pendingBadgeFor = useCallback(
    (pageId: string) => pendingCountOf(unseen, pageId),
    [unseen],
  );

  // ── §SIDEBAR-V3: hydrate the persisted preference once ──
  // One canonical rule (resolveInitialSidebarState): the DEFAULT
  // experience is the sidebar PINNED in layout and COLLAPSED to the
  // rail. A legacy `pinOpen === false` (explicitly unpinned) still
  // resolves to drawer mode.
  const appliedPrefRef = useRef(false);
  useEffect(() => {
    if (appliedPrefRef.current) return;
    const pinOpen = preferences?.sidebar?.pinOpen;
    appliedPrefRef.current = true;
    const resolved = resolveInitialSidebarState(pinOpen);
    setSidebarPinned(resolved.pinned);
    setSidebarExpanded(resolved.expanded);
  }, [preferences, setSidebarPinned, setSidebarExpanded]);

  // ── §SIDEBAR-V3: HOVER-TO-PREVIEW with 1.5s dwell ──
  // Hovering the collapsed rail does NOT expand instantly — the user
  // must dwell 1.5s (reading tooltips, scrolling, or just passing by
  // keeps the rail stable). After the dwell, the surface unfolds as a
  // temporary OVERLAY (layout width untouched); leaving collapses it.
  // Deterministic timer, cleared on leave/unmount/open-menu freeze.
  const HOVER_EXPAND_DELAY_MS = 1500;
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // ── §SIDEBAR-V3 — ONE toggle: the Q-logo ──
  // Click toggles expanded ⇄ collapsed (pinned mode). The width choice
  // is SESSION state by design (store doctrine: it "never fights the
  // persisted pin choice") — it is deliberately NOT written into
  // `sidebar.pinOpen`. Writing it there leaked presentation into the
  // persisted pin axis: collapsing the rail once persisted pinOpen=false,
  // which the hydration rule maps to UNPINNED drawer mode after a
  // reload (the §10 presentation-corrupts-persistence bug family).
  // Expanding from the rail/hover-preview always clears the temporary
  // hover overlay so exactly one surface owns the screen.
  const handleToggleExpand = useCallback(() => {
    const next = !useAppStore.getState().sidebarExpanded;
    clearHoverTimer();
    setSidebarHoverExpand(false);
    setSidebarExpanded(next);
  }, [clearHoverTimer, setSidebarHoverExpand, setSidebarExpanded]);

  const handleRailMouseEnter = useCallback(() => {
    clearHoverTimer();
    hoverTimerRef.current = setTimeout(() => {
      hoverTimerRef.current = null;
      setSidebarHoverExpand(true);
    }, HOVER_EXPAND_DELAY_MS);
  }, [clearHoverTimer, setSidebarHoverExpand]);

  const handleRailMouseLeave = useCallback(() => {
    clearHoverTimer();
    setSidebarHoverExpand(false);
  }, [clearHoverTimer, setSidebarHoverExpand]);

  // Unmount hygiene — no stray timer fires after the sidebar is gone.
  useEffect(() => clearHoverTimer, [clearHoverTimer]);

  // ── §SIDEBAR-V3: NAV SCROLL CONTINUITY ──
  // The rail nav and the expanded nav are separate DOM elements (the
  // surface swaps). ONE shared scroll position: every nav writes its
  // scrollTop into the ref while scrolling, and every nav RESTORES it
  // on mount (callback ref) — collapsing/expanding/hover-preview never
  // loses the user's place in the list.
  const navScrollRef = useRef(0);
  const handleNavScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    navScrollRef.current = e.currentTarget.scrollTop;
  }, []);
  const railNavRefCb = useCallback((el: HTMLElement | null) => {
    if (el) el.scrollTop = navScrollRef.current;
  }, []);
  const expandedNavRefCb = useCallback((el: HTMLElement | null) => {
    if (el) el.scrollTop = navScrollRef.current;
  }, []);

  // ── §1: OVERFLOW-MENU FIX (root cause) ──
  // The ⋮ menu content renders in a RADIX PORTAL on document.body —
  // OUTSIDE this sidebar's DOM subtree. Moving the pointer from the
  // trigger towards the menu therefore fires onMouseLeave on the
  // sidebar root; previously that flipped `hovering` and swapped the
  // rendered surface (rail ⇄ full), unmounting the trigger and
  // killing the open menu. Fix: while the ⋮ menu is open we FREEZE
  // whichever surface it was opened from — hover changes are ignored
  // and mouse-leave cannot collapse the sidebar mid-interaction.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpenSurface, setMenuOpenSurface] = useState(false);

  // ── §SIDEBAR-WORKSPACE: dedicated EDIT MODE ──
  // `editing` swaps the nav for SidebarEditNav, which owns a LOCAL
  // DRAFT of the layout: nothing persists until Done validates and
  // the server confirms; Cancel restores the previous layout without
  // a write. Draft isolation prevents partial/accidental writes
  // during drag operations.
  const [editing, setEditing] = useState(false);
  const wasExpandedBeforeEditRef = useRef<boolean | null>(null);

  const enterEditMode = useCallback(() => {
    if (!layout) return;
    wasExpandedBeforeEditRef.current = sidebarExpanded;
    clearHoverTimer();
    setSidebarHoverExpand(false);
    if (!sidebarExpanded) setSidebarExpanded(true); // editing needs the full surface
    setEditing(true);
  }, [clearHoverTimer, layout, setSidebarExpanded, setSidebarHoverExpand, sidebarExpanded]);

  const exitEditMode = useCallback(() => {
    setEditing(false);
    if (wasExpandedBeforeEditRef.current === false && useAppStore.getState().sidebarExpanded) {
      setSidebarExpanded(false); // restore the rail
    }
    wasExpandedBeforeEditRef.current = null;
  }, [setSidebarExpanded]);

  const handleEditDone = useCallback(async (draft: SidebarLayout) => {
    try {
      // Success feedback ONLY after the persistence write is
      // confirmed by the server (§12/§13).
      await saveLayout(draft);
      toast.success(t('sidebar.layoutSaved'));
      exitEditMode();
    } catch {
      // Stay in edit mode — the draft survives for another attempt.
      toast.error(t('sidebar.layoutSaveFailed'));
    }
  }, [exitEditMode, saveLayout, t]);

  // ── Reset layout (normal mode) — canonical default, confirmed ──
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const handleResetLayout = async () => {
    if (!layout) return;
    try {
      await saveLayout(createDefaultLayout(visiblePages.map((p) => p.id)));
      toast.success(t('sidebar.layoutSaved'));
    } catch {
      toast.error(t('sidebar.layoutSaveFailed'));
    }
  };

  // §1: while the ⋮ menu is open the surface is FROZEN to whatever it
  // was when the menu opened — the menu's portal lives outside this
  // element, so hover state must never swap the surface under an open
  // menu (that would unmount the trigger and close the menu).
  const handleMenuOpenChange = useCallback((open: boolean) => {
    setMenuOpen(open);
    if (open) {
      // Freeze the dwell timer too — the surface must not swap mid-menu.
      clearHoverTimer();
      setMenuOpenSurface(editing || sidebarExpanded || sidebarHoverExpand);
    }
  }, [clearHoverTimer, editing, sidebarExpanded, sidebarHoverExpand]);

  // Full-surface visibility (pinned column): expanded, editing, or the
  // dwell-triggered hover surface (§SIDEBAR-V3 1.5s).
  const expanded = !isDesktop
    ? false
    : sidebarExpanded || editing;

  // Hover-expand target (pinned collapsed rail, desktop only): active
  // only AFTER the 1.5s dwell flips `sidebarHoverExpand`. While a ⋮
  // menu is open the surface freezes to whatever it was when the menu
  // opened (§1 menu fix).
  const hoverSurfaceActive = isDesktop && sidebarPinned && !expanded &&
    (menuOpen ? menuOpenSurface : sidebarHoverExpand);

  // ── ESC closes the unpinned drawer (any non-desktop size) ──
  useEffect(() => {
    if (isDesktop || sidebarPinned || !isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useAppStore.getState().setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDesktop, sidebarPinned, isOpen]);

  // ── §4/§5: favorites + pins, reconciled against CURRENT routes ──
  const visibleIds = useMemo(() => new Set(visiblePages.map((p) => p.id)), [visiblePages]);
  const isRouteVisible = useCallback((route: string) => visibleIds.has(route), [visibleIds]);
  const favorites = useMemo<FavoriteEntry[]>(
    () => reconcileNavigationEntries<FavoriteEntry>(preferences?.favorites, isRouteVisible),
    [preferences, isRouteVisible],
  );
  const pins = useMemo<PinEntry[]>(
    () => reconcileNavigationEntries<PinEntry>(preferences?.pins, isRouteVisible),
    [preferences, isRouteVisible],
  );
  const navigateEntry = useCallback((entry: NavigationDescriptor) => {
    useAppStore.getState().navigateTo(
      entry.route,
      entry.targetType === 'record' ? entry.targetId ?? undefined : undefined,
      entry.navigationContext ?? {},
    );
  }, []);
  const removeFavorite = useFavoriteToggleAction();
  const removePin = usePinToggleAction();

  // ── ⋮ menu: ⭐/📌 for the CURRENT page ──
  const pageDescriptor = useMemo<NavigationDescriptor | null>(() => {
    const cfg = APP_PAGES_BY_ID.get(currentPage);
    if (!cfg) return null;
    return { targetType: 'page', route: cfg.id, label: cfg.title };
  }, [currentPage]);
  const pageMarkState = useMarkState(
    pageDescriptor ?? { targetType: 'page', route: '__none__', label: '' },
  );
  const toggleFavorite = useFavoriteToggleAction();
  const togglePin = usePinToggleAction();

  // ── §SIDEBAR-WORKSPACE — the rendered groups come from the LAYOUT ──
  // References → registry configs. The reconcile step already removed
  // stale/unauthorized refs; the lookup filter is belt-and-braces so a
  // registry change can never render a bare id.
  const layoutGroups = useMemo(() => {
    if (!layout) return [];
    return layout.groups
      .map((g) => ({
        id: g.id,
        name: g.name,
        pages: g.items
          .map((it) => APP_PAGES_BY_ID.get(it.id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p) && visibleIds.has(p!.id)),
      }))
      .filter((g) => g.pages.length > 0);
  }, [layout, visibleIds]);

  // ── §22 GROUP STATE — ONE system: the persisted layout's
  //  `collapsed` flags (per user, via the preferences API). Derived
  //  here; toggles go through `toggleGroupCollapsed` (optimistic
  //  cache seed + one server write per click). Survives sidebar
  //  collapse/expand, navigation, reloads and logout/login BY
  //  CONSTRUCTION — it is the stored layout, not a mirror. Absent
  //  flag = open (a fresh MAIN-only layout renders open).
  const collapsedGroups = useMemo(() => {
    const map: Record<string, boolean> = {};
    layout?.groups.forEach((g) => { map[g.id] = g.collapsed === true; });
    return map;
  }, [layout]);

  // ── §27 SHOW-ALL — per-group overflow reveal (SESSION state, both
  //  surfaces share it: the rail and the expanded nav are the same
  //  model). Never persisted: it is a transient view of a long group,
  //  not a layout change. The group containing the CURRENT page is
  //  always treated as revealed.
  const [revealedGroups, setRevealedGroups] = useState<Set<string>>(new Set());
  const toggleRevealGroup = useCallback((groupId: string) => {
    setRevealedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ── §16/§39 ACTIVE-GROUP DISCOVERABILITY — navigating to a page of
  //  a CLOSED group reveals that group for the session WITHOUT writing
  //  the stored layout (the user's saved collapse choice is untouched;
  //  §22). An explicit user toggle on the group clears the override.
  const [navOpenedGroups, setNavOpenedGroups] = useState<Set<string>>(new Set());

  // §7 UNIFIED MODEL — the ONE rendered-collapse map both surfaces
  // consume: stored flag (§22) + session navigation reveal (§16).
  // The rail and the expanded nav render the same groups open/closed.
  const renderedCollapsed = useMemo(() => {
    const map: Record<string, boolean> = {};
    layoutGroups.forEach((g) => {
      map[g.id] = collapsedGroups[g.id] === true && !navOpenedGroups.has(g.id);
    });
    return map;
  }, [layoutGroups, collapsedGroups, navOpenedGroups]);

  const toggleGroup = useCallback((groupId: string) => {
    // Toggle operates on the RENDERED state (a navigation-forced-open
    // group reads as open): clicking it closed removes the override —
    // and writes only when the stored flag actually changes.
    if (navOpenedGroups.has(groupId)) {
      setNavOpenedGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      if (!collapsedGroups[groupId]) toggleGroupCollapsed(groupId); // rendered open AND stored open → persist close
      return; // stored flag already says collapsed — the override was the only opener
    }
    toggleGroupCollapsed(groupId);
  }, [collapsedGroups, navOpenedGroups, toggleGroupCollapsed]);

  // ── §SIDEBAR-MIRROR — the group containing the CURRENT page is
  //  always shown open. One source of truth (collapsedGroups) drives
  //  BOTH surfaces: navigating to a page of a closed group re-opens
  //  that group. Explicit user collapse of that same group is still
  //  respected until the next navigation. (§16 — the active page is
  //  always discoverable, without destroying the user's collapse
  //  preference.)
  const activeGroupId = useMemo(
    () => layoutGroups.find((g) => g.pages.some((p) => p.id === currentPage))?.id ?? null,
    [layoutGroups, currentPage],
  );
  // Fires ONLY on an activeGroupId CHANGE (not on layout refetches):
  // an explicit user collapse of the active group is respected until
  // the user navigates elsewhere and back.
  const lastActiveGroupRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastActiveGroupRef.current;
    lastActiveGroupRef.current = activeGroupId;
    if (!activeGroupId || activeGroupId === prev) return;
    if (!collapsedGroups[activeGroupId]) return; // stored open — nothing to reveal
    // Route-change reveal sync — mirrors the file's canonical hydration
    // guard pattern (no render-safe alternative exists).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route-change sync of the session reveal override.
    setNavOpenedGroups((prevSet) => (prevSet.has(activeGroupId) ? prevSet : new Set(prevSet).add(activeGroupId)));
    // collapsedGroups is intentionally NOT a dependency: only navigation
    // (activeGroupId) may add a reveal override, never a layout refetch.
  }, [activeGroupId]);

  // ── Sidebar settings ⋮ menu (§SIDEBAR-WORKSPACE) — shared by
  //    expanded + collapsed surfaces ──
  const settingsMenu = (
    <DropdownMenu onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('sidebar.menuSettings')}
          aria-haspopup="menu"
          title={t('sidebar.menuSettings')}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="bg-slate-900 border-slate-700/60 min-w-52 z-50">
        <DropdownMenuItem
          onClick={enterEditMode}
          disabled={editing || !layout}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <SlidersHorizontal className="size-3.5" />
          {t('sidebar.editSidebar')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setResetConfirmOpen(true)}
          disabled={layoutSaving}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <RotateCcw className="size-3.5" />
          {t('sidebar.resetLayout')}
        </DropdownMenuItem>
        {pageDescriptor && (
          <>
            <DropdownMenuSeparator className="bg-slate-700/50" />
            <DropdownMenuLabel className="text-[10px] font-semibold text-slate-500 py-1.5">
              {t('sidebar.currentPageSection')}
            </DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => void toggleFavorite(pageDescriptor)}
              className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
            >
              <Star className={cn('size-3.5', pageMarkState.favoriteActive && 'text-amber-400 fill-amber-400')} />
              {pageMarkState.favoriteActive ? t('sidebar.removeFavorite') : t('sidebar.addFavorite')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void togglePin(pageDescriptor)}
              className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
            >
              <PinIcon className={cn('size-3.5', pageMarkState.pinActive && 'text-cyan-400 fill-cyan-400')} />
              {pageMarkState.pinActive ? t('sidebar.unpinPage') : t('sidebar.pinPage')}
            </DropdownMenuItem>
          </>
        )}
        {/* §HEADER-V3 — logout moved to the Header profile menu (the
            single profile surface); no duplicated control here. */}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ── Nav content (expanded surface) ──
  // §7 EMERGE: page names slide OUT FROM BEHIND their icons (RTL: the
  // icon sits at the row start/right; the label starts offset TOWARD
  // the icon and settles left into place). Staggered per item — CSS
  // class + framer transforms only, replayed when the surface mounts.
  // §SIDEBAR-WORKSPACE: iterates `layoutGroups` — the user's own
  // group structure over the permission-filtered registry set.
  // Group headers carry the NAME only (main group localized; custom
  // names are user content, rendered verbatim) — no emoji, no dots
  // (§23/§24: structure comes from typography, spacing and the
  // §SIDEBAR-GROUP-FRAME ambient boundary).
  const expandedNav = (
    <nav
      ref={expandedNavRefCb}
      onScroll={handleNavScroll}
      className="flex-1 overflow-y-auto py-3 px-3 arm-scroll"
      aria-label={t('sidebar.pagesNav')}
    >
      {layoutGroups.map((group, groupIdx) => {
        const groupPages = group.pages;
        if (groupPages.length === 0) return null;
        const isGroupCollapsed = renderedCollapsed[group.id] === true;
        const isActiveGroup = activeGroupId === group.id;
        const groupLabel = sidebarGroupLabel(group, locale);
        // §27 SHOW-ALL — the active group never overflows; "Show less"
        // only appears when the USER revealed the group (not navigation).
        const isRevealed = revealedGroups.has(group.id) || isActiveGroup;
        const preview = previewSlice(groupPages, isRevealed);
        const canShowLess = preview.hiddenCount === 0
          && revealedGroups.has(group.id)
          && !isActiveGroup
          && groupPages.length > GROUP_PREVIEW_ITEMS + 1;

        return (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIdx * 0.04 + 0.08, duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className={cn(groupIdx > 0 && 'mt-2')}
          >
            {/* §SIDEBAR-GROUP-FRAME — the group renders as ONE connected
                object: a transparent glass surface whose thin Qnalys
                boundary is DRAWN progressively on open and retracted in
                reverse on close. Geometry follows the real content box
                (no hardcoded heights); the collapsed rail never mounts
                it, so icon mode stays frame-free. */}
            <SidebarGroupFrame open={!isGroupCollapsed} className="p-1">
            <button
              onClick={() => toggleGroup(group.id)}
              aria-expanded={!isGroupCollapsed}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group/header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              )}
            >
              <span className={cn(
                'flex-1 text-start text-[10px] font-bold tracking-wide whitespace-nowrap transition-colors truncate',
                isActiveGroup ? 'text-slate-300' : 'text-slate-500 group-hover/header:text-slate-400',
              )}>
                {groupLabel}
              </span>
              <motion.span
                animate={{ rotate: isGroupCollapsed ? 0 : 180 }}
                transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="flex items-center justify-center w-5 h-5 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-400 shrink-0"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M7.5 3.75L5 6.25L2.5 3.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.span>
            </button>

            <AnimatePresence initial={false}>
              {!isGroupCollapsed && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                  className="overflow-hidden space-y-0.5 mt-0.5"
                >
                  {preview.shown.map((page, index) => {
                    const Icon = SIDEBAR_ICON_MAP[page.icon];
                    const isActive = currentPage === page.id;
                    const unseenBadge = unseenBadgeFor(page.id);
                    const pendingBadge = pendingBadgeFor(page.id);
                    const badgeCount = Math.max(unseenBadge, pendingBadge);
                    return (
                      <motion.li
                        key={page.id}
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          // §7 EMERGE — from the icon (row start) toward
                          // its place; 180-280ms window, no bounce.
                          delay: index * 0.025,
                          duration: 0.22,
                          ease: [0.4, 0, 0.2, 1],
                        }}
                      >
                        <motion.button
                          onClick={() => onNavigate(page.id)}
                          whileHover={{ x: dir === 'rtl' ? -4 : 4 }}
                          transition={{ duration: 0.12 }}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                            isActive
                              ? 'bg-gradient-to-l from-brand-600 to-brand-700 text-white shadow-md shadow-brand-500/20'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white',
                          )}
                        >
                          {Icon && (
                            <span className="shrink-0 flex items-center justify-center size-5">
                              <Icon className={cn('h-5 w-5', isActive && 'scale-110')} />
                            </span>
                          )}
                          <span className="truncate min-w-0">{localizedPageLabel(page.id, locale)}</span>
                          {/* §APPROVAL-NOTIFY — action-needed badge wins over
                              the unseen badge (more urgent, different tone). */}
                          {pendingBadge > 0 ? (
                            <SidebarActivityBadge
                              count={pendingBadge}
                              tone="amber"
                              title={`${pendingBadge} ${t('sidebar.qualityDeductionPending')}`}
                            />
                          ) : (
                            /* §SIDEBAR-BADGES — new-items counter (per user). */
                            <SidebarActivityBadge
                              count={badgeCount}
                              tone="violet"
                              title={`${badgeCount} ${t('sidebar.newItemsHint')}`}
                            />
                          )}
                        </motion.button>
                      </motion.li>
                    );
                  })}
                  {/* §27 SHOW-ALL — navigation overflow control (keyboard
                      accessible; reveals the remaining items in place). */}
                  {(preview.hiddenCount > 0 || canShowLess) && (
                    <li className="px-2 pt-0.5">
                      <button
                        type="button"
                        onClick={() => toggleRevealGroup(group.id)}
                        aria-expanded={preview.hiddenCount === 0}
                        className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-brand-300/80 hover:text-brand-200 hover:bg-slate-800/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                      >
                        {preview.hiddenCount > 0
                          ? `${t('sidebar.showAll')} (${groupPages.length})`
                          : t('sidebar.showLess')}
                      </button>
                    </li>
                  )}
                </motion.ul>
              )}
            </AnimatePresence>
            </SidebarGroupFrame>
          </motion.div>
        );
      })}
    </nav>
  );

  // ── Normal-mode footer: sidebar's OWN controls only (⋮ settings).
  //  §HEADER-V3 — the user's identity/profile lives in the HEADER
  //  profile menu (the single profile surface); the sidebar ends with
  //  navigation + its own settings control, no duplicate identity. ──
  const normalFooter = (
    <div className="border-t border-slate-700/50 p-2 shrink-0 flex items-center">
      {settingsMenu}
    </div>
  );

  // ── FULL SURFACE — shared by: pinned expanded column, hover surface,
  // unpinned drawer, and the non-desktop drawer. Exactly ONE instance
  // is ever mounted (the layout modes are mutually exclusive), so
  // framer layoutIds inside it stay unique.
  const showCloseButton = !isDesktop || !sidebarPinned;
  const surface = (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      {/* §SIDEBAR-V3 — the Q-logo IS the toggle (hover = collapse chevron,
          click = fold back to the rail). Drawer modes keep the close
          button. §HEADER-V3 SYNC: glassmorphism + gradient line + 48px
          baseline shared with the main header. */}
      <header className="glass-header sticky top-0 z-10 flex flex-col shrink-0">
        <div className="header-gradient-line" />
        <div className="relative flex items-center h-12 px-4">
          {/* Drawer close (mobile/tablet drawers + unpinned desktop) —
              the ONLY extra control; pin/expand buttons are gone. */}
          {showCloseButton ? (
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
              aria-label={t('sidebar.close')}
            >
              <X className="h-5 w-5" />
            </button>
          ) : (
            <span className="w-2" aria-hidden="true" />
          )}
          {/* §BRAND + toggle — centered Qnlys, hover reveals collapse glyph */}
          <div className="absolute inset-x-0 flex justify-center pointer-events-none">
            <div className="pointer-events-auto">
              <QLogoToggle expanded onToggle={handleToggleExpand} />
            </div>
          </div>
        </div>
      </header>

      {/* §SIDEBAR-WORKSPACE: edit mode swaps the nav for the draft
          editor (own footer); normal mode renders navigation + the
          favorites/pins workspace sections. */}
      {editing && layout ? (
        <SidebarEditNav
          key="sidebar-edit-nav"
          initialLayout={layout}
          visiblePages={visiblePages}
          saving={layoutSaving}
          onDone={handleEditDone}
          onCancel={exitEditMode}
        />
      ) : expandedNav}
      {!editing && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-800/60 pt-2 overflow-y-auto arm-scroll max-h-56 shrink-0">
          <WorkspaceSection
            title={t('sidebar.pinnedPages')}
            icon={<PinIcon className="size-3 text-cyan-400" />}
            entries={pins}
            onNavigate={navigateEntry}
            onRemove={(entry) => void removePin(entry)}
          />
          <WorkspaceSection
            title={t('sidebar.favoritePages')}
            icon={<Star className="size-3 text-amber-400" />}
            entries={favorites}
            onNavigate={navigateEntry}
            onRemove={(entry) => void removeFavorite(entry)}
          />
        </div>
      )}

      {!editing && normalFooter}
      {/* a11y: surface is a navigation region; close control exists above */}
      <span className="sr-only">{showCloseButton ? t('sidebar.escHint') : ''}</span>
    </div>
  );

  // ── Non-desktop overlay (mobile AND the 768–1023 tablet range — the
  // §SIDEBAR-TABLET dead zone fix). Hidden entirely until the header's
  // menu button opens it as an overlay DRAWER above the page.
  // §DIR-AWARE — the drawer anchors to the sidebar's edge (inline-start:
  // right in RTL, left in LTR) and slides in FROM that edge. ──
  if (!isDesktop) {
    const drawerSlide = dir === 'rtl' ? '100%' : '-100%';
    return (
      <>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm print:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onToggle}
            />
            <motion.aside
              className="flex fixed inset-y-0 start-0 z-50 w-72 shadow-2xl print:hidden"
              initial={{ x: drawerSlide }}
              animate={{ x: 0 }}
              exit={{ x: drawerSlide }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              aria-label={t('sidebar.mainNav')}
            >
              {surface}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        destructive={false}
        title={t('sidebar.resetLayout')}
        description={t('sidebar.resetLayoutDescription')}
        confirmLabel={t('sidebar.resetLayout')}
        onConfirm={() => void handleResetLayout()}
      />
      </>
    );
  }

  // ── UNPINNED desktop: NO layout footprint. Hidden entirely until the
  // header's menu button opens it as an overlay DRAWER above the page
  // and header (z-50 backdrop / z-50 panel vs header z-30).
  // §DIR-AWARE — same anchoring contract as the non-desktop drawer. ──
  if (!sidebarPinned) {
    const drawerSlide = dir === 'rtl' ? '100%' : '-100%';
    return (
      <>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] print:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onToggle}
              aria-hidden="true"
            />
            <motion.aside
              className="flex fixed inset-y-0 start-0 z-50 w-[288px] shadow-2xl shadow-black/60 print:hidden"
              initial={{ x: drawerSlide }}
              animate={{ x: 0 }}
              exit={{ x: drawerSlide }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              aria-label={t('sidebar.mainNav')}
            >
              {surface}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        destructive={false}
        title={t('sidebar.resetLayout')}
        description={t('sidebar.resetLayoutDescription')}
        confirmLabel={t('sidebar.resetLayout')}
        onConfirm={() => void handleResetLayout()}
      />
      </>
    );
  }

  // ── PINNED desktop: the sidebar is PART OF THE LAYOUT — a sticky
  // in-flow column. The page content is a flex sibling, so it ALWAYS
  // responds to the sidebar width and the header (inside the content
  // column) can never overlap the sidebar.
  //
  // §SIDEBAR-SINGLE-SURFACE (hover architecture): there is EXACTLY ONE
  // navigation surface element. Hovering the collapsed rail does NOT
  // mount a second aside/panel beside it — the expanded surface renders
  // as an absolutely-positioned layer INSIDE this same <aside>, so:
  //   • one ownership model for hover events (the aside subtree owns
  //     mouseenter/leave; React's subtree-based semantics make phantom
  //     mouseleave impossible — the §SIDEBAR-HOVER-BRIDGE guarantee,
  //     now structural);
  //   • no transparent duplicate navigation panel, no ghost menu, no
  //     pointer conflicts (the old second motion.aside is gone);
  //   • no layout jump — the in-flow rail keeps its 72px width while
  //     the 288px surface overlays the content (z-40 above the header);
  //   • deterministic, no timers.
  return (
    <>
    <aside
      onMouseEnter={handleRailMouseEnter}
      onMouseLeave={handleRailMouseLeave}
      className={cn(
        'hidden lg:flex lg:sticky lg:top-0 lg:h-screen shrink-0 flex-col bg-slate-900 text-white print:hidden',
        hoverSurfaceActive ? 'overflow-visible z-40' : 'overflow-hidden z-20',
      )}
      style={{
        width: expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED,
        transition: 'width 260ms cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      aria-label={t('sidebar.mainNav')}
    >
      {expanded ? (
        surface
      ) : (
        <>
          <CollapsedRail
            currentPage={currentPage}
            onNavigate={onNavigate}
            onExpand={handleToggleExpand}
            layoutGroups={layoutGroups}
            renderedCollapsed={renderedCollapsed}
            onToggleGroup={toggleGroup}
            revealedGroups={revealedGroups}
            onToggleReveal={toggleRevealGroup}
            settingsMenu={settingsMenu}
            navScrollRefCb={railNavRefCb}
            onNavScroll={handleNavScroll}
            unseenBadgeFor={unseenBadgeFor}
            pendingBadgeFor={pendingBadgeFor}
          />
          {/* The hover-expanded layer lives INSIDE the aside — the same
              navigation surface, simply unfolded over the content.
              §DIR-AWARE — anchored to the INLINE-START edge (the edge
              hugging the viewport: right in RTL, left in LTR), so the
              288px surface expands INTO the viewport in both languages.
              The physical `right-0` anchor rendered it off-screen left
              in English (the aside is the layout's first flex child). */}
          <AnimatePresence>
            {hoverSurfaceActive && (
              <motion.div
                key="sidebar-hover-surface"
                className="absolute top-0 start-0 h-full w-[288px] shadow-2xl shadow-black/60 ring-1 ring-slate-700/50"
                initial={{ opacity: 0, x: dir === 'rtl' ? 24 : -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir === 'rtl' ? 24 : -24 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                aria-label={t('sidebar.mainNav')}
              >
                {surface}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </aside>

    <ConfirmDialog
      open={resetConfirmOpen}
      onOpenChange={setResetConfirmOpen}
      destructive={false}
      title={t('sidebar.resetLayout')}
      description={t('sidebar.resetLayoutDescription')}
      confirmLabel={t('sidebar.resetLayout')}
      onConfirm={() => void handleResetLayout()}
    />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  Collapsed rail (§UNIFIED-RAIL) — the SAME navigation structure as
//  the expanded sidebar (layout groups → pages), ICONS-ONLY:
//    • The group icon toggles the SAME open/closed state (one source
//      of truth: the persisted layout's §22 flags + the session §16
//      navigation reveal, pre-merged into `renderedCollapsed` —
//      preserved across surface swaps by construction).
//    • Pages of OPEN groups render beneath their group icon; tooltips
//      carry the labels. §27 SHOW-ALL overflow identical to expanded.
//      No counters, no flyouts.
//    • §22 CLEAN RAIL: no group frames, backgrounds or labels here —
//      a single neutral group glyph per group (structure, not
//      decoration), the Qnalys accent marks the group holding the
//      CURRENT page, and only the ACTIVE PAGE gets the gradient fill.
// ══════════════════════════════════════════════════════════════

interface RailGroup {
  id: string;
  name: string;
  pages: { id: string; title: string; icon: string }[];
}

function CollapsedRail({
  currentPage,
  onNavigate,
  onExpand,
  layoutGroups,
  renderedCollapsed,
  onToggleGroup,
  revealedGroups,
  onToggleReveal,
  settingsMenu,
  navScrollRefCb,
  onNavScroll,
  unseenBadgeFor,
  pendingBadgeFor,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onExpand: () => void;
  layoutGroups: RailGroup[];
  /** §7 UNIFIED MODEL — the same rendered-collapse map the expanded
   *  surface uses (stored §22 flags + session §16 navigation reveal). */
  renderedCollapsed: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  /** §27 SHOW-ALL — shared with the expanded surface. */
  revealedGroups: Set<string>;
  onToggleReveal: (groupId: string) => void;
  settingsMenu: React.ReactNode;
  /** §SIDEBAR-V3 — shared nav scroll continuity (restore on mount). */
  navScrollRefCb: (el: HTMLElement | null) => void;
  onNavScroll: (e: React.UIEvent<HTMLElement>) => void;
  unseenBadgeFor?: (pageId: string) => number;
  pendingBadgeFor?: (pageId: string) => number;
}) {
  const { locale, t, dir } = useLanguage();
  // Determine which group the active page belongs to (for the active accent).
  const activeGroupId = useMemo(() => {
    const active = layoutGroups.find((g) => g.pages.some((p) => p.id === currentPage));
    return active?.id ?? null;
  }, [layoutGroups, currentPage]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900">
      {/* §SIDEBAR-V3 — the Q-logo IS the expand toggle: hover cross-fades
          the glyph into an expand chevron, click expands the sidebar.
          §HEADER-V3 SYNC: glassmorphism + gradient line + 48px baseline. */}
      <header className="glass-header sticky top-0 z-10 flex flex-col shrink-0">
        <div className="header-gradient-line" />
        <div className="flex items-center justify-center h-12">
          <QLogoToggle expanded={false} onToggle={onExpand} />
        </div>
      </header>

      {/* Navigation — §22: icon-only, ultra clean. The group glyph is a
          neutral structural marker (the user names their groups in the
          expanded surface / tooltips); the Qnalys accent marks the
          group holding the CURRENT page; only the current page gets
          the gradient. */}
      <nav
        ref={navScrollRefCb}
        onScroll={onNavScroll}
        className="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-1.5 px-2 arm-scroll"
        aria-label={t('sidebar.groupsNav')}
      >
        {layoutGroups.map((group) => {
          const isActive = activeGroupId === group.id;
          const isGroupOpen = !renderedCollapsed[group.id];
          const groupLabel = sidebarGroupLabel(group, locale);
          // §27 SHOW-ALL — the SAME preview contract as the expanded
          // surface (shared reveal state; active group never overflows).
          const railPreview = previewSlice(group.pages, revealedGroups.has(group.id) || isActive);
          const canShowLess = railPreview.hiddenCount === 0
            && revealedGroups.has(group.id)
            && !isActive
            && group.pages.length > GROUP_PREVIEW_ITEMS + 1;
          return (
            <div key={group.id} className="w-full flex flex-col items-center gap-0.5">
              <SidebarTooltip label={groupLabel}>
                <motion.button
                  onClick={() => onToggleGroup(group.id)}
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label={groupLabel}
                  aria-expanded={isGroupOpen}
                  className={cn(
                    'w-12 h-10 flex items-center justify-center rounded-lg transition-colors duration-150 text-slate-400 hover:bg-slate-800/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    // The accent COLOR (never a fill/container) marks the
                    // group holding the current page.
                    isActive && 'sidebar-group-icon-active',
                  )}
                >
                  <Folder className="h-5 w-5 shrink-0" />
                </motion.button>
              </SidebarTooltip>

              {/* Pages of OPEN groups — icons only, SAME order as the
                  expanded sidebar, tooltips carry the labels. Rendered
                  INSIDE the rail: no flyout, no floating mirror panel. */}
              <AnimatePresence initial={false}>
                {isGroupOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                    className="overflow-hidden w-full"
                  >
                    <div className="relative flex flex-col items-center gap-0.5 py-0.5">
                      {/* tree spine connecting the group icon to its pages —
                          centered on the icon axis (logical, RTL-safe) */}
                      <span aria-hidden="true" className="absolute top-0 bottom-0 start-1/2 w-px bg-slate-700/50" />
                      {railPreview.shown.map((page) => {
                        const PageIcon = SIDEBAR_ICON_MAP[page.icon];
                        const isCurrent = currentPage === page.id;
                        const unseenBadge = unseenBadgeFor?.(page.id) ?? 0;
                        const pendingBadge = pendingBadgeFor?.(page.id) ?? 0;
                        return (
                          <SidebarTooltip
                            key={page.id}
                            label={localizedPageLabel(page.id, locale) + (pendingBadge > 0
                              ? ` — ${pendingBadge} ${t('sidebar.awaitingApproval')}`
                              : unseenBadge > 0 ? ` — ${unseenBadge} ${t('sidebar.newItems')}` : '')}
                          >
                            <button
                              type="button"
                              onClick={() => onNavigate(page.id)}
                              aria-current={isCurrent ? 'page' : undefined}
                              aria-label={localizedPageLabel(page.id, locale)}
                              className={cn(
                                'relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                                isCurrent
                                  ? 'bg-gradient-to-br from-brand-600 to-brand-700 text-white shadow-md shadow-brand-500/25'
                                  : 'text-slate-400 bg-slate-900 hover:bg-slate-800 hover:text-white',
                              )}
                            >
                              {PageIcon && <PageIcon className="size-4 shrink-0" />}
                              {/* §APPROVAL-NOTIFY — amber action-needed dot wins. */}
                              {pendingBadge > 0 && !isCurrent && (
                                <SidebarActivityBadge
                                  count={pendingBadge}
                                  tone="amber"
                                  variant="dot"
                                  title={`${pendingBadge} ${t('sidebar.awaitingApproval')}`}
                                />
                              )}
                              {/* §SIDEBAR-BADGES — tiny unread dot on the rail icon. */}
                              {pendingBadge === 0 && unseenBadge > 0 && !isCurrent && (
                                <SidebarActivityBadge
                                  count={unseenBadge}
                                  tone="violet"
                                  variant="dot"
                                  title={`${unseenBadge} ${t('sidebar.newItems')}`}
                                />
                              )}
                              {isCurrent && (
                                <motion.span
                                  layoutId="collapsedPageIndicator"
                                  className="absolute start-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-e-full bg-brand-300"
                                />
                              )}
                            </button>
                          </SidebarTooltip>
                        );
                      })}
                    </div>
                    {/* §27 SHOW-ALL — compact overflow toggle (tooltip
                        carries the label; keyboard accessible). */}
                    {(railPreview.hiddenCount > 0 || canShowLess) && (
                      <SidebarTooltip
                        label={railPreview.hiddenCount > 0
                          ? `${t('sidebar.showAll')} (${group.pages.length})`
                          : t('sidebar.showLess')}
                      >
                        <button
                          type="button"
                          onClick={() => onToggleReveal(group.id)}
                          aria-label={railPreview.hiddenCount > 0
                            ? `${t('sidebar.showAll')} (${group.pages.length})`
                            : t('sidebar.showLess')}
                          className="w-9 h-6 flex items-center justify-center rounded-md text-slate-500 hover:text-white hover:bg-slate-800/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                        >
                          {railPreview.hiddenCount > 0
                            ? <ChevronDown className="size-3.5" />
                            : <ChevronUp className="size-3.5" />}
                        </button>
                      </SidebarTooltip>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Bottom controls — sidebar's own settings only; expand lives in
          the Q-logo (§SIDEBAR-V3), identity in the Header profile menu. */}
      <div className="border-t border-slate-700/50 py-3 flex flex-col items-center gap-2 shrink-0">
        <SidebarTooltip label={t('sidebar.menuSettings')}>
          {settingsMenu}
        </SidebarTooltip>
      </div>
    </div>
  );
}
