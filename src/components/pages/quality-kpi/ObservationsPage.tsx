'use client';

import { useState, useMemo, useEffect, type ReactNode } from 'react';
import { authFetch } from '@/lib/api-fetch';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDate, formatNumber, formatInteger, formatMonthKey } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
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
  CalendarDays,
} from 'lucide-react';
import { formatMonth } from './kpi-reports-shared';
import { ApprovalStatusBadge } from '@/components/shared/kpi';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { SmartActionMenu, type SmartAction } from '@/components/shared/SmartActionMenu';
import type { OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { useMarkState, useFavoriteToggleAction, usePinToggleAction } from '@/components/shared/NavigationMarks';
import type { NavigationDescriptor } from '@/lib/personalization';
import { Pin as PinIcon, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { CAPAInlineForm } from '@/components/shared/inline-forms';
import { TimelineView } from '@/components/shared/audit';
import { ApprovalHistoryTimeline } from '@/components/shared/approval';
import { buildTimeline } from '@/lib/audit/timeline-builder';
import {
  classifyEvidence,
  truncateEvidenceForDisplay,
  EVIDENCE_EMPTY_LABEL,
} from '@/lib/quality-observations/evidence';
import { useEmployees } from '@/hooks/use-queries';
import { usePageState } from '@/hooks/use-page-state';
import {
  useObservations, useObservationCategories, useObservationTemplates,
  useCreateObservation, useUpdateObservation, useDeleteObservation,
  useApproveObservation, useRejectObservation, useMonthSnapshots,
  type ObservationsParams,
} from '@/hooks/use-kpi-queries';
import type { QualityObservation } from '@/types/quality-kpi';

// ─── Helpers ──────────────────────────────────────────────────
const CURRENT_MONTH = new Date().toISOString().slice(0, 7);

// §5 — system enum codes → [ar, en] display labels, picked by locale at
// the render site. User/business data never passes through these maps.
const SEVERITY_LABELS: Record<string, [string, string]> = {
  low: ['منخفض', 'Low'], medium: ['متوسط', 'Medium'], high: ['عالٍ', 'High'], critical: ['حرج', 'Critical'],
};

const STATUS_LABELS: Record<string, [string, string]> = {
  open: ['مفتوحة', 'Open'], in_review: ['قيد المراجعة', 'In review'], resolved: ['تم الحل', 'Resolved'], closed: ['مغلقة', 'Closed'],
};

/** Pick the locale side of an enum-label pair; unknown codes pass raw. */
function enumLabel(map: Record<string, [string, string]>, code: string, locale: Locale): string {
  const pair = map[code];
  return pair ? (locale === 'en' ? pair[1] : pair[0]) : code;
}

/** §7 — GLOBAL RULE (inline contract): "إنشاء CAPA" from a quality note
 *  opens the REAL CAPA form INLINE on this page with the observation
 *  prefilled — no navigation to the CAPA page. (The old nav-based flow
 *  is kept in §11 for the CAPA page's own deep-link consumption.) */
function capaDefaultsFromObservation(obs: QualityObservation) {
  return {
    title: obs.categoryName ?? '',
    department: obs.department ?? '',
    priority: obs.severity === 'critical' ? 'critical' : obs.severity === 'high' ? 'high' : 'medium',
    employeeId: obs.employeeId ?? '',
    problemDescription: obs.notes ?? '',
    source: 'observation',
  };
}

// ─── Page ─────────────────────────────────────────────────────
export default function ObservationsPage() {
  const { canView, canCreate, canUpdate, canDelete, canApprove, isAdmin } = usePermissions('observations');
  const { locale } = useLanguage();

  // Filters — Phase 5.3 (spec §27/§28): an evidence deep-link seeds the
  // month filter with the RECORD's own month (server-derived meta.month).
  // The Quality Notes list is server-filtered by month, so without this
  // the exact observation was unreachable from a previous-month report.
  // Phase 6.3 (§8/§9/§27): the work context persists per user — an
  // explicit navigation seed wins over the remembered state for that
  // mount, and «مسح الفلاتر» resets to the page default (all months).
  const navMonth = useAppStore((s) => {
    const m = s.navParams.month;
    return typeof m === 'string' && m.length === 7 && m[4] === '-' ? m : null;
  });
  const [filters, setFilters, resetFilters] = usePageState<ObservationsParams>({
    page: 'observations',
    slot: 'filters',
    version: 1,
    initial: () => ({ month: navMonth ?? CURRENT_MONTH }),
    skipRestore: navMonth !== null,
    validate: (raw) =>
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as ObservationsParams) : null,
  });
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

  // Deep-link highlight (Phase 5.2 §35): locate + scroll + temporary
  // highlight when navigated with a recordId from Evidence Preview.
  useRecordHighlight();

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
    // Phase 6.2 (spec §68): "مسح الفلاتر" must actually CLEAR — including
    // the month. The current-month default applies only to a fresh page
    // load, and the active period is always visible in the toolbar.
    // Phase 6.3 (§9): clearing also REMOVES the persisted state and
    // persists the cleared (all-months) state — coming back to the page
    // keeps the reset semantics (never resurrects the old filters).
    resetFilters();
    setFilters({});
  }

  function showAllMonths() {
    setFilters((f) => ({ ...f, month: undefined }));
  }

  const deleteMut = useDeleteObservation();

  // §4: deletion goes through the unified ConfirmDialog — a pending
  // target is parked in state instead of a native confirm() popup.
  const [deleteTarget, setDeleteTarget] = useState<QualityObservation | null>(null);
  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      logDelete('observations', 'ملاحظة', deleteTarget.employeeName);
      toast.success(translateUIText('تم حذف الملاحظة', locale));
      setDeleteTarget(null);
    } catch (e) {
      toast.error(translateUIText('فشل الحذف', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  // §7 inline CAPA creation (GLOBAL RULE): the observation chosen from a
  // card's ⋮ menu parks here and the REAL CAPA form renders INLINE above
  // the list — same visual pattern as the Dashboard quick-action host.
  const [capaTarget, setCapaTarget] = useState<QualityObservation | null>(null);

  // System users for the inline CAPA form's "المسؤول" picker (same
  // endpoint the quick-action host and Risk Center already use).
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    authFetch('/api/dashboard/users?basic=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => { if (!cancelled) setSystemUsers((list as { id: string; name: string }[]) ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The inline CAPA host mounts above the list — bring it into view
  // so the user immediately sees the form they asked for.
  useEffect(() => {
    if (!capaTarget) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById('observation-inline-capa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [capaTarget]);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p><T>ليس لديك صلاحية للوصول إلى هذه الصفحة</T></p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* Header (§25/§26 — sticky, primary action always accessible) */}
      <PageHeaderBar
        icon={<Eye className="size-5" />}
        iconClassName="bg-blue-500/15 border-blue-500/30 text-blue-400"
        title={translateUIText('ملاحظات الجودة', locale)}
        description={translateUIText('إدارة ملاحظات الجودة واعتمادها — المصدر الأساسي لمؤشرات الأداء', locale)}
        primaryAction={canCreate ? { label: translateUIText('ملاحظة جديدة', locale), onClick: () => setCreateOpen(true) } : undefined}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder={translateUIText('بحث...', locale)}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-9 bg-slate-800/50 border-slate-700"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowFilters((s) => !s)} className="gap-2">
          <Filter className="size-4" /> <T>فلترة</T>
        </Button>
        {/* Phase 6.2 (spec §68): the ACTIVE period is always visible in the
            toolbar — a month-filtered view must never look like the whole
            dataset. Clicking it opens the filter panel to change the month. */}
        <button
          type="button"
          data-testid="observations-period-indicator"
          onClick={() => setShowFilters((s) => !s)}
          title={translateUIText('الفترة المعروضة — اضغط لتغيير الشهر', locale)}
          className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-500/15"
        >
          <CalendarDays className="size-3.5" />
          <T>فترة العرض: </T>{filters.month ? formatMonthKey(filters.month, locale) : <T>كل الأشهر</T>}
        </button>
        {filters.month && (
          <Button variant="ghost" size="sm" data-testid="observations-show-all-months" onClick={showAllMonths} className="text-xs text-slate-400">
            <T>عرض كل الأشهر</T>
          </Button>
        )}
        {Object.values(filters).some(Boolean) && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-xs text-slate-400">
            <T>مسح الفلاتر</T>
          </Button>
        )}
      </div>

      {/* Filters panel — expanded with Department, Employee, Category, Status */}
      {showFilters && (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-4">
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>الشهر</T></Label>
              <Input
                type="month"
                value={filters.month ?? ''}
                onChange={(e) => setFilters((f) => ({ ...f, month: e.target.value }))}
                className="bg-slate-800/50 border-slate-700"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>حالة الاعتماد</T></Label>
              <Select
                value={filters.approvalStatus ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, approvalStatus: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><T>الكل</T></SelectItem>
                  <SelectItem value="pending"><T>بانتظار الاعتماد</T></SelectItem>
                  <SelectItem value="approved"><T>معتمدة</T></SelectItem>
                  <SelectItem value="rejected"><T>مرفوضة</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>النوع</T></Label>
              <Select
                value={filters.isBonus ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, isBonus: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><T>الكل</T></SelectItem>
                  <SelectItem value="false"><T>خصومات</T></SelectItem>
                  <SelectItem value="true"><T>مكافآت</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>القسم</T></Label>
              <Select
                value={filters.department ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, department: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><T>كل الأقسام</T></SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>الموظف</T></Label>
              <EmployeeSearchInput
                employees={employeeList}
                value={filters.employeeId ?? ''}
                onChange={(id) => setFilters((f) => ({ ...f, employeeId: id === 'all' ? undefined : id }))}
                placeholder={translateUIText('فلتر حسب الموظف', locale)}
                variant="filter"
                showDepartment
                showAllOption
                allOptionValue="all"
                allOptionLabel={translateUIText('كل الموظفين', locale)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>التصنيف</T></Label>
              <Select
                value={filters.categoryId ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, categoryId: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><T>كل التصنيفات</T></SelectItem>
                  {categoriesList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-400"><T>الحالة</T></Label>
              <Select
                value={filters.status ?? 'all'}
                onValueChange={(v) => setFilters((f) => ({ ...f, status: v === 'all' ? undefined : v }))}
              >
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><T>الكل</T></SelectItem>
                  <SelectItem value="open"><T>مفتوحة</T></SelectItem>
                  <SelectItem value="in_review"><T>قيد المراجعة</T></SelectItem>
                  <SelectItem value="resolved"><T>تم الحل</T></SelectItem>
                  <SelectItem value="closed"><T>مغلقة</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatChip label={<T>الإجمالي</T>} value={obsList.length} icon={ClipboardList} className="text-slate-300" />
        <StatChip label={<T>بانتظار الاعتماد</T>} value={obsList.filter((o) => o.approvalStatus === 'pending').length} icon={Clock} className="text-amber-400" />
        <StatChip label={<T>معتمدة</T>} value={obsList.filter((o) => o.approvalStatus === 'approved').length} icon={Check} className="text-emerald-400" />
        <StatChip label={<T>مرفوضة</T>} value={obsList.filter((o) => o.approvalStatus === 'rejected').length} icon={X} className="text-rose-400" />
      </div>

      {/* §7 inline CAPA host (GLOBAL RULE) — the REAL CAPA form opens
          HERE, prefilled from the chosen quality note. Same visual
          pattern as the Dashboard quick-action host; the user stays
          on this page and can close back to the list. */}
      <AnimatePresence>
        {capaTarget && (
          <InlineFormPanel
            id="observation-inline-capa"
            tone="violet"
            icon={<ShieldCheck className="size-3.5 text-brand-400" />}
            title={`${translateUIText('إنشاء CAPA من ملاحظة', locale)} — ${capaTarget.employeeName}`}
            onClose={() => setCapaTarget(null)}
          >
            <CAPAInlineForm
              onClose={() => setCapaTarget(null)}
              onCreated={() => setCapaTarget(null)}
              employees={employeeList as never}
              systemUsers={systemUsers}
              defaultValues={capaDefaultsFromObservation(capaTarget)}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          monthLabel={filters.month ? formatMonthKey(filters.month, locale) : null}
          hasFilters={!!search || Object.values(filters).some(Boolean)}
          onShowAllMonths={showAllMonths}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((obs, i) => (
            <motion.div
              key={obs.id}
              data-record-id={obs.id}
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
                onDelete={() => setDeleteTarget(obs)}
                onApprove={() => setApproveTarget(obs)}
                onReject={() => setRejectTarget(obs)}
                onDetails={() => setDetailTarget(obs)}
                onCreateCapa={setCapaTarget}
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
          onDelete={() => { setDeleteTarget(detailTarget); }}
        />
      )}

      {/* §4: unified delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        description={translateUIText('سيتم حذف ملاحظة الجودة نهائياً من النظام.', locale)}
        itemName={deleteTarget ? deleteTarget.employeeName : undefined}
        loading={deleteMut.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function StatChip({ label, value, icon: Icon, className }: { label: ReactNode; value: number; icon: typeof ClipboardList; className?: string }) {
  const { locale } = useLanguage();
  return (
    <Card className="border-slate-700/40 bg-slate-800/30">
      <CardContent className="flex items-center gap-3 py-3">
        <Icon className={`size-5 ${className ?? ''}`} />
        <div>
          <p className="text-lg font-bold tabular-nums">{formatInteger(value, locale)}</p>
          <p className="text-xs text-slate-400">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// Phase 6.2 (spec §68): the empty state NAMES the active period —
// "لا توجد ملاحظات مسجلة في سبتمبر 2026." never a bare
// "لا توجد ملاحظات" that reads as if the data disappeared.
function EmptyState({
  monthLabel,
  hasFilters,
  onShowAllMonths,
}: {
  monthLabel: string | null;
  hasFilters: boolean;
  onShowAllMonths: () => void;
}) {
  return (
    <Card className="border-slate-700/40 bg-slate-800/30">
      <CardContent className="flex flex-col items-center justify-center py-14">
        <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
          <Eye className="size-6 text-slate-600" />
        </div>
        <p className="text-slate-400 text-sm font-medium">
          {monthLabel ? (<><T>لا توجد ملاحظات مسجلة في </T>{monthLabel}</>) : <T>لا توجد نتائج مطابقة</T>}
        </p>
        <p className="text-slate-600 text-xs mt-1">
          {monthLabel
            ? <T>العرض مُفلتر على هذه الفترة — غيّر الشهر أو اعرض كل الأشهر.</T>
            : hasFilters
              ? <T>لم يتم العثور على نتائج مع الفلاتر المحددة</T>
              : <T>لم يتم تسجيل أي ملاحظات جودة بعد</T>}
        </p>
        {monthLabel && (
          <Button
            variant="outline"
            size="sm"
            data-testid="observations-empty-show-all"
            onClick={onShowAllMonths}
            className="mt-4 border-slate-700/50 text-slate-300 hover:bg-slate-800/60"
          >
            <CalendarDays className="size-3.5 ml-1" />
            <T>عرض كل الأشهر</T>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ObservationCard({
  obs, canUpdate, canDelete, canApprove, isAdmin, monthClosed,
  onEdit, onDelete, onApprove, onReject, onDetails, onCreateCapa,
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
  onCreateCapa: (obs: QualityObservation) => void;
}) {
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const { locale } = useLanguage();

  // Approved observations are editable/deletable ONLY by Admin, and only
  // while the month is OPEN (backend enforces the same policy).
  const approved = obs.approvalStatus === 'approved';
  const canEditThis = canUpdate && !monthClosed && (!approved || isAdmin);
  const canDeleteThis = canDelete && !monthClosed && (!approved || isAdmin);

  // §7: secondary/contextual actions live in ONE ⋮ OverflowMenu —
  // ⭐ favorite and 📌 pin target this RECORD through the shared
  // NavigationMarks (same preferences record the sidebar reads).
  const descriptor = useMemo<NavigationDescriptor>(() => ({
    targetType: 'record',
    targetId: obs.id,
    route: 'observations',
    label: `${translateUIText('ملاحظة', locale)}: ${obs.employeeName} — ${obs.categoryName}`,
  }), [obs.id, obs.employeeName, obs.categoryName, locale]);
  const markState = useMarkState(descriptor);
  const toggleFavorite = useFavoriteToggleAction();
  const togglePin = usePinToggleAction();

  const overflowItems: OverflowMenuItem[] = [
    { key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: onEdit, separatorBefore: true },
    { key: 'favorite', label: markState.favoriteActive ? translateUIText('إزالة من المفضلة', locale) : translateUIText('إضافة للمفضلة ⭐', locale), icon: <Star className={cn('size-3.5', markState.favoriteActive && 'text-amber-400 fill-amber-400')} />, onSelect: () => void toggleFavorite(descriptor) },
    { key: 'pin', label: markState.pinActive ? translateUIText('إزالة التثبيت', locale) : translateUIText('تثبيت 📌', locale), icon: <PinIcon className={cn('size-3.5', markState.pinActive && 'text-cyan-400 fill-cyan-400')} />, onSelect: () => void togglePin(descriptor) },
    { key: 'capa', label: translateUIText('إنشاء CAPA', locale), icon: <ShieldCheck className="size-3.5" />, onSelect: () => onCreateCapa(obs), separatorBefore: true },
    { key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: onDelete, separatorBefore: true },
  ].filter((item) => {
    if ((item.key === 'edit' || item.key === 'delete') && !(item.key === 'edit' ? canEditThis : canDeleteThis)) return false;
    return true;
  });

  return (
    <Card className="border-slate-700/40 bg-slate-800/30 hover:border-slate-600/50 transition-colors">
      {/* Compact density: tighter padding, single-line notes — more
          records visible per screen without losing any information
          (full notes remain one click away in تفاصيل). */}
      <CardContent className="px-3.5 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                className="text-[13px] font-semibold text-slate-100 hover:text-blue-400 transition-colors"
                onClick={() => openEmployee360(obs.employeeId)}
              >
                {obs.employeeName}
              </button>
              <Badge variant="outline" className="bg-slate-700/30 text-slate-300 text-[10px] px-1.5">{obs.department}</Badge>
              <ApprovalStatusBadge status={obs.approvalStatus} />
              {obs.isBonus ? (
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] px-1.5">+{formatNumber(obs.points, { locale })} <T>مكافأة</T></Badge>
              ) : obs.applyPointDeduction ? (
                <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/20 text-[10px] px-1.5">-{formatNumber(obs.points, { locale })} <T>خصم</T></Badge>
              ) : null}
            </div>
            <p className="text-xs text-slate-400 mt-1 line-clamp-1">{obs.notes || '—'}</p>
            <div className="flex items-center gap-2 mt-1.5 text-[11px] text-slate-500 flex-wrap">
              <span>{obs.categoryName}</span><span>•</span>
              <span>{obs.observationDate}</span><span>•</span>
              <span>{enumLabel(SEVERITY_LABELS, obs.severity, locale)}</span>
              {/* §2 — "Added by" appears HERE ONLY (card level, no click
                  needed) and ONLY for viewers the server authorized: the
                  API strips observerName for everyone without the
                  audit-identity permission, so this renders nothing for
                  unauthorized users — no client-side guessing. */}
              {obs.observerName && (
                <>
                  <span>•</span>
                  <span className="text-slate-400" title={translateUIText('أضافها', locale)}>
                    <T>بواسطة: </T><span className="text-slate-300">{obs.observerName}</span>
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* §7: the ONE visible primary action is تفاصيل; everything
                contextual (تعديل/⭐/📌/CAPA/حذف) lives in the ⋮ menu.
                Approve/reject stay visible — they are the time-sensitive
                primary decision for approvers on pending deductions. */}
            {!monthClosed && canApprove && obs.applyPointDeduction && obs.approvalStatus === 'pending' && (
              <>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={onApprove}>
                  <Check className="size-3.5" /> <T>اعتماد</T>
                </Button>
                <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 border-rose-500/30 text-rose-400 hover:bg-rose-500/10" onClick={onReject}>
                  <X className="size-3.5" /> <T>رفض</T>
                </Button>
              </>
            )}
            {/* تفاصيل is icon-only now (text removed — the card was too
                crowded): same handler, same behavior; the aria-label +
                title tooltip carry the meaning for accessibility. */}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-slate-400"
              onClick={onDetails}
              aria-label={translateUIText('تفاصيل الملاحظة', locale)}
              title={translateUIText('تفاصيل الملاحظة', locale)}
            >
              <Info className="size-3.5" />
            </Button>
            {!monthClosed && overflowItems.length > 0 && (
              <SmartActionMenu actions={overflowItems} label={translateUIText('إجراءات الملاحظة', locale)} />
            )}
            {monthClosed && (
              <Badge variant="outline" className="justify-center gap-1 text-blue-400 border-blue-500/30 text-[10px]">
                <Lock className="size-3" /> <T>مغلق</T>
              </Badge>
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
  const { locale } = useLanguage();

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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><T>تفاصيل الملاحظة</T></DialogTitle>
          <DialogDescription>{obs.employeeName} — {obs.observationDate}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <InfoCell label={<T>الموظف</T>} value={obs.employeeName} onClick={() => openEmployee360(obs.employeeId)} />
            <InfoCell label={<T>القسم</T>} value={obs.department} />
            <InfoCell label={<T>التصنيف</T>} value={obs.categoryName} />
            <InfoCell label={<T>الخطورة</T>} value={enumLabel(SEVERITY_LABELS, obs.severity, locale)} />
            <InfoCell label={<T>الحالة</T>} value={enumLabel(STATUS_LABELS, obs.status, locale)} />
            <InfoCell label={<T>الاعتماد</T>} value={obs.approvalStatus} />
            <InfoCell label={<T>النقاط</T>} value={obs.applyPointDeduction ? `${obs.isBonus ? '+' : '-'}${formatNumber(obs.points, { locale })}` : '—'} />
            {/* §2 — «بواسطة» is NOT repeated here: it already appears ONCE
                on the card row (and only reaches authorized viewers — the
                API strips the identity for everyone else). */}
            <InfoCell label={<T>تاريخ الإنشاء</T>} value={formatDate(obs.createdAt, locale)} />
            {obs.correctiveAction && <InfoCell label={<T>الإجراء التصحيحي</T>} value={obs.correctiveAction} />}
            {obs.dueDate && <InfoCell label={<T>تاريخ الاستحقاق</T>} value={obs.dueDate} />}
            {obs.resolvedDate && <InfoCell label={<T>تاريخ الحل</T>} value={obs.resolvedDate} />}
          </div>

          {obs.notes && (
            <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
              <p className="text-[11px] text-slate-400 mb-1"><T>الملاحظات</T></p>
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
                <T>الشهر </T>{formatMonthKey(obs.month, locale)} <T>مغلق — لا يمكن تعديل أو حذف أو اعتماد ملاحظاته</T>
              </p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canApprove && obs.applyPointDeduction && obs.approvalStatus === 'pending' && (
                <>
                  <Button size="sm" className="gap-1.5" onClick={onApprove}>
                    <Check className="size-3.5" /> <T>اعتماد</T>
                  </Button>
                  <Button size="sm" variant="destructive" className="gap-1.5" onClick={onReject}>
                    <X className="size-3.5" /> <T>رفض</T>
                  </Button>
                </>
              )}
              {canEditThis && approved && isAdmin && (
                <Button size="sm" variant="outline" className="gap-1.5 border-amber-500/40 text-amber-400 hover:bg-amber-500/10" onClick={onEdit}>
                  <ShieldAlert className="size-3.5" /> <T>تعديل (مدير النظام)</T>
                </Button>
              )}
              {canEditThis && !approved && (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
                  <Pencil className="size-3.5" /> <T>تعديل</T>
                </Button>
              )}
              {canDeleteThis && approved && isAdmin && (
                <Button size="sm" variant="outline" className="gap-1.5 border-rose-500/40 text-rose-400 hover:bg-rose-500/10" onClick={onDelete}>
                  <Trash2 className="size-3.5" /><T> حذف (مدير النظام)
                </T></Button>
              )}
            </div>
          )}

          {/* Approval history (append-only, backend-provided) */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Check className="size-3.5 text-emerald-400" /><T> سجل الاعتماد
            </T></h4>
            <ApprovalHistoryTimeline events={obs.approvalHistory ?? []} />
          </div>

          {/* Full timeline (derived via pure lib buildTimeline) */}
          <div>
            <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
              <Clock className="size-3.5 text-blue-400" /><T> سجل الأحداث
            </T></h4>
            <TimelineView points={timeline} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إغلاق</T></Button>
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
          <Link2 className="size-3.5" /><T> الدليل / الإثبات
        </T></p>
        <p className="text-sm text-slate-500">{EVIDENCE_EMPTY_LABEL}</p>
      </div>
    );
  }

  const isUrl = classified.kind === 'url';

  return (
    <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3 min-w-0">
      <p className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1.5">
        <Link2 className="size-3.5 text-cyan-400" /><T> الدليل / الإثبات
      </T></p>

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
          <Copy className="size-3.5" /><T> نسخ الدليل
        </T></Button>
        <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={() => setPreviewOpen(true)}>
          <Eye className="size-3.5" /><T> عرض الدليل
        </T></Button>
        {isUrl && (
          <a
            href={classified.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 h-7 rounded-md border border-blue-500/40 bg-blue-500/10 px-3 text-xs font-medium text-blue-300 hover:bg-blue-500/20 transition-colors"
          >
            <ExternalLink className="size-3.5" /><T> فتح الرابط
          </T></a>
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
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            <Link2 className="size-4 text-cyan-400" /><T> الدليل / الإثبات
          </T></DialogTitle>
          <DialogDescription><T>القيمة الكاملة للدليل كما تم تسجيلها — بدون أي اقتطاع</T></DialogDescription>
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
            <Copy className="size-3.5" /><T> نسخ الدليل
          </T></Button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 h-9 rounded-md border border-blue-500/40 bg-blue-500/10 px-4 text-sm font-medium text-blue-300 hover:bg-blue-500/20 transition-colors"
            >
              <ExternalLink className="size-4" /><T> فتح الرابط
            </T></a>
          )}
          <Button onClick={() => onOpenChange(false)}><T>إغلاق</T></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InfoCell({ label, value, onClick }: { label: ReactNode; value: string; onClick?: () => void }) {
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
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle><T>ملاحظة جودة جديدة</T></DialogTitle>
          <DialogDescription><T>إنشاء ملاحظة جودة جديدة للموظف</T></DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {templates.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-slate-400 flex items-center gap-1.5">
                <Star className="size-3" /><T> قوالب سريعة
              </T></Label>
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
              <Label><T>التاريخ *</T></Label>
              <Input value={observationDate} onChange={(e) => setObservationDate(e.target.value)} placeholder="DD/MM/YYYY" className="bg-slate-800/50 border-slate-700" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label><T>التصنيف *</T></Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label><T>الخطورة</T></Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as 'low' | 'medium' | 'high' | 'critical')}>
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

          <div className="space-y-1">
            <Label><T>الملاحظات</T></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-slate-800/50 border-slate-700" />
          </div>

          <div className="space-y-1">
            <Label><T>الأدلة</T></Label>
            <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={1} className="bg-slate-800/50 border-slate-700" />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-700/40 bg-slate-800/30 p-3">
            <div>
              <Label className="cursor-pointer"><T>تطبيق الخصم/المكافأة على النقاط</T></Label>
              <p className="text-xs text-slate-500 mt-0.5"><T>يحتاج اعتماد المدير قبل التأثير على المؤشر</T></p>
            </div>
            <Switch checked={applyPoints} onCheckedChange={setApplyPoints} />
          </div>

          {applyPoints && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label><T>النقاط</T></Label>
                <Input type="number" value={points} onChange={(e) => setPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
              </div>
              <div className="space-y-1">
                <Label><T>النوع</T></Label>
                <Select value={isBonus ? 'bonus' : 'deduction'} onValueChange={(v) => setIsBonus(v === 'bonus')}>
                  <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="deduction"><T>خصم</T></SelectItem>
                    <SelectItem value="bonus"><T>مكافأة</T></SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle><T>تعديل الملاحظة</T></DialogTitle>
          <DialogDescription>{obs.employeeName} — {obs.observationDate}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {editingApproved && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
              <ShieldAlert className="size-4 text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-300">
                <T>هذه ملاحظة معتمدة. تعديل القيم المؤثرة على المؤشر (التصنيف أو النقاط)
                سيُبطل الاعتماد ويعيد الملاحظة إلى «بانتظار الاعتماد» حتى اعتماد جديد.
                تعديل الحقول غير المؤثرة (الملاحظات، الأدلة، الخطورة) يحافظ على الاعتماد.</T>
              </p>
            </div>
          )}
          <div className="space-y-1">
            <Label><T>التصنيف</T></Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label><T>الخطورة</T></Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as 'low' | 'medium' | 'high' | 'critical')}>
                <SelectTrigger className="bg-slate-800/50 border-slate-700"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low"><T>منخفض</T></SelectItem>
                  <SelectItem value="medium"><T>متوسط</T></SelectItem>
                  <SelectItem value="high"><T>عالٍ</T></SelectItem>
                  <SelectItem value="critical"><T>حرج</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
            {obs.applyPointDeduction && (
              <div className="space-y-1">
                <Label><T>النقاط</T></Label>
                <Input type="number" value={points} onChange={(e) => setPoints(e.target.value === '' ? '' : Number(e.target.value))} className="bg-slate-800/50 border-slate-700" />
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label><T>الملاحظات</T></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label><T>الأدلة</T></Label>
            <Textarea value={evidence} onChange={(e) => setEvidence(e.target.value)} rows={1} className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle><T>اعتماد الملاحظة</T></DialogTitle>
          <DialogDescription>{obs.employeeName} — النقاط الحالية: {obs.points}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label><T>تجاوز النقاط (اختياري)</T></Label>
            <Input type="number" value={overridePoints} onChange={(e) => setOverridePoints(e.target.value === '' ? '' : Number(e.target.value))} placeholder={String(obs.points)} className="bg-slate-800/50 border-slate-700" />
          </div>
          <div className="space-y-1">
            <Label><T>ملاحظات</T></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات الاعتماد..." className="bg-slate-800/50 border-slate-700" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle><T>رفض الملاحظة</T></DialogTitle>
          <DialogDescription>{obs.employeeName}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label><T>سبب الرفض *</T></Label>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="bg-slate-800/50 border-slate-700" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}><T>إلغاء</T></Button>
          <Button onClick={handleSubmit} disabled={rejectMut.isPending} variant="destructive" className="gap-1.5">
            <X className="size-4" /> {rejectMut.isPending ? 'جاري...' : 'رفض'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
