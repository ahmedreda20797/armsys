'use client';

// ══════════════════════════════════════════════════════════════
//  SidebarEditNav — the customization surface of the Personalizable
//  Navigation Workspace (§SIDEBAR-WORKSPACE edit mode).
//
//  Entering edit mode produces a LOCAL DRAFT of the user's layout:
//  every mutation below (reorder, cross-group move, create/rename/
//  delete group, reset) touches the draft only. Nothing persists
//  until the user commits Done — the sidebar then validates, writes
//  once, and only reports success after the server confirms.
//
//  DRAG & DROP — real pointer-based dragging (no HTML5 dnd, no
//  timers): pointer capture on the drag handle, per-move hit-testing
//  against measured rects, and React state changes ONLY when the
//  insertion slot actually changes. The floating preview is a portal
//  element moved by direct style writes (zero re-renders per move).
//  Feedback is deliberately quiet: a thin Qnalys insertion line for
//  items, a group-level line for reordering groups, and a faint
//  ambient accent on the group under the pointer — never heavy
//  borders or glowing containers.
//
//  AUTHORIZATION IS NOT THIS LAYER'S CONCERN: the item universe is
//  the permission-filtered visible pages passed by the Sidebar; the
//  draft can only ever arrange that set.
//
//  KEYBOARD: every handle is focusable; Alt+↑/↓ moves items (across
//  group boundaries included) and reorders groups; group menus offer
//  rename/delete/move. An aria-live region announces changes.
// ══════════════════════════════════════════════════════════════

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { createId } from '@paralleldrive/cuid2';
import { motion, MotionConfig } from 'framer-motion';
import {
  Folder,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import { localizedPageLabel, type PageConfig } from '@/config/permissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';
import { SIDEBAR_ICON_MAP } from '@/components/layout/sidebar-icons';
import { SidebarGroupFrame } from '@/components/layout/SidebarGroupFrame';
import { OverflowMenu } from '@/components/shared/OverflowMenu';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  addSidebarGroup,
  createDefaultLayout,
  deleteSidebarGroup,
  insertionIndexForPointerY,
  MAIN_GROUP_ID,
  moveSidebarGroup,
  moveSidebarItem,
  renameSidebarGroup,
  sidebarGroupLabel,
  validateGroupName,
  type GroupNameProblem,
  type SidebarLayout,
} from '@/lib/personalization/sidebar-layout';

/** Pointer travel (px) before a press becomes a drag — clicks and
 *  tremor never start one. */
const DRAG_ACTIVATION_PX = 4;
/** Edge zone (px) that nudges the nav to scroll while dragging. */
const EDGE_SCROLL_PX = 28;
const EDGE_SCROLL_SPEED = 8;

interface SidebarEditNavProps {
  initialLayout: SidebarLayout;
  visiblePages: PageConfig[];
  saving: boolean;
  /** Commit the draft — awaited; a rejection keeps editing (draft preserved). */
  onDone: (layout: SidebarLayout) => Promise<void>;
  onCancel: () => void;
}

// ── drag-session types (refs — not render state) ──
interface DragSession {
  kind: 'item' | 'group';
  id: string;
  groupId: string | null;
  label: string;
  pointerId: number;
  startX: number;
  startY: number;
  grabDX: number;
  grabDY: number;
  width: number;
  activated: boolean;
}
interface GroupGeom {
  id: string;
  rect: DOMRect;
  itemsRect: DOMRect;
  items: Array<{ id: string; rect: DOMRect }>;
}
interface ItemTarget {
  groupId: string;
  index: number;
  offsetY: number;
}

export function SidebarEditNav({ initialLayout, visiblePages, saving, onDone, onCancel }: SidebarEditNavProps) {
  const { t, locale } = useLanguage();

  const [draft, setDraft] = useState<SidebarLayout>(() => initialLayout);
  const [nameDialog, setNameDialog] = useState<{ mode: 'create' } | { mode: 'rename'; groupId: string; name: string } | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [announce, setAnnounce] = useState<{ id: number; msg: string } | null>(null);
  const announceSeq = useRef(0);

  const say = useCallback((msg: string) => {
    announceSeq.current += 1;
    setAnnounce({ id: announceSeq.current, msg });
  }, []);

  const applyDraft = useCallback((fn: (d: SidebarLayout) => SidebarLayout | null) => {
    setDraft((prev) => fn(prev) ?? prev);
  }, []);

  // ── item metadata (registry-owned: labels, icons) ──
  const pageById = useMemo(() => new Map(visiblePages.map((p) => [p.id, p])), [visiblePages]);

  // ── drag state ──
  const dragRef = useRef<DragSession | null>(null);
  const [ghost, setGhost] = useState<{ kind: 'item' | 'group'; id: string; label: string; icon: React.ReactNode; width: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const lastPointer = useRef({ x: 0, y: 0 });
  const [itemTarget, setItemTarget] = useState<ItemTarget | null>(null);
  const itemTargetKey = useRef<string>('');
  const [groupTarget, setGroupTarget] = useState<{ index: number; offsetY: number } | null>(null);
  const groupTargetKey = useRef<string>('');
  const navRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback((): { contentRect: DOMRect; groups: GroupGeom[] } => {
    const content = contentRef.current;
    const contentRect = content?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0);
    const groups: GroupGeom[] = [];
    content?.querySelectorAll<HTMLElement>('[data-sb-group]').forEach((gEl) => {
      const id = gEl.getAttribute('data-sb-group') ?? '';
      const itemsEl = gEl.querySelector<HTMLElement>('[data-sb-items]');
      const items: GroupGeom['items'] = [];
      itemsEl?.querySelectorAll<HTMLElement>('[data-sb-item]').forEach((el) => {
        items.push({ id: el.getAttribute('data-sb-item-id') ?? '', rect: el.getBoundingClientRect() });
      });
      groups.push({ id, rect: gEl.getBoundingClientRect(), itemsRect: itemsEl?.getBoundingClientRect() ?? gEl.getBoundingClientRect(), items });
    });
    return { contentRect, groups };
  }, []);

  const setItemTargetIfChanged = useCallback((next: ItemTarget | null) => {
    const key = next ? `${next.groupId}:${next.index}` : '';
    if (key === itemTargetKey.current) return;
    itemTargetKey.current = key;
    setItemTarget(next);
  }, []);

  const setGroupTargetIfChanged = useCallback((next: { index: number; offsetY: number } | null) => {
    const key = next ? `${next.index}` : '';
    if (key === groupTargetKey.current) return;
    groupTargetKey.current = key;
    setGroupTarget(next);
  }, []);

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    itemTargetKey.current = '';
    groupTargetKey.current = '';
    setItemTarget(null);
    setGroupTarget(null);
    setGhost(null);
  }, []);

  // Escape abandons the drag in flight — the item returns to origin.
  useEffect(() => {
    if (!ghost) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancelDrag();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ghost, cancelDrag]);

  const onHandlePointerDown = useCallback((session: DragSession) => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // grabDX/grabDY arrive precomputed (pointer minus the SOURCE row's
    // top-start corner) so the ghost tracks the exact grab point.
    dragRef.current = { ...session, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, activated: false };
    lastPointer.current = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture unsupported → move events still reach the handle while pressed */ }
  }, []);

  const positionGhost = useCallback((x: number, y: number) => {
    const d = dragRef.current;
    if (!d || !ghostRef.current) return;
    ghostRef.current.style.transform = `translate(${x - d.grabDX}px, ${y - d.grabDY}px)`;
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    if (!d.activated) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_ACTIVATION_PX) return;
      d.activated = true;
      setGhost({
        kind: d.kind,
        id: d.id,
        label: d.label,
        icon: <GripVertical className="size-3.5 text-brand-300" aria-hidden="true" />,
        width: d.width,
      });
    }

    positionGhost(e.clientX, e.clientY);

    // ── hit-testing (read-only; state flips only when the slot changes) ──
    const { contentRect, groups } = measure();
    if (d.kind === 'item') {
      // The group under the pointer (rects nudged 3px so adjacent-group
      // travel never flickers across the gap).
      const hovered = groups.find((g) =>
        e.clientY >= g.rect.top - 3 && e.clientY <= g.rect.bottom + 3 &&
        e.clientX >= g.rect.left && e.clientX <= g.rect.right);
      if (!hovered) { setItemTargetIfChanged(null); return; }
      const centers = hovered.items.map((it) => it.rect.top + it.rect.height / 2);
      const index = insertionIndexForPointerY(e.clientY, centers);
      // Empty group: no insertion line — the hint brightens instead.
      let offsetY = -1;
      if (hovered.items.length > 0) {
        offsetY = index < hovered.items.length
          ? hovered.items[index]!.rect.top - hovered.itemsRect.top
          : hovered.items[hovered.items.length - 1]!.rect.bottom - hovered.itemsRect.top;
      }
      setItemTargetIfChanged({ groupId: hovered.id, index, offsetY });
    } else {
      const centers = groups.map((g) => g.rect.top + g.rect.height / 2);
      const index = insertionIndexForPointerY(e.clientY, centers);
      const offsetY = index < groups.length
        ? groups[index]!.rect.top - contentRect.top - 3
        : (groups[groups.length - 1]?.rect.bottom ?? contentRect.bottom) - contentRect.top + 1;
      setGroupTargetIfChanged({ index, offsetY });
      setItemTargetIfChanged(null);
    }

    // Edge nudge — scrolls only while the pointer actually moves.
    const nav = navRef.current;
    if (nav) {
      const navRect = nav.getBoundingClientRect();
      if (e.clientY < navRect.top + EDGE_SCROLL_PX) nav.scrollTop -= EDGE_SCROLL_SPEED;
      else if (e.clientY > navRect.bottom - EDGE_SCROLL_PX) nav.scrollTop += EDGE_SCROLL_SPEED;
    }
  }, [measure, positionGhost, setGroupTargetIfChanged, setItemTargetIfChanged]);

  const onHandlePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    if (!d.activated) { dragRef.current = null; return; }

    if (d.kind === 'item' && itemTargetKey.current) {
      const target = itemTarget;
      if (target) {
        applyDraft((prev) => moveSidebarItem(prev, d.id, target.groupId, target.index));
        say(t('sidebar.announceItemMoved'));
      }
    } else if (d.kind === 'group' && groupTargetKey.current) {
      const target = groupTarget;
      if (target) {
        applyDraft((prev) => moveSidebarGroup(prev, d.id, target.index));
        say(t('sidebar.announceGroupMoved'));
      }
    }
    cancelDrag();
  }, [applyDraft, cancelDrag, groupTarget, itemTarget, say, t]);

  // Ghost mounts at the pointer (subsequent moves write style directly).
  useLayoutEffect(() => {
    if (ghost) positionGhost(lastPointer.current.x, lastPointer.current.y);
  }, [ghost, positionGhost]);

  // ── keyboard reordering (Alt+↑/↓ on any handle) ──
  const flattenedItems = useMemo(() => {
    const flat: Array<{ groupId: string; itemId: string; index: number }> = [];
    for (const g of draft.groups) {
      g.items.forEach((it, index) => flat.push({ groupId: g.id, itemId: it.id, index }));
    }
    return flat;
  }, [draft]);

  const moveItemKeyboard = useCallback((itemId: string, dir: -1 | 1) => {
    const pos = flattenedItems.findIndex((f) => f.itemId === itemId);
    if (pos < 0) return;
    const to = pos + dir;
    if (to < 0 || to >= flattenedItems.length) return;
    const current = flattenedItems[pos]!;
    const neighbor = flattenedItems[to]!;
    applyDraft((prev) => moveSidebarItem(
      prev,
      itemId,
      neighbor.groupId,
      dir === -1
        ? neighbor.index // before the neighbor (possibly another group)
        : neighbor.groupId === current.groupId ? neighbor.index + 1 : 0, // after it
    ));
    say(t('sidebar.announceItemMoved'));
  }, [applyDraft, flattenedItems, say, t]);

  const moveGroupKeyboard = useCallback((groupId: string, dir: -1 | 1) => {
    applyDraft((prev) => {
      const idx = prev.groups.findIndex((g) => g.id === groupId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.groups.length) return prev;
      return moveSidebarGroup(prev, groupId, to);
    });
    say(t('sidebar.announceGroupMoved'));
  }, [applyDraft, say, t]);

  // ── group dialogs ──
  const submitGroupName = (rawName: string) => {
    if (!nameDialog) return;
    if (nameDialog.mode === 'create') {
      applyDraft((prev) => {
        const next = addSidebarGroup(prev, rawName, createId);
        if (next) say(t('sidebar.announceGroupCreated'));
        return next;
      });
    } else {
      applyDraft((prev) => {
        const next = renameSidebarGroup(prev, nameDialog.groupId, rawName);
        if (next) say(t('sidebar.announceGroupRenamed'));
        return next;
      });
    }
    setNameDialog(null);
  };

  const confirmDeleteGroup = () => {
    if (!deleteGroupId) return;
    applyDraft((prev) => deleteSidebarGroup(prev, deleteGroupId));
    say(t('sidebar.announceGroupDeleted'));
    setDeleteGroupId(null);
  };

  const confirmResetLayout = () => {
    applyDraft(() => createDefaultLayout(visiblePages.map((p) => p.id)));
    say(t('sidebar.announceLayoutReset'));
    setConfirmReset(false);
  };

  // ── render helpers ──
  const groupLabel = useCallback(
    (groupId: string) => {
      const g = draft.groups.find((x) => x.id === groupId);
      return g ? sidebarGroupLabel(g, locale) : groupId;
    },
    [draft, locale],
  );

  const ghostEl = ghost && createPortal(
    <div
      ref={ghostRef}
      aria-hidden="true"
      className="sidebar-drag-ghost fixed top-0 left-0 z-[9999] flex items-center gap-2 px-3 py-2 rounded-lg pointer-events-none"
      style={{ width: ghost.width }}
    >
      {ghost.icon}
      <span className="text-xs font-medium text-slate-100 truncate">{ghost.label}</span>
    </div>,
    document.body,
  );

  const itemLine = itemTarget && itemTarget.offsetY >= 0 && (
    <div
      aria-hidden="true"
      className="sidebar-drop-line"
      style={{ top: itemTarget.offsetY - 1 }}
    />
  );

  return (
    <MotionConfig reducedMotion="user">
      <div
        ref={navRef}
        className="flex-1 overflow-y-auto py-3 px-3 arm-scroll"
        aria-label={t('sidebar.editOrderAria')}
      >
        <p className="text-[10px] text-slate-500 px-2 pb-2 leading-relaxed">
          {t('sidebar.editHint')}
        </p>

        <div ref={contentRef} className="relative space-y-2">
          {draft.groups.map((group, groupIndex) => {
            const isMain = group.id === MAIN_GROUP_ID;
            const label = sidebarGroupLabel(group, locale);
            const menuItems = [
              ...(!isMain ? [{
                key: 'rename',
                label: t('sidebar.renameGroup'),
                icon: <Pencil className="size-3.5" />,
                onSelect: () => setNameDialog({ mode: 'rename', groupId: group.id, name: group.name }),
              }] : []),
              ...(!isMain ? [{
                key: 'delete',
                label: t('sidebar.deleteGroup'),
                icon: <X className="size-3.5" />,
                destructive: true,
                separatorBefore: true,
                onSelect: () => setDeleteGroupId(group.id),
              }] : []),
              {
                key: 'up',
                label: t('sidebar.moveGroupUp'),
                icon: <GripVertical className="size-3.5 rotate-180" />,
                onSelect: () => moveGroupKeyboard(group.id, -1),
              },
              {
                key: 'down',
                label: t('sidebar.moveGroupDown'),
                icon: <GripVertical className="size-3.5" />,
                onSelect: () => moveGroupKeyboard(group.id, 1),
              },
            ];

            return (
              <div
                key={group.id}
                data-sb-group={group.id}
                data-drop-ambient={itemTarget?.groupId === group.id ? 'true' : undefined}
                className={cn('relative rounded-xl', itemTarget?.groupId === group.id && 'sidebar-drop-ambient')}
              >
                {/* group-level insertion line (only while dragging GROUPS) */}
                {groupTarget && groupTarget.index === groupIndex && (
                  <div aria-hidden="true" className="sidebar-drop-line sidebar-drop-line-group" style={{ top: -5 }} />
                )}
                <SidebarGroupFrame open className="p-1">
                  {/* header — grip + name + overflow menu */}
                  <div className="flex items-center gap-1 pr-1 group/header">
                    <button
                      type="button"
                      data-sb-handle="group"
                      data-group-id={group.id}
                      aria-label={`${t('sidebar.groupHandle')}: ${label}`}
                      onKeyDown={(e) => {
                        if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveGroupKeyboard(group.id, -1); }
                        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveGroupKeyboard(group.id, 1); }
                      }}
                      onPointerDown={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        onHandlePointerDown({
                          kind: 'group', id: group.id, groupId: group.id, label,
                          pointerId: -1, startX: 0, startY: 0,
                          grabDX: e.clientX - rect.left, grabDY: e.clientY - rect.top,
                          width: rect.width, activated: false,
                        })(e);
                      }}
                      onPointerMove={onHandlePointerMove}
                      onPointerUp={onHandlePointerUp}
                      onPointerCancel={cancelDrag}
                      className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-700/60 cursor-grab active:cursor-grabbing transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50"
                      style={{ touchAction: 'none' }}
                    >
                      <GripVertical className="size-3.5" aria-hidden="true" />
                    </button>
                    <span className="flex-1 text-start text-[10px] font-bold tracking-wide whitespace-nowrap text-slate-400 truncate" title={label}>
                      {label}
                    </span>
                    <OverflowMenu items={menuItems} label={`${t('sidebar.groupActions')} — ${label}`} />
                  </div>

                  {/* items */}
                  <div data-sb-items="true" className="relative mt-0.5 space-y-0.5">
                    {group.items.length === 0 && (
                      <p className={cn(
                        'px-6 py-2 text-[10px] text-center rounded-lg border border-dashed transition-colors',
                        itemTarget?.groupId === group.id
                          ? 'border-brand-500/40 text-brand-300'
                          : 'border-slate-700/40 text-slate-600',
                      )}>
                        {t('sidebar.emptyGroup')}
                      </p>
                    )}
                    {group.items.map((item) => {
                      const page = pageById.get(item.id);
                      if (!page) return null;
                      const Icon = SIDEBAR_ICON_MAP[page.icon];
                      const label = localizedPageLabel(page.id, locale);
                      return (
                        <motion.div
                          key={item.id}
                          layoutId={`sb-item-${item.id}`}
                          data-sb-item="true"
                          data-sb-item-id={item.id}
                          className={cn(
                            'relative flex items-center gap-2 px-2 py-2 rounded-lg bg-slate-800/30',
                            'transition-opacity',
                            ghost?.kind === 'item' && ghost.id === item.id && 'sidebar-item-dragging',
                          )}
                        >
                          <button
                            type="button"
                            data-sb-handle="item"
                            data-item-id={item.id}
                            aria-label={`${t('sidebar.itemHandle')}: ${label}`}
                            onKeyDown={(e) => {
                              if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); moveItemKeyboard(item.id, -1); }
                              if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); moveItemKeyboard(item.id, 1); }
                            }}
                            onPointerDown={(e) => {
                              const row = e.currentTarget.closest<HTMLElement>('[data-sb-item]');
                              const rect = row?.getBoundingClientRect();
                              onHandlePointerDown({
                                kind: 'item', id: item.id, groupId: group.id, label,
                                pointerId: -1, startX: 0, startY: 0,
                                grabDX: rect ? e.clientX - rect.left : 0,
                                grabDY: rect ? e.clientY - rect.top : 0,
                                width: rect?.width ?? 0, activated: false,
                              })(e);
                            }}
                            onPointerMove={onHandlePointerMove}
                            onPointerUp={onHandlePointerUp}
                            onPointerCancel={cancelDrag}
                            title={label}
                            className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-700/60 cursor-grab active:cursor-grabbing transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 shrink-0"
                            style={{ touchAction: 'none' }}
                          >
                            <GripVertical className="size-3.5" aria-hidden="true" />
                          </button>
                          <span className="shrink-0 flex items-center justify-center size-5">
                            {Icon ? <Icon className="size-4 text-slate-400" /> : <Folder className="size-4 text-slate-500" />}
                          </span>
                          <span className="flex-1 min-w-0 truncate text-xs text-slate-200" title={label}>
                            {label}
                          </span>
                        </motion.div>
                      );
                    })}
                    {/* thin Qnalys insertion line for ITEMS */}
                    {itemTarget?.groupId === group.id && itemLine}
                  </div>
                </SidebarGroupFrame>
              </div>
            );
          })}

          {/* trailing group insertion slot */}
          {groupTarget && groupTarget.index === draft.groups.length && (
            <div aria-hidden="true" className="sidebar-drop-line sidebar-drop-line-group" style={{ top: groupTarget.offsetY }} />
          )}
        </div>

        {/* workspace-level controls */}
        <div className="mt-3 px-1 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setNameDialog({ mode: 'create' })}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-600/60 text-xs text-slate-400 hover:text-white hover:border-brand-500/50 hover:bg-slate-800/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <Plus className="size-3.5" />
            {t('sidebar.newGroup')}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-slate-500 hover:text-slate-200 hover:bg-slate-800/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            <RotateCcw className="size-3.5" />
            {t('sidebar.resetLayout')}
          </button>
        </div>

        {/* footer — Cancel discards the draft; Done validates + persists */}
        <div className="border-t border-slate-700/50 mt-3 -mx-3 px-3 py-3 flex items-center gap-2 bg-slate-900/95">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600/60 text-slate-300 hover:bg-slate-800 hover:text-white text-xs font-semibold transition-colors"
          >
            <X className="size-3.5" />
            {t('action.cancel')}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onDone(draft)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {t('sidebar.editDone')}
          </button>
        </div>

        {ghostEl}

        {/* group name (create / rename) */}
        <GroupNameDialog
          state={nameDialog}
          layout={draft}
          onClose={() => setNameDialog(null)}
          onSubmit={submitGroupName}
        />

        {/* delete group — items ALWAYS survive into Main */}
        <ConfirmDialog
          open={deleteGroupId !== null}
          onOpenChange={(open) => { if (!open) setDeleteGroupId(null); }}
          title={t('sidebar.deleteGroup')}
          description={t('sidebar.deleteGroupDescription')}
          itemName={deleteGroupId ? groupLabel(deleteGroupId) : undefined}
          confirmLabel={t('action.delete')}
          onConfirm={confirmDeleteGroup}
        />

        {/* reset layout — draft-level until Done; permissions untouched */}
        <ConfirmDialog
          open={confirmReset}
          onOpenChange={setConfirmReset}
          destructive={false}
          title={t('sidebar.resetLayout')}
          description={t('sidebar.resetLayoutDescription')}
          confirmLabel={t('sidebar.resetLayout')}
          cancelLabel={t('action.cancel')}
          onConfirm={confirmResetLayout}
        />

        {/* drag/drop + edit announcements */}
        <div aria-live="polite" role="status" className="sr-only">
          {announce && <span key={announce.id}>{announce.msg}</span>}
        </div>
      </div>
    </MotionConfig>
  );
}

// ══════════════════════════════════════════════════════════════
//  GroupNameDialog — create/rename through the standard Qnalys
//  dialog + input primitives. Validation mirrors the engine
//  (trimmed, non-empty, length cap, unique among groups); for a
//  rename the group's own id is excluded so its current name does
//  not count as a duplicate.
// ══════════════════════════════════════════════════════════════

function GroupNameDialog({
  state,
  layout,
  onClose,
  onSubmit,
}: {
  state: { mode: 'create' } | { mode: 'rename'; groupId: string; name: string } | null;
  layout: SidebarLayout;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useLanguage();
  if (!state) return null;
  const isRename = state.mode === 'rename';
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700/60 max-w-sm rounded-2xl" dir="auto">
        <DialogHeader>
          <DialogTitle className="text-white text-sm font-bold">
            {isRename ? t('sidebar.renameGroup') : t('sidebar.newGroup')}
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            {t('sidebar.groupNameLabel')}
          </DialogDescription>
        </DialogHeader>
        <GroupNameForm
          key={isRename ? state.groupId : 'create'}
          initialName={isRename ? state.name : ''}
          excludeGroupId={isRename ? state.groupId : undefined}
          layout={layout}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </DialogContent>
    </Dialog>
  );
}

// The KEYED form: mounting fresh per dialog session seeds the field
// without effects, so a cancelled rename never leaks back in.
function GroupNameForm({
  initialName,
  excludeGroupId,
  layout,
  onClose,
  onSubmit,
}: {
  initialName: string;
  excludeGroupId?: string;
  layout: SidebarLayout;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<GroupNameProblem | null>(null);

  const submit = () => {
    const problem = validateGroupName(name, layout, excludeGroupId);
    if (problem) { setError(problem); return; }
    onSubmit(name);
  };

  const errorText = error
    ? error === 'empty' ? t('sidebar.groupNameEmpty')
      : error === 'too_long' ? t('sidebar.groupNameTooLong')
        : t('sidebar.groupNameDuplicate')
    : null;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); submit(); }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <Input
          autoFocus
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          placeholder={excludeGroupId === undefined ? t('sidebar.groupNamePlaceholder') : undefined}
          maxLength={80}
          aria-invalid={error ? true : undefined}
          aria-label={t('sidebar.groupNameLabel')}
          className="bg-slate-800/60 border-slate-700/60 text-slate-100 text-sm h-9"
        />
        {errorText && <p className="text-[11px] text-red-400">{errorText}</p>}
      </div>
      <DialogFooter className="flex-row gap-2 sm:justify-start">
        <button
          type="button"
          onClick={onClose}
          className="flex-1 sm:flex-none h-9 px-4 rounded-xl border border-slate-600/60 text-slate-300 hover:bg-slate-800 hover:text-white text-xs font-semibold transition-colors"
        >
          {t('action.cancel')}
        </button>
        <button
          type="submit"
          className="flex-1 sm:flex-none h-9 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold shadow-md transition-colors"
        >
          {excludeGroupId !== undefined ? t('action.save') : t('sidebar.newGroup')}
        </button>
      </DialogFooter>
    </form>
  );
}
