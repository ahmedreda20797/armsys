'use client';

import React, { memo } from 'react';
import {
  Undo2, Redo2, Save, Upload, CheckCircle2, ZoomIn, ZoomOut,
  Maximize2, Crosshair, Map, Grid3x3, Magnet,
  AlertTriangle, Loader2, Trash2, Copy, ClipboardCopy, ClipboardPaste,
  Play, FolderOpen, LayoutTemplate, Search, Wand2, Gauge, Bookmark,
} from 'lucide-react';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { VBValidationResult } from '../engine/types';
import type { VBValidationReport } from '../engine/v2-types';

/* ─── Types ────────────────────────────────────────────────────────────── */

interface DesignerToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  isSaving: boolean;
  isPublishing: boolean;
  hasChanges: boolean;
  /** Accepts the richer V2 report (which extends V1 result) or V1 result. */
  validation: VBValidationResult | VBValidationReport | null;
  showMinimap: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  selectedCount: number;
  canPaste?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onPublish: () => void;
  onValidate: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitView: () => void;
  onCenterView: () => void;
  onToggleMinimap: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onCopySelected?: () => void;
  onPaste?: () => void;
  // V2 additions
  onAutoLayout?: () => void;
  onToggleExplorer?: () => void;
  onToggleTemplates?: () => void;
  onToggleNodeTemplates?: () => void;
  onToggleSearch?: () => void;
  onToggleSimulation?: () => void;
  onToggleAnalytics?: () => void;
  onToggleDocumentation?: () => void;
  onToggleVersions?: () => void;
  onToggleOutline?: () => void;
}

/* ─── Toolbar button ────────────────────────────────────────────────────── */

interface ToolBtnProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  variant?: 'default' | 'danger' | 'success' | 'warning';
  loading?: boolean;
  className?: string;
}

const ToolBtn = memo(function ToolBtn({
  icon: Icon, label, onClick,
  disabled = false, active = false,
  variant = 'default', loading = false, className,
}: ToolBtnProps) {
  const btn = (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex items-center justify-center w-8 h-8 rounded-md transition-all duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
        disabled && 'opacity-30 cursor-not-allowed',
        !disabled && 'hover:bg-slate-700/60 active:bg-slate-600/60',
        active && 'bg-violet-600/30 text-violet-300 ring-1 ring-violet-500/30',
        variant === 'danger' && !disabled && 'text-red-400 hover:bg-red-500/10',
        variant === 'success' && !disabled && 'text-emerald-400 hover:bg-emerald-500/10',
        variant === 'warning' && !disabled && 'text-amber-400 hover:bg-amber-500/10',
        !active && !disabled && variant === 'default' && 'text-slate-400',
        className,
      )}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs bg-slate-900 border-slate-700 text-slate-300">
        {label}
      </TooltipContent>
    </Tooltip>
  );
});

function Divider() {
  return <div className="w-px h-5 bg-slate-700/50 mx-1" />;
}

/* ─── Main toolbar ──────────────────────────────────────────────────────── */

export const DesignerToolbar = memo(function DesignerToolbar(props: DesignerToolbarProps) {
  const errorCount = props.validation?.errors.length ?? 0;
  const warningCount = props.validation?.warnings.length ?? 0;

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/60" dir="ltr">
      {/* ── History ────────────────────────────────────────────── */}
      <ToolBtn icon={Undo2} label="تراجع (Ctrl+Z)" onClick={props.onUndo} disabled={!props.canUndo} />
      <ToolBtn icon={Redo2} label="إعادة (Ctrl+Shift+Z)" onClick={props.onRedo} disabled={!props.canRedo} />

      <Divider />

      {/* ── Save / Publish ─────────────────────────────────────── */}
      <ToolBtn
        icon={Save}
        label="حفظ (Ctrl+S)"
        onClick={props.onSave}
        loading={props.isSaving}
      />
      <ToolBtn
        icon={Upload}
        label="نشر"
        onClick={props.onPublish}
        loading={props.isPublishing}
      />

      <Divider />

      {/* ── Validate ────────────────────────────────────────────── */}
      <ToolBtn
        icon={CheckCircle2}
        label="التحقق من الصحة"
        onClick={props.onValidate}
        variant={errorCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success'}
      />
      {errorCount > 0 && (
        <span className="text-[10px] text-red-400 font-medium px-1">{errorCount}</span>
      )}
      {warningCount > 0 && errorCount === 0 && (
        <span className="text-[10px] text-amber-400 font-medium px-1">{warningCount}</span>
      )}

      <Divider />

      {/* ── Selection actions: Copy / Cut / Paste / Duplicate / Delete ── */}
      <ToolBtn
        icon={ClipboardCopy}
        label="نسخ (Ctrl+C)"
        onClick={props.onCopySelected ?? (() => {})}
        disabled={props.selectedCount === 0}
      />
      <ToolBtn
        icon={ClipboardPaste}
        label="لصق (Ctrl+V)"
        onClick={props.onPaste ?? (() => {})}
        disabled={!props.canPaste}
      />
      <ToolBtn
        icon={Copy}
        label="تكرار (Ctrl+D)"
        onClick={props.onDuplicateSelected}
        disabled={props.selectedCount === 0}
      />
      <ToolBtn
        icon={Trash2}
        label="حذف (Delete)"
        onClick={props.onDeleteSelected}
        disabled={props.selectedCount === 0}
        variant="danger"
      />

      <Divider />

      {/* ── Zoom / View ────────────────────────────────────────── */}
      <ToolBtn icon={ZoomIn} label="تكبير" onClick={props.onZoomIn} />
      <ToolBtn icon={ZoomOut} label="تصغير" onClick={props.onZoomOut} />
      <ToolBtn icon={Maximize2} label="ملاءمة الشاشة (Ctrl+0)" onClick={props.onFitView} />
      <ToolBtn icon={Crosshair} label="توسيط" onClick={props.onCenterView} />

      <Divider />

      {/* ── Canvas toggles ──────────────────────────────────────── */}
      <ToolBtn icon={Map} label="خريطة صغيرة" onClick={props.onToggleMinimap} active={props.showMinimap} />
      <ToolBtn icon={Grid3x3} label="الشبكة" onClick={props.onToggleGrid} active={props.showGrid} />
      <ToolBtn icon={Magnet} label="الالتصاق" onClick={props.onToggleSnap} active={props.snapToGrid} />

      <Divider />

      {/* ── V2 Authoring tools ─────────────────────────────────── */}
      <ToolBtn icon={Wand2} label="ترتيب تلقائي (Ctrl+L)" onClick={props.onAutoLayout ?? (() => {})} />
      <ToolBtn icon={Play} label="محاكاة" onClick={props.onToggleSimulation ?? (() => {})} />
      <ToolBtn icon={Gauge} label="تحليلات" onClick={props.onToggleAnalytics ?? (() => {})} />
      <ToolBtn icon={FolderOpen} label="مستكشف المسارات" onClick={props.onToggleExplorer ?? (() => {})} />
      <ToolBtn icon={LayoutTemplate} label="قوالب المسارات" onClick={props.onToggleTemplates ?? (() => {})} />
      <ToolBtn icon={Bookmark} label="قوالب العقد" onClick={props.onToggleNodeTemplates ?? (() => {})} />
      <ToolBtn icon={Search} label="بحث (Ctrl+K)" onClick={props.onToggleSearch ?? (() => {})} />

      {/* ── Spacer ──────────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Right side info ────────────────────────────────────── */}
      {props.hasChanges && (
        <span className="text-[10px] text-amber-400 font-medium px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20">
          تعديلات غير محفوظة
        </span>
      )}
    </div>
  );
});
