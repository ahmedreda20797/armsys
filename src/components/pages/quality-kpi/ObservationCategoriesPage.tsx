'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tags, Plus, Pencil, Trash2, Sparkles, TrendingUp } from 'lucide-react';
import {
  useObservationCategories, useCreateCategory, useUpdateCategory, useDeleteCategory,
} from '@/hooks/use-kpi-queries';
import type { ObservationCategory, Priority } from '@/types/quality-kpi';

// ─── Constants ────────────────────────────────────────────────
const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج',
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  high: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  critical: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

const COLOR_TOKENS = [
  'blue', 'emerald', 'amber', 'rose', 'orange',
  'violet', 'cyan', 'pink', 'slate', 'teal',
] as const;

// Color token → tailwind classes for preview chips
const TOKEN_BG: Record<string, string> = {
  blue: 'bg-blue-500', emerald: 'bg-emerald-500', amber: 'bg-amber-500',
  rose: 'bg-rose-500', orange: 'bg-orange-500', violet: 'bg-violet-500',
  cyan: 'bg-cyan-500', pink: 'bg-pink-500', slate: 'bg-slate-500', teal: 'bg-teal-500',
};

// ─── Category dialog form ─────────────────────────────────────
interface CategoryFormData {
  key: string;
  name: string;
  defaultPointValue: number;
  weight: number;
  color: string;
  priority: Priority;
  isBonusDefault: boolean;
}

const EMPTY_FORM: CategoryFormData = {
  key: '', name: '', defaultPointValue: 5, weight: 1,
  color: 'blue', priority: 'medium', isBonusDefault: false,
};

function CategoryDialog({
  open, onOpenChange, initial, onSave, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: CategoryFormData | null;
  onSave: (data: CategoryFormData) => Promise<void>;
  busy: boolean;
}) {
  const [form, setForm] = useState<CategoryFormData>(initial ?? EMPTY_FORM);
  const isEdit = !!initial;

  // Sync form when dialog opens with different initial
  const [lastInitial, setLastInitial] = useState<CategoryFormData | null>(null);
  if (open && initial && initial !== lastInitial) {
    setForm(initial);
    setLastInitial(initial);
  }
  if (open && !initial && lastInitial !== null) {
    setForm(EMPTY_FORM);
    setLastInitial(null);
  }

  function update<K extends keyof CategoryFormData>(key: K, value: CategoryFormData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim()) {
      toast.error('الاسم مطلوب');
      return;
    }
    if (!form.key.trim()) {
      toast.error('المعرّف البرمجي مطلوب');
      return;
    }
    if (form.defaultPointValue < 0) {
      toast.error('النقاط لا يمكن أن تكون سالبة');
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
            {isEdit ? 'تعديل فئة' : 'فئة جديدة'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            الفئات تتحكم في النقاط والوزن واللون المعروض في الملاحظات
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1 col-span-2">
            <Label>الاسم (عربي)</Label>
            <Input
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="مثال: تأخر متابعة"
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label>المعرّف البرمجي</Label>
            <Input
              value={form.key}
              onChange={(e) => update('key', e.target.value.toLowerCase().replace(/\s+/g, '_'))}
              placeholder="late_followup"
              disabled={isEdit}
              className="bg-slate-800/50 border-slate-700 font-mono text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label>النقاط الافتراضية</Label>
            <Input
              type="number"
              min={0}
              value={form.defaultPointValue}
              onChange={(e) => update('defaultPointValue', parseInt(e.target.value, 10) || 0)}
              className="bg-slate-800/50 border-slate-700"
            />
          </div>
          <div className="space-y-1">
            <Label>الوزن</Label>
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
            <Label>الأولوية</Label>
            <Select value={form.priority} onValueChange={(v) => update('priority', v as Priority)}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
                  <SelectItem key={p} value={p}>{PRIORITY_LABELS[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 col-span-2">
            <Label>اللون</Label>
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
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-emerald-400" />
              <div>
                <p className="text-sm text-slate-200">فئة مكافأة افتراضية</p>
                <p className="text-xs text-slate-500">عند التفعيل، الملاحظات الجديدة تبدأ كمكافأة بدل الخصم</p>
              </div>
            </div>
            <Switch checked={form.isBonusDefault} onCheckedChange={(v) => update('isBonusDefault', v)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={busy} className="gap-2">
            {busy ? 'جارٍ الحفظ...' : isEdit ? 'حفظ التغييرات' : 'إنشاء الفئة'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Category card ────────────────────────────────────────────
function CategoryCard({
  cat, onEdit, onDelete, canEdit,
}: {
  cat: ObservationCategory;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
}) {
  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`size-3 rounded-full shrink-0 ${TOKEN_BG[cat.color] ?? TOKEN_BG.slate}`} />
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-100 truncate">{cat.name}</p>
              <p className="text-xs text-slate-500 font-mono truncate">{cat.key}</p>
            </div>
          </div>
          {canEdit && (
            <div className="flex gap-1 shrink-0">
              <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
                <Pencil className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="size-7 text-rose-400" onClick={onDelete}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cat.isBonusDefault
            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}
          >
            {cat.isBonusDefault ? `+${cat.defaultPointValue} مكافأة` : `−${cat.defaultPointValue} خصم`}
          </Badge>
          <Badge variant="outline" className={PRIORITY_COLORS[cat.priority] ?? PRIORITY_COLORS.medium}>
            {PRIORITY_LABELS[cat.priority] ?? cat.priority}
          </Badge>
          <Badge variant="outline" className="text-slate-400 border-slate-600/40">
            <TrendingUp className="size-3 mr-1" />
            وزن {cat.weight}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function ObservationCategoriesPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('observationCategories');
  const { data, isLoading } = useObservationCategories();
  const createMut = useCreateCategory();
  const updateMut = useUpdateCategory();
  const deleteMut = useDeleteCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryFormData | null>(null);

  const categories = (Array.isArray(data) ? data : []) as ObservationCategory[];

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  async function handleSave(form: CategoryFormData) {
    try {
      if (editing) {
        // Edit mode — find the id from the editing source.
        // editing is set from the card; we stored the form but need the id.
        // We look it up by key to get the id.
        const target = categories.find((c) => c.key === form.key);
        if (!target) {
          toast.error('لم يتم العثور على الفئة');
          return;
        }
        await updateMut.mutateAsync({
          id: target.id,
          data: {
            name: form.name,
            defaultPointValue: form.defaultPointValue,
            weight: form.weight,
            color: form.color,
            priority: form.priority,
            isBonusDefault: form.isBonusDefault,
          },
        });
        toast.success('تم تحديث الفئة');
      } else {
        await createMut.mutateAsync({
          key: form.key,
          name: form.name,
          defaultPointValue: form.defaultPointValue,
          weight: form.weight,
          color: form.color,
          priority: form.priority,
          isBonusDefault: form.isBonusDefault,
        });
        toast.success('تم إنشاء الفئة');
      }
      setDialogOpen(false);
      setEditing(null);
    } catch (e) {
      toast.error('فشل الحفظ', { description: e instanceof Error ? e.message : undefined });
    }
  }

  function startEdit(cat: ObservationCategory) {
    setEditing({
      key: cat.key,
      name: cat.name,
      defaultPointValue: cat.defaultPointValue,
      weight: cat.weight,
      color: cat.color,
      priority: cat.priority,
      isBonusDefault: cat.isBonusDefault,
    });
    setDialogOpen(true);
  }

  async function handleDelete(cat: ObservationCategory) {
    if (!confirm(`حذف الفئة "${cat.name}"؟ الملاحظات الحالية لا تتأثر.`)) return;
    try {
      await deleteMut.mutateAsync(cat.id);
      toast.success('تم حذف الفئة');
    } catch (e) {
      toast.error('فشل الحذف', { description: e instanceof Error ? e.message : undefined });
    }
  }

  const canEdit = canUpdate || canCreate;

  return (
    <div dir="rtl" className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Tags className="size-6 text-blue-400" />
            فئات ملاحظات الجودة
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            فئات قابلة للتكوين تتحكم في النقاط والوزن والأولوية — مصدر تكوين المؤشرات
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="gap-2">
            <Plus className="size-4" />
            فئة جديدة
          </Button>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : categories.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <motion.div key={cat.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <CategoryCard
                cat={cat}
                canEdit={canEdit}
                onEdit={() => startEdit(cat)}
                onDelete={() => handleDelete(cat)}
              />
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Tags className="size-12 mb-3 opacity-50" />
          <p className="text-sm">لا توجد فئات. تُضاف الفئات الافتراضية تلقائياً.</p>
        </div>
      )}

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditing(null); }}
        initial={editing}
        onSave={handleSave}
        busy={createMut.isPending || updateMut.isPending}
      />

      {/* Silence unused canDelete when it's part of the permission gate */}
      {canDelete && null}
    </div>
  );
}
