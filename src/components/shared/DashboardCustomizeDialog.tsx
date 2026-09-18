'use client';

// ══════════════════════════════════════════════════════════════
//  DashboardCustomizeDialog — Milestone 10 personal workspace
//
//  Per-USER dashboard widget order + visibility. PERMISSION WINS
//  over personalization: unauthorized widgets never appear here,
//  so a user cannot personalize something into view they are not
//  allowed to see. Saving affects only the current user.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, RotateCcw, Save, Loader2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useUserPreferences, useSaveUserPreferences } from '@/hooks/use-user-preferences';
import { DASHBOARD_WIDGETS, type WidgetConfig } from '@/config/dashboard-widgets';

interface DashboardCustomizeDialogProps {
  open: boolean;
  onClose: () => void;
}

export function DashboardCustomizeDialog({ open, onClose }: DashboardCustomizeDialogProps) {
  const { canViewPage } = usePermissions();
  const { data: preferences } = useUserPreferences();
  // The customizer MOUNTS on open — state initializes from the
  // CURRENT permission-filtered widget set (permission always wins).
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col bg-slate-900 border-slate-700/50">
        {open && <DashboardCustomizer canViewPage={canViewPage} preferences={preferences} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function DashboardCustomizer({ canViewPage, preferences, onClose }: {
  canViewPage: (page: string) => boolean;
  preferences?: { dashboard?: { hiddenWidgets?: string[]; widgetOrder?: string[] } } | null;
  onClose: () => void;
}) {
  const saveMutation = useSaveUserPreferences();

  // Permission gate FIRST — the configurable set is exactly what the
  // user may see (the resolver applies the same rule at render time).
  const permitted = useMemo(
    () => DASHBOARD_WIDGETS.filter((w) => w.permissionKey === 'home' || canViewPage(w.permissionKey)),
    [canViewPage],
  );
  const defaultOrder = useMemo(
    () => [...permitted].sort((a, b) => a.order - b.order).map((w) => w.id),
    [permitted],
  );

  const savedOrder = preferences?.dashboard?.widgetOrder;
  const [order, setOrder] = useState<string[]>(
    savedOrder && savedOrder.length > 0 ? savedOrder : defaultOrder,
  );
  const [hidden, setHidden] = useState<Set<string>>(
    new Set(preferences?.dashboard?.hiddenWidgets ?? []),
  );

  const widgetById = useMemo(() => new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w])), []);
  const orderedWidgets = order
    .map((id) => widgetById.get(id))
    .filter((w): w is WidgetConfig => Boolean(w) && permitted.some((p) => p.id === w!.id));
  // Widgets added after the saved order (or not yet in it) append in registry order
  const appended = defaultOrder.filter((id) => !order.includes(id));
  const allWidgets = [...orderedWidgets, ...appended.map((id) => widgetById.get(id)!)];

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= allWidgets.length) return;
    const ids = allWidgets.map((w) => w.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setOrder(ids);
  };

  const toggleVisibility = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async (nextOrder: string[], nextHidden: Set<string>, reset = false) => {
    try {
      await saveMutation.mutateAsync({
        dashboard: reset
          ? { hiddenWidgets: [], widgetOrder: [] }
          : { hiddenWidgets: [...nextHidden], widgetOrder: nextOrder },
      });
      onClose();
    } catch {
      toast.error('تعذر حفظ تخصيص اللوحة');
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="text-white">تخصيص لوحة القيادة</DialogTitle>
        <DialogDescription>
          أخفِ البطاقات غير المهمة لك ورتّبها كما يناسبك — الإعداد خاص بحسابك فقط.
          البطاقات التي لا تملك صلاحية مشاهدتها لا تظهر هنا.
        </DialogDescription>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto space-y-1 py-2 arm-scroll" role="list" aria-label="ترتيب البطاقات">
        {allWidgets.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-6">لا توجد بطاقات متاحة لك حالياً</p>
        )}
        {allWidgets.map((widget, index) => {
          const isHidden = hidden.has(widget.id);
          return (
            <div
              key={widget.id}
              role="listitem"
              className={`flex items-center gap-2 p-2.5 rounded-xl border transition-colors ${
                isHidden
                  ? 'bg-slate-800/20 border-slate-700/20 opacity-60'
                  : 'bg-slate-800/40 border-slate-700/30'
              }`}
            >
              <span className="text-[10px] text-slate-500 font-mono w-6 text-center shrink-0">{index + 1}</span>
              <p className={`flex-1 min-w-0 text-sm truncate ${isHidden ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                {widget.title}
              </p>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  size="icon" variant="ghost"
                  className={`h-8 w-8 ${isHidden ? 'text-slate-500 hover:text-white' : 'text-brand-400 hover:text-brand-300'}`}
                  onClick={() => toggleVisibility(widget.id)}
                  aria-label={isHidden ? `إظهار ${widget.title}` : `إخفاء ${widget.title}`}
                >
                  {isHidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label={`نقل ${widget.title} لأعلى`}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-white"
                  disabled={index === allWidgets.length - 1}
                  onClick={() => move(index, 1)}
                  aria-label={`نقل ${widget.title} لأسفل`}
                >
                  <ArrowDown className="size-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-700/40">
        <Button
          variant="outline" size="sm"
          className="border-slate-700/50 text-slate-300 hover:bg-slate-800 gap-1.5"
          disabled={saveMutation.isPending}
          onClick={() => {
            setOrder(defaultOrder);
            setHidden(new Set());
            void save(defaultOrder, new Set(), true);
          }}
        >
          <RotateCcw className="size-3.5" />
          الافتراضي
        </Button>
        <Button
          size="sm"
          className="bg-brand-600 hover:bg-brand-700 text-white gap-1.5"
          disabled={saveMutation.isPending}
          onClick={() => void save(allWidgets.map((w) => w.id), hidden)}
        >
          {saveMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          حفظ التخصيص
        </Button>
      </div>
    </>
  );
}
