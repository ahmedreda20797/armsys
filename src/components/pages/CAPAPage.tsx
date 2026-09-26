'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatInteger, formatPercentage, formatMonthKey } from '@/lib/i18n/format';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AttentionPanel, type AttentionItem } from '@/components/shared/AttentionPanel';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck, Plus, Search, X, Trash2, CalendarDays, Users,
  CheckCircle2, AlertTriangle, Clock, Loader2, Eye, BarChart3,
  UserCheck, FileText,
  Target, Zap, TrendingUp, Flame,
  CircleDot, Download, AlertOctagon, ShieldAlert,
} from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import { toast } from 'sonner';
import { logDelete } from '@/lib/activity-logger';
import { apiFetch, authFetch } from '@/lib/api-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { useCapaList, useRepetitionAlerts, useEmployees, useDashboardUsers } from '@/hooks/use-queries';
import { invalidateDomain } from '@/lib/cache/invalidation';
import { DataFreshnessIndicator } from '@/components/shared/DataFreshnessIndicator';
import { useAppStore } from '@/lib/store';
import type { CAPACase, Employee } from '@/types';
import { buildCapaPrefillFromAlert } from '@/lib/repetition-detection';
import { capaDefaultsFromNavParams, hasCreateIntent } from '@/lib/record-prefill';
import { FavoriteToggle, PinToggle } from '@/components/shared/NavigationMarks';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CAPAInlineForm } from '@/components/shared/inline-forms';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import CAPADetailPage from '@/components/capa/CAPADetailPage';
import {
  STATUS_OPTIONS, PRIORITY_OPTIONS, ISSUE_CATEGORIES, DEPARTMENTS,
  WORKFLOW_STAGES, CATEGORY_LABELS, SOURCE_LABELS,
} from '@/lib/capa-constants';
import {
  getStatusConfig, getPriorityConfig, getActionStatusConfig,
  formatDate, isOverdue, truncate, getSLAInfo,
  calculateProgress,
} from '@/lib/capa-helpers';

// ═══════════════════════════════════════════════════════════════
//  ROUTING WRAPPER
// ═══════════════════════════════════════════════════════════════
// CAPA has two modes — list and detail — selected by navParams.id.
// They must be SEPARATE components: returning <CAPADetailPage/>
// early from inside the list component skipped its remaining
// useEffect/useMemo calls on the next render and crashed React with
// "Rendered fewer hooks than expected". Swapping child component
// types keeps each one's hook count stable.
export default function CAPAPage() {
  const navParams = useAppStore((s) => s.navParams);
  const navigateTo = useAppStore((s) => s.navigateTo);

  if (navParams?.id) {
    return (
      <CAPADetailPage
        capaId={navParams.id}
        onBack={() => navigateTo('capa')}
      />
    );
  }

  return <CAPAListPage />;
}

// ═══════════════════════════════════════════════════════════════
//  LIST COMPONENT
// ═══════════════════════════════════════════════════════════════

function CAPAListPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('capa');
  const { user } = useAuth();
  const navParams = useAppStore((s) => s.navParams);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { locale } = useLanguage();

  // ═══ State ═══
  // ═══ DATA STATE (cache-backed, §4) — snapshot restore + background
  //  revalidation (§9/§28); non-viewers never trigger a request.
  const queryClient = useQueryClient();
  const capaQuery = useCapaList(canView);
  const employeesQuery = useEmployees(canView);
  const systemUsersQuery = useDashboardUsers('full', canView);
  const repetitionAlertsQuery = useRepetitionAlerts(canView);
  const cases = capaQuery.data?.data ?? [];
  const employees = employeesQuery.data ?? [];
  const systemUsers = systemUsersQuery.data ?? [];
  const repetitionAlerts = repetitionAlertsQuery.data?.alerts ?? [];
  // Full skeleton only without a snapshot (§11); revalidation is subtle.
  const loading = canView && (capaQuery.isLoading || employeesQuery.isLoading);
  const revalidating = canView && (capaQuery.isFetching || employeesQuery.isFetching) && !loading;
  // Blocking error only without a snapshot (§33).
  const error = canView && capaQuery.isError && !capaQuery.data
    ? 'تعذّر تحميل حالات CAPA'
    : null;
  // Phase 6.3 (§8): filter context persists per user (session-scoped).
  const [capaView, setCapaView] = usePageState<{
    search: string;
    statusFilter: string;
    priorityFilter: string;
    categoryFilter: string;
    departmentFilter: string;
    activeTab: string;
  }>({
    page: 'capa',
    slot: 'filters',
    version: 1,
    initial: () => ({ search: '', statusFilter: 'all', priorityFilter: 'all', categoryFilter: 'all', departmentFilter: 'all', activeTab: 'all' }),
    validate: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null),
  });
  const search = capaView.search;
  const setSearch = (v: string) => setCapaView((s) => ({ ...s, search: v }));
  const statusFilter = capaView.statusFilter;
  const setStatusFilter = (v: string) => setCapaView((s) => ({ ...s, statusFilter: v }));
  const priorityFilter = capaView.priorityFilter;
  const setPriorityFilter = (v: string) => setCapaView((s) => ({ ...s, priorityFilter: v }));
  const categoryFilter = capaView.categoryFilter;
  const setCategoryFilter = (v: string) => setCapaView((s) => ({ ...s, categoryFilter: v }));
  const departmentFilter = capaView.departmentFilter;
  const setDepartmentFilter = (v: string) => setCapaView((s) => ({ ...s, departmentFilter: v }));
  const activeTab = capaView.activeTab;
  const setActiveTab = (v: string) => setCapaView((s) => ({ ...s, activeTab: v }));

  // Quick Create
  // UX Corrections §1 (ROOT CAUSE FIX): cross-module create intents
  // (Quality deduction / Complaint / Follow-up / Repetition alert)
  // arrive via navParams BEFORE this page mounts — the PageRouter
  // remounts pages per navigation. The previous render-time guard
  // compared navParams against useState(navParams), which is ALWAYS
  // equal on mount, so the dialog never auto-opened. State now
  // INITIALIZES from the mount-time intent, and the render-time
  // guard below keeps handling intents that arrive while mounted.
  const [isCreateOpen, setIsCreateOpen] = useState(() => hasCreateIntent(navParams));
  const [createDefaults, setCreateDefaults] = useState<Record<string, any>>(() =>
    capaDefaultsFromNavParams(navParams),
  );

  // ═══ Milestone 7 §8 — Repetition → CAPA alerts are served by the
  //  repetitionAlertsQuery above (cache-backed, on-mount enabled).

  // §12 — when the inline create card opens (alert row, overflow menu,
  // navParams intent), bring it into view so the user sees the form
  // open in place instead of hunting for it.
  useEffect(() => {
    if (!isCreateOpen) return;
    const raf = requestAnimationFrame(() => {
      document.getElementById('capa-inline-create')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => cancelAnimationFrame(raf);
  }, [isCreateOpen]);

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Report & Export
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ═══ Manual refresh / mutation revalidation (§26).
  const refreshData = useCallback(async () => {
    await invalidateDomain(queryClient, 'capaCases');
  }, [queryClient]);

  // Listen for navParams changes WHILE the page is mounted (the
  // mount-time intent is handled by the useState initializers above).
  // Uses the compiler-endorsed "adjust state during render" guard.
  const [lastHandledNav, setLastHandledNav] = useState(navParams);
  if (navParams !== lastHandledNav) {
    setLastHandledNav(navParams);
    if (hasCreateIntent(navParams)) {
      setCreateDefaults(capaDefaultsFromNavParams(navParams));
      setIsCreateOpen(true);
    }
  }

  // ═══ Filtering ═══
  const filtered = useMemo(() => {
    return cases.filter((c) => {
      const matchSearch = !search ||
        c.title?.toLowerCase().includes(search.toLowerCase()) ||
        c.capaId?.toLowerCase().includes(search.toLowerCase()) ||
        c.problemDescription?.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === 'all' || c.status === statusFilter;
      const matchPriority = priorityFilter === 'all' || c.priority === priorityFilter;
      const matchCategory = categoryFilter === 'all' || c.issueCategory === categoryFilter;
      const matchDept = departmentFilter === 'all' || c.department === departmentFilter;
      return matchSearch && matchStatus && matchPriority && matchCategory && matchDept;
    });
  }, [cases, search, statusFilter, priorityFilter, categoryFilter, departmentFilter]);

  const displayed = useMemo(() => {
    if (activeTab === 'all') return filtered;
    if (activeTab === 'overdue') return filtered.filter(isOverdue);
    if (activeTab === 'verification') return filtered.filter((c) => c.status === 'verification');
    if (activeTab === 'critical') return filtered.filter((c) => c.priority === 'critical' && c.status !== 'closed');
    if (activeTab === 'reopened') return filtered.filter((c) => c.status === 'reopened');
    return filtered.filter((c) => c.status === activeTab);
  }, [filtered, activeTab]);

  // ═══ Enhanced Stats ═══
  const stats = useMemo(() => {
    const total = cases.length;
    const open = cases.filter((c) => c.status === 'open').length;
    const inProgress = cases.filter((c) => ['investigation', 'root_cause_analysis', 'corrective_action', 'preventive_action'].includes(c.status)).length;
    const overdue = cases.filter(isOverdue).length;
    const closed = cases.filter((c) => c.status === 'closed').length;
    const pendingVerification = cases.filter((c) => c.status === 'verification').length;
    const critical = cases.filter((c) => c.priority === 'critical' && c.status !== 'closed' && c.status !== 'rejected').length;
    const reopened = cases.filter((c) => c.status === 'reopened').length;
    // Verification Success Rate
    const verified = cases.filter((c) => c.verificationResult);
    const effective = verified.filter((c) => c.verificationResult === 'effective');
    const verificationRate = verified.length > 0 ? Math.round((effective.length / verified.length) * 100) : 0;
    // Average Closure Time
    const closedCases = cases.filter((c) => c.status === 'closed' && c.createdAt && c.closedAt);
    let avgClosure = '—';
    if (closedCases.length > 0) {
      const avg = closedCases.reduce((sum, c) => sum + (new Date(c.closedAt!).getTime() - new Date(c.createdAt).getTime()), 0) / closedCases.length;
      avgClosure = `${formatInteger(Math.round(avg / 86400000), locale)} ${translateUIText('يوم', locale)}`;
    }
    return { total, open, inProgress, overdue, closed, pendingVerification, critical, reopened, verificationRate, avgClosure };
  }, [cases, locale]);

  // ═══ Navigate to Detail ═══
  const openDetail = (item: CAPACase) => {
    navigateTo('capa', item.id, { id: item.id });
  };

  // ═══ Delete Handler ═══
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const target = cases.find((c) => c.id === id);
      await apiFetch(`/api/capa-cases/${id}`, { method: 'DELETE' });
      logDelete('capa', 'حالة كابا', '');
      toast.success(translateUIText('تم حذف الحالة', locale));
      await invalidateDomain(queryClient, 'capaCases', { employeeId: target?.employeeId });
    } catch { toast.error(translateUIText('فشل في الحذف', locale)); }
    setDeleting(false);
    setDeletingId(null);
  };

  // ═══ After Quick Create ═══
  const handleCreated = (newId: string) => {
    void refreshData();
    // Navigate to the new detail page
    navigateTo('capa', newId, { id: newId });
  };

  // ═══ Export Handler ═══
  const handleExport = async (format: 'xlsx' | 'csv') => {
    setExporting(true);
    try {
      const filters: Record<string, string> = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      if (priorityFilter !== 'all') filters.priority = priorityFilter;
      if (departmentFilter !== 'all') filters.department = departmentFilter;
      if (search) filters.search = search;
      const res = await authFetch('/api/reports/capa-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ format, filters, lang: locale }),
      });
      if (!res.ok) { toast.error(translateUIText('فشل في التصدير', locale)); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capa_report_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`${translateUIText('تم التصدير بنجاح', locale)} (${format.toUpperCase()})`);
    } catch { toast.error(translateUIText('حدث خطأ أثناء التصدير', locale)); }
    finally { setExporting(false); }
  };

  // ═══ Report Handler ═══
  const openReport = async () => {
    setShowReport(true);
    setReportLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (priorityFilter !== 'all') params.set('priority', priorityFilter);
      if (departmentFilter !== 'all') params.set('department', departmentFilter);
      const qs = params.toString();
      const res = await authFetch(`/api/reports/capa${qs ? `?${qs}` : ''}`);
      if (res.ok) {
        const data = await res.json();
        setReportData(data);
      } else {
        toast.error(translateUIText('فشل في تحميل التقرير', locale));
      }
    } catch { toast.error(translateUIText('حدث خطأ أثناء تحميل التقرير', locale)); }
    finally { setReportLoading(false); }
  };

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldCheck className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium"><T>غير مصرح بالوصول</T></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ Header (§25/§26 — sticky) ═══ */}
      <PageHeaderBar
        icon={<ShieldCheck className="size-5" />}
        iconClassName="bg-linear-to-br from-brand-600/20 to-brand-700/20 border-brand-500/30 text-brand-400"
        title={translateUIText('نظام كابا — الإجراءات التصحيحية والوقائية', locale)}
        description={<T>محرك تحسين الجودة وحل المشكلات</T>}
        primaryAction={canCreate ? {
          label: translateUIText('إنشاء حالة كابا', locale),
          onClick: () => { setCreateDefaults({}); setIsCreateOpen(true); },
        } : undefined}
        actions={
          <>
            <Button onClick={openReport} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
              <BarChart3 className="size-4 ml-1" /> <T>التقرير</T>
            </Button>
            <Button onClick={() => handleExport('xlsx')} disabled={exporting} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
              {exporting ? <Loader2 className="size-4 animate-spin ml-1" /> : <Download className="size-4 ml-1" />}
              <T>{exporting ? 'جارٍ...' : 'تصدير'}</T>
            </Button>
          </>
        }
      />

      {/* ═══ Enhanced Dashboard Widgets ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {[
          { label: 'إجمالي الحالات', value: formatInteger(stats.total, locale), color: 'border-brand-500/30 bg-brand-500/8', textColor: 'text-brand-400' },
          { label: 'مفتوحة', value: formatInteger(stats.open, locale), color: 'border-blue-500/25 bg-blue-500/8', textColor: 'text-blue-400' },
          { label: 'قيد التنفيذ', value: formatInteger(stats.inProgress, locale), color: 'border-amber-500/25 bg-amber-500/8', textColor: 'text-amber-400' },
          { label: 'متأخرة', value: formatInteger(stats.overdue, locale), color: 'border-red-500/25 bg-red-500/8', textColor: 'text-red-400' },
          { label: 'حرجة', value: formatInteger(stats.critical, locale), color: 'border-orange-500/25 bg-orange-500/8', textColor: 'text-orange-400' },
          { label: 'معاد فتحها', value: formatInteger(stats.reopened, locale), color: 'border-rose-500/25 bg-rose-500/8', textColor: 'text-rose-400' },
          { label: 'نسبة الفعالية', value: formatPercentage(stats.verificationRate, { locale }), color: 'border-emerald-500/25 bg-emerald-500/8', textColor: 'text-emerald-400' },
          { label: 'متوسط الحل', value: stats.avgClosure, color: 'border-sky-500/25 bg-sky-500/8', textColor: 'text-sky-400' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-lg border ${stat.color} px-3.5 py-2.5`}>
            <p className="text-slate-500 text-[10px] mb-0.5"><T>{stat.label}</T></p>
            <p className={`${stat.textColor} font-bold text-lg leading-tight`}>{stat.value}</p>
          </div>
        ))}
      </motion.div>

      {/* ═══ §8 Repetition → CAPA alerts (now flows through the
              shared AttentionPanel: collapse, default-closed, severity
              accent — no permanent hide, the surface is always reachable). */}
      {repetitionAlerts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }}>
          <AttentionPanel
            title={translateUIText('مشكلات متكررة', locale)}
            icon={<AlertOctagon className="size-3.5 text-amber-300" />}
            subtitle={`${formatInteger(repetitionAlerts.length, locale)} ${translateUIText('موظف بنمط متكرر خلال آخر 30 يوماً — يُنصح بفتح CAPA', locale)}`}
            persistKey="capaRepetitionAttention"
            items={repetitionAlerts.map((alert, idx): AttentionItem => {
              const empName = employees.find((e: any) => e.id === alert.employeeId)?.name || alert.employeeId;
              const sourceLabel = translateUIText(alert.source === 'followUp' ? 'متابعة' : alert.source === 'complaint' ? 'شكوى' : 'ملاحظة', locale);
              return {
                id: `${alert.employeeId}:${alert.source}:${alert.issueKey}:${idx}`,
                severity: 'warning',
                primary: empName,
                secondary: `${alert.issueLabel} · ${formatInteger(alert.occurrenceCount, locale)} ${translateUIText('مرات', locale)}`,
                trailing: <span className="font-mono">{alert.firstDay} → {alert.lastDay}</span>,
                onClick: () => {
                  setCreateDefaults(buildCapaPrefillFromAlert(alert, empName));
                  setIsCreateOpen(true);
                },
                overflowItems: [
                  { key: 'view', label: translateUIText('فتح ملف الموظف', locale), icon: <Eye className="size-3.5" />, onSelect: () => useAppStore.getState().openEmployee360(alert.employeeId) },
                  { key: 'capa', label: translateUIText('إنشاء CAPA', locale), icon: <ShieldAlert className="size-3.5" />, separatorBefore: true, onSelect: () => { setCreateDefaults(buildCapaPrefillFromAlert(alert, empName)); setIsCreateOpen(true); } },
                ],
              };
            })}
          />
        </motion.div>
      )}

      {/* ═══ §12 QUICK CREATE — INLINE CARD (not a dialog) ═══ */}
      {/* Same motion-card + shared CAPAInlineForm used by the Dashboard
          quick action / Quality / Follow-ups / Complaints / Risk Center.
          key = defaults identity: a NEW pre-fill payload (cross-module
          create intent or repetition alert) REMOUNTS the form so its
          useState re-initializes from the incoming defaults — without
          this, dynamically-arriving defaults were silently dropped. */}
      <AnimatePresence>
        {isCreateOpen && (
          <InlineFormPanel
            id="capa-inline-create"
            tone="violet"
            icon={<Plus className="size-3.5 text-brand-400" />}
            title={translateUIText('إنشاء حالة CAPA جديدة', locale)}
            onClose={() => { setIsCreateOpen(false); setCreateDefaults({}); }}
          >
            <CAPAInlineForm
              key={JSON.stringify(createDefaults)}
              onClose={() => { setIsCreateOpen(false); setCreateDefaults({}); }}
              onCreated={(newId) => { setIsCreateOpen(false); setCreateDefaults({}); if (newId) handleCreated(newId); }}
              defaultValues={createDefaults}
              employees={employees}
              systemUsers={systemUsers}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* ═══ Filters + Tabs ═══ */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input placeholder={translateUIText('بحث بالعنوان أو ID...', locale)} value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="size-3.5" /></button>}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <Clock className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder={translateUIText('الحالة', locale)} />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>}{STATUS_OPTIONS.map((s) => (<SelectItem key={s.value} value={s.value} className="text-white"><T>{s.label}</T></SelectItem>))}</SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <AlertTriangle className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder={translateUIText('الأولوية', locale)} />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>}{PRIORITY_OPTIONS.map((p) => (<SelectItem key={p.value} value={p.value} className="text-white"><T>{p.label}</T></SelectItem>))}</SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
              <FileText className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder={translateUIText('التصنيف', locale)} />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>}{ISSUE_CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value} className="text-white"><T>{c.label}</T></SelectItem>))}</SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <Users className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder={translateUIText('القسم', locale)} />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>}{DEPARTMENTS.map((d) => (<SelectItem key={d} value={d} className="text-white">{d}</SelectItem>))}</SelectContent>
          </Select>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {[
            { key: 'all', label: 'الكل', count: filtered.length },
            { key: 'open', label: 'مفتوحة' },
            { key: 'overdue', label: 'متأخرة', count: stats.overdue },
            { key: 'critical', label: 'حرجة', count: stats.critical },
            { key: 'reopened', label: 'معاد فتحها', count: stats.reopened },
            { key: 'verification', label: 'بانتظار التحقق' },
            { key: 'closed', label: 'مغلقة' },
          ].map((tab) => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.key ? 'bg-linear-to-r from-brand-600 to-brand-700 text-white shadow-md shadow-brand-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}>
              {tab.label && <T>{tab.label}</T>}{tab.count !== undefined ? ` (${formatInteger(tab.count, locale)})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* Subtle background-revalidation state (§32) */}
      <DataFreshnessIndicator revalidating={revalidating} />

      {/* ═══ Loading / Error / Empty ═══ */}
      {loading ? (
        <div className="space-y-2.5">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />))}</div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3"><AlertTriangle className="size-6 text-rose-400" /></div>
            <p className="text-rose-300 text-sm font-medium">{error && <T>{error}</T>}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refreshData()}><T>إعادة المحاولة</T></Button>
          </CardContent>
        </Card>
      ) : displayed.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3"><ShieldCheck className="size-6 text-slate-600" /></div>
            <p className="text-slate-400 text-sm font-medium"><T>لا توجد حالات كابا</T></p>
            <p className="text-slate-600 text-xs mt-1"><T>{search ? 'لم يتم العثور على نتائج' : 'لم يتم تسجيل أي حالات بعد'}</T></p>
            {canCreate && !search && (
              <Button onClick={() => { setCreateDefaults({}); setIsCreateOpen(true); }} size="sm" className="mt-3 bg-brand-600 hover:bg-brand-700 text-white">
                <Plus className="size-4 ml-1" /> <T>إنشاء أول حالة</T>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {displayed.map((item) => {
              const sc = getStatusConfig(item.status);
              const SIcon = sc.icon;
              const pc = getPriorityConfig(item.priority);
              const overdue = isOverdue(item);
              const pct = calculateProgress(item);
              const sla = getSLAInfo(item);

              return (
                <motion.div key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}>
                  <Card
                    className={`border overflow-hidden transition-all cursor-pointer ${
                      overdue ? 'border-red-500/40 bg-red-500/[0.03] hover:bg-red-500/[0.06]' :
                      'border-slate-700/40 bg-slate-800/50 hover:bg-slate-800/70'
                    }`}
                    onClick={() => openDetail(item)}
                  >
                    <CardContent className="p-4 space-y-3">
                      {/* Top Row */}
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-mono" dir="ltr">{item.capaId || '—'}</span>
                            {overdue && <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30"><Flame className="size-2.5" /> <T>متأخرة</T></span>}
                            {/* SLA Badge */}
                            {sla.state === 'warning' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                <Clock className="size-2 inline" /> {formatInteger(sla.daysRemaining, locale)} <T>يوم متبقي</T>
                              </span>
                            )}
                            {sla.state === 'critical' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                <AlertTriangle className="size-2 inline" /> <T>تجاوز المهلة</T>
                              </span>
                            )}
                          </div>
                          <h3 className="text-white font-semibold text-sm leading-tight mt-0.5">{item.title || translateUIText('بدون عنوان', locale)}</h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${sc.color}`}><SIcon className="size-2.5" /><T>{sc.label}</T></div>
                            <div className={`px-2 py-0.5 rounded border text-[10px] font-medium ${pc.color}`}><T>{pc.label}</T></div>
                            {item.department && <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-700/50">{item.department}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                          {/* §22/§23: mark this CAPA case (⭐/📌) — the
                              descriptor opens the exact DETAIL card via the
                              page's navParams.id contract. */}
                          <FavoriteToggle
                            size="sm"
                            descriptor={{
                              targetType: 'record',
                              targetId: item.id,
                              route: 'capa',
                              label: `CAPA: ${item.title || item.capaId || ''}`,
                              navigationContext: { id: item.id },
                            }}
                          />
                          <PinToggle
                            size="sm"
                            descriptor={{
                              targetType: 'record',
                              targetId: item.id,
                              route: 'capa',
                              label: `CAPA: ${item.title || item.capaId || ''}`,
                              navigationContext: { id: item.id },
                            }}
                          />
                          {/* §2 — SmartActionMenu */}
                          <SmartActionMenu
                            actions={[
                              { key: 'delete', label: translateUIText('حذف الحالة', locale), icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => setDeletingId(item.id), hidden: !canDelete },
                            ]}
                          />
                        </div>
                      </div>

                      {/* Smart Progress Bar (section-based) */}
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              pct >= 85 ? 'bg-brand-500' : pct >= 60 ? 'bg-sky-500' : pct >= 35 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 min-w-[28px] text-left" dir="ltr">{formatPercentage(pct, { locale })}</span>
                      </div>

                      {/* Key Info Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                        {item.assignedToName && <span className="text-slate-500 flex items-center gap-1"><UserCheck className="size-3" />{item.assignedToName}</span>}
                        {item.issueCategory && <span className="text-slate-500">{CATEGORY_LABELS[item.issueCategory] || item.issueCategory}</span>}
                        <span className="text-slate-500 flex items-center gap-1"><CalendarDays className="size-3" />{formatDate(item.createdAt, locale)}</span>
                        {item.correctiveDueDate && <span className="text-slate-500 flex items-center gap-1"><Clock className="size-3" /><T>موعد التصحيح: </T><span dir="ltr" className="text-slate-300">{item.correctiveDueDate}</span></span>}
                      </div>

                      {/* Quick Root Cause / Actions Preview */}
                      {item.rootCauseDescription && (
                        <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-1.5">
                          <p className="text-amber-500/70 text-[10px] font-medium mb-0.5"><T>السبب الجذري</T></p>
                          <p className="text-slate-400 text-xs leading-relaxed">{truncate(item.rootCauseDescription, 100)}</p>
                        </div>
                      )}

                      {item.correctiveAction && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 px-3 py-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <p className="text-blue-400 text-[10px] font-medium"><T>الإجراء التصحيحي</T></p>
                              {item.correctiveStatus && (() => { const ac = getActionStatusConfig(item.correctiveStatus); return <span className={`px-1.5 py-0.5 rounded text-[9px] border ${ac.color}`}><T>{ac.label}</T></span>; })()}
                            </div>
                            <p className="text-slate-400 text-xs leading-relaxed">{truncate(item.correctiveAction, 80)}</p>
                          </div>
                          {item.preventiveAction && (
                            <div className="rounded-lg bg-brand-500/5 border border-brand-500/10 px-3 py-1.5">
                              <div className="flex items-center justify-between mb-0.5">
                                <p className="text-brand-400 text-[10px] font-medium"><T>الإجراء الوقائي</T></p>
                                {item.preventiveStatus && (() => { const ac = getActionStatusConfig(item.preventiveStatus); return <span className={`px-1.5 py-0.5 rounded text-[9px] border ${ac.color}`}><T>{ac.label}</T></span>; })()}
                              </div>
                              <p className="text-slate-400 text-xs leading-relaxed">{truncate(item.preventiveAction, 80)}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ §12 QUICK CREATE — INLINE CARD (moved above; legacy position removed) ═══ */}

      {/* ═══ Delete Dialog — unified ConfirmDialog (§4) ═══ */}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
        description={translateUIText('هل أنت متأكد من حذف هذه الحالة؟ لا يمكن التراجع عن هذه العملية.', locale)}
        itemName={deletingId ? cases.find((c) => c.id === deletingId)?.title : undefined}
        loading={deleting}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />

      {/* ═══ Report Dialog ═══ */}
      <Dialog open={showReport} onOpenChange={(o) => { if (!o) { setShowReport(false); setReportData(null); } }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><BarChart3 className="size-5 text-brand-400" /><T>تقرير حالات كابا</T></DialogTitle>
            <DialogDescription className="text-slate-400"><T>إحصائيات وتحليلات شاملة لحالات CAPA</T></DialogDescription>
          </DialogHeader>
          {reportLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-8 text-brand-400 animate-spin" /></div>
          ) : reportData ? (
            <div className="space-y-5">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: 'إجمالي الحالات', value: formatInteger(reportData.summary?.total ?? 0, locale), color: 'text-brand-400', border: 'border-brand-500/30' },
                  { label: 'مفتوحة', value: formatInteger(reportData.summary?.open ?? 0, locale), color: 'text-blue-400', border: 'border-blue-500/30' },
                  { label: 'مغلقة', value: formatInteger(reportData.summary?.closed ?? 0, locale), color: 'text-green-400', border: 'border-green-500/30' },
                  { label: 'متأخرة', value: formatInteger(reportData.summary?.overdue ?? 0, locale), color: 'text-red-400', border: 'border-red-500/30' },
                  { label: 'حرجة', value: formatInteger(reportData.summary?.critical ?? 0, locale), color: 'text-orange-400', border: 'border-orange-500/30' },
                  { label: 'معاد فتحها', value: formatInteger(reportData.summary?.reopened ?? 0, locale), color: 'text-rose-400', border: 'border-rose-500/30' },
                  { label: 'نسبة الفعالية', value: formatPercentage(reportData.summary?.effectivenessPct ?? 0, { locale }), color: 'text-emerald-400', border: 'border-emerald-500/30' },
                  { label: 'قيد التنفيذ', value: formatInteger((reportData.summary?.total ?? 0) - (reportData.summary?.open ?? 0) - (reportData.summary?.closed ?? 0), locale), color: 'text-amber-400', border: 'border-amber-500/30' },
                ].map((kpi) => (
                  <div key={kpi.label} className={`rounded-lg border ${kpi.border} bg-slate-800/40 px-3 py-2.5`}>
                    <p className="text-slate-500 text-[10px]"><T>{kpi.label}</T></p>
                    <p className={`${kpi.color} font-bold text-xl leading-tight`}>{kpi.value}</p>
                  </div>
                ))}
              </div>
              <Separator className="bg-slate-700/50" />

              {/* By Department */}
              {reportData.byDepartment && Object.keys(reportData.byDepartment).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><Users className="size-4 text-brand-400" /><T>حسب القسم</T></h3>
                  <div className="space-y-1.5">
                    {Object.entries(reportData.byDepartment).sort((a: any, b: any) => (b[1] as any).total - (a[1] as any).total).map(([dept, metrics]: [string, any]) => (
                      <div key={dept} className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
                        <span className="text-slate-300 w-28 truncate">{dept}</span>
                        <div className="flex-1 flex gap-3">
                          <span className="text-slate-500"><T>إجمالي: </T><span className="text-white">{formatInteger(metrics.total, locale)}</span></span>
                          <span className="text-slate-500"><T>مفتوح: </T><span className="text-blue-400">{formatInteger(metrics.open, locale)}</span></span>
                          <span className="text-slate-500"><T>مغلق: </T><span className="text-green-400">{formatInteger(metrics.closed, locale)}</span></span>
                          <span className="text-slate-500"><T>متأخر: </T><span className="text-red-400">{formatInteger(metrics.overdue, locale)}</span></span>
                          <span className="text-slate-500"><T>فعالية: </T><span className="text-emerald-400">{formatPercentage(metrics.effectivenessPct, { locale })}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Status */}
              {reportData.byStatus && Object.keys(reportData.byStatus).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><CircleDot className="size-4 text-brand-400" /><T>حسب الحالة</T></h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byStatus).sort((a: any, b: any) => b[1] - a[1]).map(([status, count]: [string, any]) => {
                      const cfg = getStatusConfig(status);
                      return (
                        <div key={status} className={`px-3 py-1.5 rounded-lg border ${cfg.color} text-xs font-medium`}>
                          <T>{cfg.label}</T>: {formatInteger(count, locale)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By Priority */}
              {reportData.byPriority && Object.keys(reportData.byPriority).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="size-4 text-brand-400" /><T>حسب الأولوية</T></h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byPriority).sort((a: any, b: any) => b[1] - a[1]).map(([priority, count]: [string, any]) => {
                      const cfg = getPriorityConfig(priority);
                      return (
                        <div key={priority} className={`px-3 py-1.5 rounded-lg border ${cfg.color} text-xs font-medium`}>
                          <T>{cfg.label}</T>: {formatInteger(count, locale)}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly Trends */}
              {reportData.monthlyTrends && reportData.monthlyTrends.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><TrendingUp className="size-4 text-brand-400" /><T>الاتجاه الشهري (آخر 12 شهر)</T></h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {reportData.monthlyTrends.filter((m: any) => m.total > 0).map((m: any) => (
                      <div key={m.month} className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg bg-slate-800/30">
                        <span className="text-slate-400 w-20" dir="ltr">{formatMonthKey(m.month, locale)}</span>
                        <div className="flex-1 flex gap-4">
                          <span className="text-slate-500"><T>جديد: </T><span className="text-white">{formatInteger(m.total, locale)}</span></span>
                          <span className="text-slate-500"><T>مغلق: </T><span className="text-green-400">{formatInteger(m.closed, locale)}</span></span>
                          <span className="text-slate-500"><T>متأخر: </T><span className="text-red-400">{formatInteger(m.overdue, locale)}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Category */}
              {reportData.byCategory && Object.keys(reportData.byCategory).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><FileText className="size-4 text-brand-400" /><T>حسب التصنيف</T></h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byCategory).sort((a: any, b: any) => b[1] - a[1]).map(([cat, count]: [string, any]) => (
                      <div key={cat} className="px-3 py-1.5 rounded-lg border border-slate-700/40 bg-slate-800/40 text-xs">
                        <span className="text-slate-400"><T>{CATEGORY_LABELS[cat] || cat}</T>:</span> <span className="text-white font-medium">{formatInteger(count, locale)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Source */}
              {reportData.bySource && Object.keys(reportData.bySource).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><Zap className="size-4 text-brand-400" /><T>حسب المصدر</T></h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.bySource).sort((a: any, b: any) => b[1] - a[1]).map(([source, count]: [string, any]) => (
                      <div key={source} className="px-3 py-1.5 rounded-lg border border-slate-700/40 bg-slate-800/40 text-xs">
                        <span className="text-slate-400"><T>{SOURCE_LABELS[source] || source}</T>:</span> <span className="text-white font-medium">{formatInteger(count, locale)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Export Buttons */}
              <Separator className="bg-slate-700/50" />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => handleExport('csv')}>
                  <Download className="size-3.5 ml-1" /> <T>تصدير CSV</T>
                </Button>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => handleExport('xlsx')}>
                  <Download className="size-3.5 ml-1" /> <T>تصدير Excel</T>
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="size-8 text-slate-600 mb-2" />
              <p className="text-slate-500 text-sm"><T>لا تتوفر بيانات التقرير</T></p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}