'use client';

/**
 * Phase 13 — Context Menu
 *
 * Two flavours:
 *   1. Canvas menu (right-click on empty canvas)
 *   2. Node menu   (right-click on a node)
 *
 * Mounted by the page as a fixed-position overlay. Pure UI; the page supplies
 * every action callback so this component stays free of business logic.
 */

import React, { memo, useEffect, useRef } from 'react';
import {
  Plus, Clipboard, ClipboardCopy, Maximize2, Wand2, Grid3x3, Magnet,
  Map, Pencil, Copy, Trash2, Ban, Scissors, Palette, ChevronDown,
  Crosshair, Eye,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ContextMenuPosition {
  x: number; // screen coords
  y: number;
}

interface BaseProps {
  position: ContextMenuPosition;
  onClose: () => void;
}

interface MenuItemDef {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  dividerAfter?: boolean;
}

/* ─── Canvas context menu ────────────────────────────────────────────────── */

export interface CanvasContextMenuProps extends BaseProps {
  onCreateNode: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onFitView: () => void;
  onAutoLayout: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onToggleMinimap: () => void;
  showGrid: boolean;
  snapToGrid: boolean;
  showMinimap: boolean;
}

export const CanvasContextMenu = memo(function CanvasContextMenu({
  position, onClose,
  onCreateNode, onPaste, canPaste,
  onFitView, onAutoLayout, onToggleGrid, onToggleSnap, onToggleMinimap,
  showGrid, snapToGrid, showMinimap,
}: CanvasContextMenuProps) {
  const items: MenuItemDef[] = [
    { label: 'إنشاء عقدة', icon: Plus, onClick: onCreateNode },
    { label: 'لصق', icon: Clipboard, onClick: onPaste, disabled: !canPaste, dividerAfter: true },
    { label: 'ملاءمة الشاشة', icon: Maximize2, onClick: onFitView },
    { label: 'ترتيب تلقائي', icon: Wand2, onClick: onAutoLayout, dividerAfter: true },
    { label: showGrid ? 'إخفاء الشبكة' : 'إظهار الشبكة', icon: Grid3x3, onClick: onToggleGrid },
    { label: snapToGrid ? 'إلغاء الالتصاق' : 'تفعيل الالتصاق', icon: Magnet, onClick: onToggleSnap },
    { label: showMinimap ? 'إخفاء الخريطة' : 'إظهار الخريطة', icon: Map, onClick: onToggleMinimap },
  ];
  return <MenuShell position={position} onClose={onClose} items={items} />;
});

/* ─── Node context menu ──────────────────────────────────────────────────── */

export interface NodeContextMenuProps extends BaseProps {
  nodeId: string;
  nodeLabel: string;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDisable: () => void;
  onCopy: () => void;
  onCut: () => void;
  onColor: () => void;
  onCollapse: () => void;
  isCollapsed: boolean;
  isDisabled: boolean;
  onCenterView: () => void;
}

export const NodeContextMenu = memo(function NodeContextMenu({
  position, onClose,
  onRename, onDuplicate, onDelete, onDisable, onCopy, onCut, onColor, onCollapse,
  isCollapsed, isDisabled, onCenterView,
}: NodeContextMenuProps) {
  const items: MenuItemDef[] = [
    { label: 'إعادة تسمية', icon: Pencil, onClick: onRename },
    { label: 'تكرار', icon: Copy, onClick: onDuplicate },
    { label: 'حذف', icon: Trash2, onClick: onDelete, variant: 'danger' },
    { label: isDisabled ? 'تفعيل' : 'تعطيل', icon: Ban, onClick: onDisable, dividerAfter: true },
    { label: 'نسخ', icon: ClipboardCopy, onClick: onCopy },
    { label: 'قص', icon: Scissors, onClick: onCut, dividerAfter: true },
    { label: 'اللون', icon: Palette, onClick: onColor },
    { label: isCollapsed ? 'توسيع' : 'طيّ', icon: ChevronDown, onClick: onCollapse },
    { label: 'توسيط العرض', icon: Crosshair, onClick: onCenterView },
  ];
  return <MenuShell position={position} onClose={onClose} items={items} />;
});

/* ─── Shared menu shell ──────────────────────────────────────────────────── */

function MenuShell({
  position, onClose, items,
}: {
  position: ContextMenuPosition;
  onClose: () => void;
  items: MenuItemDef[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / escape / scroll.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  // Keep menu inside the viewport.
  const adjusted = adjustPosition(position);

  return (
    <div
      ref={ref}
      dir="rtl"
      className="fixed z-[100] min-w-[180px] py-1 bg-slate-900/95 backdrop-blur-md border border-slate-700/60 rounded-lg shadow-2xl"
      style={{ left: adjusted.x, top: adjusted.y }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((item, idx) => (
        <React.Fragment key={idx}>
          <button
            disabled={item.disabled}
            onClick={() => { if (!item.disabled) { item.onClick(); onClose(); } }}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-right transition-colors',
              item.disabled
                ? 'text-slate-600 cursor-not-allowed'
                : item.variant === 'danger'
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-slate-300 hover:bg-slate-800/60',
            )}
          >
            {item.icon && <item.icon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1 text-right">{item.label}</span>
          </button>
          {item.dividerAfter && <div className="my-1 border-t border-slate-800/60" />}
        </React.Fragment>
      ))}
    </div>
  );
}

function adjustPosition(p: ContextMenuPosition): ContextMenuPosition {
  if (typeof window === 'undefined') return p;
  const MENU_W = 200;
  const MENU_H = 320;
  return {
    x: Math.min(p.x, window.innerWidth - MENU_W - 8),
    y: Math.min(p.y, window.innerHeight - MENU_H - 8),
  };
}

/** Helper: detect whether a right-click landed on a node (by element class). */
export function isNodeTarget(e: React.MouseEvent | MouseEvent): string | null {
  const target = e.target as HTMLElement | null;
  if (!target) return null;
  const nodeEl = target.closest('.react-flow__node') as HTMLElement | null;
  if (!nodeEl) return null;
  return nodeEl.getAttribute('data-id');
}
