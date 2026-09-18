'use client';

// ══════════════════════════════════════════════════════════════
//  SmartActionMenu — the ONE system-wide row/card action menu (§2,
//  polished per §11/§12 of the nav refactor)
//
//  At rest only the ⋮ trigger is visible; on hover OR click the
//  action ICONS emerge from it with a subtle staggered spring, each
//  with a tooltip. The trigger rotates 90° while open and reverses
//  on close.
//
//  §11 MOTION POLISH:
//    • faster, lighter close (~120ms, no exit stagger);
//    • subtle surface — thin border, faint translucency, small
//      shadow (no heavy opaque blocks);
//    • open = ~180ms stagger of scale+translate from the trigger.
//
//  §12 POSITIONING: the fan renders in a PORTAL with position:fixed,
//  measured ONCE at open from the trigger's viewport rect (event-
//  driven — no rAF loops, no continuous measurement). It can never
//  be clipped by an overflow:hidden ancestor and flips direction to
//  stay inside the viewport: horizontal toward the roomier side,
//  vertical fallback near horizontal edges. RTL-safe (physical
//  coordinates).
//
//  CONSUMERS pass only the actions relevant to their context — the
//  component never hardcodes which actions exist. Items may carry
//  `hidden` so callers can drop actions declaratively.
// ══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Circle, MoreVertical } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface SmartAction {
  /** Stable key — also the React key. */
  key: string;
  /** Tooltip label (Arabic). */
  label: string;
  /** Action glyph (required in practice; optional for legacy arrays). */
  icon?: React.ReactNode;
  onSelect: () => void;
  /** Destructive styling (delete/archive). */
  destructive?: boolean;
  /** Disabled: rendered inert with muted styling. */
  disabled?: boolean;
  /** Drop the action entirely (declarative permission filtering). */
  hidden?: boolean;
  /**
   * Accepted for OverflowMenu call-site compatibility — IGNORED here
   * (an icon fan has no text-list separators).
   */
  separatorBefore?: boolean;
}

interface SmartActionMenuProps {
  actions: SmartAction[];
  /** Accessible label for the ⋮ trigger. */
  label?: string;
  /** Stop click propagation (record cards open details on click). */
  stopPropagation?: boolean;
  /** Visual size variant for dense tables. */
  size?: 'sm' | 'md';
  className?: string;
}

const ITEM_SIZE = 34;      // px — icon button box
const FAN_PADDING = 8;     // px — fan container padding (p-1)
const VIEWPORT_MARGIN = 10;

type FanDirection = 'x-start' | 'x-end' | 'y-down' | 'y-up';

interface FanPlacement {
  direction: FanDirection;
  top: number;
  left: number;
}

export function SmartActionMenu({
  actions,
  label = 'الإجراءات',
  stopPropagation = true,
  size = 'md',
  className,
}: SmartActionMenuProps) {
  const items = actions.filter((a) => !a.hidden);
  if (items.length === 0) return null;

  return <SmartActionMenuInner
    items={items}
    label={label}
    stopPropagation={stopPropagation}
    size={size}
    className={className}
  />;
}

function SmartActionMenuInner({
  items,
  label,
  stopPropagation,
  size,
  className,
}: {
  items: SmartAction[];
  label: string;
  stopPropagation: boolean;
  size: 'sm' | 'md';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // click-open stays open
  const [placement, setPlacement] = useState<FanPlacement | null>(null);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = useId();

  // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical one-time hydration guard (the portal needs document.body).
  useEffect(() => { setMounted(true); }, []);

  const fanWidth = (isVertical: boolean) =>
    isVertical ? ITEM_SIZE + FAN_PADDING : items.length * ITEM_SIZE + FAN_PADDING;
  const fanHeight = (isVertical: boolean) =>
    isVertical ? items.length * ITEM_SIZE + FAN_PADDING : ITEM_SIZE + FAN_PADDING;

  /** ONE measurement per open — placement is then pure CSS positioning. */
  const computePlacement = useCallback((): FanPlacement => {
    const el = rootRef.current;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!el) return { direction: 'x-end', top: 0, left: 0 };
    const rect = el.getBoundingClientRect();
    const needed = items.length * ITEM_SIZE + FAN_PADDING;

    const spaceLeft = rect.left;
    const spaceRight = vw - rect.right;
    const spaceTop = rect.top;
    const spaceBottom = vh - rect.bottom;

    // Horizontal when one side fits the whole fan; vertical otherwise.
    const horizontal = Math.max(spaceLeft, spaceRight) >= needed + VIEWPORT_MARGIN;
    const direction: FanDirection = horizontal
      ? (spaceRight >= spaceLeft ? 'x-start' : 'x-end')
      : (spaceBottom >= spaceTop ? 'y-down' : 'y-up');

    const fw = fanWidth(!horizontal);
    const fh = fanHeight(!horizontal);

    let top = 0;
    let left = 0;
    if (direction === 'x-start') {
      // Fan to the RIGHT of the trigger (physical), vertically centered.
      left = Math.min(vw - fw - VIEWPORT_MARGIN, rect.right - 4);
      top = rect.top + rect.height / 2 - fh / 2;
    } else if (direction === 'x-end') {
      // Fan to the LEFT of the trigger.
      left = Math.max(VIEWPORT_MARGIN, rect.left - fw + 4);
      top = rect.top + rect.height / 2 - fh / 2;
    } else if (direction === 'y-down') {
      top = Math.min(vh - fh - VIEWPORT_MARGIN, rect.bottom - 4);
      left = rect.left + rect.width / 2 - fw / 2;
    } else {
      top = Math.max(VIEWPORT_MARGIN, rect.top - fh + 4);
      left = rect.left + rect.width / 2 - fw / 2;
    }
    // Final clamp — never outside the viewport.
    top = Math.max(VIEWPORT_MARGIN, Math.min(vh - fh - VIEWPORT_MARGIN, top));
    left = Math.max(VIEWPORT_MARGIN, Math.min(vw - fw - VIEWPORT_MARGIN, left));
    return { direction, top, left };
  }, [items.length]);

  const openMenu = useCallback((pin: boolean) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setPlacement(computePlacement());
    setPinned(pin);
    setOpen(true);
  }, [computePlacement]);

  const closeMenu = useCallback((clearPin = true) => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    if (clearPin) setPinned(false);
    setOpen(false);
  }, []);

  /** §11 fast close on hover-out — a 120ms bridge covers the trigger→fan gap. */
  const scheduleClose = useCallback(() => {
    if (pinned) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 120);
  }, [pinned]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  // Outside click / Escape / scroll-away close (the fan is fixed — a
  // scroll invalidates the one-shot placement, so we close instead of
  // re-measuring on every frame).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest(`[data-smart-fan="${menuId}"]`)) return;
      closeMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMenu(); };
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target)) return;
      closeMenu();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, closeMenu, menuId]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const isVertical = placement?.direction === 'y-down' || placement?.direction === 'y-up';
  // Items emerge FROM the trigger side: the offset starts toward the
  // trigger and settles at 0 (physical measurement → no RTL mirroring).
  const xFrom = placement?.direction === 'x-start' ? -8 : placement?.direction === 'x-end' ? 8 : 0;
  const yFrom = placement?.direction === 'y-down' ? -8 : placement?.direction === 'y-up' ? 8 : 0;

  const fan = open && mounted && placement ? createPortal(
    <AnimatePresence>
      <motion.div
        key="fan"
        data-smart-fan={menuId}
        id={menuId}
        role="menu"
        aria-label={label}
        initial="closed"
        animate="open"
        exit="closed"
        variants={{
          open: { transition: { staggerChildren: 0.02, delayChildren: 0.01 } },
          // §11: close is FASTER — no stagger, one short settle.
          closed: { transition: { duration: 0.1 } },
        }}
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        style={{
          position: 'fixed',
          top: placement.top,
          left: placement.left,
          zIndex: 70,
        }}
        className={cn(
          'flex items-center rounded-lg border border-slate-700/40 bg-slate-900/90 backdrop-blur-md shadow-lg shadow-black/25 p-1',
          isVertical ? 'flex-col' : 'flex-row',
        )}
      >
        {items.map((item) => (
          <motion.button
            key={item.key}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            variants={{
              closed: { opacity: 0, x: isVertical ? 0 : xFrom, y: isVertical ? yFrom : 0, scale: 0.7 },
              open: { opacity: 1, x: 0, y: 0, scale: 1 },
            }}
            transition={{ type: 'spring', stiffness: 520, damping: 32 }}
            whileHover={item.disabled ? undefined : { scale: 1.1 }}
            whileTap={item.disabled ? undefined : { scale: 0.92 }}
            onClick={(e) => {
              e.stopPropagation();
              if (item.disabled) return;
              closeMenu();
              item.onSelect();
            }}
            aria-label={item.label}
            className={cn(
              'flex items-center justify-center rounded-md transition-colors',
              size === 'sm' ? 'size-7' : 'size-8',
              item.disabled && 'opacity-40 cursor-not-allowed',
              item.destructive
                ? 'text-red-400 hover:bg-red-500/15 hover:text-red-300'
                : 'text-slate-300 hover:bg-slate-700/60 hover:text-white',
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center justify-center size-4">
                  {item.icon ?? <Circle className="size-2.5 fill-current" />}
                </span>
              </TooltipTrigger>
              <TooltipContent side={isVertical ? 'left' : 'bottom'} className="text-[11px]">
                {item.label}
              </TooltipContent>
            </Tooltip>
          </motion.button>
        ))}
      </motion.div>
    </AnimatePresence>,
    document.body,
  ) : null;

  return (
    <TooltipProvider>
      <div
        ref={rootRef}
        className={cn('relative inline-flex items-center', className)}
        onMouseEnter={() => openMenu(false)}
        onMouseLeave={scheduleClose}
        onClick={(e) => { if (stopPropagation) e.stopPropagation(); }}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node) && !pinned) closeMenu(false);
        }}
      >
        {/* ── The ⋮ trigger — rotates 90° while open ── */}
        <motion.button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (open && pinned) { closeMenu(); return; }
            openMenu(true);
          }}
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          whileTap={{ scale: 0.88 }}
          className={cn(
            'flex items-center justify-center rounded-md transition-colors',
            size === 'sm' ? 'size-6' : 'size-[30px]',
            open
              ? 'text-white bg-slate-700/70'
              : 'text-slate-400 hover:text-white hover:bg-slate-700/60',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
          )}
        >
          <MoreVertical className={size === 'sm' ? 'size-3.5' : 'size-4'} />
        </motion.button>
        {fan}
      </div>
    </TooltipProvider>
  );
}
