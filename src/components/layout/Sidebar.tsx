'use client';

// ══════════════════════════════════════════════════════════════
//  Sidebar — enterprise navigation surface (UX Corrections §2-§5)
//
//  §2  CUSTOMIZATION HAPPENS HERE, not in a dialog: a ⋮ menu in the
//      sidebar enters an in-place EDIT MODE — drag handles appear on
//      the actual items, order changes live, [إلغاء]/[حفظ] finish.
//      ORDER ONLY: the flat saved order is re-filtered through each
//      page's registry group on render, so pages can never migrate
//      across structural boundaries and permissions always win
//      (reconcileSidebarOrder + useSidebarPages).
//
//  §3  COLLAPSE BY DEFAULT + HOVER: the sidebar renders collapsed;
//      hovering (desktop) temporarily expands it as an overlay; a
//      manual toggle PINS the chosen state, persisted through the
//      existing preferences record (sidebar.pinOpen — user-scoped).
//      Three separated states: pinned preference (store+prefs),
//      temporary hover (local), rendered result (derived).
//
//  §4/§5 Favorites ⭐ and Pins 📌 live INSIDE the sidebar as
//      dedicated workspace sections — never in the global Header.
//      Entries are the existing compact navigation descriptors,
//      reconciled against CURRENT visible pages before rendering,
//      navigated with the store's navigateTo + useRecordHighlight.
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
  LogOut,
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
import { useUnseenCounts, unseenCountOf } from '@/hooks/use-unseen';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { SIDEBAR_GROUPS, APP_PAGES } from '@/config/permissions';
import { useAppStore } from '@/lib/store';
import {
  useUserPreferences,
  useSaveUserPreferences,
} from '@/hooks/use-user-preferences';
import {
  reconcileSidebarOrder,
  reconcileNavigationEntries,
  navigationEntriesEqual,
  type FavoriteEntry,
  type NavigationDescriptor,
  type PinEntry,
} from '@/lib/personalization';
import {
  useFavoriteToggleAction,
  usePinToggleAction,
  useMarkState,
} from '@/components/shared/NavigationMarks';
import { UserAvatar } from '@/components/shared/UserAvatar';
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
  if (entries.length === 0) return null;
  return (
    <div className="px-1">
      <p className="px-2 py-1 text-[10px] font-bold text-slate-500 flex items-center gap-1.5">
        {icon}
        {title}
        <span className="text-slate-600 font-mono">({entries.length})</span>
      </p>
      <ul className="space-y-0.5">
        {entries.map((entry) => (
          <li key={entry.id} className="group/item relative">
            <button
              type="button"
              onClick={() => onNavigate(entry)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
              title={entry.label}
            >
              <span className="shrink-0">{icon}</span>
              <span className="truncate flex-1 min-w-0">{entry.label}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(entry)}
              aria-label={`إزالة ${entry.label}`}
              title="إزالة"
              className="absolute left-1 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover/item:opacity-100 transition-opacity"
            >
              <X className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
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
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  currentPage,
  onNavigate,
  isOpen,
  onToggle,
  isCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  // Permission-filtered pages in the USER'S saved order (Milestone 10).
  // Permission resolution happens FIRST; the personal order only
  // reorders within the authorized set (never the other way round).
  const visiblePages = useSidebarPages();
  const { user, logout } = useAuth();
  const isMobile = useIsMobile();
  const { user: _authUser } = useAuth();
  void _authUser;

  const { data: preferences } = useUserPreferences();
  const savePrefs = useSaveUserPreferences();
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  // ── §SIDEBAR-BADGES — per-user unseen counters ──
  // ONE shared react-query for the whole sidebar: new records added by
  // OTHER users since THIS user last opened the page. The active page
  // is never badged (opening it marks it seen via the PageRouter).
  const { data: unseen } = useUnseenCounts();
  const unseenBadgeFor = useCallback(
    (pageId: string) => {
      if (pageId === currentPage) return 0;
      return unseenCountOf(unseen?.counts, pageId);
    },
    [unseen, currentPage],
  );

  // ── §3: apply the user's PINNED preference once per session ──
  const appliedPrefRef = useRef(false);
  useEffect(() => {
    if (appliedPrefRef.current) return;
    const pinOpen = preferences?.sidebar?.pinOpen;
    if (pinOpen === undefined) return; // keep the system default (collapsed)
    appliedPrefRef.current = true;
    setSidebarCollapsed(!pinOpen);
  }, [preferences, setSidebarCollapsed]);

  // ── §3: temporary hover state (desktop, only when pinned closed) ──
  const [hovering, setHovering] = useState(false);

  // ── §1: OVERFLOW-MENU FIX (root cause) ──
  // The ⋮ menu content renders in a RADIX PORTAL on document.body —
  // OUTSIDE this sidebar's DOM subtree. Moving the pointer from the
  // trigger towards the menu therefore fires onMouseLeave on the
  // sidebar root; previously that flipped `hovering` and swapped the
  // rendered surface (rail ⇄ full), unmounting the trigger and
  // killing the open menu. Fix: while the ⋮ menu is open we FREEZE
  // whichever surface it was opened from — hover changes are ignored
  // and mouse-leave cannot collapse the sidebar mid-interaction.
  // (State declared here; the callback wiring lives below, after
  // `editing` is computed.)
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOpenSurface, setMenuOpenSurface] = useState(false);

  // ── §2: in-sidebar EDIT MODE ──
  const defaultOrder = useMemo(() => visiblePages.map((p) => p.id), [visiblePages]);
  const [editOrder, setEditOrder] = useState<string[] | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const wasCollapsedBeforeEditRef = useRef<boolean | null>(null);

  const enterEditMode = () => {
    wasCollapsedBeforeEditRef.current = isCollapsed;
    if (isCollapsed) setSidebarCollapsed(false); // editing needs the full surface
    setEditOrder([...defaultOrder]);
  };
  const exitEditMode = () => {
    setEditOrder(null);
    setDragIndex(null);
    setDropIndex(null);
    if (wasCollapsedBeforeEditRef.current && !isCollapsed) {
      setSidebarCollapsed(true); // restore the pinned state
    }
    wasCollapsedBeforeEditRef.current = null;
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
    if (open) setMenuOpenSurface(editing || !isCollapsed || hovering);
  }, [editing, isCollapsed, hovering]);
  // While editing, the surface must stay expanded (hover cannot collapse it).
  const expanded = isMobile
    ? false
    : menuOpen
      ? menuOpenSurface
      : editing || !isCollapsed || hovering;

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

  const userName = user?.name || '';
  const userRank = user?.rank || '';

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
  //  that group, so the collapsed rail mirror always shows where the
  //  user is (Bitrix-style active-section behavior). Explicit user
  //  collapse of that same group is still respected until the next
  //  navigation (the effect only runs on activeGroupId change).
  const activeGroupId = useMemo(() => {
    const active = visiblePages.find((p) => p.id === currentPage);
    return active?.groupId ?? null;
  }, [visiblePages, currentPage]);
  useEffect(() => {
    if (!activeGroupId) return;
    // Route-driven group state sync: navigating to a page of a closed
    // group re-opens that group so the collapsed rail mirror always
    // shows where the user is. Same canonical post-mount-sync pattern
    // as the hydration guard below — there is no render-safe
    // alternative that doesn't read other state during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- route-change sync of persisted group state; mirrors the file's canonical hydration guard pattern.
    setCollapsedGroups((prev) => (prev[activeGroupId] ? { ...prev, [activeGroupId]: false } : prev));
  }, [activeGroupId]);

  // Groups that actually render (≥1 visible page) — shared by the
  // expanded nav and the collapsed rail (SAME structure, two sizes).
  const visibleGroups = useMemo(() => {
    return SIDEBAR_GROUPS
      .map((g) => ({ ...g, pages: visiblePages.filter((p) => p.groupId === g.id) }))
      .filter((g) => g.pages.length > 0);
  }, [visiblePages]);

  // ── Sidebar settings ⋮ menu (§2) — shared by expanded + collapsed ──
  // §1: onOpenChange drives the surface-freeze so the menu survives
  // pointer travel into its portal; §1 also owns logout here — it is
  // NOT a standalone button consuming rail/footer space.
  const settingsMenu = (
    <DropdownMenu onOpenChange={handleMenuOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="إعدادات القائمة"
          aria-haspopup="menu"
          title="إعدادات القائمة"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
        >
          <MoreVertical className="size-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={6} className="bg-slate-900 border-slate-700/60 min-w-52 z-50">
        <DropdownMenuItem
          onClick={() => enterEditMode()}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <SlidersHorizontal className="size-3.5" />
          تخصيص القائمة
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void resetOrder()}
          disabled={savePrefs.isPending}
          className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
        >
          <RotateCcw className="size-3.5" />
          إعادة للوضع الافتراضي
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
              {pageMarkState.favoriteActive ? 'إزالة الصفحة من المفضلة' : 'إضافة للمفضلة ⭐'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => void togglePin(pageDescriptor)}
              className="gap-2 cursor-pointer text-xs text-slate-300 focus:text-white focus:bg-slate-800"
            >
              <PinIcon className={cn('size-3.5', pageMarkState.pinActive && 'text-cyan-400 fill-cyan-400')} />
              {pageMarkState.pinActive ? 'إزالة تثبيت الصفحة' : 'تثبيت 📌'}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator className="bg-slate-700/50" />
        <DropdownMenuItem
          onClick={() => { handleMenuOpenChange(false); logout(); }}
          className="gap-2 cursor-pointer text-xs text-red-400 focus:text-red-300 focus:bg-red-500/10"
        >
          <LogOut className="size-3.5" />
          تسجيل الخروج 🚪
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // ── Nav content (expanded, normal mode) ──
  const expandedNav = (
    <nav className="flex-1 overflow-y-auto py-3 px-3 arm-scroll">
      {SIDEBAR_GROUPS.map((group, groupIdx) => {
        const groupPages = visiblePages.filter((p) => p.groupId === group.id);
        if (groupPages.length === 0) return null;
        const isGroupCollapsed = collapsedGroups[group.id] ?? false;

        return (
          <motion.div
            key={group.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: groupIdx * 0.06 + 0.15, duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={cn(groupIdx > 0 && 'mt-2')}
          >
            <button
              onClick={() => toggleGroup(group.id)}
              className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800/50 transition-colors group/header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            >
              <span className="text-xs leading-none shrink-0">{group.emoji}</span>
              <span className="flex-1 text-right text-[10px] font-bold tracking-wide text-slate-500 group-hover/header:text-slate-400 whitespace-nowrap transition-colors">
                {group.label}
              </span>
              <motion.span animate={{ rotate: isGroupCollapsed ? 0 : 180 }} transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }} className="flex items-center justify-center w-5 h-5 rounded-md bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-500/20 shrink-0">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-violet-400">
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
                    return (
                      <motion.li
                        key={page.id}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.03 + 0.05, duration: 0.18 }}
                      >
                        <motion.button
                          onClick={() => onNavigate(page.id)}
                          whileHover={{ x: -4 }}
                          transition={{ duration: 0.12 }}
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
                            isActive
                              ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20'
                              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                          )}
                        >
                          {Icon && (
                            <Icon className={cn('h-5 w-5 shrink-0', isActive && 'scale-110')} />
                          )}
                          <span className="truncate">{page.title}</span>
                          {/* §SIDEBAR-BADGES — new-items counter (per user). */}
                          {unseenBadge > 0 && (
                            <span
                              className="mr-auto shrink-0 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-violet-500/25 border border-violet-300/40 text-violet-100 text-[10px] font-bold tabular-nums"
                              title={`${unseenBadge} عنصر جديد لم تشاهده بعد`}
                              aria-label={`${unseenBadge} عنصر جديد`}
                            >
                              {unseenBadge > 99 ? '+99' : unseenBadge}
                            </span>
                          )}
                          {isActive && (
                            <motion.div
                              className="mr-auto w-1.5 h-1.5 rounded-full bg-violet-300"
                              layoutId="activeIndicator"
                              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
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
              isDragging ? 'border-violet-500/60 opacity-60' : isDropTarget ? 'border-violet-500/80 ring-1 ring-violet-500/60' : 'border-slate-700/30',
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
        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold transition-colors disabled:opacity-60"
      >
        {savePrefs.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
        حفظ
      </button>
    </div>
  );

  // ── Normal-mode footer: user + ⋮ settings (logout lives INSIDE the ⋮ menu — §1) ──
  const normalFooter = (
    <div className="border-t border-slate-700/50 p-3 shrink-0">
      <div className="flex items-center gap-2.5">
        {/* §AVATAR-UNIFICATION — the ONE shared identity surface,
            identical to the Header and the collapsed rail. */}
        <UserAvatar name={userName} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white truncate">{userName}</p>
          <span className="inline-block mt-0.5 px-1.5 py-0 text-[9px] font-medium rounded-full bg-violet-600/20 text-violet-400 border border-violet-600/30">
            {userRank}
          </span>
        </div>
        {settingsMenu}
      </div>
    </div>
  );

  const sidebarContent = (
    <div className="flex flex-col h-full bg-slate-900 text-white">
      {/* Logo */}
      <div className="relative flex items-center justify-center h-20 px-4 border-b border-slate-700/50 shrink-0">
        {isMobile && (
          <button
            onClick={onToggle}
            className="absolute top-4 left-4 p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            aria-label="إغلاق القائمة"
          >
            <X className="h-5 w-5" />
          </button>
        )}
        <motion.img
          src="/logo-full-clean.png"
          alt="ARM Logo"
          className="h-16 w-auto object-contain drop-shadow-[0_0_15px_rgba(99,102,241,0.15)]"
          animate={{ y: [0, -5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className="absolute top-4 left-4 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
            aria-label={isCollapsed ? 'تثبيت القائمة مفتوحة' : 'تصغير القائمة'}
            title={isCollapsed ? 'تثبيت القائمة مفتوحة 📌' : 'تصغير القائمة'}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* §2: editing replaces the nav; §4/§5: favorites/pins live here */}
      {editing ? editNav : expandedNav}
      {!editing && (
        <div className="px-2 pb-2 space-y-2 border-t border-slate-800/60 pt-2 overflow-y-auto arm-scroll max-h-56 shrink-0">
          <WorkspaceSection
            title="المثبتة"
            icon={<PinIcon className="size-3 text-cyan-400" />}
            entries={pins}
            onNavigate={navigateEntry}
            onRemove={(entry) => void removePin(entry)}
          />
          <WorkspaceSection
            title="المفضلة"
            icon={<Star className="size-3 text-amber-400" />}
            entries={favorites}
            onNavigate={navigateEntry}
            onRemove={(entry) => void removeFavorite(entry)}
          />
        </div>
      )}

      {editing ? editFooter : normalFooter}
    </div>
  );

  // ── Mobile overlay (unchanged pattern) ──
  if (isMobile) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onToggle}
            />
            <motion.aside
              className="fixed inset-y-0 right-0 z-50 w-72 shadow-2xl"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              {sidebarContent}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  // ── Desktop: ONE animated surface (§3) — width transitions between
  // collapsed rail and full sidebar; hover temporarily expands as an
  // overlay (content margin unchanged), pin state pushes content.
  // The collapsed rail mirrors the SAME structure as the expanded
  // sidebar (group → its open pages) with ICONS ONLY — no secondary
  // floating panel, nothing covering the page content. ──
  return (
    <div
        className={cn(
          'hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:right-0 z-20 bg-slate-900 text-white overflow-hidden shadow-xl',
          // Hover-expanded overlay floats ABOVE content — stronger shadow + lift.
          // §1: uses the FROZEN surface while the ⋮ menu is open so the
          // overlay styling doesn't flicker when the pointer enters the menu.
          (menuOpen ? menuOpenSurface : hovering) && !editing && isCollapsed && 'z-30 shadow-2xl shadow-black/60 ring-1 ring-slate-700/50',
        )}
        style={{
          width: expanded ? WIDTH_EXPANDED : WIDTH_COLLAPSED,
          transition: 'width 0.28s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.28s ease',
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        aria-label="التنقل الرئيسي"
      >
        {expanded ? (
          sidebarContent
        ) : (
          <CollapsedRail
            currentPage={currentPage}
            onNavigate={onNavigate}
            onToggleCollapse={onToggleCollapse}
            visibleGroups={visibleGroups}
            collapsedGroups={collapsedGroups}
            onToggleGroup={toggleGroup}
            userName={userName}
            settingsMenu={settingsMenu}
            unseenBadgeFor={unseenBadgeFor}
          />
        )}
      </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Collapsed rail (PHASE 8, §UNIFIED-RAIL revision) — the SAME
//  navigation structure as the expanded sidebar (group → pages),
//  rendered ICONS-ONLY inside the narrow rail itself:
//    • The group icon toggles the SAME open/closed state the
//      expanded sidebar uses (one source of truth: `collapsedGroups`).
//    • The pages of OPEN groups render directly BENEATH their group
//      icon as compact icon buttons (tooltip carries the label).
//      NO secondary floating panel — nothing ever covers the page.
//    • The group containing the CURRENT page is always shown open
//      (route-driven sync at the parent) and the current page icon
//      carries the active gradient + indicator.
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
  onToggleCollapse,
  visibleGroups,
  collapsedGroups,
  onToggleGroup,
  userName,
  settingsMenu,
  unseenBadgeFor,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  onToggleCollapse: () => void;
  visibleGroups: RailGroup[];
  collapsedGroups: Record<string, boolean>;
  onToggleGroup: (groupId: string) => void;
  userName: string;
  settingsMenu: React.ReactNode;
  unseenBadgeFor?: (pageId: string) => number;
}) {
  // Determine which group the active page belongs to (for the active accent).
  const activeGroupId = useMemo(() => {
    const active = visibleGroups.find((g) => g.pages.some((p) => p.id === currentPage));
    return active?.id ?? null;
  }, [visibleGroups, currentPage]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900">
      {/* Logo */}
      <div className="flex items-center justify-center h-20 border-b border-slate-700/50 shrink-0">
        <motion.img
          src="/logo-full-clean.png"
          alt="ARM Logo"
          className="h-10 w-auto object-contain"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {/* Navigation — SAME structure as the expanded sidebar (group
          → its pages) in ICONS-ONLY form: the group icon toggles the
          SAME open/closed state as the expanded sidebar's chevron,
          and the pages of every OPEN group render right below it as
          compact icon buttons. The group containing the CURRENT page
          is always shown open (route-driven sync at the parent). */}
      <nav
        className="flex-1 overflow-y-auto py-3 flex flex-col items-center gap-1 px-2 arm-scroll"
        aria-label="مجموعات التنقل"
      >
        {visibleGroups.map((group) => {
          const meta = GROUP_META[group.id];
          const GroupIcon = ICON_MAP[meta?.representativeIcon ?? 'LayoutDashboard'] ?? LayoutDashboard;
          const isActive = activeGroupId === group.id;
          const isGroupOpen = !collapsedGroups[group.id];
          const groupLabel = meta?.label ?? group.label;
          return (
            <div key={group.id} className="w-full flex flex-col items-center gap-0.5">
              <SidebarTooltip label={groupLabel}>
                <motion.button
                  onClick={() => onToggleGroup(group.id)}
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.95 }}
                  aria-label={groupLabel}
                  aria-expanded={isGroupOpen}
                  className={cn(
                    'w-12 h-10 flex items-center justify-center rounded-lg transition-colors duration-150 relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50',
                    isActive || isGroupOpen
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-500/20'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white',
                  )}
                >
                  <GroupIcon className="h-5 w-5 shrink-0" />
                  {isActive && (
                    <motion.div
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-l-full bg-violet-400"
                      layoutId="collapsedIndicator"
                      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    />
                  )}
                  {/* §UNIFIED-RAIL — state dot: this group is currently
                      expanded (its page icons are visible beneath it). */}
                  {isGroupOpen && !isActive && (
                    <span aria-hidden="true" className="absolute top-1 left-1 size-1.5 rounded-full bg-violet-300 ring-2 ring-slate-900" />
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
                        return (
                          <SidebarTooltip key={page.id} label={page.title + (unseenBadge > 0 ? ` — ${unseenBadge} عنصر جديد` : '')}>
                            <button
                              type="button"
                              onClick={() => onNavigate(page.id)}
                              aria-current={isCurrent ? 'page' : undefined}
                              aria-label={page.title}
                              className={cn(
                                'relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50',
                                isCurrent
                                  ? 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/25'
                                  : 'text-slate-400 bg-slate-900 hover:bg-slate-800 hover:text-white',
                              )}
                            >
                              {PageIcon && <PageIcon className="size-4 shrink-0" />}
                              {/* §SIDEBAR-BADGES — tiny unread dot on the rail icon. */}
                              {unseenBadge > 0 && !isCurrent && (
                                <span
                                  aria-hidden="true"
                                  className="absolute top-1 left-1 size-2 rounded-full bg-violet-400 ring-2 ring-slate-900"
                                />
                              )}
                              {isCurrent && (
                                <motion.span
                                  layoutId="collapsedPageIndicator"
                                  className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-l-full bg-violet-300"
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

      {/* Bottom controls — logout lives inside the ⋮ menu (§1) */}
      <div className="border-t border-slate-700/50 py-3 flex flex-col items-center gap-2 shrink-0">
        <SidebarTooltip label={userName}>
          {/* §AVATAR-UNIFICATION — same shared identity surface as the
              Header and the expanded sidebar footer (photo-ready). */}
          <UserAvatar name={userName} className="size-10 text-sm cursor-default" />
        </SidebarTooltip>
        <SidebarTooltip label="إعدادات القائمة">
          {settingsMenu}
        </SidebarTooltip>
        <SidebarTooltip label="تثبيت القائمة مفتوحة 📌">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={onToggleCollapse}
            aria-label="تثبيت القائمة مفتوحة"
            className="w-10 h-10 rounded-lg text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
          >
            <ChevronLeft className="h-4 w-4" />
          </motion.button>
        </SidebarTooltip>
      </div>
    </div>
  );
}
