'use client';

// ══════════════════════════════════════════════════════════════
//  ConfirmDialog — the ONE global confirmation dialog (§4)
//
//  Every destructive operation in the system (delete, archive,
//  close-period …) MUST render through this component — pages are
//  forbidden from rolling their own confirmation markup. Built on
//  the existing Radix AlertDialog primitives (focus trap, Escape,
//  aria wiring, portal) with the system's dark theme applied once,
//  centrally.
//
//  Contract:
//   • Fixed, compact width (max-w-md) — never page-wide.
//   • itemName highlights WHAT is being affected.
//   • Irreversibility warning is always visible.
//   • loading disables both buttons + swaps the confirm icon.
//   • Escape/close disabled while a mutation is in flight.
//   • Focus lands on Cancel (safe default) — Radix handles it via
//     AlertDialogCancel auto-focus.
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog headline, e.g. "تأكيد الحذف". */
  title?: string;
  /** What the operation does, e.g. "سيتم حذف السجل نهائياً من النظام". */
  description?: string;
  /** Display name of the affected record (rendered as a highlighted chip). */
  itemName?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** While true: buttons disabled, spinner on confirm, Escape/close suppressed. */
  loading?: boolean;
  /** Destructive (red) styling — the default for delete flows. */
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
}

const DEFAULTS = {
  title: 'تأكيد الحذف',
  description: 'هل أنت متأكد من تنفيذ هذه العملية؟ لا يمكن التراجع عنها بعد التنفيذ.',
  confirmLabel: 'حذف',
  cancelLabel: 'إلغاء',
} as const;

export function ConfirmDialog({
  open,
  onOpenChange,
  title = DEFAULTS.title,
  description = DEFAULTS.description,
  itemName,
  confirmLabel = DEFAULTS.confirmLabel,
  cancelLabel = DEFAULTS.cancelLabel,
  loading = false,
  destructive = true,
  onConfirm,
}: ConfirmDialogProps) {
  // Confirm stays focusable but inert while loading — a second click
  // must never fire a second mutation.
  const confirmingRef = useRef(false);
  useEffect(() => {
    if (!open) confirmingRef.current = false;
  }, [open]);

  const handleConfirm = async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      await onConfirm();
    } finally {
      confirmingRef.current = false;
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // A pending mutation pins the dialog open — closing mid-flight
        // would orphan the request's success/error feedback.
        if (!next && loading) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
       
        className="bg-slate-900 border-slate-700/60 max-w-md w-[calc(100%-2rem)] rounded-2xl p-5 gap-3 text-right data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
      >
        <AlertDialogHeader className="text-right gap-2">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex items-center justify-center size-10 rounded-xl border shrink-0',
                destructive
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-400',
              )}
            >
              <TriangleAlert className="size-5" />
            </div>
            <div className="min-w-0">
              <AlertDialogTitle className="text-white text-base font-bold">{title}</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400 text-xs leading-relaxed mt-1">
                {description}
              </AlertDialogDescription>
            </div>
          </div>
          {itemName && (
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-2">
              <span className="text-[10px] text-slate-500 shrink-0">العنصر:</span>
              <span className="text-xs font-semibold text-slate-200 truncate" title={itemName}>
                {itemName}
              </span>
            </div>
          )}
        </AlertDialogHeader>
        <div className="flex items-center gap-1.5 text-[10px] text-amber-400/90">
          <TriangleAlert className="size-3 shrink-0" />
          <span>تحذير: هذه العملية قد لا يمكن التراجع عنها.</span>
        </div>
        <AlertDialogFooter className="flex-row gap-2 sm:justify-start mt-1">
          <AlertDialogCancel
            disabled={loading}
            className="flex-1 sm:flex-none h-9 rounded-xl border-slate-600/60 bg-transparent text-slate-300 hover:bg-slate-800 hover:text-white text-xs font-semibold"
          >
            {cancelLabel}
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={loading}
            onClick={() => void handleConfirm()}
            className={cn(
              'flex-1 sm:flex-none h-9 rounded-xl text-xs font-semibold text-white shadow-md',
              destructive
                ? 'bg-red-600 hover:bg-red-700 shadow-red-900/20'
                : 'bg-brand-600 hover:bg-brand-700 shadow-brand-900/20',
            )}
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : null}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
