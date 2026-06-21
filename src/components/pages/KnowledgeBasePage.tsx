'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import {
  useKnowledgeBase,
  useEmployees,
  useCreateKnowledgeArticle,
  useUpdateKnowledgeArticle,
  useDeleteKnowledgeArticle,
} from '@/hooks/use-queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  BookOpen,
  Plus,
  Pencil,
  Search,
  X,
  Trash2,
  ShieldCheck,
  CalendarDays,
  User,
  Tag,
  FileText,
  Building2,
} from 'lucide-react';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface KnowledgeArticle {
  id: string;
  title: string;
  problem: string;
  rootCause?: string;
  solution: string;
  preventionMethod?: string;
  department: string;
  category: string;
  tags?: string;
  status: string;
  authorId: string;
  createdAt: string;
  updatedAt: string;
  author?: { id: string; name: string; department: string | null } | null;
}

interface ArticleFormData {
  title: string;
  problem: string;
  rootCause: string;
  solution: string;
  preventionMethod: string;
  department: string;
  category: string;
  tags: string;
  status: string;
  authorId: string;
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const DEPARTMENTS = [
  { value: 'operations', label: 'العمليات' },
  { value: 'quality', label: 'الجودة' },
  { value: 'hr', label: 'الموارد البشرية' },
  { value: 'sales', label: 'المبيعات' },
  { value: 'it', label: 'تكنولوجيا المعلومات' },
  { value: 'finance', label: 'المالية' },
];

const STATUS_OPTIONS = [
  { value: 'draft', label: 'مسودة' },
  { value: 'published', label: 'منشور' },
  { value: 'archived', label: 'مؤرشف' },
];

const emptyForm: ArticleFormData = {
  title: '',
  problem: '',
  rootCause: '',
  solution: '',
  preventionMethod: '',
  department: 'operations',
  category: '',
  tags: '',
  status: 'draft',
  authorId: '',
};

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function getDepartmentBadge(dept: string) {
  const found = DEPARTMENTS.find((d) => d.value === dept);
  return found?.label || dept;
}

function getDepartmentColor(dept: string) {
  switch (dept) {
    case 'operations': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
    case 'quality': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
    case 'hr': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
    case 'sales': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'it': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'finance': return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function getStatusBadge(status: string) {
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found?.label || status;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'draft': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'published': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
    case 'archived': return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function parseTags(tagsStr: string | undefined | null): string[] {
  if (!tagsStr) return [];
  return tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function KnowledgeBasePage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('knowledgeBase');

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingArticle, setEditingArticle] = useState<KnowledgeArticle | null>(null);
  const [form, setForm] = useState<ArticleFormData>({ ...emptyForm });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Queries
  const { data: kbData, isLoading } = useKnowledgeBase();
  const { data: employeesData } = useEmployees();
  const createMutation = useCreateKnowledgeArticle();
  const updateMutation = useUpdateKnowledgeArticle();
  const deleteMutation = useDeleteKnowledgeArticle();

  // Parse response data
  const articles: KnowledgeArticle[] = kbData?.data || kbData || [];
  const employees: any[] = employeesData || [];

  // Filtered articles
  const filtered = useMemo(() => {
    return articles.filter((a) => {
      const searchLower = search.toLowerCase();
      const matchesSearch =
        !search ||
        a.title?.toLowerCase().includes(searchLower) ||
        a.problem?.toLowerCase().includes(searchLower) ||
        a.rootCause?.toLowerCase().includes(searchLower) ||
        a.solution?.toLowerCase().includes(searchLower);

      const matchesDepartment =
        departmentFilter === 'all' || a.department === departmentFilter;

      const matchesStatus =
        statusFilter === 'all' || a.status === statusFilter;

      const matchesCategory =
        !categoryFilter || a.category?.toLowerCase().includes(categoryFilter.toLowerCase());

      return matchesSearch && matchesDepartment && matchesStatus && matchesCategory;
    });
  }, [articles, search, departmentFilter, statusFilter, categoryFilter]);

  // Stats
  const stats = useMemo(() => {
    const total = articles.length;
    const publishedCount = articles.filter((a) => a.status === 'published').length;
    const draftCount = articles.filter((a) => a.status === 'draft').length;
    return { total, publishedCount, draftCount };
  }, [articles]);

  // ═══ Access denied guard ═══
  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <ShieldCheck className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400">صلاحية غير كافية</h2>
        <p className="text-slate-500 mt-2">هذه الصفحة غير متاحة لحسابك</p>
      </div>
    );
  }

  // ═══ Form handlers ═══
  const openCreateDialog = () => {
    setEditingArticle(null);
    setForm({ ...emptyForm });
    setIsDialogOpen(true);
  };

  const openEditDialog = (article: KnowledgeArticle) => {
    setEditingArticle(article);
    setForm({
      title: article.title || '',
      problem: article.problem || '',
      rootCause: article.rootCause || '',
      solution: article.solution || '',
      preventionMethod: article.preventionMethod || '',
      department: article.department || 'operations',
      category: article.category || '',
      tags: article.tags || '',
      status: article.status || 'draft',
      authorId: article.authorId || '',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim() || !form.problem.trim() || !form.solution.trim()) return;

    const payload: Record<string, any> = {
      title: form.title.trim(),
      problem: form.problem.trim(),
      rootCause: form.rootCause.trim() || null,
      solution: form.solution.trim(),
      preventionMethod: form.preventionMethod.trim() || null,
      department: form.department,
      category: form.category.trim() || null,
      tags: form.tags.trim() || null,
      status: form.status,
      authorId: form.authorId || null,
    };

    try {
      if (editingArticle) {
        await updateMutation.mutateAsync({ id: editingArticle.id, data: payload });
        logUpdate('knowledgeBase', 'مقال قاعدة المعرفة', form.title);
      } else {
        await createMutation.mutateAsync(payload);
        logCreate('knowledgeBase', 'مقال قاعدة المعرفة', form.title);
      }
      setIsDialogOpen(false);
      setEditingArticle(null);
      setForm({ ...emptyForm });
    } catch {
      // Error handled silently
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const article = articles.find((a) => a.id === id);
      await deleteMutation.mutateAsync(id);
      if (article) {
        logDelete('knowledgeBase', 'مقال قاعدة المعرفة', article.title);
      }
      setDeletingId(null);
    } catch {
      // Error handled silently
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-cyan-500/15 border border-cyan-500/30">
            <BookOpen className="size-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">قاعدة المعرفة</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {filtered.length} مقال معرفي
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-cyan-600 hover:bg-cyan-700 text-white h-9 px-4"
          >
            <Plus className="size-4 ml-1" />
            إضافة مقال
          </Button>
        )}
      </motion.div>

      {/* ═══ Stats Row ═══ */}
      {articles.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-2.5"
        >
          <div className="rounded-lg border border-slate-500/25 bg-slate-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">إجمالي المقالات</p>
            <p className="text-slate-300 font-bold text-lg leading-tight">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-violet-500/30 bg-emerald-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">منشورة</p>
            <p className="text-violet-400 font-bold text-lg leading-tight">{stats.publishedCount}</p>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">مسودات</p>
            <p className="text-amber-400 font-bold text-lg leading-tight">{stats.draftCount}</p>
          </div>
        </motion.div>
      )}

      {/* ═══ Filters ═══ */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث بالعنوان أو المشكلة أو الحل..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <Building2 className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder="القسم" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d.value} value={d.value} className="text-white">
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <FileText className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder="الحالة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-white">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-40">
          <Tag className="absolute right-3 top-1/2 -translate-y-1/2 size-3.5 text-slate-500" />
          <Input
            placeholder="الفئة..."
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm"
          />
          {categoryFilter && (
            <button
              onClick={() => setCategoryFilter('')}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ═══ Loading ═══ */}
      {isLoading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <BookOpen className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد مقالات</p>
            <p className="text-slate-600 text-xs mt-1">
              {search || departmentFilter !== 'all' || statusFilter !== 'all' || categoryFilter
                ? 'لم يتم العثور على نتائج'
                : 'لم يتم إضافة أي مقالات بعد'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((article) => {
              const tags = parseTags(article.tags);

              return (
                <motion.div
                  key={article.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5, transition: { duration: 0.15 } }}
                  layout
                >
                  <Card className="border-slate-700/40 bg-slate-800/50 hover:bg-slate-800/70 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      {/* Top row: title, badges, actions */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-white font-semibold text-sm">{article.title}</h3>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getDepartmentColor(article.department)}`}
                          >
                            {getDepartmentBadge(article.department)}
                          </Badge>
                          {article.category && (
                            <Badge
                              variant="outline"
                              className="text-[10px] px-2 py-0 h-5 border bg-slate-500/15 text-slate-400 border-slate-500/30"
                            >
                              {article.category}
                            </Badge>
                          )}
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getStatusColor(article.status)}`}
                          >
                            {getStatusBadge(article.status)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-700/50"
                              onClick={() => openEditDialog(article)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => setDeletingId(article.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Problem (truncated) */}
                      <div className="space-y-1">
                        <p className="text-slate-500 text-[10px] font-medium">المشكلة</p>
                        <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
                          {article.problem}
                        </p>
                      </div>

                      {/* Solution (truncated) */}
                      <div className="space-y-1">
                        <p className="text-slate-500 text-[10px] font-medium">الحل</p>
                        <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
                          {article.solution}
                        </p>
                      </div>

                      {/* Tags */}
                      {tags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {tags.map((tag, idx) => (
                            <span
                              key={idx}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-400 border border-slate-600/30"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Meta row */}
                      <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 pt-1 border-t border-slate-700/30">
                        {article.author && (
                          <span className="flex items-center gap-1">
                            <User className="size-3" />
                            {article.author.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <CalendarDays className="size-3" />
                          تاريخ الإنشاء: {formatDate(article.createdAt)}
                        </span>
                        {article.updatedAt && article.updatedAt !== article.createdAt && (
                          <span className="flex items-center gap-1 text-slate-600">
                            تعديل: {formatDate(article.updatedAt)}
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ Add/Edit Dialog ═══ */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); setEditingArticle(null); } }}>
        <DialogContent className="bg-slate-900 border-slate-700/60 max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">
              {editingArticle ? 'تعديل المقال' : 'إضافة مقال جديد'}
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              {editingArticle ? 'قم بتعديل بيانات المقال' : 'أدخل بيانات المقال المعرفي الجديد'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">العنوان *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                placeholder="عنوان المقال"
              />
            </div>

            {/* Problem */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">المشكلة *</Label>
              <Textarea
                value={form.problem}
                onChange={(e) => setForm((p) => ({ ...p, problem: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[80px] resize-none"
                placeholder="وصف المشكلة بالتفصيل"
              />
            </div>

            {/* Root Cause */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">السبب الجذري</Label>
              <Textarea
                value={form.rootCause}
                onChange={(e) => setForm((p) => ({ ...p, rootCause: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder="السبب الجذري للمشكلة"
              />
            </div>

            {/* Solution */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الحل *</Label>
              <Textarea
                value={form.solution}
                onChange={(e) => setForm((p) => ({ ...p, solution: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[80px] resize-none"
                placeholder="الحل المقترح أو المُطبّق"
              />
            </div>

            {/* Prevention Method */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">طريقة الوقاية</Label>
              <Textarea
                value={form.preventionMethod}
                onChange={(e) => setForm((p) => ({ ...p, preventionMethod: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder="كيفية الوقاية من تكرار المشكلة"
              />
            </div>

            {/* Row: Department + Category */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">القسم</Label>
                <Select value={form.department} onValueChange={(v) => setForm((p) => ({ ...p, department: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d.value} value={d.value} className="text-white">
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">الفئة</Label>
                <Input
                  value={form.category}
                  onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder="الفئة"
                />
              </div>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الوسوم</Label>
              <Input
                value={form.tags}
                onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                placeholder="وسوم مفصولة بفواصل (مثال: جودة، تدريب، إجراء)"
              />
            </div>

            {/* Row: Status + Author */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">الحالة</Label>
                <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-white">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">الكاتب</Label>
                <Select value={form.authorId} onValueChange={(v) => setForm((p) => ({ ...p, authorId: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue placeholder="اختر الكاتب" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-white">— بدون —</SelectItem>
                    {employees.map((emp: any) => (
                      <SelectItem key={emp.id} value={emp.id} className="text-white">
                        {emp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => { setIsDialogOpen(false); setEditingArticle(null); }}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.title.trim() || !form.problem.trim() || !form.solution.trim()}
              className="bg-cyan-600 hover:bg-cyan-700 text-white"
            >
              {isSaving ? 'جاري الحفظ...' : editingArticle ? 'حفظ التعديلات' : 'إضافة المقال'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation Dialog ═══ */}
      <Dialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <DialogContent className="bg-slate-900 border-slate-700/60 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              هل أنت متأكد من حذف هذا المقال؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDeletingId(null)}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              إلغاء
            </Button>
            <Button
              onClick={() => deletingId && handleDelete(deletingId)}
              disabled={deleteMutation.isPending}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleteMutation.isPending ? 'جاري الحذف...' : 'حذف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}