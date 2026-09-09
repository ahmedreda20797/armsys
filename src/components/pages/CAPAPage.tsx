'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useAuth } from '@/contexts/AuthContext';
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
import { toast } from 'sonner';
import { logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import type { CAPACase, Employee } from '@/types';
import type { RepetitionAlert } from '@/lib/repetition-detection';
import { buildCapaPrefillFromAlert } from '@/lib/repetition-detection';
import { capaDefaultsFromNavParams, hasCreateIntent } from '@/lib/record-prefill';
import { FavoriteToggle, PinToggle } from '@/components/shared/NavigationMarks';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CAPAInlineForm } from '@/components/shared/inline-forms';
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

  // ═══ State ═══
  const [cases, setCases] = useState<CAPACase[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  const [loading, setLoading] = useState(!canView); // start settled when the user lacks view permission
  const [error, setError] = useState<string | null>(null);
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

  // ═══ Milestone 7 §8 — Repetition → CAPA alerts ═══
  // Deterministic server detection (same employee + same issue key
  // within the 30-day window, thresholds documented in
  // lib/repetition-detection). Per-domain permissions + employee
  // scope are enforced server-side; the banner only ever shows
  // alerts this caller is entitled to see.
  const [repetitionAlerts, setRepetitionAlerts] = useState<RepetitionAlert[]>([]);
  useEffect(() => {
    if (!canView) return;
    authFetch('/api/repetition-alerts')
      .then((r) => (r.ok ? r.json() : { alerts: [] }))
      .then((d) => setRepetitionAlerts(Array.isArray(d?.alerts) ? d.alerts : []))
      .catch(() => setRepetitionAlerts([]));
  }, [canView]);

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

  // ═══ Fetch ═══
  useEffect(() => {
    if (!canView) return; // loading initialized to false for non-viewers
    fetchData();
  }, []);

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

  async function fetchData() {
    setError(null);
    try {
      const [capaRes, empRes, usrRes] = await Promise.allSettled([
        authFetch('/api/capa-cases'),
        authFetch('/api/employees'),
        authFetch('/api/dashboard/users'),
      ]);
      if (capaRes.status === 'fulfilled' && capaRes.value.ok) {
        const d = await capaRes.value.json();
        setCases(Array.isArray(d.data) ? d.data : Array.isArray(d) ? d : []);
      }
      if (empRes.status === 'fulfilled' && empRes.value.ok) {
        const e = await empRes.value.json();
        setEmployees(Array.isArray(e) ? e : []);
      }
      if (usrRes.status === 'fulfilled' && usrRes.value.ok) {
        const u = await usrRes.value.json();
        setSystemUsers(Array.isArray(u) ? u : []);
      }
    } catch { setError('تعذّر تحميل حالات CAPA'); setCases([]); setEmployees([]); }
    finally { setLoading(false); }
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
      avgClosure = `${Math.round(avg / 86400000)} يوم`;
    }
    return { total, open, inProgress, overdue, closed, pendingVerification, critical, reopened, verificationRate, avgClosure };
  }, [cases]);

  // ═══ Navigate to Detail ═══
  const openDetail = (item: CAPACase) => {
    navigateTo('capa', item.id, { id: item.id });
  };

  // ═══ Delete Handler ═══
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async (id: string) => {
    setDeleting(true);
    try {
      const res = await authFetch(`/api/capa-cases/${id}`, { method: 'DELETE' });
      if (res.ok) {
        logDelete('capa', 'حالة كابا', '');
        toast.success('تم حذف الحالة');
        setCases((p) => p.filter((c) => c.id !== id));
      }
    } catch { toast.error('فشل في الحذف'); }
    setDeleting(false);
    setDeletingId(null);
  };

  // ═══ After Quick Create ═══
  const handleCreated = (newId: string) => {
    fetchData();
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
        body: JSON.stringify({ format, filters }),
      });
      if (!res.ok) { toast.error('فشل في التصدير'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `capa_report_${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`تم التصدير بنجاح (${format.toUpperCase()})`);
    } catch { toast.error('حدث خطأ أثناء التصدير'); }
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
        toast.error('فشل في تحميل التقرير');
      }
    } catch { toast.error('حدث خطأ أثناء تحميل التقرير'); }
    finally { setReportLoading(false); }
  };

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldCheck className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">غير مصرح بالوصول</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header (§25/§26 — sticky) ═══ */}
      <PageHeaderBar
        icon={<ShieldCheck className="size-5" />}
        iconClassName="bg-linear-to-br from-violet-600/20 to-indigo-600/20 border-violet-500/30 text-violet-400"
        title="نظام كابا — الإجراءات التصحيحية والوقائية"
        subtitle="محرك تحسين الجودة وحل المشكلات"
        primaryAction={canCreate ? {
          label: 'إنشاء حالة كابا',
          onClick: () => { setCreateDefaults({}); setIsCreateOpen(true); },
        } : undefined}
        actions={
          <>
            <Button onClick={openReport} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
              <BarChart3 className="size-4 ml-1" /> التقرير
            </Button>
            <Button onClick={() => handleExport('xlsx')} disabled={exporting} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
              {exporting ? <Loader2 className="size-4 animate-spin ml-1" /> : <Download className="size-4 ml-1" />}
              {exporting ? 'جارٍ...' : 'تصدير'}
            </Button>
          </>
        }
      />

      {/* ═══ Enhanced Dashboard Widgets ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {[
          { label: 'إجمالي الحالات', value: stats.total, color: 'border-violet-500/30 bg-violet-500/8', textColor: 'text-violet-400' },
          { label: 'مفتوحة', value: stats.open, color: 'border-blue-500/25 bg-blue-500/8', textColor: 'text-blue-400' },
          { label: 'قيد التنفيذ', value: stats.inProgress, color: 'border-amber-500/25 bg-amber-500/8', textColor: 'text-amber-400' },
          { label: 'متأخرة', value: stats.overdue, color: 'border-red-500/25 bg-red-500/8', textColor: 'text-red-400' },
          { label: 'حرجة', value: stats.critical, color: 'border-orange-500/25 bg-orange-500/8', textColor: 'text-orange-400' },
          { label: 'معاد فتحها', value: stats.reopened, color: 'border-rose-500/25 bg-rose-500/8', textColor: 'text-rose-400' },
          { label: 'نسبة الفعالية', value: `${stats.verificationRate}%`, color: 'border-emerald-500/25 bg-emerald-500/8', textColor: 'text-emerald-400' },
          { label: 'متوسط الحل', value: stats.avgClosure, color: 'border-sky-500/25 bg-sky-500/8', textColor: 'text-sky-400' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-lg border ${stat.color} px-3.5 py-2.5`}>
            <p className="text-slate-500 text-[10px] mb-0.5">{stat.label}</p>
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
            title="مشكلات متكررة"
            icon={<AlertOctagon className="size-3.5 text-amber-300" />}
            subtitle={`${repetitionAlerts.length} موظف بنمط متكرر خلال آخر 30 يوماً — يُنصح بفتح CAPA`}
            persistKey="capaRepetitionAttention"
            items={repetitionAlerts.map((alert, idx): AttentionItem => {
              const empName = employees.find((e: any) => e.id === alert.employeeId)?.name || alert.employeeId;
              const sourceLabel = alert.source === 'followUp' ? 'متابعة' : alert.source === 'complaint' ? 'شكوى' : 'ملاحظة';
              return {
                id: `${alert.employeeId}:${alert.source}:${alert.issueKey}:${idx}`,
                severity: 'warning',
                primary: empName,
                secondary: `${alert.issueLabel} · ${alert.occurrenceCount} مرات`,
                trailing: <span className="font-mono">{alert.firstDay} → {alert.lastDay}</span>,
                onClick: () => {
                  setCreateDefaults(buildCapaPrefillFromAlert(alert, empName));
                  setIsCreateOpen(true);
                },
                overflowItems: [
                  { key: 'view', label: 'فتح ملف الموظف', icon: <Eye className="size-3.5" />, onSelect: () => useAppStore.getState().openEmployee360(alert.employeeId) },
                  { key: 'capa', label: 'إنشاء CAPA', icon: <ShieldAlert className="size-3.5" />, separatorBefore: true, onSelect: () => { setCreateDefaults(buildCapaPrefillFromAlert(alert, empName)); setIsCreateOpen(true); } },
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
          <motion.div
            id="capa-inline-create"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className="rounded-2xl border border-violet-500/30 bg-slate-900/60 backdrop-blur-md shadow-2xl shadow-violet-900/20"
          >
            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-700/50">
              <p className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Plus className="size-3.5 text-violet-400" />
                إنشاء حالة CAPA جديدة
              </p>
              <Button variant="ghost" size="sm" onClick={() => { setIsCreateOpen(false); setCreateDefaults({}); }} className="h-7 text-xs text-slate-400 hover:text-white">
                <X className="size-3.5 ml-1" />
                إغلاق
              </Button>
            </div>
            <div className="p-4">
              <CAPAInlineForm
                key={JSON.stringify(createDefaults)}
                onClose={() => { setIsCreateOpen(false); setCreateDefaults({}); }}
                onCreated={(newId) => { setIsCreateOpen(false); setCreateDefaults({}); if (newId) handleCreated(newId); }}
                defaultValues={createDefaults}
                employees={employees}
                systemUsers={systemUsers}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Filters + Tabs ═══ */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
            <Input placeholder="بحث بالعنوان أو ID..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm" />
            {search && <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="size-3.5" /></button>}
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <Clock className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder="الحالة" />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white">الكل</SelectItem>}{STATUS_OPTIONS.map((s) => (<SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <AlertTriangle className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder="الأولوية" />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white">الكل</SelectItem>}{PRIORITY_OPTIONS.map((p) => (<SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
              <FileText className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder="التصنيف" />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white">الكل</SelectItem>}{ISSUE_CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value} className="text-white">{c.label}</SelectItem>))}</SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-36 h-9 text-sm">
              <Users className="size-3.5 ml-1.5 text-slate-500" /><SelectValue placeholder="القسم" />
            </SelectTrigger>
            <SelectContent>{<SelectItem value="all" className="text-white">الكل</SelectItem>}{DEPARTMENTS.map((d) => (<SelectItem key={d} value={d} className="text-white">{d}</SelectItem>))}</SelectContent>
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
                activeTab === tab.key ? 'bg-linear-to-r from-violet-600 to-indigo-600 text-white shadow-md shadow-violet-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
              }`}>
              {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ Loading / Error / Empty ═══ */}
      {loading ? (
        <div className="space-y-2.5">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />))}</div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3"><AlertTriangle className="size-6 text-rose-400" /></div>
            <p className="text-rose-300 text-sm font-medium">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchData()}>إعادة المحاولة</Button>
          </CardContent>
        </Card>
      ) : displayed.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3"><ShieldCheck className="size-6 text-slate-600" /></div>
            <p className="text-slate-400 text-sm font-medium">لا توجد حالات كابا</p>
            <p className="text-slate-600 text-xs mt-1">{search ? 'لم يتم العثور على نتائج' : 'لم يتم تسجيل أي حالات بعد'}</p>
            {canCreate && !search && (
              <Button onClick={() => { setCreateDefaults({}); setIsCreateOpen(true); }} size="sm" className="mt-3 bg-violet-600 hover:bg-violet-700 text-white">
                <Plus className="size-4 ml-1" /> إنشاء أول حالة
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
                            {overdue && <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30"><Flame className="size-2.5" /> متأخرة</span>}
                            {/* SLA Badge */}
                            {sla.state === 'warning' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                                <Clock className="size-2 inline" /> {sla.daysRemaining} يوم متبقي
                              </span>
                            )}
                            {sla.state === 'critical' && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                                <AlertTriangle className="size-2 inline" /> تجاوز المهلة
                              </span>
                            )}
                          </div>
                          <h3 className="text-white font-semibold text-sm leading-tight mt-0.5">{item.title || 'بدون عنوان'}</h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${sc.color}`}><SIcon className="size-2.5" />{sc.label}</div>
                            <div className={`px-2 py-0.5 rounded border text-[10px] font-medium ${pc.color}`}>{pc.label}</div>
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
                          {canDelete && <button onClick={() => setDeletingId(item.id)} className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="size-3.5" /></button>}
                        </div>
                      </div>

                      {/* Smart Progress Bar (section-based) */}
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              pct >= 85 ? 'bg-violet-500' : pct >= 60 ? 'bg-sky-500' : pct >= 35 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                        <span className="text-[10px] text-slate-500 min-w-[28px] text-left" dir="ltr">{pct}%</span>
                      </div>

                      {/* Key Info Row */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
                        {item.assignedToName && <span className="text-slate-500 flex items-center gap-1"><UserCheck className="size-3" />{item.assignedToName}</span>}
                        {item.issueCategory && <span className="text-slate-500">{CATEGORY_LABELS[item.issueCategory] || item.issueCategory}</span>}
                        <span className="text-slate-500 flex items-center gap-1"><CalendarDays className="size-3" />{formatDate(item.createdAt)}</span>
                        {item.correctiveDueDate && <span className="text-slate-500 flex items-center gap-1"><Clock className="size-3" />موعد التصحيح: <span dir="ltr" className="text-slate-300">{item.correctiveDueDate}</span></span>}
                      </div>

                      {/* Quick Root Cause / Actions Preview */}
                      {item.rootCauseDescription && (
                        <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 px-3 py-1.5">
                          <p className="text-amber-500/70 text-[10px] font-medium mb-0.5">السبب الجذري</p>
                          <p className="text-slate-400 text-xs leading-relaxed">{truncate(item.rootCauseDescription, 100)}</p>
                        </div>
                      )}

                      {item.correctiveAction && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 px-3 py-1.5">
                            <div className="flex items-center justify-between mb-0.5">
                              <p className="text-blue-400 text-[10px] font-medium">الإجراء التصحيحي</p>
                              {item.correctiveStatus && (() => { const ac = getActionStatusConfig(item.correctiveStatus); return <span className={`px-1.5 py-0.5 rounded text-[9px] border ${ac.color}`}>{ac.label}</span>; })()}
                            </div>
                            <p className="text-slate-400 text-xs leading-relaxed">{truncate(item.correctiveAction, 80)}</p>
                          </div>
                          {item.preventiveAction && (
                            <div className="rounded-lg bg-violet-500/5 border border-violet-500/10 px-3 py-1.5">
                              <div className="flex items-center justify-between mb-0.5">
                                <p className="text-violet-400 text-[10px] font-medium">الإجراء الوقائي</p>
                                {item.preventiveStatus && (() => { const ac = getActionStatusConfig(item.preventiveStatus); return <span className={`px-1.5 py-0.5 rounded text-[9px] border ${ac.color}`}>{ac.label}</span>; })()}
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
        description="هل أنت متأكد من حذف هذه الحالة؟ لا يمكن التراجع عن هذه العملية."
        itemName={deletingId ? cases.find((c) => c.id === deletingId)?.title : undefined}
        loading={deleting}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />

      {/* ═══ Report Dialog ═══ */}
      <Dialog open={showReport} onOpenChange={(o) => { if (!o) { setShowReport(false); setReportData(null); } }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2"><BarChart3 className="size-5 text-violet-400" />تقرير حالات كابا</DialogTitle>
            <DialogDescription className="text-slate-400">إحصائيات وتحليلات شاملة لحالات CAPA</DialogDescription>
          </DialogHeader>
          {reportLoading ? (
            <div className="flex items-center justify-center py-12"><Loader2 className="size-8 text-violet-400 animate-spin" /></div>
          ) : reportData ? (
            <div className="space-y-5">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {[
                  { label: 'إجمالي الحالات', value: reportData.summary?.total ?? 0, color: 'text-violet-400', border: 'border-violet-500/30' },
                  { label: 'مفتوحة', value: reportData.summary?.open ?? 0, color: 'text-blue-400', border: 'border-blue-500/30' },
                  { label: 'مغلقة', value: reportData.summary?.closed ?? 0, color: 'text-green-400', border: 'border-green-500/30' },
                  { label: 'متأخرة', value: reportData.summary?.overdue ?? 0, color: 'text-red-400', border: 'border-red-500/30' },
                  { label: 'حرجة', value: reportData.summary?.critical ?? 0, color: 'text-orange-400', border: 'border-orange-500/30' },
                  { label: 'معاد فتحها', value: reportData.summary?.reopened ?? 0, color: 'text-rose-400', border: 'border-rose-500/30' },
                  { label: 'نسبة الفعالية', value: `${reportData.summary?.effectivenessPct ?? 0}%`, color: 'text-emerald-400', border: 'border-emerald-500/30' },
                  { label: 'قيد التنفيذ', value: (reportData.summary?.total ?? 0) - (reportData.summary?.open ?? 0) - (reportData.summary?.closed ?? 0), color: 'text-amber-400', border: 'border-amber-500/30' },
                ].map((kpi) => (
                  <div key={kpi.label} className={`rounded-lg border ${kpi.border} bg-slate-800/40 px-3 py-2.5`}>
                    <p className="text-slate-500 text-[10px]">{kpi.label}</p>
                    <p className={`${kpi.color} font-bold text-xl leading-tight`}>{kpi.value}</p>
                  </div>
                ))}
              </div>
              <Separator className="bg-slate-700/50" />

              {/* By Department */}
              {reportData.byDepartment && Object.keys(reportData.byDepartment).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><Users className="size-4 text-violet-400" />حسب القسم</h3>
                  <div className="space-y-1.5">
                    {Object.entries(reportData.byDepartment).sort((a: any, b: any) => (b[1] as any).total - (a[1] as any).total).map(([dept, metrics]: [string, any]) => (
                      <div key={dept} className="flex items-center gap-3 text-xs px-3 py-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
                        <span className="text-slate-300 w-28 truncate">{dept}</span>
                        <div className="flex-1 flex gap-3">
                          <span className="text-slate-500">إجمالي: <span className="text-white">{metrics.total}</span></span>
                          <span className="text-slate-500">مفتوح: <span className="text-blue-400">{metrics.open}</span></span>
                          <span className="text-slate-500">مغلق: <span className="text-green-400">{metrics.closed}</span></span>
                          <span className="text-slate-500">متأخر: <span className="text-red-400">{metrics.overdue}</span></span>
                          <span className="text-slate-500">فعالية: <span className="text-emerald-400">{metrics.effectivenessPct}%</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Status */}
              {reportData.byStatus && Object.keys(reportData.byStatus).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><CircleDot className="size-4 text-violet-400" />حسب الحالة</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byStatus).sort((a: any, b: any) => b[1] - a[1]).map(([status, count]: [string, any]) => {
                      const cfg = getStatusConfig(status);
                      return (
                        <div key={status} className={`px-3 py-1.5 rounded-lg border ${cfg.color} text-xs font-medium`}>
                          {cfg.label}: {count}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* By Priority */}
              {reportData.byPriority && Object.keys(reportData.byPriority).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><AlertTriangle className="size-4 text-violet-400" />حسب الأولوية</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byPriority).sort((a: any, b: any) => b[1] - a[1]).map(([priority, count]: [string, any]) => {
                      const cfg = getPriorityConfig(priority);
                      return (
                        <div key={priority} className={`px-3 py-1.5 rounded-lg border ${cfg.color} text-xs font-medium`}>
                          {cfg.label}: {count}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Monthly Trends */}
              {reportData.monthlyTrends && reportData.monthlyTrends.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><TrendingUp className="size-4 text-violet-400" />الاتجاه الشهري (آخر 12 شهر)</h3>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {reportData.monthlyTrends.filter((m: any) => m.total > 0).map((m: any) => (
                      <div key={m.month} className="flex items-center gap-3 text-xs px-3 py-1.5 rounded-lg bg-slate-800/30">
                        <span className="text-slate-400 w-20" dir="ltr">{m.month}</span>
                        <div className="flex-1 flex gap-4">
                          <span className="text-slate-500">جديد: <span className="text-white">{m.total}</span></span>
                          <span className="text-slate-500">مغلق: <span className="text-green-400">{m.closed}</span></span>
                          <span className="text-slate-500">متأخر: <span className="text-red-400">{m.overdue}</span></span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Category */}
              {reportData.byCategory && Object.keys(reportData.byCategory).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><FileText className="size-4 text-violet-400" />حسب التصنيف</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.byCategory).sort((a: any, b: any) => b[1] - a[1]).map(([cat, count]: [string, any]) => (
                      <div key={cat} className="px-3 py-1.5 rounded-lg border border-slate-700/40 bg-slate-800/40 text-xs">
                        <span className="text-slate-400">{CATEGORY_LABELS[cat] || cat}:</span> <span className="text-white font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* By Source */}
              {reportData.bySource && Object.keys(reportData.bySource).length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-1.5"><Zap className="size-4 text-violet-400" />حسب المصدر</h3>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reportData.bySource).sort((a: any, b: any) => b[1] - a[1]).map(([source, count]: [string, any]) => (
                      <div key={source} className="px-3 py-1.5 rounded-lg border border-slate-700/40 bg-slate-800/40 text-xs">
                        <span className="text-slate-400">{SOURCE_LABELS[source] || source}:</span> <span className="text-white font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Export Buttons */}
              <Separator className="bg-slate-700/50" />
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => handleExport('csv')}>
                  <Download className="size-3.5 ml-1" /> تصدير CSV
                </Button>
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300" onClick={() => handleExport('xlsx')}>
                  <Download className="size-3.5 ml-1" /> تصدير Excel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12">
              <AlertTriangle className="size-8 text-slate-600 mb-2" />
              <p className="text-slate-500 text-sm">لا تتوفر بيانات التقرير</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}