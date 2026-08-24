'use client';

// ══════════════════════════════════════════════════════════════
//  SidebarCustomizeDialog — Milestone 10 personal workspace
//
//  Per-USER sidebar ordering (drag-free reorder with arrows —
//  works identically on desktop / tablet / mobile, RTL-safe).
//
//  Safety rules enforced by the reconciliation layer, not the UI:
//    • only PERMISSION-VISIBLE pages are listed/configurable
//    • hidden pages stay hidden regardless of any saved order
//    • saving affects ONLY the current user's workspace
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, RotateCcw, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useSaveUserPreferences } from '@/hooks/use-user-preferences';
import { SIDEBAR_GROUPS } from '@/config/permissions';

interface SidebarCustomizeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SidebarCustomizeDialog({ open, onClose }: SidebarCustomizeDialogProps) {
  const { visiblePages } = usePermissions();
  // The customizer MOUNTS on open — state initializes from the
  // current permission-filtered page set (permission always wins).
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent dir="rtl" className="max-w-md max-h-[85vh] flex flex-col bg-slate-900 border-slate-700/50">
        {open && <SidebarCustomizer visiblePages={visiblePages} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function SidebarCustomizer({ visiblePages, onClose }: {
  visiblePages: ReturnType<typeof usePermissions>['visiblePages'];
  onClose: () => void;
}) {
  const saveMutation = useSaveUserPreferences();

  const defaultOrder = useMemo(() => visiblePages.map((p) => p.id), [visiblePages]);
  const [order, setOrder] = useState<string[]>(defaultOrder);

  const groupLabel = (groupId: string) =>
    SIDEBAR_GROUPS.find((g) => g.id === groupId)?.label ?? '';

  const pageTitle = (id: string) => visiblePages.find((p) => p.id === id)?.title ?? id;

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
  };

  const save = async (nextOrder: string[]) => {
    try {
      await saveMutation.mutateAsync({ sidebar: { order: nextOrder } });
      onClose();
    } catch {
      toast.error('تعذر حفظ ترتيب القائمة');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-white">تخصيص ترتيب القائمة</DialogTitle>
        <DialogDescription>
          رتّب الصفحات كما يناسبك — الترتيب خاص بحسابك فقط ولا يؤثر على باقي المستخدمين.
          الصفحات غير المصرّح بها لك لا تظهر هنا مهما حدث.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto space-y-1 py-2 arm-scroll" role="list" aria-label="ترتيب الصفحات">
        {order.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">لا توجد صفحات متاحة لك حالياً</p>
        )}
        {order.map((pageId, index) => (
          <div
            key={pageId}
            role="listitem"
            className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/30"
          >
            <span className="text-[10px] text-slate-500 font-mono w-6 text-center shrink-0">{index + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200 truncate">{pageTitle(pageId)}</p>
              <p className="text-[10px] text-slate-500">{groupLabel(visiblePages.find((p) => p.id === pageId)?.groupId ?? '')}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`نقل ${pageTitle(pageId)} لأعلى`}
              >
                <ArrowUp className="size-4" />
              </Button>
              <Button
                size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white"
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`نقل ${pageTitle(pageId)} لأسفل`}
              >
                <ArrowDown className="size-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-700/40">
        <Button
          variant="outline" size="sm"
          className="border-slate-700/50 text-slate-300 hover:bg-slate-800 gap-1.5"
          disabled={saveMutation.isPending}
          onClick={() => { setOrder(defaultOrder); void save(defaultOrder); }}
        >
          <RotateCcw className="size-3.5" />
          الترتيب الافتراضي
        </Button>
        <Button
          size="sm"
          className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5"
          disabled={saveMutation.isPending}
          onClick={() => void save(order)}
        >
          {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          حفظ الترتيب
        </Button>
      </div>
    </>
  );
}
