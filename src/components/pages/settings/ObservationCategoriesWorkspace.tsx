'use client';

// ═══════════════════════════════════════════════════════════════
//  ObservationCategoriesWorkspace — Settings → Master Data &
//  System Lists → Quality Observation Categories.
//
//  The management UI for the FIRST Master Data domain. It renders
//  the canonical `observationCategories` collection through the
//  existing /api/observation-categories family — it is NOT a second
//  source of truth and holds no local category list.
//
//  Capabilities: search, active/inactive filter, add, edit,
//  deactivate/reactivate (usage count + §45 confirmation), reorder
//  (up/down → PUT {reorder}), safe delete (server rejects referenced
//  records). Presentational names follow the global rule:
//  nameAr/nameEn only — never record ids or internal keys as labels.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Tags, Plus, Pencil, Trash2, ShieldAlert, Power, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import {
  useObservationCategoriesWithUsage, useCreateCategory, useUpdateCategory,
  useDeleteCategory, useReorderCategories,
} from '@/hooks/use-kpi-queries';
import {
  isCategoryActive, categoryDisplayName, sortCategories,
} from '@/lib/observation-categories/presentation';
import { formatDateTime } from '@/lib/i18n/format';
import type { CategoryImpact, ObservationCategory, Priority } from '@/types/quality-kpi';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { cn } from '@/lib/utils';

// ─── Constants ────────────────────────────────────────────────
const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج',
};

const IMPACT_LABELS: Record<CategoryImpact, string> = {
  POSITIVE: 'إيجابي', NEGATIVE: 'سلبي', NEUTRAL: 'محايد',
};

const IMPACT_STYLES: Record<CategoryImpact, string> = {
  POSITIVE: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  NEGATIVE: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
  NEUTRAL: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
};

const COLOR_TOKENS = [
  'blue', 'emerald', 'amber', 'rose', 'orange',
  'violet', 'cyan', 'pink', 'slate', 'teal',
] as const;

const TOKEN_BG: Record<string, string> = {
  blue: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  rose: 'bg-rose-500', orange: 'bg-orange-500', violet: 'bg-brand-500',
  cyan: 'bg-cyan-500', pink: 'bg-pink-500', slate: 'bg-slate-500', teal: 'bg-teal-500',
};

type StatusFilter = 'all' | 'active' | 'inactive';
type CategoryRow = ObservationCategory & { usageCount?: number };

// ─── Create / edit dialog ─────────────────────────────────────
interface CategoryFormData {
  key: string;
  name: string;
  nameEn: string;
  defaultPointValue: number;
  weight: number;
  color: string;
  priority: Priority;
  impact: CategoryImpact;
  sortOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: CategoryFormData = {
  key: '', name: '', nameEn: '', defaultPointValue: 0, weight: 1,
  color: 'blue', priority: 'medium', impact: 'NEGATIVE', sortOrder: 0,
  isActive: true,
};

function CategoryDialog({
  open, onOpenChange, initial, nextSortOrder, onSave, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: CategoryFormData | null;
  /** sortOrder offered to a NEW record (max existing + 1). */
  nextSortOrder: number;
  onSave: (data: CategoryFormData) => Promise<void>;
  busy: boolean;
}) {
  const { locale } = useLanguage();
  const [form, setForm] = useState<CategoryFormData>(initial ?? { ...EMPTY_FORM, sortOrder: nextSortOrder });
  const isEdit = !!initial;

  const [lastInitial, setLastInitial] = useState<CategoryFormData | null>(null);
  if (open && initial && initial !== lastInitial) {
    setForm(initial);
    setLastInitial(initial);
  }
  if (open && !initial && lastInitial !== null) {
    setForm({ ...EMPTY_FORM, sortOrder: nextSortOrder });
    setLastInitial(null);
  }

  function update<K extends keyof CategoryFormData>(key: K, value: CategoryFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error(translateUIText('الاسم العربي مطلوب', locale));
      return;
    }
    if (!form.nameEn.trim()) {
      toast.error(translateUIText('الاسم الإنجليزي مطلوب', locale));
      return;
    }
    if (!isEdit && !form.key.trim()) {
      toast.error(translateUIText('المعرّف البرمجي مطلوب', locale));
      return;
    }
    if (form.defaultPointValue < 0) {
      toast.error(translateUIText('النقاط لا يمكن أن تكون سالبة', locale));
      return;
    }
    await onSave(form);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <Tags className="size-5 text-blue-400" />
            {isEdit ? <T>تعديل التصنيف</T> : <T>تصنيف جديد</T>}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <T>التصنيفات هي مفردات الأعمال القابلة للتكوين — تظهر في نموذج الملاحظات حسب الترتيب والحالة</T>
          </DialogDescription>
        </DialogHeader>

        {isEdit && (
          <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-300">
            <ShieldAlert className="size-4 shrink-0 mt-0.5" />
            <p>
              <T>تعديل هذا التصنيف يؤثر على الملاحظات والقوالب الجديدة فقط. السجلات التاريخية تحتفظ ببياناتها الأصلية ولا تتأثر.</T>
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label><T>الاسم العربي *</T></Label>
            <Input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder={translateUIText('مثال: متابعة', locale)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>الاسم الإنجليزي *</T></Label>
            <Input
              value={form.nameEn}
              onChange={(e) => update('nameEn', e.target.value)}
              placeholder="e.g. Follow-up"
              dir="ltr"
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>المعرّف البرمجي</T></Label>
            <Input
              value={form.key}
              onChange={(e) => update('key', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="follow_up"
              disabled={isEdit}
              dir="ltr"
              className="bg-slate-800/50 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label><T>التأثير</T></Label>
            <Select value={form.impact} onValueChange={(v) => update('impact', v as CategoryImpact)}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(IMPACT_LABELS) as CategoryImpact[]).map((imp) => (
                  <SelectItem key={imp} value={imp}>{IMPACT_LABELS[imp]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label><T>النقاط الافتراضية</T></Label>
            <Input
              type="number"
              min={0}
              value={form.defaultPointValue}
              onChange={(e) => update('defaultPointValue', parseInt(e.target.value, 10) || 0)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>النسبة</T></Label>
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.weight}
              onChange={(e) => update('weight', parseFloat(e.target.value) || 0)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label><T>الأولوية</T></Label>
            <Select value={form.priority} onValueChange={(v) => update('priority', v as Priority)}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <SelectItem key={p} value={p}>{translateUIText(PRIORITY_LABELS[p], locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label><T>ترتيب العرض</T></Label>
            <Input
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => update('sortOrder', parseInt(e.target.value, 10) || 0)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1 col-span-2">
            <Label><T>اللون</T></Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_TOKENS.map((tok) => (
                <button
                  key={tok}
                  type="button"
                  onClick={() => update('color', tok)}
                  className={`size-8 rounded-full transition-transform ${TOKEN_BG[tok]} ${
                    form.color === tok ? 'ring-2 ring-offset-2 ring-offset-slate-900 ring-white scale-110' : ''
                  }`}
                  aria-label={tok}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-800/50 px-3 py-2 col-span-2">
            <div>
              <p className="text-sm text-slate-200"><T>نشط للاستخدام في الملاحظات الجديدة</T></p>
              <p className="text-xs text-slate-500"><T>التعطيل يمنع الاستخدام الجديد فقط ولا يمس السجلات التاريخية</T></p>
            </div>
            <Switch checked={form.isActive} onCheckedChange={(v) => update('isActive', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
          <Button onClick={handleSubmit} disabled={busy} className="gap-2">
            {busy ? <T>جارٍ الحفظ...</T> : isEdit ? <T>حفظ التغييرات</T> : <T>إنشاء التصنيف</T>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Workspace ────────────────────────────────────────────────
export default function ObservationCategoriesWorkspace() {
  const { locale } = useLanguage();
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('observationCategories');
  const { data, isLoading } = useObservationCategoriesWithUsage();
  const createMut = useCreateCategory();
  const updateMut = useUpdateCategory();
  const deleteMut = useDeleteCategory();
  const reorderMut = useReorderCategories();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryFormData | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [deactivateTarget, setDeactivateTarget] = useState<CategoryRow | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);

  const categories = useMemo(
    () => sortCategories((Array.isArray(data) ? data : []) as CategoryRow[]),
    [data],
  );

  const filtered = useMemo(() => {
    let list = categories;
    if (statusFilter === 'active') list = list.filter(isCategoryActive);
    if (statusFilter === 'inactive') list = list.filter((c) => !isCategoryActive(c));
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.nameEn ?? '').toLowerCase().includes(q) ||
        c.key.toLowerCase().includes(q),
      );
    }
    return list;
  }, [categories, statusFilter, search]);

  const isUnfiltered = !search.trim() && statusFilter === 'all';
  const nextSortOrder = categories.reduce((max, c) => Math.max(max, Number(c.sortOrder ?? 0)), 0) + 1;

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-400">
        <Tags className="size-10 mb-3 opacity-40" />
        <p className="text-sm"><T>ليس لديك صلاحية لإدارة هذه القائمة</T></p>
      </div>
    );
  }

  function startEdit(cat: CategoryRow) {
    setEditTargetId(cat.id);
    setEditing({
      key: cat.key,
      name: cat.name,
      nameEn: cat.nameEn ?? '',
      defaultPointValue: cat.defaultPointValue,
      weight: cat.weight,
      color: cat.color,
      priority: cat.priority,
      impact: cat.impact ?? (cat.isBonusDefault ? 'POSITIVE' : 'NEGATIVE'),
      sortOrder: Number(cat.sortOrder ?? 0),
      isActive: isCategoryActive(cat),
    });
    setDialogOpen(true);
  }

  async function handleSave(form: CategoryFormData) {
    try {
      if (editTargetId) {
        await updateMut.mutateAsync({
          id: editTargetId,
          data: {
            name: form.name,
            nameEn: form.nameEn,
            defaultPointValue: form.defaultPointValue,
            weight: form.weight,
            color: form.color,
            priority: form.priority,
            impact: form.impact,
            sortOrder: form.sortOrder,
            isActive: form.isActive,
          },
        });
        toast.success(translateUIText('تم تحديث التصنيف', locale));
      } else {
        await createMut.mutateAsync({
          key: form.key,
          name: form.name,
          nameEn: form.nameEn,
          defaultPointValue: form.defaultPointValue,
          weight: form.weight,
          color: form.color,
          priority: form.priority,
          impact: form.impact,
          sortOrder: form.sortOrder,
        });
        toast.success(translateUIText('تم إنشاء التصنيف', locale));
      }
      setDialogOpen(false);
      setEditing(null);
      setEditTargetId(null);
    } catch (e) {
      toast.error(translateUIText('فشل الحفظ', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmDeactivate() {
    if (!deactivateTarget) return;
    try {
      await updateMut.mutateAsync({ id: deactivateTarget.id, data: { isActive: false } });
      toast.success(translateUIText('تم تعطيل التصنيف', locale));
      setDeactivateTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل التعطيل', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmReactivate() {
    if (!reactivateTarget) return;
    try {
      await updateMut.mutateAsync({ id: reactivateTarget.id, data: { isActive: true } });
      toast.success(translateUIText('تم إعادة تفعيل التصنيف', locale));
      setReactivateTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل التفعيل', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success(translateUIText('تم حذف التصنيف', locale));
      setDeleteTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل الحذف', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  // Reorder moves a category within the FULL canonical order.
  async function move(cat: CategoryRow, dir: -1 | 1) {
    const ids = categories.map((c) => c.id);
    const index = ids.indexOf(cat.id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    try {
      await reorderMut.mutateAsync(next);
    } catch (e) {
      toast.error(translateUIText('فشل تحديث الترتيب', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  const canEdit = canUpdate || canCreate;
  const busy = createMut.isPending || updateMut.isPending || reorderMut.isPending;

  return (
    <div className="space-y-3">
      {/* Toolbar: search + status filter + add */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={translateUIText('بحث بالاسم أو الكود...', locale)}
            className="bg-slate-800/50 border-slate-700 ps-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-32 h-8 bg-slate-800/50 border-slate-700 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all"><T>الكل</T></SelectItem>
            <SelectItem value="active"><T>النشطة</T></SelectItem>
            <SelectItem value="inactive"><T>المعطّلة</T></SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        {canCreate && (
          <Button size="sm" onClick={() => { setEditing(null); setEditTargetId(null); setDialogOpen(true); }} className="gap-1.5 h-8">
            <Plus className="size-3.5" />
            <T>تصنيف جديد</T>
          </Button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
        </div>
      ) : filtered.length > 0 ? (
        <div className="rounded-xl border border-slate-700/40 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-800/40 border-slate-700/40">
                <TableHead className="text-slate-400 text-xs"><T>الاسم</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الكود</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>التأثير</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الحالة</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>الاستخدام</T></TableHead>
                <TableHead className="text-slate-400 text-xs"><T>آخر تعديل</T></TableHead>
                <TableHead className="text-slate-400 text-xs text-end"><T>الإجراءات</T></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((cat) => {
                const active = isCategoryActive(cat);
                const usage = cat.usageCount;
                return (
                  <TableRow key={cat.id} className={cn('border-slate-700/30', !active && 'opacity-55')}>
                    <TableCell>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={cn('size-2.5 rounded-full shrink-0', TOKEN_BG[cat.color] ?? TOKEN_BG.slate)} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-100 truncate">{categoryDisplayName(cat, locale)}</p>
                          {locale === 'ar' && cat.nameEn && (
                            <p className="text-[11px] text-slate-500 truncate" dir="ltr">{cat.nameEn}</p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {/* Admin-facing stable code — management context only, never in operational UI */}
                      <span className="text-xs text-slate-500 font-mono" dir="ltr">{cat.key}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={IMPACT_STYLES[cat.impact ?? (cat.isBonusDefault ? 'POSITIVE' : 'NEGATIVE')]}>
                          {translateUIText(IMPACT_LABELS[cat.impact ?? (cat.isBonusDefault ? 'POSITIVE' : 'NEGATIVE')], locale)}
                        </Badge>
                        <span className="text-[11px] text-slate-500">{cat.defaultPointValue}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={active
                        ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                        : 'text-slate-400 border-slate-600/40 bg-slate-500/10'}
                      >
                        {active ? <T>نشط</T> : <T>معطّل</T>}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-400">
                        {typeof usage === 'number'
                          ? (locale === 'en'
                              ? `${usage} ${usage === 1 ? 'observation' : 'observations'}`
                              : usage === 1 ? 'ملاحظة واحدة' : `${usage} ملاحظة`)
                          : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-500">{cat.updatedAt ? formatDateTime(cat.updatedAt, locale) : '—'}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        {canUpdate && isUnfiltered && (
                          <div className="flex items-center rounded-md border border-slate-700/50 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => move(cat, -1)}
                              disabled={busy || cat.id === categories[0]?.id}
                              className="p-1 hover:bg-slate-700/40 disabled:opacity-30"
                              aria-label={translateUIText('تحريك للأعلى', locale)}
                            >
                              <ChevronUp className="size-3.5 text-slate-400" />
                            </button>
                            <button
                              type="button"
                              onClick={() => move(cat, 1)}
                              disabled={busy || cat.id === categories[categories.length - 1]?.id}
                              className="p-1 hover:bg-slate-700/40 disabled:opacity-30 border-s border-slate-700/50"
                              aria-label={translateUIText('تحريك للأسفل', locale)}
                            >
                              <ChevronDown className="size-3.5 text-slate-400" />
                            </button>
                          </div>
                        )}
                        {canEdit && (
                          <SmartActionMenu
                            size="sm"
                            label={translateUIText('الإجراءات', locale)}
                            actions={[
                              { key: 'edit', label: translateUIText('تعديل التصنيف', locale), icon: <Pencil className="size-3.5" />, onSelect: () => startEdit(cat) },
                              active
                                ? { key: 'deactivate', label: translateUIText('تعطيل', locale), icon: <Power className="size-3.5" />, onSelect: () => setDeactivateTarget(cat) }
                                : { key: 'reactivate', label: translateUIText('إعادة تفعيل', locale), icon: <Power className="size-3.5" />, onSelect: () => setReactivateTarget(cat) },
                              ...(canDelete && usage === 0
                                ? [{ key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => setDeleteTarget(cat) }]
                                : []),
                            ]}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-14 text-slate-400">
          <Tags className="size-10 mb-2 opacity-50" />
          <p className="text-sm"><T>لا توجد تصنيفات مطابقة</T></p>
        </div>
      )}

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) { setEditing(null); setEditTargetId(null); } }}
        initial={editing}
        nextSortOrder={nextSortOrder}
        onSave={handleSave}
        busy={busy}
      />

      {/* §45 — deactivation confirms usage and never implies deletion */}
      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => { if (!open) setDeactivateTarget(null); }}
        title={translateUIText('تعطيل التصنيف', locale)}
        description={translateUIText('تعطيل هذا التصنيف سيمنع استخدامه في الملاحظات الجديدة، ولن يؤثر على السجلات التاريخية.', locale)}
        itemName={deactivateTarget ? categoryDisplayName(deactivateTarget, locale) : undefined}
        confirmLabel={translateUIText('تعطيل', locale)}
        destructive={false}
        loading={updateMut.isPending}
        onConfirm={confirmDeactivate}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        onOpenChange={(open) => { if (!open) setReactivateTarget(null); }}
        title={translateUIText('إعادة تفعيل التصنيف', locale)}
        description={translateUIText('سيعود هذا التصنيف للظهور في نموذج الملاحظات الجديدة حسب ترتيبه.', locale)}
        itemName={reactivateTarget ? categoryDisplayName(reactivateTarget, locale) : undefined}
        confirmLabel={translateUIText('إعادة تفعيل', locale)}
        destructive={false}
        loading={updateMut.isPending}
        onConfirm={confirmReactivate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={translateUIText('سيتم حذف التصنيف نهائياً. لا يمكن الحذف إذا كان مستخدماً في ملاحظات أو قوالب.', locale)}
        itemName={deleteTarget ? categoryDisplayName(deleteTarget, locale) : undefined}
        loading={deleteMut.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
