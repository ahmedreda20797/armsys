'use client';

// ══════════════════════════════════════════════════════════════
//  Sidebar — enterprise navigation surface (§SIDEBAR-V2)
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
//  §2  CUSTOMIZATION HAPPENS HERE: the ⋮ menu enters in-place EDIT
//      MODE — drag handles on the real items, [إلغاء]/[حفظ] finish.
//      ORDER ONLY (reconcileSidebarOrder — permissions always win).
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
  LayoutDashboard,
  Users,
  Fingerprint,
  Clock,
  FileText,
  Scale,
  Award,
  Banknote,
  Plane,
  BarChart3,
  Settings,
  Database,
  X,
  ChevronRight,
  ChevronLeft,
  ClipboardCheck,
  ShieldCheck,
  MessageSquareWarning,
  BookOpen,
  AlertTriangle,
  Monitor,
  Bell,
  Zap,
  Shield,
  Workflow,
  Eye,
  Tags,
  FilePlus2,
  Gauge,
  CalendarCog,
  Settings2,
  ScrollText,
  FileWarning,
  Network,
  FileBarChart,
  FileSearch,
  SlidersHorizontal,
  MoreVertical,
  RotateCcw,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Star,
  Pin as PinIcon,
  Save,
  Loader2,
} from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { useSidebarPages } from '@/hooks/use-sidebar-order';
import { useUnseenCounts, unseenCountOf, pendingCountOf } from '@/hooks/use-unseen';
import { SidebarActivityBadge } from '@/components/shared/SidebarActivityBadge';
import { useIsMobile, useIsDesktop } from '@/hooks/use-mobile';
import { SIDEBAR_GROUPS, APP_PAGES, localizedPageLabel, localizedGroupLabel } from '@/config/permissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { MenuCustomizationDialog } from '@/components/shared/MenuCustomizationDialog';
import { useAppStore, resolveInitialSidebarState } from '@/lib/store';
import { SidebarLogo } from '@/components/layout/SidebarLogo';
import {
  useUserPreferences,
  useSaveUserPreferences,
} from '@/hooks/use-user-preferences';
import {
  reconcileSidebarOrder,
  reconcileNavigationEntries,
  type FavoriteEntry,
  type NavigationDescriptor,
  type PinEntry,
} from '@/lib/personalization';
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
import { toast } from 'sonner';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/** §SIDEBAR-STATE — localStorage mirror for group expanded/collapsed
 *  state (Bitrix-style: navigation state survives reloads; loaded
 *  post-mount so SSR markup and client markup stay identical). */
const SIDEBAR_GROUPS_STORAGE_KEY = 'arm-erp:sidebar:collapsedGroups';

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Users,
  Fingerprint,
  Clock,
  FileText,
  Scale,
  Award,
  Banknote,
  Plane,
  BarChart3,
  Settings,
  Database,
  ClipboardCheck,
  ShieldCheck,
  MessageSquareWarning,
  BookOpen,
  AlertTriangle,
  Monitor,
  Bell,
  Zap,
  Shield,
  Workflow,
  Eye,
  Tags,
  FilePlus2,
  Gauge,
  CalendarCog,
  Settings2,
  ScrollText,
  FileWarning,
  Network,
  FileBarChart,
  FileSearch,
};

/** Page id → config (current-page ⭐/📌 descriptors in the ⋮ menu). */
const APP_PAGES_BY_ID = new Map(APP_PAGES.map((p) => [p.id, p]));

const WIDTH_COLLAPSED = 72;
const WIDTH_EXPANDED = 288;

// ══════════════════════════════════════════════════════════════
//  Fixed-position Tooltip — rendered in a portal so it NEVER
//  affects layout flow or causes any horizontal shift.
// ══════════════════════════════════════════════════════════════
function SidebarTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard: state must flip after SSR completes; there is no render-safe alternative for mount-only flags.
  useEffect(() => { setMounted(true); }, []);

  const handleMouseEnter = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.top + rect.height / 2,
      right: window.innerWidth - rect.left + 8,
    });
    setShow(true);
  }, []);

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
            right: pos.right,
            transform: 'translateY(-50%)',
            zIndex: 9999,
            pointerEvents: 'none',
          }}
          className="px-3 py-1.5 rounded-lg bg-slate-800/98 backdrop-blur-xl border border-slate-600/50 text-white text-xs whitespace-nowrap shadow-xl shadow-black/30"
          role="tooltip"
        >
          {label}
          {/* Arrow pointing right */}
          <div className="absolute top-1/2 -translate-y-1/2 -right-1.5 w-2.5 h-2.5 bg-slate-800/98 rotate-45 border-r border-t border-slate-600/50" />
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

/** Array move preserving all other indices (ORDER ONLY). */
function moveItem(list: string[], from: number, to: number): string[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
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
          const EntryIcon = ICON_MAP[APP_PAGES_BY_ID.get(entry.route)?.icon ?? ''];
          // §I18N-BILINGUAL — the stored label is a page-title snapshot;
          // the registry-localized label renders for the active locale.
          const entryLabel = localizedPageLabel(entry.route, locale);
          return (
            <li key={entry.id} className="group/item relative">
              <button
                type="button"
                onClick={() => onNavigate(entry)}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
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
                title="إزالة"
                className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/item:opacity-100 transition-opacity"
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
// ═══════════════════════════════════════════════════════════════
function QLogoToggle({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);

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
          <ChevronLeft className="h-5 w-5" />
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
          In RTL (sidebar on right), this is the LEFT edge (start).
          Points toward the rail (ChevronRight in RTL = "go back"). */}
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ opacity: hovered ? 1 : 0, x: hovered ? 0 : 4 }}
        transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
        className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full border border-slate-700/60 bg-slate-800 text-brand-300 shadow-md"
      >
        <ChevronRight className="h-3.5 w-3.5" />
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
  // Permission-filtered pages in the USER'S saved order (Milestone 10).
  // Permission resolution happens FIRST; the personal order only
  // reorders within the authorized set (never the other way round).
  const visiblePages = useSidebarPages();
  const isMobile = useIsMobile();
  // §SIDEBAR-TABLET — the pinned in-layout sidebar exists ONLY on
  // desktop (≥1024px, the `lg:` breakpoint). Below that (including the
  // 768–1023 tablet range that used to be a dead zone) the sidebar is
  // the overlay drawer, opened by the header hamburger.
  const isDesktop = useIsDesktop();

  const { data: preferences } = useUserPreferences();
  const savePrefs = useSaveUserPreferences();
  const { locale, t } = useLanguage();

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
  // Click toggles expanded ⇄ collapsed (pinned mode). The expanded
  // choice persists (user-scoped `sidebar.pinOpen` reuses the same
  // channel: true = expanded, false/undefined = collapsed rail).
  // Expanding from the rail/hover-preview always clears the temporary
  // hover overlay so exactly one surface owns the screen.
  const handleToggleExpand = useCallback(() => {
    const next = !useAppStore.getState().sidebarExpanded;
    clearHoverTimer();
    setSidebarHoverExpand(false);
    setSidebarExpanded(next);
    savePrefs.mutate({ sidebar: { pinOpen: next } }, {
      onError: () => toast.error('تعذر حفظ تفضيل القائمة'),
    });
  }, [clearHoverTimer, setSidebarHoverExpand, setSidebarExpanded, savePrefs]);

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

  // ── §2: in-sidebar EDIT MODE ──
  const defaultOrder = useMemo(() => visiblePages.map((p) => p.id), [visiblePages]);
  const [editOrder, setEditOrder] = useState<string[] | null>(null);
  // §21 — the full customization dialog (groups + cross-group DnD).
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const wasExpandedBeforeEditRef = useRef<boolean | null>(null);

  const enterEditMode = () => {
    wasExpandedBeforeEditRef.current = sidebarExpanded;
    clearHoverTimer();
    setSidebarHoverExpand(false);
    if (!sidebarExpanded) setSidebarExpanded(true); // editing needs the full surface
    setEditOrder([...defaultOrder]);
  };
  const exitEditMode = () => {
    setEditOrder(null);
    setDragIndex(null);
    setDropIndex(null);
    if (wasExpandedBeforeEditRef.current === false && sidebarExpanded) {
      setSidebarExpanded(false); // restore the rail
    }
    wasExpandedBeforeEditRef.current = null;
  };
  const saveEdit = async () => {
    if (!editOrder) return;
    try {
      await savePrefs.mutateAsync({ sidebar: { order: editOrder } });
      toast.success('تم حفظ ترتيب القائمة');
      exitEditMode();
    } catch {
      toast.error('تعذر حفظ ترتيب القائمة');
    }
  };
  const resetOrder = async () => {
    try {
      await savePrefs.mutateAsync({ sidebar: { order: defaultOrder } });
      toast.success('تمت إعادة القائمة للوضع الافتراضي');
      setEditOrder(null);
    } catch {
      toast.error('تعذر إعادة الترتيب الافتراضي');
    }
  };
  const editing = editOrder !== null;
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

  const handleDrop = () => {
    if (dragIndex === null || dropIndex === null || !editOrder) return;
    if (dragIndex !== dropIndex) {
      setEditOrder(moveItem(editOrder, dragIndex, dropIndex));
    }
    setDragIndex(null);
    setDropIndex(null);
  };

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

  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    SIDEBAR_GROUPS.forEach((g, i) => { initial[g.id] = i > 0; });
    return initial;
  });

  // §SIDEBAR-STATE — Bitrix-style persistence: the expanded/collapsed
  // state of each navigation group is a USER choice, not session
  // noise. It survives sidebar collapse/expand (the Sidebar stays
  // mounted, only the surface swaps) AND full reloads (localStorage
  // mirror loaded post-mount to avoid SSR hydration mismatch).
  // Presentation-only concern → localStorage, not the preferences API.
  const sidebarGroupsHydratedRef = useRef(false);
  useEffect(() => {
    if (sidebarGroupsHydratedRef.current) return;
    sidebarGroupsHydratedRef.current = true;
    let stored: Record<string, unknown> | null = null;
    try {
      const raw = window.localStorage.getItem(SIDEBAR_GROUPS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          stored = parsed as Record<string, unknown>;
        }
      }
    } catch { /* corrupted storage → keep defaults */ }
    if (!stored) return;
    const initial: Record<string, boolean> = {};
    SIDEBAR_GROUPS.forEach((g, i) => { initial[g.id] = i > 0; });
    for (const g of SIDEBAR_GROUPS) {
      const v = stored[g.id];
      if (typeof v === 'boolean') initial[g.id] = v;
    }
    setCollapsedGroups(initial);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_GROUPS_STORAGE_KEY, JSON.stringify(collapsedGroups));
    } catch { /* storage full/blocked → best-effort */ }
  }, [collapsedGroups]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  // ── §SIDEBAR-MIRROR — the group containing the CURRENT page is
  //  always shown open. One source of truth (collapsedGroups) drives
  //  BOTH surfaces: navigating to a page of a closed group re-opens
  //  that group. Explicit user collapse of that same group is still
  //  respected until the next navigation.
  const activeGroupId = useMemo(() => {
    const active = visiblePages.find((p) => p.id === currentPage);
    return active?.groupId ?? null;
  }, [visiblePages, currentPage]);
  useEffect(() => {
    if (!activeGroupId) return;
    // Route-driven group state sync — mirrors the file's canonical
    // hydration guard pattern (no render-safe alternative exists).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route-change sync of persisted group state.
    setCollapsedGroups((prev) => (prev[activeGroupId] ? { ...prev, [activeGroupId]: false } : prev));
  }, [activeGroupId]);

  // Groups that actually render (≥1 visible page) — shared by the
  // expanded nav and the collapsed rail (SAME structure, two sizes).
  // §21 — menu customization: saved GROUP order + cross-group item
  // overrides apply here (the single rendering path — no second
  // navigation architecture). Permissions already filtered
  // `visiblePages`; ordering can never resurrect a hidden page.
  const sidebarPrefs = preferences?.sidebar;
  const visibleGroups = useMemo(() => {
    const groupOf = (p: typeof visiblePages[number]) => {
      const override = sidebarPrefs?.itemGroups?.[p.id];
      return override && SIDEBAR_GROUPS.some((g) => g.id === override) ? override : p.groupId;
    };
    const groupRank = new Map<string, number>();
    (sidebarPrefs?.groupOrder ?? []).forEach((id, i) => { if (!groupRank.has(id)) groupRank.set(id, i); });
    return SIDEBAR_GROUPS
      .map((g) => ({ ...g, pages: visiblePages.filter((p) => groupOf(p) === g.id) }))
      .filter((g) => g.pages.length > 0)
      .sort((a, b) => {
        const ra = groupRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = groupRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
  }, [visiblePages, sidebarPrefs]);

  // ── Sidebar settings ⋮ menu (§2) — shared by expanded + collapsed ──
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
          onClick={() => setCustomizeOpen(true)}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <SlidersHorizontal className="size-3.5" />
          {t('sidebar.customize')}
        </DropdownMenuItem>
        {!isMobile && (
          <DropdownMenuItem
            // §13 DIRECT MANIPULATION — in-place edit mode: drag handles
            // on the REAL items with exact drop positioning (no dialog).
            onClick={enterEditMode}
            disabled={editing}
            className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
          >
            <GripVertical className="size-3.5" />
            ترتيب مباشر (سحب وإفلات)
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => void resetOrder()}
          disabled={savePrefs.isPending}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <RotateCcw className="size-3.5" />
          {t('sidebar.resetOrder')}
        </DropdownMenuItem>
        {pageDescriptor && (
          <>
            <DropdownMenuSeparator className="bg-slate-700/50" />
            <DropdownMenuLabel className="text-[10px] font-semibold text-slate-500 py-1.5">
              إدارة الصفحة الحالية
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
  // §CUSTOMIZATION-PARITY: iterates `visibleGroups` — the SAME
  // customized group order/membership the collapsed rail renders (the
  // old SIDEBAR_GROUPS iteration ignored groupOrder/itemGroups, so the
  // rail and the expanded surface disagreed after customization).
  const expandedNav = (
    <nav
      ref={expandedNavRefCb}
      onScroll={handleNavScroll}
      className="flex-1 overflow-y-auto py-3 px-3 arm-scroll"
      aria-label={t('sidebar.pagesNav')}
    >
      {visibleGroups.map((group, groupIdx) => {
        const groupPages = group.pages;
        if (groupPages.length === 0) return null;
        const isGroupCollapsed = collapsedGroups[group.id] ?? false;
        const isActiveGroup = activeGroupId === group.id;

        return (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIdx * 0.04 + 0.08, duration: 0.24, ease: [0.4, 0, 0.2, 1] }}
            className={cn(groupIdx > 0 && 'mt-2')}
          >
            <button
              onClick={() => toggleGroup(group.id)}
              aria-expanded={!isGroupCollapsed}
              className={cn(
                'w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group/header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              )}
            >
              <span className="text-xs leading-none shrink-0" aria-hidden="true">{group.emoji}</span>
              <span className={cn(
                'flex-1 text-right text-[10px] font-bold tracking-wide whitespace-nowrap transition-colors',
                isActiveGroup ? 'text-slate-300' : 'text-slate-500 group-hover/header:text-slate-400',
              )}>
                {localizedGroupLabel(group.id, locale)}
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
                  {groupPages.map((page, index) => {
                    const Icon = ICON_MAP[page.icon];
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
                          whileHover={{ x: -4 }}
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
                              title={`${pendingBadge} خصم جودة بانتظار الاعتماد`}
                            />
                          ) : (
                            /* §SIDEBAR-BADGES — new-items counter (per user). */
                            <SidebarActivityBadge
                              count={badgeCount}
                              tone="violet"
                              title={`${badgeCount} عنصر جديد لم تشاهده بعد`}
                            />
                          )}
                        </motion.button>
                      </motion.li>
                    );
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </nav>
  );

  // ── §2: EDIT MODE surface — flat, directly draggable list ──
  const editNav = (
    <div
      className="flex-1 overflow-y-auto py-3 px-3 arm-scroll space-y-1"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      aria-label="ترتيب الصفحات — وضع التحرير"
    >
      <p className="text-[10px] text-slate-500 px-2 pb-1 leading-relaxed">
        اسحب الصفوف (أو استخدم الأسهم) لإعادة الترتيب — الترتيب فقط؛ الصفحة تبقى دائماً داخل مجموعتها.
      </p>
      {(editOrder ?? []).map((pageId, index) => {
        const page = APP_PAGES_BY_ID.get(pageId);
        const groupLabel = SIDEBAR_GROUPS.find((g) => g.id === page?.groupId)?.label ?? '';
        const Icon = page ? ICON_MAP[page.icon] : undefined;
        const isDragging = dragIndex === index;
        const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;
        return (
          <div
            key={pageId}
            draggable
            onDragStart={(e) => {
              setDragIndex(index);
              e.dataTransfer.effectAllowed = 'move';
              try { e.dataTransfer.setData('text/plain', pageId); } catch { /* optional */ }
            }}
            onDragEnd={() => { setDragIndex(null); setDropIndex(null); }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              setDropIndex(index);
            }}
            onDrop={handleDrop}
            className={cn(
              'flex items-center gap-2 p-2 rounded-xl bg-slate-800/40 border transition-colors cursor-grab active:cursor-grabbing',
              isDragging ? 'border-brand-500/60 opacity-60' : isDropTarget ? 'border-brand-500/80 ring-1 ring-brand-500/60' : 'border-slate-700/30',
            )}
          >
            <GripVertical className="size-4 text-slate-600 shrink-0" aria-hidden="true" />
            <span className="text-[10px] text-slate-500 font-mono w-5 text-center shrink-0">{index + 1}</span>
            {Icon && <Icon className="size-4 text-slate-400 shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-200 truncate">{page?.title ?? pageId}</p>
              <p className="text-[9px] text-slate-500">{groupLabel}</p>
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setEditOrder(moveItem(editOrder ?? [], index, index - 1))}
                aria-label={`نقل ${page?.title ?? pageId} لأعلى`}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-30"
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                disabled={index === (editOrder ?? []).length - 1}
                onClick={() => setEditOrder(moveItem(editOrder ?? [], index, index + 1))}
                aria-label={`نقل ${page?.title ?? pageId} لأسفل`}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-30"
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  // ── §2: edit-mode footer — ONLY [إلغاء] [حفظ] ──
  const editFooter = (
    <div className="border-t border-slate-700/50 p-3 shrink-0 flex items-center gap-2">
      <button
        type="button"
        onClick={exitEditMode}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600/60 text-slate-300 hover:bg-slate-800 hover:text-white text-xs font-semibold transition-colors"
      >
        <X className="size-3.5" />
        إلغاء
      </button>
      <button
        type="button"
        onClick={() => void saveEdit()}
        disabled={savePrefs.isPending}
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors disabled:opacity-60"
      >
        {savePrefs.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        حفظ
      </button>
    </div>
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

      {/* §2: editing replaces the nav; §4/§5: favorites/pins live here */}
      {editing ? editNav : expandedNav}
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

      {editing ? editFooter : normalFooter}
      {/* a11y: surface is a navigation region; close control exists above */}
      <span className="sr-only">{showCloseButton ? t('sidebar.escHint') : ''}</span>
    </div>
  );

  // ── Non-desktop overlay (mobile AND the 768–1023 tablet range — the
  // §SIDEBAR-TABLET dead zone fix). Hidden entirely until the header's
  // menu button opens it as an overlay DRAWER above the page. ──
  if (!isDesktop) {
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
              className="flex fixed inset-y-0 right-0 z-50 w-72 shadow-2xl print:hidden"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              aria-label={t('sidebar.mainNav')}
            >
              {surface}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      {/* §21 — menu customization dialog (groups → items, DnD) */}
      <MenuCustomizationDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        groups={SIDEBAR_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
        pages={visiblePages.map((p) => ({ id: p.id, title: p.title, groupId: p.groupId }))}
        state={{
          order: sidebarPrefs?.order,
          groupOrder: sidebarPrefs?.groupOrder,
          itemGroups: sidebarPrefs?.itemGroups,
        }}
        saving={savePrefs.isPending}
        onSave={async (next) => {
          await savePrefs.mutateAsync({ sidebar: next });
        }}
      />
      </>
    );
  }

  // ── UNPINNED desktop: NO layout footprint. Hidden entirely until the
  // header's menu button opens it as an overlay DRAWER above the page
  // and header (z-50 backdrop / z-50 panel vs header z-30). ──
  if (!sidebarPinned) {
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
              className="flex fixed inset-y-0 right-0 z-50 w-[288px] shadow-2xl shadow-black/60 print:hidden"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              aria-label="التنقل الرئيسي"
            >
              {surface}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* §21 — menu customization dialog (groups → items, DnD) */}
      <MenuCustomizationDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        groups={SIDEBAR_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
        pages={visiblePages.map((p) => ({ id: p.id, title: p.title, groupId: p.groupId }))}
        state={{
          order: sidebarPrefs?.order,
          groupOrder: sidebarPrefs?.groupOrder,
          itemGroups: sidebarPrefs?.itemGroups,
        }}
        saving={savePrefs.isPending}
        onSave={async (next) => {
          await savePrefs.mutateAsync({ sidebar: next });
        }}
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
      aria-label="التنقل الرئيسي"
    >
      {expanded ? (
        surface
      ) : (
        <>
          <CollapsedRail
            currentPage={currentPage}
            onNavigate={onNavigate}
            onExpand={handleToggleExpand}
            visibleGroups={visibleGroups}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            settingsMenu={settingsMenu}
            navScrollRefCb={railNavRefCb}
            onNavScroll={handleNavScroll}
            unseenBadgeFor={unseenBadgeFor}
            pendingBadgeFor={pendingBadgeFor}
          />
          {/* The hover-expanded layer lives INSIDE the aside — the same
              navigation surface, simply unfolded over the content. */}
          <AnimatePresence>
            {hoverSurfaceActive && (
              <motion.div
                key="sidebar-hover-surface"
                className="absolute top-0 right-0 h-full w-[288px] shadow-2xl shadow-black/60 ring-1 ring-slate-700/50"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                aria-label="التنقل الرئيسي — معاينة موسعة"
              >
                {surface}
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </aside>

    {/* §21 — menu customization dialog (groups → items, DnD) */}
    <MenuCustomizationDialog
      open={customizeOpen}
      onOpenChange={setCustomizeOpen}
      groups={SIDEBAR_GROUPS.map((g) => ({ id: g.id, label: g.label }))}
      pages={visiblePages.map((p) => ({ id: p.id, title: p.title, groupId: p.groupId }))}
      state={{
        order: sidebarPrefs?.order,
        groupOrder: sidebarPrefs?.groupOrder,
        itemGroups: sidebarPrefs?.itemGroups,
      }}
      saving={savePrefs.isPending}
      onSave={async (next) => {
        await savePrefs.mutateAsync({ sidebar: next });
      }}
    />
    </>
  );
}

// ══════════════════════════════════════════════════════════════
//  Collapsed rail (§UNIFIED-RAIL) — the SAME navigation structure as
//  the expanded sidebar (group → pages), ICONS-ONLY:
//    • The group icon toggles the SAME open/closed state (one source
//      of truth: `collapsedGroups` — preserved across collapse).
//    • Pages of OPEN groups render beneath their group icon; tooltips
//      carry the labels. No counters, no flyouts.
//    • §6 NEUTRAL HIERARCHY: group containers are NEVER filled with
//      the active gradient — neutral icons, subtle hover, an accent
//      bar for the group containing the CURRENT page, and a tiny
//      state dot for open groups. Only the ACTIVE PAGE gets the
//      gradient fill.
// ══════════════════════════════════════════════════════════════

const GROUP_META: Record<string, { label: string; emoji: string; representativeIcon: keyof typeof ICON_MAP }> = {
  daily_ops:     { label: 'العمليات اليومية',  emoji: '📊', representativeIcon: 'LayoutDashboard' },
  employee_mgmt: { label: 'إدارة الموظفين',   emoji: '👥', representativeIcon: 'Users' },
  quality_ctrl:  { label: 'الجودة والرقابة',  emoji: '🎯', representativeIcon: 'Award' },
  hr:            { label: 'الموارد البشرية',   emoji: '🏢', representativeIcon: 'Banknote' },
  travel_ops:    { label: 'العمليات والسفر',  emoji: '✈️', representativeIcon: 'Plane' },
  reports:       { label: 'التقارير والتحليلات', emoji: '📈', representativeIcon: 'BarChart3' },
  settings:      { label: 'الإدارة والإعدادات', emoji: '⚙️', representativeIcon: 'Settings' },
};

interface RailGroup {
  id: string;
  label: string;
  emoji?: string;
  pages: { id: string; title: string; icon: string }[];
}

function CollapsedRail({
  currentPage,
  onNavigate,
  onExpand,
  visibleGroups,
  collapsedGroups,
  onToggleGroup,
  settingsMenu,
  navScrollRefCb,
  onNavScroll,
  unseenBadgeFor,
  pendingBadgeFor,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onExpand: () => void;
  visibleGroups: RailGroup[];
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  settingsMenu: React.ReactNode;
  /** §SIDEBAR-V3 — shared nav scroll continuity (restore on mount). */
  navScrollRefCb: (el: HTMLElement | null) => void;
  onNavScroll: (e: React.UIEvent<HTMLElement>) => void;
  unseenBadgeFor?: (pageId: string) => number;
  pendingBadgeFor?: (pageId: string) => number;
}) {
  const { locale, t } = useLanguage();
  // Determine which group the active page belongs to (for the active accent).
  const activeGroupId = useMemo(() => {
    const active = visibleGroups.find((g) => g.pages.some((p) => p.id === currentPage));
    return active?.id ?? null;
  }, [visibleGroups, currentPage]);

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

      {/* Navigation — group containers stay NEUTRAL (§6); only the
          group holding the CURRENT page gets the accent bar + a faint
          contextual surface, and only the current page gets the
          gradient. Open-group state = a tiny dot, never a fill. */}
      <nav
        ref={navScrollRefCb}
        onScroll={onNavScroll}
        className="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-1 px-2 arm-scroll"
        aria-label={t('sidebar.groupsNav')}
      >
        {visibleGroups.map((group) => {
          const meta = GROUP_META[group.id];
          const GroupIcon = ICON_MAP[meta?.representativeIcon ?? 'LayoutDashboard'] ?? LayoutDashboard;
          const isActive = activeGroupId === group.id;
          const isGroupOpen = !collapsedGroups[group.id];
          const groupLabel = localizedGroupLabel(group.id, locale);
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
                    'w-12 h-10 flex items-center justify-center rounded-lg transition-colors duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
                    isActive
                      ? 'bg-slate-800/90 text-white'
                      : 'text-slate-400 hover:bg-slate-800/60 hover:text-white',
                  )}
                >
                  <GroupIcon className="h-5 w-5 shrink-0" />
                  {isActive && (
                    <motion.span
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full bg-brand-400"
                      layoutId="collapsedIndicator"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  {/* §UNIFIED-RAIL — state dot: this group is currently
                      expanded (its page icons are visible beneath it). */}
                  {isGroupOpen && (
                    <span aria-hidden="true" className="absolute top-1 left-1 size-1.5 rounded-full bg-brand-300/80 ring-2 ring-slate-900" />
                  )}
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
                      {/* tree spine connecting the group icon to its pages */}
                      <span aria-hidden="true" className="absolute top-0 bottom-0 right-[27px] w-px bg-slate-700/50" />
                      {group.pages.map((page) => {
                        const PageIcon = ICON_MAP[page.icon];
                        const isCurrent = currentPage === page.id;
                        const unseenBadge = unseenBadgeFor?.(page.id) ?? 0;
                        const pendingBadge = pendingBadgeFor?.(page.id) ?? 0;
                        return (
                          <SidebarTooltip
                            key={page.id}
                            label={localizedPageLabel(page.id, locale) + (pendingBadge > 0
                              ? ` — ${pendingBadge} بانتظار الاعتماد`
                              : unseenBadge > 0 ? ` — ${unseenBadge} عنصر جديد` : '')}
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
                                  title={`${pendingBadge} بانتظار الاعتماد`}
                                />
                              )}
                              {/* §SIDEBAR-BADGES — tiny unread dot on the rail icon. */}
                              {pendingBadge === 0 && unseenBadge > 0 && !isCurrent && (
                                <SidebarActivityBadge
                                  count={unseenBadge}
                                  tone="violet"
                                  variant="dot"
                                  title={`${unseenBadge} عنصر جديد`}
                                />
                              )}
                              {isCurrent && (
                                <motion.span
                                  layoutId="collapsedPageIndicator"
                                  className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-l-full bg-brand-300"
                                />
                              )}
                            </button>
                          </SidebarTooltip>
                        );
                      })}
                    </div>
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
