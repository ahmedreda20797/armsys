'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { logCreate, logUpdate, logDelete, logApprove } from '@/lib/activity-logger';
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
import {
  Eye, Plus, Search, Filter, Trash2, Pencil, Check, X, Star, Clock,
  ClipboardList, FileText, Info, Lock, ShieldAlert, Copy, ExternalLink, Link2,
} from 'lucide-react';
import { ApprovalStatusBadge } from '@/components/shared/kpi';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { TimelineView } from '@/components/shared/audit';
import { ApprovalHistoryTimeline } from '@/components/shared/approval';
import { buildTimeline } from '@/lib/audit/timeline-builder';
import {
  classifyEvidence,
  truncateEvidenceForDisplay,
  EVIDENCE_EMPTY_LABEL,
} from '@/lib/quality-observations/evidence';
import { useEmployees } from '@/hooks/use-queries';
import {
  useObservations, useObservationCategories, useObservationTemplates,
  useCreateObservation, useUpdateObservation, useDeleteObservation,
  useApproveObservation, useRejectObservation, useMonthSnapshots,
  type ObservationsParams,
} from '@/hooks/use-kpi-queries';
import type { QualityObservation } from '@/types/quality-kpi';

// ─── Helpers ──────────────────────────────────────────────────
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

const SEVERITY_LABELS: Record<string, string> = {
  low: 'منخفض', medium: 'متوسط', high: 'عالٍ', critical: 'حرج',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'مفتوحة', in_review: 'قيد المراجعة', resolved: 'تم الحل', closed: 'مغلقة',
};

// ─── Page ─────────────────────────────────────────────────────
export default function ObservationsPage() {
  const { canView, canCreate, canUpdate, canDelete, canApprove, isAdmin } = usePermissions('observations');

  // Filters
  const [filters, setFilters] = useState<ObservationsParams>({ month: CURRENT_MONTH });
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  // Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<QualityObservation | null>(null);
  const [approveTarget, setApproveTarget] = useState<QualityObservation | null>(null);
  const [rejectTarget, setRejectTarget] = useState<QualityObservation | null>(null);
  const [detailTarget, setDetailTarget] = useState<QualityObservation | null>(null);

  // Data
  const { data: observations, isLoading } = useObservations(filters);
  const { data: categories } = useObservationCategories();
  const { data: templates } = useObservationTemplates('recent');
  const { data: employeesData } = useEmployees();
  const { data: snapshotsData } = useMonthSnapshots();

  // Closed months (frozen) — mutations are locked for every role; the UI
  // hides edit/delete and shows a locked state. The backend enforces the
  // same rule authoritatively.
  const closedMonths = useMemo(() => {
    const snaps = Array.isArray(snapshotsData) ? snapshotsData : [];
    return new Set(
      snaps
        .filter((s) => (s as Record<string, unknown>).status === 'closed')
        .map((s) => String((s as Record<string, unknown>).monthKey)),
    );
  }, [snapshotsData]);
  const employeeList: Array<{ id: string; name: string; department: string | null; position: string | null; code: string | null; mobile: string | null; email?: string | null }> = Array.isArray(employeesData) ? employeesData : [];

  const obsList: QualityObservation[] = Array.isArray(observations) ? observations : [];

  // Distinct departments for the filter dropdown.
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const e of employeeList) {
      if (e.department) set.add(e.department);
    }
    return Array.from(set).sort();
  }, [employeeList]);

  const categoriesList = Array.isArray(categories) ? categories : [];

  // Client-side search (supplements server filters)
  const filtered = useMemo(() => {
    if (!search.trim()) return obsList;
    const q = search.toLowerCase();
    return obsList.filter((o) =>
      o.employeeName?.toLowerCase().includes(q) ||
      o.notes?.toLowerCase().includes(q) ||
      o.type?.toLowerCase().includes(q) ||
      o.categoryName?.toLowerCase().includes(q),
    );
  }, [obsList, search]);

  function clearFilters() {
    setFilters({ month: CURRENT_MONTH });
  }

  const deleteMut = useDeleteObservation();

  async function handleDelete(obs: QualityObservation) {
    if (!confirm(`حذف ملاحظة الجودة للموظف ${obs.employeeName}؟`)) return;
    try {
      await deleteMut.mutateAsync(obs.id);
      logDelete('observations', 'ملاحظة', obs.employeeName);
      toast.success('تم حذف الملاحظة');
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
            <Eye className="size-6 text-blue-400" />
            ملاحظات الجودة
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            إدارة ملاحظات الجودة واعتمادها — المصدر الأساسي لمؤشرات الأداء
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <Plus className="size-4" />
            ملاحظة جديدة
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 bg-slate-800/50 border-slate-700"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters((s) => !s)} className="gap-2">
          <Filter className="size-4" /> فلترة
        </Button>
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-slate-400">
            مسح الفلاتر
          </Button>
        )}
      </div>

      {/* Filters panel — expanded with Department, Employee, Category, Status */}
      {showFilters && (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">الشهر</Label>
              <Input
                type="month"
                value={filters.month ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
                className="bg-slate-800/50 border-slate-700"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">حالة الاعتماد</Label>
              <Select
                value={filters.approvalStatus ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, approvalStatus: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="pending">بانتظار الاعتماد</SelectItem>
                  <SelectItem value="approved">معتمدة</SelectItem>
                  <SelectItem value="rejected">مرفوضة</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">النوع</Label>
              <Select
                value={filters.isBonus ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, isBonus: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="false">خصومات</SelectItem>
                  <SelectItem value="true">مكافآت</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">القسم</Label>
              <Select
                value={filters.department ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, department: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الأقسام</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">الموظف</Label>
              <EmployeeSearchInput
                employees={employeeList}
                value={filters.employeeId ?? ''}
                onChange={(id) => setFilters((f) => ({ ...f, employeeId: id === 'all' ? undefined : id }))}
                placeholder="فلتر حسب الموظف"
                variant="filter"
                showDepartment
                showAllOption
                allOptionValue="all"
                allOptionLabel="كل الموظفين"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">التصنيف</Label>
              <Select
                value={filters.categoryId ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, categoryId: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  {categoriesList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400">الحالة</Label>
              <Select
                value={filters.status ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="open">مفتوحة</SelectItem>
                  <SelectItem value="in_review">قيد المراجعة</SelectItem>
                  <SelectItem value="resolved">تم الحل</SelectItem>
                  <SelectItem value="closed">مغلقة</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip label="الإجمالي" value={obsList.length} icon={ClipboardList} className="text-slate-300" />
        <StatChip label="بانتظار الاعتماد" value={obsList.filter((o) => o.approvalStatus === 'pending').length} icon={Clock} className="text-amber-400" />
        <StatChip label="معتمدة" value={obsList.filter((o) => o.approvalStatus === 'approved').length} icon={Check} className="text-emerald-400" />
        <StatChip label="مرفوضة" value={obsList.filter((o) => o.approvalStatus === 'rejected').length} icon={X} className="text-rose-400" />
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState hasFilters={!!search || Object.values(filters).some(Boolean)} />
      ) : (
        <div className="space-y-3">
          {filtered.map((obs, i) => (
            <motion.div
              key={obs.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
            >
              <ObservationCard
                obs={obs}
                canUpdate={canUpdate}
                canDelete={canDelete}
                canApprove={canApprove}
                isAdmin={isAdmin}
                monthClosed={closedMonths.has(obs.month)}
                onEdit={() => setEditTarget(obs)}
                onDelete={() => handleDelete(obs)}
                onApprove={() => setApproveTarget(obs)}
                onReject={() => setRejectTarget(obs)}
                onDetails={() => setDetailTarget(obs)}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <CreateObservationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        categories={categoriesList}
        templates={Array.isArray(templates) ? templates : []}
        employees={employeeList}
      />

      {/* Edit dialog */}
      {editTarget && (
        <EditObservationDialog
          obs={editTarget}
          open={!!editTarget}
          onOpenChange={(o) => !o && setEditTarget(null)}
          categories={categoriesList}
        />
      )}

      {/* Approve dialog */}
      {approveTarget && (
        <ApproveDialog obs={approveTarget} open={!!approveTarget} onOpenChange={(o) => !o && setApproveTarget(null)} />
      )}

      {/* Reject dialog */}
      {rejectTarget && (
        <RejectDialog obs={rejectTarget} open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)} />
      )}

      {/* Detail dialog — timeline + approval history */}
      {detailTarget && (
        <ObservationDetailDialog
          obs={detailTarget}
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          canApprove={canApprove}
          canUpdate={canUpdate}
          canDelete={canDelete}
          isAdmin={isAdmin}
          monthClosed={closedMonths.has(detailTarget.month)}
          onApprove={() => { setDetailTarget(null); setApproveTarget(detailTarget); }}
          onReject={() => { setDetailTarget(null); setRejectTarget(detailTarget); }}
          onEdit={() => { setDetailTarget(null); setEditTarget(detailTarget); }}
          onDelete={() => { setDetailTarget(null); handleDelete(detailTarget); }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function StatChip({ label, value, icon: Icon, className }: { label: string; value: number; icon: typeof ClipboardList; className?: string }) {
  return (
    <Card className="border-slate-700/40 bg-slate-800/30">
      <CardContent className="flex items-center gap-3 py-3">
        <Icon className={`size-5 ${className ?? ''}`} />
        <div>
          <p className="text-lg font-bold tabular-nums">{value}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <Card className="border-slate-700/40 bg-slate-800/30">
      <CardContent className="flex flex-col items-center justify-center py-14">
        <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
          <Eye className="size-6 text-slate-600" />
        </div>
        <p className="text-slate-400 text-sm font-medium">لا توجد ملاحظات</p>
        <p className="text-slate-600 text-xs mt-1">
          {hasFilters ? 'لم يتم العثور على نتائج مع الفلاتر المحددة' : 'لم يتم تسجيل أي ملاحظات جودة بعد'}
        </p>
      </CardContent>
    </Card>
  );
}

function ObservationCard({
  obs, canUpdate, canDelete, canApprove, isAdmin, monthClosed,
  onEdit, onDelete, onApprove, onReject, onDetails,
}: {
  obs: QualityObservation;
  canUpdate: boolean;
  canDelete: boolean;
  canApprove: boolean;
  isAdmin: boolean;
  monthClosed: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onApprove: () => void;
  onReject: () => void;
  onDetails: () => void;
}) {
  const openEmployee360 = useAppStore((s) => s.openEmployee360);

  // Approved observations are editable/deletable ONLY by Admin, and only
  // while the month is OPEN (backend enforces the same policy).
  const approved = obs.approvalStatus === 'approved';
  const canEditThis = canUpdate && !monthClosed && (!approved || isAdmin);
  const canDeleteThis = canDelete && !monthClosed && (!approved || isAdmin);

  return (
    <Card className="border-slate-700/40 bg-slate-800/30 hover:border-slate-600/50 transition-colors">
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="font-semibold text-slate-100 hover:text-blue-400 transition-colors"
                onClick={() => openEmployee360(obs.employeeId)}
              >
                {obs.employeeName}
              </button>
              <Badge variant="outline" className="bg-slate-700/30 text-slate-300">{obs.department}</Badge>
              <ApprovalStatusBadge status={obs.approvalStatus} />
              {obs.isBonus ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20">+{obs.points} مكافأة</Badge>
              ) : obs.applyPointDeduction ? (
                <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20">-{obs.points} خصم</Badge>
              ) : null}
            </div>
            <p className="text-sm text-slate-400 mt-1 line-clamp-2">{obs.notes || '—'}</p>
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
              <span>{obs.categoryName}</span><span>•</span>
              <span>{obs.observationDate}</span><span>•</span>
              <span>{SEVERITY_LABELS[obs.severity] ?? obs.severity}</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="ghost" className="gap-1.5 text-slate-400" onClick={onDetails}>
              <Info className="size-3.5" /> تفاصيل
            </Button>
            {monthClosed ? (
              <Badge variant="outline" className="justify-center gap-1 text-blue-400 border-blue-500/30 text-[10px]">
                <Lock className="size-3" /> الشهر مغلق
              </Badge>
            ) : (
              <>
                {canApprove && obs.applyPointDeduction && obs.approvalStatus === 'pending' && (
                  <>
                    <Button size="sm" variant="outline" className="gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={onApprove}>
                      <Check className="size-3.5" /> اعتماد
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 border-rose-500/30 text-rose-400 hover:bg-rose-500/10" onClick={onReject}>
                      <X className="size-3.5" /> رفض
                    </Button>
                  </>
                )}
                {canEditThis && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-slate-400" onClick={onEdit}>
                    <Pencil className="size-3.5" /> تعديل
                  </Button>
                )}
                {canDeleteThis && (
                  <Button size="sm" variant="ghost" className="gap-1.5 text-rose-400" onClick={onDelete}>
                    <Trash2 className="size-3.5" /> حذف
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Detail dialog (timeline + approval history) ─────────────

function ObservationDetailDialog({
  obs, open, onOpenChange, canApprove, canUpdate, canDelete, isAdmin, monthClosed,
  onApprove, onReject, onEdit, onDelete,
}: {
  obs: QualityObservation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  canApprove: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  isAdmin: boolean;
  monthClosed: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const openEmployee360 = useAppStore((s) => s.openEmployee360);

  // Approved observations are editable/deletable ONLY by Admin, and only
  // while the month is OPEN (backend enforces the same policy).
  const approved = obs.approvalStatus === 'approved';
  const canEditThis = canUpdate && !monthClosed && (!approved || isAdmin);
  const canDeleteThis = canDelete && !monthClosed && (!approved || isAdmin);

  // Derive the timeline using the pure lib function (client-safe, no business logic).
  const timeline = useMemo(
    () => buildTimeline(obs.auditLog ?? [], obs.approvalHistory ?? []),
    [obs.auditLog, obs.approvalHistory],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>تفاصيل الملاحظة</DialogTitle>
          <DialogDescription>{obs.employeeName} — {obs.observationDate}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <InfoCell label="الموظف" value={obs.employeeName} onClick={() => openEmployee360(obs.employeeId)} />
            <InfoCell label="القسم" value={obs.department} />
            <InfoCell label="التصنيف" value={obs.categoryName} />
            <InfoCell label="الخطورة" value={SEVERITY_LABELS[obs.severity] ?? obs.severity} />
            <InfoCell label="الحالة" value={STATUS_LABELS[obs.status] ?? obs.status} />
            <InfoCell label="الاعتماد" value={obs.approvalStatus} />
            <InfoCell label="النقاط" value={obs.applyPointDeduction ? `${obs.isBonus ? '+' : '-'}${obs.points}` : '—'} />
            <InfoCell label="الملاحظ" value={obs.observerName} />
            <InfoCell label="تاريخ الإنشاء" value={new Date(obs.createdAt).toLocaleDateString('ar-EG')} />
            {obs.correctiveAction && <InfoCell label="الإجراء التصحيحي" value={obs.correctiveAction} />}
            {obs.dueDate && <InfoCell label="تاريخ الاستحقاق" value={obs.dueDate} />}
            {obs.resolvedDate && <InfoCell label="تاريخ الحل" value={obs.resolvedDate} />}
          </div>

          {obs.notes && (
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="text-[11px] text-slate-400 mb-1">الملاحظات</p>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{obs.notes}</p>
            </div>
          )}

          {/* Evidence viewer — read-only presentation of the stored evidence field */}
          <ObservationEvidenceSection evidence={obs.evidence} />

          {/* Action buttons */}
          {monthClosed ? (
            <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/5 px-3 py-2">
              <Lock className="size-4 text-blue-400 shrink-0" />
              <p className="text-xs text-blue-300">
                الشهر {obs.month} مغلق — لا يمكن تعديل أو حذف أو اعتماد ملاحظاته
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canApprove && obs.applyPointDeduction && obs.approvalStatus === 'pending' && (
                <>
                  <Button size="sm" className="gap-1.5" onClick={onApprove}>
                    <Check className="size-3.5" /> اعتماد
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={onReject}>
                    <X className="size-3.5" /> رفض
                  </Button>
                </>
              )}
              {canEditThis && approved && isAdmin && (
                <Button size="sm" variant="outline" className="gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={onEdit}>
                  <ShieldAlert className="size-3.5" /> تعديل (مدير النظام)
                </Button>
              )}
              {canEditThis && !approved && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
                  <Pencil className="size-3.5" /> تعديل
                </Button>
              )}
              {canDeleteThis && approved && isAdmin && (
                <Button size="sm" variant="outline" className="gap-1.5 border-rose-500/40 text-rose-400 hover:bg-rose-500/10" onClick={onDelete}>
                  <Trash2 className="size-3.5" /> حذف (مدير النظام)
                </Button>
              )}
            </div>
          )}

          {/* Approval history (append-only, backend-provided) */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-400" /> سجل الاعتماد
            </h4>
            <ApprovalHistoryTimeline events={obs.approvalHistory ?? []} />
          </div>

          {/* Full timeline (derived via pure lib buildTimeline) */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Clock className="size-3.5 text-blue-400" /> سجل الأحداث
            </h4>
            <TimelineView points={timeline} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Evidence viewer (الدليل / الإثبات) ──────────────────────

/**
 * Dedicated evidence section inside the Observation Detail dialog.
 *
 * Renders the STORED `evidence` field as-is (no new fetch, no
 * mutation, no audit event). Three kinds, classified by the pure
 * lib helper:
 *   • url   → link preview (visually truncated, break-all) +
 *             نسخ الدليل / عرض الدليل / فتح الرابط
 *   • text  → wrapped, scrollable preview + نسخ الدليل / عرض الدليل
 *   • empty → explicit empty state, NO action buttons
 *
 * Copy always copies the ORIGINAL stored value exactly; فتح الرابط
 * is a real <a target="_blank" rel="noopener noreferrer"> whose href
 * is guaranteed http(s) by classification (javascript:/data:/… are
 * classified as text and never linked).
 */
function ObservationEvidenceSection({ evidence }: { evidence: string }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const classified = useMemo(() => classifyEvidence(evidence), [evidence]);

  // Copy the ORIGINAL stored value — no trimming, no formatting changes.
  const copyEvidence = async () => {
    try {
      await navigator.clipboard.writeText(evidence);
      toast.success('تم نسخ الدليل');
    } catch {
      toast.error('فشل نسخ الدليل');
    }
  };

  if (classified.kind === 'empty') {
    return (
      <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
        <p className="text-[11px] text-slate-400 mb-1 flex items-center gap-1.5">
          <Link2 className="size-3.5" /> الدليل / الإثبات
        </p>
        <p className="text-sm text-slate-500">{EVIDENCE_EMPTY_LABEL}</p>
      </div>
    );
  }

  const isUrl = classified.kind === 'url';

  return (
    <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3 min-w-0">
      <p className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Link2 className="size-3.5 text-cyan-400" /> الدليل / الإثبات
      </p>

      {isUrl ? (
        // Visual truncation only — Copy/View/Open always use the full URL.
        <p className="text-sm text-blue-300 break-all leading-relaxed" dir="ltr">
          {truncateEvidenceForDisplay(classified.url)}
        </p>
      ) : (
        <div className="max-h-28 overflow-y-auto rounded border border-slate-700/30 bg-slate-800/30 p-2">
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{classified.text}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-2.5">
        <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={copyEvidence}>
          <Copy className="size-3.5" /> نسخ الدليل
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={() => setPreviewOpen(true)}>
          <Eye className="size-3.5" /> عرض الدليل
        </Button>
        {isUrl && (
          <a
            href={classified.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 h-7 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 text-xs font-medium text-blue-300 hover:bg-blue-500/20 transition-colors"
          >
            <ExternalLink className="size-3.5" /> فتح الرابط
          </a>
        )}
      </div>

      <EvidencePreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        evidence={evidence}
        url={isUrl ? classified.url : null}
        onCopy={copyEvidence}
      />
    </div>
  );
}

/** Small full-evidence viewer — complete value, never truncated. */
function EvidencePreviewDialog({
  open, onOpenChange, evidence, url, onCopy,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  evidence: string;
  url: string | null;
  onCopy: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Link2 className="size-4 text-cyan-400" /> الدليل / الإثبات
          </DialogTitle>
          <DialogDescription>القيمة الكاملة للدليل كما تم تسجيلها — بدون أي اقتطاع</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3 min-w-0 max-h-[45vh] overflow-y-auto">
          {url ? (
            <p className="text-sm text-blue-300 break-all whitespace-pre-wrap select-text" dir="ltr">{evidence}</p>
          ) : (
            <p className="text-sm text-slate-200 break-words whitespace-pre-wrap select-text">{evidence}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" className="gap-1.5" onClick={onCopy}>
            <Copy className="size-3.5" /> نسخ الدليل
          </Button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-medium text-blue-300 hover:bg-blue-500/20 transition-colors"
            >
              <ExternalLink className="size-4" /> فتح الرابط
            </a>
          )}
          <Button onClick={() => onOpenChange(false)}>إغلاق</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value, onClick }: { label: string; value: string; onClick?: () => void }) {
  return (
    <div className="rounded border border-slate-700/40 bg-slate-800/20 px-2 py-1.5">
      <p className="text-slate-500">{label}</p>
      {onClick ? (
        <button onClick={onClick} className="text-slate-200 font-medium hover:text-blue-400 transition-colors text-right w-full">
          {value}
        </button>
      ) : (
        <p className="text-slate-200 font-medium">{value}</p>
      )}
    </div>
  );
}

// ─── Create dialog ────────────────────────────────────────────

function CreateObservationDialog({
  open, onOpenChange, categories, templates, employees,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>;
  templates: Array<{ id: string; title: string; categoryId: string; categoryName: string; defaultPoints: number; isBonus: boolean; defaultNotes: string }>;
  employees: Array<{ id: string; name: string; department: string | null; position: string | null; code: string | null }>;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [observationDate, setObservationDate] = useState(new Date().toLocaleDateString('en-GB'));
  const [type, setType] = useState('quality_observation');
  const [categoryId, setCategoryId] = useState('');
  const [notes, setNotes] = useState('');
  const [evidence, setEvidence] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [applyPoints, setApplyPoints] = useState(true);
  const [points, setPoints] = useState<number | ''>('');
  const [isBonus, setIsBonus] = useState(false);

  const createMut = useCreateObservation();

  function applyTemplate(t: typeof templates[number]) {
    setCategoryId(t.categoryId);
    setNotes(t.defaultNotes);
    setPoints(t.defaultPoints);
    setIsBonus(t.isBonus);
    setApplyPoints(true);
  }

  async function handleSubmit() {
    if (!employeeId || !categoryId || !type) {
      toast.error('الموظف والتصنيف والنوع مطلوبة');
      return;
    }
    try {
      await createMut.mutateAsync({
        employeeId,
        observationDate,
        type,
        categoryId,
        severity,
        notes,
        evidence,
        applyPointDeduction: applyPoints,
        points: applyPoints ? (points === '' ? undefined : points) : 0,
        isBonus: applyPoints ? isBonus : false,
        clientRequestId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      });
      logCreate('observations', 'ملاحظة', employeeId);
      toast.success('تم إنشاء الملاحظة');
      onOpenChange(false);
      setEmployeeId(''); setNotes(''); setEvidence(''); setPoints('');
    } catch (e) {
      toast.error('فشل الإنشاء', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle>ملاحظة جودة جديدة</DialogTitle>
          <DialogDescription>إنشاء ملاحظة جودة جديدة للموظف</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {templates.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                <Star className="size-3" /> قوالب سريعة
              </Label>
              <div className="flex flex-wrap gap-2">
                {templates.slice(0, 6).map((t) => (
                  <Button key={t.id} size="sm" variant="outline" className="text-xs gap-1" onClick={() => applyTemplate(t)}>
                    <FileText className="size-3" /> {t.title}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <EmployeeSearchInput
              employees={employees}
              value={employeeId}
              onChange={(id) => setEmployeeId(id)}
              label="الموظف *"
              placeholder="ابحث بالاسم أو القسم..."
              showDepartment
              showPosition
            />
            <div className="space-y-1">
              <Label>التاريخ *</Label>
              <Input value={observationDate} onChange={(e) => setObservationDate(e.target.value)} placeholder="DD/MM/YYYY" className="bg-slate-800/50 border-slate-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>التصنيف *</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>الخطورة</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as 'low' | 'medium' | 'high' | 'critical')}>
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

          <div className="space-y-1">
            <Label>الملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-slate-800/50 border-slate-700" />
          </div>

          <div className="space-y-1">
            <Label>الأدلة</Label>
            <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={1} className="bg-slate-800/50 border-slate-700" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
            <div>
              <Label className="cursor-pointer">تطبيق الخصم/المكافأة على النقاط</Label>
              <p className="text-xs text-slate-500 mt-0.5">يحتاج اعتماد المدير قبل التأثير على المؤشر</p>
            </div>
            <Switch checked={applyPoints} onCheckedChange={setApplyPoints} />
          </div>

          {applyPoints && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>النقاط</Label>
                <Input type="number" value={points} onChange={(e) => setPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
              </div>
              <div className="space-y-1">
                <Label>النوع</Label>
                <Select value={isBonus ? 'bonus' : 'deduction'} onValueChange={(v) => setIsBonus(v === 'bonus')}>
                  <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deduction">خصم</SelectItem>
                    <SelectItem value="bonus">مكافأة</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={createMut.isPending}>
            {createMut.isPending ? 'جاري الإنشاء...' : 'إنشاء'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit dialog ──────────────────────────────────────────────

function EditObservationDialog({
  obs, open, onOpenChange, categories,
}: {
  obs: QualityObservation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  categories: Array<{ id: string; name: string }>;
}) {
  const [notes, setNotes] = useState(obs.notes);
  const [evidence, setEvidence] = useState(obs.evidence);
  const [categoryId, setCategoryId] = useState(obs.categoryId);
  const [severity, setSeverity] = useState(obs.severity);
  const [points, setPoints] = useState<number | ''>(obs.points);

  const updateMut = useUpdateObservation();
  const editingApproved = obs.approvalStatus === 'approved';

  async function handleSubmit() {
    try {
      await updateMut.mutateAsync({
        id: obs.id,
        data: { notes, evidence, categoryId, severity, points: points === '' ? 0 : points },
      });
      logUpdate('observations', 'ملاحظة', obs.employeeName);
      toast.success('تم تحديث الملاحظة');
      onOpenChange(false);
    } catch (e) {
      toast.error('فشل التحديث', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle>تعديل الملاحظة</DialogTitle>
          <DialogDescription>{obs.employeeName} — {obs.observationDate}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {editingApproved && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <ShieldAlert className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                هذه ملاحظة معتمدة. تعديل القيم المؤثرة على المؤشر (التصنيف أو النقاط)
                سيُبطل الاعتماد ويعيد الملاحظة إلى «بانتظار الاعتماد» حتى اعتماد جديد.
                تعديل الحقول غير المؤثرة (الملاحظات، الأدلة، الخطورة) يحافظ على الاعتماد.
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label>التصنيف</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>الخطورة</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as 'low' | 'medium' | 'high' | 'critical')}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">منخفض</SelectItem>
                  <SelectItem value="medium">متوسط</SelectItem>
                  <SelectItem value="high">عالٍ</SelectItem>
                  <SelectItem value="critical">حرج</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {obs.applyPointDeduction && (
              <div className="space-y-1">
                <Label>النقاط</Label>
                <Input type="number" value={points} onChange={(e) => setPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>الملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label>الأدلة</Label>
            <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={1} className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={updateMut.isPending}>
            {updateMut.isPending ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Approve dialog ───────────────────────────────────────────

function ApproveDialog({ obs, open, onOpenChange }: { obs: QualityObservation; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [notes, setNotes] = useState('');
  const [overridePoints, setOverridePoints] = useState<number | ''>('');
  const approveMut = useApproveObservation();

  async function handleSubmit() {
    try {
      await approveMut.mutateAsync({
        id: obs.id,
        data: { notes: notes || undefined, points: overridePoints === '' ? undefined : overridePoints },
      });
      logApprove('observations', 'ملاحظة', obs.employeeName, 'approved');
      toast.success('تم اعتماد الملاحظة');
      onOpenChange(false); setNotes(''); setOverridePoints('');
    } catch (e) {
      toast.error('فشل الاعتماد', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>اعتماد الملاحظة</DialogTitle>
          <DialogDescription>{obs.employeeName} — النقاط الحالية: {obs.points}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>تجاوز النقاط (اختياري)</Label>
            <Input type="number" value={overridePoints} onChange={(e) => setOverridePoints(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(obs.points)} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label>ملاحظات</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات الاعتماد..." className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={approveMut.isPending} className="gap-1.5">
            <Check className="size-4" /> {approveMut.isPending ? 'جاري...' : 'اعتماد'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Reject dialog ────────────────────────────────────────────

function RejectDialog({ obs, open, onOpenChange }: { obs: QualityObservation; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState('');
  const rejectMut = useRejectObservation();

  async function handleSubmit() {
    if (!reason.trim()) { toast.error('سبب الرفض مطلوب'); return; }
    try {
      await rejectMut.mutateAsync({ id: obs.id, reason });
      logApprove('observations', 'ملاحظة', obs.employeeName, 'rejected');
      toast.success('تم رفض الملاحظة');
      onOpenChange(false); setReason('');
    } catch (e) {
      toast.error('فشل الرفض', { description: e instanceof Error ? e.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>رفض الملاحظة</DialogTitle>
          <DialogDescription>{obs.employeeName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>سبب الرفض *</Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="bg-slate-800/50 border-slate-700" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSubmit} disabled={rejectMut.isPending} variant="destructive" className="gap-1.5">
            <X className="size-4" /> {rejectMut.isPending ? 'جاري...' : 'رفض'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
