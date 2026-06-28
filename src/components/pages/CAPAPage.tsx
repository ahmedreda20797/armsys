'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  CircleDot, Download, AlertOctagon,
} from 'lucide-react';
import { toast } from 'sonner';
import { logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import type { CAPACase, Employee } from '@/types';
import CAPAQuickCreate from '@/components/capa/CAPAQuickCreate';
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
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function CAPAPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('capa');
  const { user } = useAuth();
  const navParams = useAppStore((s) => s.navParams);
  const navigateTo = useAppStore((s) => s.navigateTo);
  const detailId = navParams?.id;

  // ═══ State ═══
  const [cases, setCases] = useState<CAPACase[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('all');

  // Quick Create
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<Record<string, any>>({});

  // Delete
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Report & Export
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ═══ If detail ID is present, show detail page ═══
  if (detailId) {
    return (
      <CAPADetailPage
        capaId={detailId}
        onBack={() => navigateTo('capa')}
      />
    );
  }

  // ═══ Fetch ═══
  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    fetchData();
  }, []);

  // Listen for navParams changes (e.g. from cross-module "create CAPA")
  useEffect(() => {
    if (navParams?.source) {
      const defaults: Record<string, any> = {};
      if (navParams.title) defaults.title = navParams.title;
      if (navParams.department) defaults.department = navParams.department;
      if (navParams.priority) defaults.priority = navParams.priority;
      if (navParams.employeeId) defaults.employeeId = navParams.employeeId;
      if (navParams.problemDescription) defaults.problemDescription = navParams.problemDescription;
      if (navParams.source) defaults.source = navParams.source;
      if (navParams.relatedFollowUpId) defaults.relatedFollowUpId = navParams.relatedFollowUpId;
      if (navParams.relatedComplaintId) defaults.relatedComplaintId = navParams.relatedComplaintId;
      if (navParams.relatedQualityDeductionId) defaults.relatedQualityDeductionId = navParams.relatedQualityDeductionId;
      if (navParams.relatedHrDeductionId) defaults.relatedHrDeductionId = navParams.relatedHrDeductionId;
      if (Object.keys(defaults).length > 0) {
        setCreateDefaults(defaults);
        setIsCreateOpen(true);
      }
    }
  }, [navParams]);

  const fetchData = async () => {
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
    } catch { setCases([]); setEmployees([]); }
    finally { setLoading(false); }
  };

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
  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/capa-cases/${id}`, { method: 'DELETE' });
      if (res.ok) {
        logDelete('capa', 'حالة كابا', '');
        toast.success('تم حذف الحالة');
        setCases((p) => p.filter((c) => c.id !== id));
      }
    } catch { toast.error('فشل في الحذف'); }
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
      {/* ═══ Header ═══ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-linear-to-br from-violet-600/20 to-indigo-600/20 border border-violet-500/30">
            <ShieldCheck className="size-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">نظام كابا — الإجراءات التصحيحية والوقائية</h1>
            <p className="text-slate-500 text-xs mt-0.5">محرك تحسين الجودة وحل المشكلات</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => { setCreateDefaults({}); setIsCreateOpen(true); }} size="sm"
            className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all">
            <Plus className="size-4 ml-1" /> إنشاء حالة كابا
          </Button>
        )}
        <div className="flex gap-1.5">
          <Button onClick={openReport} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
            <BarChart3 className="size-4 ml-1" /> التقرير
          </Button>
          <Button onClick={() => handleExport('xlsx')} disabled={exporting} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
            {exporting ? <Loader2 className="size-4 animate-spin ml-1" /> : <Download className="size-4 ml-1" />}
            {exporting ? 'جارٍ...' : 'تصدير'}
          </Button>
        </div>
      </motion.div>

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

      {/* ═══ Loading / Empty ═══ */}
      {loading ? (
        <div className="space-y-2.5">{[1, 2, 3].map((i) => (<Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />))}</div>
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

      {/* ═══ Quick Create Dialog ═══ */}
      <CAPAQuickCreate
        open={isCreateOpen}
        onOpenChange={(open) => { if (!open) { setIsCreateOpen(false); setCreateDefaults({}); } }}
        onCreated={handleCreated}
        defaultValues={createDefaults}
        employees={employees}
        systemUsers={systemUsers}
      />

      {/* ═══ Delete Dialog ═══ */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader><DialogTitle className="text-white">تأكيد الحذف</DialogTitle><DialogDescription className="text-slate-400">هل أنت متأكد من حذف هذه الحالة؟</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingId(null)} className="border-slate-600 text-slate-300">إلغاء</Button>
            <Button variant="destructive" onClick={() => { if (deletingId) handleDelete(deletingId); }}>حذف</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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