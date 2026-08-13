'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { logCreate, logDelete } from '@/lib/activity-logger';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FileText, Plus, Search, Star, Trash2, Clock, Sparkles, Heart } from 'lucide-react';
import {
  useObservationTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  useToggleTemplateFavorite,
  useObservationCategories,
} from '@/hooks/use-kpi-queries';
import type { ObservationTemplate, Severity } from '@/types/quality-kpi';

// ─── Constants ────────────────────────────────────────────────
const SEVERITY_LABELS: Record<string, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  high: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  critical: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

type SortTab = 'recent' | 'favorites' | 'all';

const SORT_TABS: { value: SortTab; label: string; icon: typeof Clock }[] = [
  { value: 'recent', label: 'الأحدث استخداماً', icon: Clock },
  { value: 'favorites', label: 'المفضّلة', icon: Heart },
  { value: 'all', label: 'الكل', icon: FileText },
];

// ─── Create template dialog ────────────────────────────────────
function CreateTemplateDialog({
  open, onOpenChange, categories,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: Array<{ id: string; name: string }>;
}) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [defaultPoints, setDefaultPoints] = useState<number | ''>('');
  const [isBonus, setIsBonus] = useState(false);
  const [defaultNotes, setDefaultNotes] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [severity, setSeverity] = useState<Severity>('medium');

  const createMut = useCreateTemplate();

  async function handleSubmit() {
    if (!title.trim()) { toast.error('عنوان القالب مطلوب'); return; }
    if (!categoryId) { toast.error('التصنيف مطلوب'); return; }
    try {
      await createMut.mutateAsync({
        title,
        categoryId,
        defaultPoints: defaultPoints === '' ? 0 : defaultPoints,
        isBonus,
        defaultNotes,
        correctiveAction,
        severity,
      });
      logCreate('templates', 'قالب ملاحظة', title);
      toast.success('تم إنشاء القالب');
      onOpenChange(false);
      // Reset fields
      setTitle(''); setCategoryId(''); setDefaultPoints('');
      setIsBonus(false); setDefaultNotes(''); setCorrectiveAction('');
      setSeverity('medium');
    } catch (e) {
      toast.error('فشل الإنشاء', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <Plus className="size-5 text-blue-400" />
            قالب ملاحظة جديد
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            القوالب تُسرّع إدخال الملاحظات المتكررة بنقاط وملاحظات افتراضية
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>عنوان القالب *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثال: تأخر متابعة دوري" className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>التصنيف *</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الخطورة</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">منخفض</SelectItem>
                  <SelectItem value="medium">متوسط</SelectItem>
                  <SelectItem value="high">عالٍ</SelectItem>
                  <SelectItem value="critical">حرج</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>النقاط الافتراضية</Label>
              <Input type="number" min={0} value={defaultPoints} onChange={(e) => setDefaultPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
            </div>
            <div className="space-y-1 flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Switch checked={isBonus} onCheckedChange={setIsBonus} />
                <Label>مكافأة بدل خصم</Label>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label>الملاحظات الافتراضية</Label>
            <Textarea value={defaultNotes} onChange={(e) => setDefaultNotes(e.target.value)} rows={2} placeholder="تُملأ تلقائياً عند اختيار القالب" className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label>الإجراء التصحيحي الافتراضي</Label>
            <Textarea value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} rows={1} placeholder="إجراء تصحيحي مقترح" className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending} className="gap-2">
            <Plus className="size-4" />
            {createMut.isPending ? 'جاري الإنشاء...' : 'إنشاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Template card ────────────────────────────────────────────
function TemplateCard({
  template, canDelete, onToggleFavorite, onDelete,
}: {
  template: ObservationTemplate;
  canDelete: boolean;
  onToggleFavorite: () => void;
  onDelete: () => void;
}) {
  // NOTE: Full edit UI is intentionally omitted.
  // The backend PATCH endpoint only supports toggle_favorite — there is no
  // generic update endpoint for templates. Editing fields (title, notes, etc.)
  // would require a new backend route which is out of scope for Milestone 8.
  return (
    <Card className="bg-slate-800/30 border-slate-700/40 hover:border-slate-600/50 transition-colors">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-100 truncate">{template.title}</p>
            <p className="text-xs text-slate-500 truncate">{template.categoryName}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onToggleFavorite}
              title="تفضيل"
            >
              {template.favoriteUserIds && template.favoriteUserIds.length > 0 ? (
                <Heart className="size-3.5 text-rose-400 fill-rose-400" />
              ) : (
                <Heart className="size-3.5 text-slate-500" />
              )}
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-rose-400"
                onClick={onDelete}
                title="حذف"
              >
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        {template.defaultNotes && (
          <p className="text-xs text-slate-400 line-clamp-2">{template.defaultNotes}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={template.isBonus
            ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
            : 'text-rose-400 border-rose-500/30 bg-rose-500/10'}
          >
            {template.isBonus ? `+${template.defaultPoints} مكافأة` : `−${template.defaultPoints} خصم`}
          </Badge>
          <Badge variant="outline" className={SEVERITY_COLORS[template.severity] ?? SEVERITY_COLORS.medium}>
            {SEVERITY_LABELS[template.severity] ?? template.severity}
          </Badge>
          <Badge variant="outline" className="text-slate-400 border-slate-600/40">
            <Sparkles className="size-3 mr-1" />
            {template.usageCount} استخدام
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function ObservationTemplatesPage() {
  const { canView, canCreate, canDelete } = usePermissions('observationTemplates');

  const [sortTab, setSortTab] = useState<SortTab>('recent');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  // Fetch based on active tab.
  const sortParam = sortTab === 'favorites' ? 'favorites' : sortTab === 'recent' ? 'recent' : undefined;
  const { data, isLoading } = useObservationTemplates(sortParam);
  const { data: categoriesData } = useObservationCategories();

  const templates: ObservationTemplate[] = Array.isArray(data) ? data : [];
  const categories: Array<{ id: string; name: string }> = Array.isArray(categoriesData) ? categoriesData : [];

  // Client-side search.
  const filtered = useMemo(() => {
    if (!search.trim()) return templates;
    const q = search.toLowerCase();
    return templates.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.categoryName.toLowerCase().includes(q) ||
      t.defaultNotes.toLowerCase().includes(q),
    );
  }, [templates, search]);

  const toggleFavMut = useToggleTemplateFavorite();
  const deleteMut = useDeleteTemplate();

  async function handleToggleFavorite(id: string) {
    try {
      await toggleFavMut.mutateAsync(id);
    } catch (e) {
      toast.error('فشل التحديث', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function handleDelete(template: ObservationTemplate) {
    if (!confirm(`حذف القالب "${template.title}"؟`)) return;
    try {
      await deleteMut.mutateAsync(template.id);
      logDelete('templates', 'قالب ملاحظة', template.title);
      toast.success('تم حذف القالب');
    } catch (e) {
      toast.error('فشل الحذف', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <FileText className="size-6 text-blue-400" />
            قوالب الملاحظات
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            قوالب جاهزة لإدخال الملاحظات بسرعة — مع نقاط وملاحظات وإجراءات تصحيحية افتراضية
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            قالب جديد
          </Button>
        )}
      </div>

      {/* Sort tabs + search */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-slate-700/40 bg-slate-800/30 p-1">
          {SORT_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.value}
                onClick={() => setSortTab(tab.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  sortTab === tab.value
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="size-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث في القوالب..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 bg-slate-800/50 border-slate-700"
          />
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <FileText className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد قوالب</p>
            <p className="text-slate-600 text-xs mt-1">
              {search || sortTab !== 'all'
                ? 'لم يتم العثور على قوالب مع المعايير المحددة'
                : 'لم يتم إنشاء أي قوالب بعد. أنشئ قالباً لتسريع إدخال الملاحظات.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.02 }}
            >
              <TemplateCard
                template={t}
                canDelete={canDelete}
                onToggleFavorite={() => handleToggleFavorite(t.id)}
                onDelete={() => handleDelete(t)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Info note about edit limitation */}
      <Card className="border-slate-700/40 bg-slate-800/20">
        <CardContent className="p-3">
          <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
            <FileText className="size-3" />
            القوالب تدعم الإنشاء والحذف والتفضيل فقط. تعديل محتوى القالب غير مدعوم حالياً — يمكن حذف القالب وإعادة إنشائه.
          </p>
        </CardContent>
      </Card>

      {/* Create dialog */}
      {createOpen && (
        <CreateTemplateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          categories={categories}
        />
      )}
    </div>
  );
}
