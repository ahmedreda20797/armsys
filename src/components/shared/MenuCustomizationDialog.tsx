'use client';

// ══════════════════════════════════════════════════════════════
//  MenuCustomizationDialog — §21 REAL menu customization
//
//  SIDEBAR → GROUPS → ITEMS, made tangible:
//    • drag items WITHIN a group and BETWEEN groups (HTML5 DnD),
//    • reorder GROUPS (drag the group header, or the arrow buttons),
//    • expand/collapse each group preview,
//    • reset to default,
//    • persist per user via the EXISTING user-preferences record
//      (sidebar.order + sidebar.groupOrder + sidebar.itemGroups) —
//      no second navigation architecture.
//
//  PERMISSIONS ARE INDEPENDENT FROM ORDERING: the dialog only ever
//  receives the permission-filtered visible pages, so an item the
//  user cannot access cannot be seen, moved, or resurrected.
// ══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { ChevronDown, GripVertical, Loader2, RotateCcw, ChevronUp } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface MenuCustomizationGroup {
  id: string;
  label: string;
}

export interface MenuCustomizationPage {
  id: string;
  title: string;
  /** Configured (default) group. */
  groupId: string;
}

export interface MenuCustomizationState {
  order?: string[];
  groupOrder?: string[];
  itemGroups?: Record<string, string>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: MenuCustomizationGroup[];
  pages: MenuCustomizationPage[];
  state: MenuCustomizationState;
  onSave: (state: MenuCustomizationState) => Promise<void> | void;
  saving?: boolean;
}

/** Local working shape: ordered groups, each with an ordered page list. */
type Layout = Array<{ groupId: string; label: string; pages: MenuCustomizationPage[] }>;

function buildLayout(
  groups: MenuCustomizationGroup[],
  pages: MenuCustomizationPage[],
  state: MenuCustomizationState,
): Layout {
  // Effective group of each page: itemGroups override, else config.
  const groupOf = new Map<string, string>();
  for (const p of pages) {
    const override = state.itemGroups?.[p.id];
    const valid = override && groups.some((g) => g.id === override) ? override : p.groupId;
    groupOf.set(p.id, valid);
  }
  // Page order: saved order first, then config order.
  const rank = new Map<string, number>();
  (state.order ?? []).forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
  const ordered = [...pages].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  // Group order: saved groupOrder first, then config order.
  // (Fix: the first loop probed the PAGE-order map `rank` instead of
  // `gRank`, so a group id already present in `order` was skipped and
  // its saved position silently dropped.)
  const gRank = new Map<string, number>();
  (state.groupOrder ?? []).forEach((id, i) => { if (!gRank.has(id)) gRank.set(id, i); });
  const orderedGroups = [...groups].sort((a, b) => {
    const ra = gRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = gRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
  return orderedGroups.map((g) => ({
    groupId: g.id,
    label: g.label,
    pages: ordered.filter((p) => groupOf.get(p.id) === g.id),
  }));
}

function layoutToState(layout: Layout): MenuCustomizationState {
  const order: string[] = [];
  const groupOrder: string[] = [];
  const itemGroups: Record<string, string> = {};
  for (const g of layout) {
    groupOrder.push(g.groupId);
    for (const p of g.pages) {
      order.push(p.id);
      if (p.groupId !== g.groupId) itemGroups[p.id] = g.groupId;
    }
  }
  return { order, groupOrder, itemGroups };
}

function CustomizerBody({ groups, pages, state, onSave, saving, onOpenChange }: Omit<Props, 'open'>) {
  // Fresh working copy per mount — the body unmounts while closed, so
  // the initializer re-derives from the saved state on every open.
  const initialLayout = useMemo(
    () => buildLayout(groups, pages, state),
    [groups, pages],
  );
  const [layout, setLayout] = useState<Layout>(initialLayout);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dragPage, setDragPage] = useState<{ page: MenuCustomizationPage; fromGroup: string } | null>(null);
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggleGroup = (groupId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  };

  const movePageToGroup = (page: MenuCustomizationPage, targetGroupId: string, beforePageId?: string) => {
    setLayout((prev) => {
      const next = prev.map((g) => ({ ...g, pages: g.pages.filter((p) => p.id !== page.id) }));
      const target = next.find((g) => g.groupId === targetGroupId);
      if (!target) return prev;
      const idx = beforePageId ? target.pages.findIndex((p) => p.id === beforePageId) : -1;
      if (idx >= 0) target.pages.splice(idx, 0, page);
      else target.pages.push(page);
      return next;
    });
  };

  const moveGroup = (groupId: string, dir: -1 | 1) => {
    setLayout((prev) => {
      const idx = prev.findIndex((g) => g.groupId === groupId);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
  };

  const handleDropOnGroup = (targetGroupId: string, beforePageId?: string) => {
    if (dragGroup) {
      setLayout((prev) => {
        const from = prev.findIndex((g) => g.groupId === dragGroup);
        const to = prev.findIndex((g) => g.groupId === targetGroupId);
        if (from < 0 || to < 0 || from === to) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      setDragGroup(null);
      return;
    }
    if (dragPage) {
      movePageToGroup(dragPage.page, targetGroupId, beforePageId);
      setDragPage(null);
    }
  };

  const handleSave = async () => {
    try {
      await onSave(layoutToState(layout));
      toast.success('تم حفظ تخصيص القائمة');
      onOpenChange(false);
    } catch {
      toast.error('تعذر حفظ التخصيص');
    }
  };

  const handleReset = async () => {
    setLayout(buildLayout(groups, pages, {}));
    try {
      await onSave({});
      toast.success('تمت إعادة القائمة للوضع الافتراضي');
    } catch {
      toast.error('تعذر إعادة التخصيص');
    }
  };

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-white font-semibold">تخصيص القائمة</h3>
        <p className="text-slate-400 text-xs mt-0.5">
          اسحب العناصر بين المجموعات وأعد ترتيبها — الصلاحيات مستقلة عن الترتيب ولن يظهر عنصر لا تملك صلاحية الوصول إليه.
        </p>
      </div>

        <div className="space-y-2.5">
          {layout.map((g) => (
            <div
              key={g.groupId}
              onDragOver={(e) => { e.preventDefault(); setDropTarget(g.groupId); }}
              onDragLeave={() => setDropTarget((t) => (t === g.groupId ? null : t))}
              onDrop={(e) => { e.preventDefault(); handleDropOnGroup(g.groupId); }}
              className={cn(
                'rounded-xl border transition-colors',
                dropTarget === g.groupId ? 'border-brand-500/50 bg-brand-500/5' : 'border-slate-700/50 bg-slate-800/30',
              )}
            >
              {/* Group header — drag to reorder groups */}
              <div
                draggable
                onDragStart={() => setDragGroup(g.groupId)}
                onDragEnd={() => setDragGroup(null)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 cursor-grab active:cursor-grabbing select-none',
                  dragGroup === g.groupId && 'opacity-50',
                )}
              >
                <GripVertical className="size-3.5 text-slate-600" />
                <button
                  type="button"
                  onClick={() => toggleGroup(g.groupId)}
                  className="flex flex-1 items-center gap-2 text-right"
                  aria-expanded={!collapsed.has(g.groupId)}
                >
                  <ChevronDown className={cn('size-3.5 text-slate-500 transition-transform', collapsed.has(g.groupId) && '-rotate-90')} />
                  <span className="text-sm font-semibold text-white">{g.label}</span>
                  <span className="text-[10px] text-slate-500">{g.pages.length} عنصر</span>
                </button>
                <button type="button" onClick={() => moveGroup(g.groupId, -1)} aria-label="نقل المجموعة لأعلى" className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700/50">
                  <ChevronUp className="size-3.5" />
                </button>
                <button type="button" onClick={() => moveGroup(g.groupId, 1)} aria-label="نقل المجموعة لأسفل" className="p-1 rounded text-slate-500 hover:text-white hover:bg-slate-700/50">
                  <ChevronDown className="size-3.5" />
                </button>
              </div>

              {/* Items */}
              {!collapsed.has(g.groupId) && (
                <div className="px-2 pb-2 space-y-1">
                  {g.pages.length === 0 && (
                    <p className="text-[11px] text-slate-600 px-6 py-1.5">أفلت عنصراً هنا لنقله إلى هذه المجموعة</p>
                  )}
                  {g.pages.map((p) => (
                    <div
                      key={p.id}
                      draggable
                      onDragStart={() => setDragPage({ page: p, fromGroup: g.groupId })}
                      onDragEnd={() => { setDragPage(null); setDropTarget(null); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDropOnGroup(g.groupId, p.id); }}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-slate-200 cursor-grab active:cursor-grabbing select-none transition-opacity',
                        dragPage?.page.id === p.id && 'opacity-40',
                      )}
                    >
                      <GripVertical className="size-3 text-slate-600" />
                      <span className="flex-1">{p.title}</span>
                      {p.groupId !== g.groupId && (
                        <span className="text-[9px] text-brand-300 bg-brand-500/10 border border-brand-500/25 rounded px-1.5 py-0.5">منقول</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <Button variant="ghost" size="sm" onClick={() => void handleReset()} disabled={saving} className="text-slate-400 hover:text-white">
            <RotateCcw className="size-3.5 ml-1" />
            إعادة للوضع الافتراضي
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving} className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white">
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              حفظ التخصيص
            </Button>
          </div>
        </div>
    </div>
  );
}

export function MenuCustomizationDialog({ open, onOpenChange, groups, pages, state, onSave, saving }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-2xl max-h-[88vh] overflow-y-auto">
        {open && (
          <CustomizerBody
            groups={groups}
            pages={pages}
            state={state}
            onSave={onSave}
            saving={saving}
            onOpenChange={onOpenChange}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
