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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { FileText, Plus, Search, Star, Trash2, Clock, Sparkles, Heart } from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import { PageIdentity } from '@/components/shared/PageIdentity';
import {
  useObservationTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  useToggleTemplateFavorite,
  useObservationCategories,
} from '@/hooks/use-kpi-queries';
import type { ObservationTemplate, Severity } from '@/types/quality-kpi';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';

// ─── Constants ────────────────────────────────────────────────
const SEVERITY_LABELS: Record<string, [string, string]> = {
  low: ['منخفض', 'Low'], medium: ['متوسط', 'Medium'], high: ['عالٍ', 'High'], critical: ['حرج', 'Critical'],
};
const severityLabel = (code: string, locale: 'ar' | 'en'): string => {
  const pair = SEVERITY_LABELS[code];
  return pair ? (locale === 'en' ? pair[1] : pair[0]) : code;
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
  const { locale } = useLanguage();
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <Plus className="size-5 text-blue-400" />
            <T>قالب ملاحظة جديد</T>
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <T>القوالب تُسرّع إدخال الملاحظات المتكررة بنقاط وملاحظات افتراضية</T>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label><T>عنوان القالب *</T></Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={translateUIText('مثال: تأخر متابعة دوري', locale)} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label><T>التصنيف *</T></Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue placeholder={translateUIText('اختر التصنيف', locale)} /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label><T>الخطورة</T></Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as Severity)}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low"><T>منخفض</T></SelectItem>
                  <SelectItem value="medium"><T>متوسط</T></SelectItem>
                  <SelectItem value="high"><T>عالٍ</T></SelectItem>
                  <SelectItem value="critical"><T>حرج</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label><T>النقاط الافتراضية</T></Label>
              <Input type="number" min={0} value={defaultPoints} onChange={(e) => setDefaultPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
            </div>
            <div className="space-y-1 flex items-end pb-1">
              <div className="flex items-center gap-2">
                <Switch checked={isBonus} onCheckedChange={setIsBonus} />
                <Label><T>مكافأة بدل خصم</T></Label>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            <Label><T>الملاحظات الافتراضية</T></Label>
            <Textarea value={defaultNotes} onChange={(e) => setDefaultNotes(e.target.value)} rows={2} placeholder={translateUIText('تُملأ تلقائياً عند اختيار القالب', locale)} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label><T>الإجراء التصحيحي الافتراضي</T></Label>
            <Textarea value={correctiveAction} onChange={(e) => setCorrectiveAction(e.target.value)} rows={1} placeholder={translateUIText('إجراء تصحيحي مقترح', locale)} className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
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
  const { locale } = useLanguage();
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
              title={translateUIText('تفضيل', locale)}
            >
              {template.favoriteUserIds && template.favoriteUserIds.length > 0 ? (
                <Heart className="size-3.5 text-rose-400 fill-rose-400" />
              ) : (
                <Heart className="size-3.5 text-slate-500" />
              )}
            </Button>
            {/* §2 — SmartActionMenu */}
            {canDelete && (
              <SmartActionMenu
                size="sm"
                actions={[
                  { key: 'delete', label: 'حذف', icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: onDelete },
                ]}
              />
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
            {severityLabel(template.severity, locale)}
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
  const { locale } = useLanguage();
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

  // §4: deletion goes through the unified ConfirmDialog.
  const [deleteTarget, setDeleteTarget] = useState<ObservationTemplate | null>(null);
  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      logDelete('templates', 'قالب ملاحظة', deleteTarget.title);
      toast.success('تم حذف القالب');
      setDeleteTarget(null);
    } catch (e) {
      toast.error('فشل الحذف', { description: e instanceof Error ? e.message : undefined });
    }
  }

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p><T>ليس لديك صلاحية للوصول إلى هذه الصفحة</T></p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="observationTemplates"
        icon={<FileText className="size-5" />}
        iconClassName="bg-blue-500/15 border-blue-500/30 text-blue-400"
        title={translateUIText('قوالب الملاحظات', locale)}
        description={translateUIText('قوالب جاهزة لإدخال الملاحظات بسرعة — مع نقاط وملاحظات وإجراءات تصحيحية افتراضية', locale)}
        actions={canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            <T>قالب جديد</T>
          </Button>
        )}
      />

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
            placeholder={translateUIText('بحث في القوالب...', locale)}
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
            <p className="text-slate-400 text-sm font-medium"><T>لا توجد قوالب</T></p>
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
                onDelete={() => setDeleteTarget(t)}
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
            <T>القوالب تدعم الإنشاء والحذف والتفضيل فقط. تعديل محتوى القالب غير مدعوم حالياً — يمكن حذف القالب وإعادة إنشائه.</T>
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

      {/* §4: unified delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={translateUIText('سيتم حذف القالب نهائياً. الملاحظات المنشأة منه لا تتأثر.', locale)}
        itemName={deleteTarget?.title}
        loading={deleteMut.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
