'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ShieldCheck, Plus, Pencil, Search, X, Trash2, CalendarDays, Users,
  CheckCircle2, AlertTriangle, Clock, Loader2, Eye, BarChart3,
  UserCheck, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText,
  Target, Zap, TrendingUp, ArrowRight, BookOpen, Brain,
  ClipboardList, FolderOpen, AlertOctagon, CircleDot, Flame,
  Wrench, Shield, RefreshCw, History, Lightbulb, ArrowDownUp, Download,
} from 'lucide-react';
import { toast } from 'sonner';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import type { CAPACase, CAPATimelineEvent, Employee } from '@/types';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';

// ══════════════════════════════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════════════════════════════

const STATUS_OPTIONS = [
  { value: 'open', label: 'مفتوح' },
  { value: 'investigation', label: 'تحقيق' },
  { value: 'root_cause_analysis', label: 'تحليل السبب الجذري' },
  { value: 'corrective_action', label: 'الإجراء التصحيحي' },
  { value: 'preventive_action', label: 'الإجراء الوقائي' },
  { value: 'verification', label: 'التحقق' },
  { value: 'closed', label: 'مغلقة' },
  { value: 'rejected', label: 'مرفوضة' },
  { value: 'reopened', label: 'أُعيد فتحها' },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'حرج' },
  { value: 'high', label: 'عالي' },
  { value: 'medium', label: 'متوسط' },
  { value: 'low', label: 'منخفض' },
];

const ISSUE_CATEGORIES = [
  { value: 'quality_issue', label: 'مشكلة جودة' },
  { value: 'attendance_issue', label: 'مشكلة حضور' },
  { value: 'behavior_issue', label: 'مشكلة سلوك' },
  { value: 'training_issue', label: 'مشكلة تدريب' },
  { value: 'customer_complaint', label: 'شكوى عميل' },
  { value: 'process_failure', label: 'فشل عملية' },
  { value: 'system_error', label: 'خطأ نظام' },
  { value: 'sales_error', label: 'خطأ مبيعات' },
  { value: 'operations_error', label: 'خطأ تشغيلي' },
  { value: 'other', label: 'أخرى' },
];

const ROOT_CAUSE_CATEGORIES = [
  { value: 'lack_of_training', label: 'نقص تدريب' },
  { value: 'human_error', label: 'خطأ بشري' },
  { value: 'poor_process', label: 'عملية ضعيفة' },
  { value: 'missing_procedure', label: 'إجراء مفقود' },
  { value: 'communication_failure', label: 'فشل تواصل' },
  { value: 'system_limitation', label: 'قيود النظام' },
  { value: 'workload', label: 'ضغط عمل' },
  { value: 'management_issue', label: 'مشكلة إدارية' },
  { value: 'other', label: 'أخرى' },
];

const ACTION_STATUS_OPTIONS = [
  { value: 'not_started', label: 'لم يبدأ' },
  { value: 'in_progress', label: 'قيد التنفيذ' },
  { value: 'completed', label: 'مكتمل' },
];

const VERIFICATION_RESULTS = [
  { value: 'effective', label: 'فعّال' },
  { value: 'partially_effective', label: 'فعّال جزئياً' },
  { value: 'not_effective', label: 'غير فعّال' },
];

const WORKFLOW_STAGES = [
  { key: 'open', label: 'مفتوح', icon: FolderOpen },
  { key: 'investigation', label: 'تحقيق', icon: Search },
  { key: 'root_cause_analysis', label: 'تحليل السبب', icon: Brain },
  { key: 'corrective_action', label: 'إجراء تصحيحي', icon: Wrench },
  { key: 'preventive_action', label: 'إجراء وقائي', icon: Shield },
  { key: 'verification', label: 'التحقق', icon: ClipboardList },
  { key: 'closed', label: 'مغلقة', icon: CheckCircle2 },
];

const SLA_DAYS: Record<string, number> = { critical: 1, high: 3, medium: 7, low: 14 };

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(ISSUE_CATEGORIES.map((c) => [c.value, c.label]));
const ROOT_CAUSE_LABELS: Record<string, string> = Object.fromEntries(ROOT_CAUSE_CATEGORIES.map((c) => [c.value, c.label]));
const SOURCE_LABELS: Record<string, string> = {
  audit: 'تدقيق', complaint: 'شكوى', mistake_pattern: 'نمط أخطاء',
  management_review: 'مراجعة إدارية', employee_feedback: 'ملاحظات موظف', automation: 'أتمتة', manual: 'يدوي',
};

const DEPARTMENTS = ['الإدارة', 'المبيعات', 'التشغيل', 'الموارد البشرية', 'المالية', 'تقنية المعلومات', 'الجودة', 'خدمة العملاء'];

// ══════════════════════════════════════════════════════════════════
//  BADGE HELPERS
// ══════════════════════════════════════════════════════════════════

function getStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string; icon: any }> = {
    open: { label: 'مفتوح', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: FolderOpen },
    investigation: { label: 'تحقيق', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', icon: Search },
    root_cause_analysis: { label: 'تحليل السبب', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Brain },
    corrective_action: { label: 'إجراء تصحيحي', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30', icon: Wrench },
    preventive_action: { label: 'إجراء وقائي', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30', icon: Shield },
    verification: { label: 'التحقق', color: 'bg-sky-500/15 text-sky-400 border-sky-500/30', icon: ClipboardList },
    closed: { label: 'مغلقة', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30', icon: CheckCircle2 },
    rejected: { label: 'مرفوضة', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: X },
    reopened: { label: 'أُعيد فتحها', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30', icon: RefreshCw },
  };
  return map[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30', icon: CircleDot };
}

function getPriorityConfig(priority: string) {
  const map: Record<string, { label: string; color: string }> = {
    critical: { label: 'حرج', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
    high: { label: 'عالي', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    medium: { label: 'متوسط', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    low: { label: 'منخفض', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
  };
  return map[priority] || { label: priority, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

function getActionStatusConfig(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    not_started: { label: 'لم يبدأ', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
    in_progress: { label: 'قيد التنفيذ', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    completed: { label: 'مكتمل', color: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  };
  return map[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

function formatDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function isOverdue(capa: CAPACase): boolean {
  if (capa.status === 'closed') return false;
  const sla = capa.slaDays || SLA_DAYS[capa.priority] || 7;
  const created = new Date(capa.createdAt).getTime();
  const due = created + sla * 86400000;
  return Date.now() > due;
}

function getStageIndex(status: string): number {
  return WORKFLOW_STAGES.findIndex((s) => s.key === status);
}

function truncate(str: string, max: number): string {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// ══════════════════════════════════════════════════════════════════
//  EMPTY FORM
// ══════════════════════════════════════════════════════════════════

const emptyForm = {
  title: '', department: '', employeeId: '', issueCategory: 'other',
  problemDescription: '', impactLevel: 'medium' as 'low' | 'medium' | 'high' | 'critical', impactDescription: '',
  rootCauseCategory: '', rootCauseDescription: '', rootCauseVerification: '',
  correctiveAction: '', correctiveAssignedTo: '', correctiveDueDate: '',
  correctiveStatus: 'not_started', correctiveEvidence: '',
  preventiveAction: '', preventiveAssignedTo: '', preventiveDueDate: '',
  preventiveStatus: 'not_started', preventiveVerificationMethod: '',
  verificationDate: '', verifiedBy: '', verificationResult: '' as string,
  verificationNotes: '', status: 'open', priority: 'medium',
  assignedTo: '', source: 'manual', finalComments: '',
  relatedFollowUpId: '', relatedRiskId: '', relatedComplaintId: '',
  lessonsLearned: '',
};

// ══════════════════════════════════════════════════════════════════
//  COMPONENT
// ══════════════════════════════════════════════════════════════════

export default function CAPAPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('capa');
  const { user } = useAuth();

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

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CAPACase | null>(null);
  const [detailItem, setDetailItem] = useState<CAPACase | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formStep, setFormStep] = useState(0);

  // Report & Export state
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ═══ Fetch ═══
  useEffect(() => {
    if (!canView) { setLoading(false); return; }
    fetchData();
  }, []);

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

  // Tab-based display
  const displayed = useMemo(() => {
    if (activeTab === 'all') return filtered;
    if (activeTab === 'overdue') return filtered.filter(isOverdue);
    if (activeTab === 'verification') return filtered.filter((c) => c.status === 'verification');
    return filtered.filter((c) => c.status === activeTab);
  }, [filtered, activeTab]);

  // ═══ Stats ═══
  const stats = useMemo(() => {
    const total = cases.length;
    const open = cases.filter((c) => c.status === 'open').length;
    const inProgress = cases.filter((c) => ['investigation', 'root_cause_analysis', 'corrective_action', 'preventive_action'].includes(c.status)).length;
    const overdue = cases.filter(isOverdue).length;
    const closed = cases.filter((c) => c.status === 'closed').length;
    const pendingVerification = cases.filter((c) => c.status === 'verification').length;
    const mostCommonRoot = getMostCommonRootCause();
    const avgResolution = getAvgResolutionTime();
    return { total, open, inProgress, overdue, closed, pendingVerification, mostCommonRoot, avgResolution };
  }, [cases]);

  function getMostCommonRootCause(): string {
    const counts: Record<string, number> = {};
    cases.forEach((c) => { if (c.rootCauseCategory) counts[c.rootCauseCategory] = (counts[c.rootCauseCategory] || 0) + 1; });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? ROOT_CAUSE_LABELS[top[0]] || top[0] : '—';
  }

  function getAvgResolutionTime(): string {
    const closed = cases.filter((c) => c.status === 'closed' && c.createdAt && c.closedAt);
    if (closed.length === 0) return '—';
    const avg = closed.reduce((sum, c) => sum + (new Date(c.closedAt!).getTime() - new Date(c.createdAt).getTime()), 0) / closed.length;
    const days = Math.round(avg / 86400000);
    return `${days} يوم`;
  }

  // ═══ Form Handlers ═══
  const openCreate = () => { setEditingItem(null); setForm(emptyForm); setFormStep(0); setIsFormOpen(true); };

  const openEdit = (item: CAPACase) => {
    setEditingItem(item);
    setForm({
      title: item.title || '', department: item.department || '', employeeId: item.employeeId || '',
      issueCategory: item.issueCategory || 'other', problemDescription: item.problemDescription || '',
      impactLevel: item.impactLevel || 'medium', impactDescription: item.impactDescription || '',
      rootCauseCategory: item.rootCauseCategory || '', rootCauseDescription: item.rootCauseDescription || '',
      rootCauseVerification: item.rootCauseVerification || '', correctiveAction: item.correctiveAction || '',
      correctiveAssignedTo: item.correctiveAssignedTo || '', correctiveDueDate: item.correctiveDueDate || '',
      correctiveStatus: item.correctiveStatus || 'not_started', correctiveEvidence: item.correctiveEvidence || '',
      preventiveAction: item.preventiveAction || '', preventiveAssignedTo: item.preventiveAssignedTo || '',
      preventiveDueDate: item.preventiveDueDate || '', preventiveStatus: item.preventiveStatus || 'not_started',
      preventiveVerificationMethod: item.preventiveVerificationMethod || '', verificationDate: item.verificationDate || '',
      verifiedBy: item.verifiedBy || '', verificationResult: item.verificationResult || '',
      verificationNotes: item.verificationNotes || '', status: item.status, priority: item.priority,
      assignedTo: item.assignedTo || '', source: item.source || 'manual', finalComments: item.finalComments || '',
      relatedFollowUpId: item.relatedFollowUpId || '', relatedRiskId: item.relatedRiskId || '',
      relatedComplaintId: item.relatedComplaintId || '', lessonsLearned: item.lessonsLearned || '',
    });
    setFormStep(0);
    setIsFormOpen(true);
  };

  const openDetail = (item: CAPACase) => { setDetailItem(item); setIsDetailOpen(true); };

  const handleSave = async () => {
    if (!form.title) return;
    setSaving(true);
    try {
      const payload = {
        ...form,
        createdBy: user?.id || 'system',
        createdByName: user?.name || 'النظام',
      };
      if (editingItem) {
        const res = await authFetch(`/api/capa-cases/${editingItem.id}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) { logUpdate('capa', 'حالة كابا', form.title); toast.success('تم تحديث الحالة بنجاح'); fetchData(); setIsFormOpen(false); }
        else toast.error('فشل في التحديث');
      } else {
        const res = await authFetch('/api/capa-cases', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (res.ok) { logCreate('capa', 'حالة كابا', form.title); toast.success('تم إنشاء الحالة بنجاح'); fetchData(); setIsFormOpen(false); }
        else toast.error('فشل في الإنشاء');
      }
    } catch { toast.error('حدث خطأ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch(`/api/capa-cases/${id}`, { method: 'DELETE' });
      if (res.ok) { logDelete('capa', 'حالة كابا', ''); toast.success('تم حذف الحالة'); setCases((p) => p.filter((c) => c.id !== id)); }
    } catch { toast.error('فشل في الحذف'); }
    setDeletingId(null);
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
          <Button onClick={openCreate} size="sm" className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all">
            <Plus className="size-4 ml-1" /> إنشاء حالة كابا
          </Button>
        )}
        <div className="flex gap-1.5">
          <Button onClick={openReport} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
            <BarChart3 className="size-4 ml-1" /> التقرير
          </Button>
          <Button onClick={() => handleExport('xlsx')} disabled={exporting} size="sm" variant="outline" className="border-slate-700/70 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-3">
            {exporting ? <Loader2 className="size-4 animate-spin ml-1" /> : <Download className="size-4 ml-1" />}
            {exporting ? 'جارٍ التصدير...' : 'تصدير'}
          </Button>
        </div>
      </motion.div>

      {/* ═══ Stats Cards ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
        {[
          { label: 'إجمالي الحالات', value: stats.total, color: 'border-violet-500/30 bg-violet-500/8', textColor: 'text-violet-400' },
          { label: 'مفتوحة', value: stats.open, color: 'border-blue-500/25 bg-blue-500/8', textColor: 'text-blue-400' },
          { label: 'قيد التنفيذ', value: stats.inProgress, color: 'border-amber-500/25 bg-amber-500/8', textColor: 'text-amber-400' },
          { label: 'متأخرة', value: stats.overdue, color: 'border-red-500/25 bg-red-500/8', textColor: 'text-red-400' },
          { label: 'مغلقة', value: stats.closed, color: 'border-violet-500/30 bg-violet-500/8', textColor: 'text-violet-400' },
          { label: 'بانتظار التحقق', value: stats.pendingVerification, color: 'border-sky-500/25 bg-sky-500/8', textColor: 'text-sky-400' },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-lg border ${stat.color} px-3.5 py-2.5`}>
            <p className="text-slate-500 text-[11px] mb-0.5">{stat.label}</p>
            <p className={`${stat.textColor} font-bold text-lg leading-tight`}>{stat.value}</p>
          </div>
        ))}
      </motion.div>

      {/* ═══ Smart Info Row ═══ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-4 py-2.5 flex items-center gap-3">
          <Target className="size-4 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-slate-500 text-[10px]">أكثر سبب جذري شيوعاً</p>
            <p className="text-slate-300 text-sm font-medium truncate">{stats.mostCommonRoot}</p>
          </div>
        </div>
        <div className="rounded-lg border border-slate-700/40 bg-slate-800/30 px-4 py-2.5 flex items-center gap-3">
          <TrendingUp className="size-4 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-slate-500 text-[10px]">متوسط وقت الحل</p>
            <p className="text-slate-300 text-sm font-medium">{stats.avgResolution}</p>
          </div>
        </div>
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
              const stageIdx = getStageIndex(item.status);
              const progressPct = Math.min(100, Math.round(((stageIdx + 1) / WORKFLOW_STAGES.length) * 100));

              return (
                <motion.div key={item.id} layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, scale: 0.97 }}>
                  <Card className={`border overflow-hidden transition-colors ${overdue ? 'border-red-500/40 bg-red-500/[0.03]' : 'border-slate-700/40 bg-slate-800/50'} hover:bg-slate-800/70`}>
                    <CardContent className="p-4 space-y-3">
                      {/* Top Row */}
                      <div className="flex flex-wrap items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-500 font-mono" dir="ltr">{item.capaId || '—'}</span>
                            {overdue && <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30"><Flame className="size-2.5" /> متأخرة</span>}
                          </div>
                          <h3 className="text-white font-semibold text-sm leading-tight mt-0.5">{item.title || 'بدون عنوان'}</h3>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${sc.color}`}><SIcon className="size-2.5" />{sc.label}</div>
                            <div className={`px-2 py-0.5 rounded border text-[10px] font-medium ${pc.color}`}>{pc.label}</div>
                            {item.department && <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-700/50">{item.department}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openDetail(item)} className="p-1.5 rounded-md text-slate-600 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"><Eye className="size-3.5" /></button>
                          {canUpdate && <button onClick={() => openEdit(item)} className="p-1.5 rounded-md text-slate-600 hover:text-violet-400 hover:bg-violet-500/10 transition-colors"><Pencil className="size-3.5" /></button>}
                          {canDelete && <button onClick={() => setDeletingId(item.id)} className="p-1.5 rounded-md text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"><Trash2 className="size-3.5" /></button>}
                        </div>
                      </div>

                      {/* Workflow Progress */}
                      <div className="flex items-center gap-1">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div className="h-full rounded-full bg-linear-to-r from-violet-500 to-indigo-500" initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.5 }} />
                        </div>
                        <span className="text-[10px] text-slate-500 min-w-[28px] text-left" dir="ltr">{progressPct}%</span>
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

      {/* ═══ Detail Dialog ═══ */}
      <Dialog open={isDetailOpen} onOpenChange={(o) => { if (!o) setIsDetailOpen(false); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          {detailItem && <CAPADetailView capa={detailItem} employees={employees} onClose={() => setIsDetailOpen(false)} />}
        </DialogContent>
      </Dialog>

      {/* ═══ Create/Edit Form Dialog ═══ */}
      <Dialog open={isFormOpen} onOpenChange={(o) => { if (!o) { setIsFormOpen(false); setEditingItem(null); } }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">{editingItem ? `تعديل: ${editingItem.capaId}` : 'إنشاء حالة كابا جديدة'}</DialogTitle>
            <DialogDescription className="text-slate-400">{editingItem ? 'عدّل تفاصيل حالة كابا' : 'أدخل تفاصيل المشكلة والإجراءات'}</DialogDescription>
          </DialogHeader>

          {/* Step Indicator */}
          <div className="flex items-center gap-1 mb-2">
            {['المعلومات الأساسية', 'المشكلة والسبب الجذري', 'الإجراءات', 'التحقق والإغلاق'].map((step, i) => (
              <button key={i} onClick={() => setFormStep(i)} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${formStep === i ? 'bg-violet-600/20 text-violet-400 border border-violet-500/30' : 'text-slate-500 hover:text-slate-300'}`}>
                <span className={`size-5 rounded-full flex items-center justify-center text-[10px] font-bold ${formStep === i ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400'}`}>{i + 1}</span>
                <span className="hidden sm:inline">{step}</span>
              </button>
            ))}
          </div>

          <div className="mt-3">
            {formStep === 0 && <FormStep1 form={form} setForm={setForm} employees={employees} systemUsers={systemUsers} />}
            {formStep === 1 && <FormStep2 form={form} setForm={setForm} />}
            {formStep === 2 && <FormStep3 form={form} setForm={setForm} employees={employees} systemUsers={systemUsers} />}
            {formStep === 3 && <FormStep4 form={form} setForm={setForm} employees={employees} systemUsers={systemUsers} />}
          </div>

          <DialogFooter className="mt-4 flex items-center gap-2">
            <Button variant="outline" onClick={() => { setIsFormOpen(false); setEditingItem(null); }} className="border-slate-600 text-slate-300">إلغاء</Button>
            {formStep > 0 && <Button variant="outline" onClick={() => setFormStep((p) => p - 1)} className="border-slate-600 text-slate-300"><ChevronRight className="size-4 ml-1" /> السابق</Button>}
            {formStep < 3 ? (
              <Button onClick={() => setFormStep((p) => p + 1)} className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white">التالي <ChevronLeft className="size-4 mr-1" /></Button>
            ) : (
              <Button onClick={handleSave} disabled={saving || !form.title} className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all">
                {saving ? 'جاري الحفظ...' : (editingItem ? 'حفظ التعديل' : 'إنشاء حالة كابا')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

// ══════════════════════════════════════════════════════════════════
//  FORM STEPS
// ══════════════════════════════════════════════════════════════════

function FormStep1({ form, setForm, employees, systemUsers }: { form: any; setForm: (fn: (p: any) => any) => void; employees: Employee[]; systemUsers: { id: string; name: string; email?: string; role?: string }[] }) {
  const upd = (key: string, val: any) => setForm((p: any) => ({ ...p, [key]: val }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 space-y-1">
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">عنوان المشكلة *</Label>
        <Input value={form.title} onChange={(e) => upd('title', e.target.value)} className="bg-slate-800 border-slate-600 text-white" placeholder="مثال: تكرار خطأ في تسعير التذاكر" />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">القسم *</Label>
        <Select value={form.department} onValueChange={(v) => upd('department', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue placeholder="اختر القسم" /></SelectTrigger>
          <SelectContent>{DEPARTMENTS.map((d) => (<SelectItem key={d} value={d} className="text-white">{d}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">الأولوية *</Label>
        <Select value={form.priority} onValueChange={(v) => upd('priority', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{PRIORITY_OPTIONS.map((p) => (<SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div>
        <EmployeeSearchInput employees={employees} value={form.employeeId || ''} onChange={(id) => upd('employeeId', id)} label="الموظف المرتبط (اختياري)" placeholder="ابحث عن الموظف..." allowClear clearLabel="— بدون —" />
      </div>
      <div>
        <UserSearchInput users={systemUsers} value={form.assignedTo || ''} onChange={(id) => upd('assignedTo', id)} label="المسؤول عن الحالة *" placeholder="ابحث عن مستخدم مسؤول..." />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">المصدر</Label>
        <Select value={form.source} onValueChange={(v) => upd('source', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{Object.entries(SOURCE_LABELS).map(([k, v]) => (<SelectItem key={k} value={k} className="text-white">{v}</SelectItem>))}</SelectContent>
        </Select>
      </div>
    </div>
  );
}

function FormStep2({ form, setForm }: { form: any; setForm: (fn: (p: any) => any) => void }) {
  const upd = (key: string, val: any) => setForm((p: any) => ({ ...p, [key]: val }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 space-y-1">
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">تصنيف المشكلة</Label>
        <Select value={form.issueCategory} onValueChange={(v) => upd('issueCategory', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{ISSUE_CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value} className="text-white">{c.label}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">وصف المشكلة *</Label>
        <Textarea value={form.problemDescription} onChange={(e) => upd('problemDescription', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="صف المشكلة بالتفصيل..." rows={3} />
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">مستوى التأثير</Label>
        <Select value={form.impactLevel} onValueChange={(v) => upd('impactLevel', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{PRIORITY_OPTIONS.map((p) => (<SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label className="text-slate-300 text-sm">الحالة</Label>
        <Select value={form.status} onValueChange={(v) => upd('status', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUS_OPTIONS.map((s) => (<SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">وصف التأثير</Label>
        <Textarea value={form.impactDescription} onChange={(e) => upd('impactDescription', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="أثر المشكلة على العميل/الشركة/العمليات..." rows={2} />
      </div>

      <Separator className="sm:col-span-2 !bg-slate-700/50 my-1" />

      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">تصنيف السبب الجذري</Label>
        <Select value={form.rootCauseCategory} onValueChange={(v) => upd('rootCauseCategory', v)}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
          <SelectContent>{ROOT_CAUSE_CATEGORIES.map((c) => (<SelectItem key={c.value} value={c.value} className="text-white">{c.label}</SelectItem>))}</SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">وصف السبب الجذري</Label>
        <Textarea value={form.rootCauseDescription} onChange={(e) => upd('rootCauseDescription', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="لماذا حدثت هذه المشكلة؟" rows={3} />
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">تأكيد السبب الجذري (الأدلة)</Label>
        <Textarea value={form.rootCauseVerification} onChange={(e) => upd('rootCauseVerification', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="ما هي الأدلة الداعمة؟" rows={2} />
      </div>
    </div>
  );
}

function FormStep3({ form, setForm, employees, systemUsers }: { form: any; setForm: (fn: (p: any) => any) => void; employees: Employee[]; systemUsers: { id: string; name: string; email?: string; role?: string }[] }) {
  const upd = (key: string, val: any) => setForm((p: any) => ({ ...p, [key]: val }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 space-y-1">
      {/* Corrective Action */}
      <div className="sm:col-span-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
        <div className="flex items-center gap-2"><Wrench className="size-4 text-blue-400" /><h3 className="text-blue-400 text-sm font-semibold">الإجراء التصحيحي — إصلاح المشكلة الحالية</h3></div>
        <div className="space-y-2">
          <Label className="text-slate-300 text-xs">وصف الإجراء *</Label>
          <Textarea value={form.correctiveAction} onChange={(e) => upd('correctiveAction', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="ما الذي سيتم عمله لإصلاح المشكلة؟" rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><UserSearchInput users={systemUsers} value={form.correctiveAssignedTo || ''} onChange={(id) => upd('correctiveAssignedTo', id)} label="المسؤول" placeholder="ابحث عن مستخدم..." /></div>
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">تاريخ الاستحقاق</Label>
            <Input type="date" value={form.correctiveDueDate} onChange={(e) => upd('correctiveDueDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" dir="ltr" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">حالة التنفيذ</Label>
            <Select value={form.correctiveStatus} onValueChange={(v) => upd('correctiveStatus', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ACTION_STATUS_OPTIONS.map((s) => (<SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Preventive Action */}
      <div className="sm:col-span-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-3">
        <div className="flex items-center gap-2"><Shield className="size-4 text-violet-400" /><h3 className="text-violet-400 text-sm font-semibold">الإجراء الوقائي — منع تكرار المشكلة</h3></div>
        <div className="space-y-2">
          <Label className="text-slate-300 text-xs">وصف الإجراء *</Label>
          <Textarea value={form.preventiveAction} onChange={(e) => upd('preventiveAction', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="ما الذي سيتم عمله لمنع تكرار المشكلة؟" rows={2} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><UserSearchInput users={systemUsers} value={form.preventiveAssignedTo || ''} onChange={(id) => upd('preventiveAssignedTo', id)} label="المسؤول" placeholder="ابحث عن مستخدم..." /></div>
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">تاريخ الاستحقاق</Label>
            <Input type="date" value={form.preventiveDueDate} onChange={(e) => upd('preventiveDueDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" dir="ltr" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="space-y-1">
            <Label className="text-slate-300 text-xs">حالة التنفيذ</Label>
            <Select value={form.preventiveStatus} onValueChange={(v) => upd('preventiveStatus', v)}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ACTION_STATUS_OPTIONS.map((s) => (<SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>))}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300 text-xs">طريقة التحقق من عدم التكرار</Label>
          <Textarea value={form.preventiveVerificationMethod} onChange={(e) => upd('preventiveVerificationMethod', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="كيف سيتم قياس فعالية الإجراء الوقائي؟" rows={2} />
        </div>
      </div>
    </div>
  );
}

function FormStep4({ form, setForm, employees, systemUsers }: { form: any; setForm: (fn: (p: any) => any) => void; employees: Employee[]; systemUsers: { id: string; name: string; email?: string; role?: string }[] }) {
  const upd = (key: string, val: any) => setForm((p: any) => ({ ...p, [key]: val }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 space-y-1">
      {/* Verification */}
      <div className="sm:col-span-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-3">
        <div className="flex items-center gap-2"><ClipboardList className="size-4 text-sky-400" /><h3 className="text-sky-400 text-sm font-semibold">التحقق من الفعالية</h3></div>
        <div className="grid grid-cols-2 gap-3">
          <div><UserSearchInput users={systemUsers} value={form.verifiedBy || ''} onChange={(id) => upd('verifiedBy', id)} label="المراجع" placeholder="ابحث عن مستخدم..." allowClear clearLabel="— بدون —" /></div>
          <div className="space-y-2">
            <Label className="text-slate-300 text-xs">تاريخ التحقق</Label>
            <Input type="date" value={form.verificationDate} onChange={(e) => upd('verificationDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white" dir="ltr" />
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300 text-xs">نتيجة التحقق</Label>
          <Select value={form.verificationResult} onValueChange={(v) => upd('verificationResult', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white"><SelectValue placeholder="اختر النتيجة" /></SelectTrigger>
            <SelectContent>{VERIFICATION_RESULTS.map((r) => (<SelectItem key={r.value} value={r.value} className="text-white">{r.label}</SelectItem>))}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-slate-300 text-xs">ملاحظات التحقق</Label>
          <Textarea value={form.verificationNotes} onChange={(e) => upd('verificationNotes', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="ملاحظات حول نتيجة التحقق..." rows={2} />
        </div>
      </div>

      {/* Lessons Learned */}
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">الدروس المستفادة</Label>
        <Textarea value={form.lessonsLearned} onChange={(e) => upd('lessonsLearned', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="ما هي الدروس المستفادة من هذه الحالة؟" rows={2} />
      </div>
      <div className="sm:col-span-2 space-y-2">
        <Label className="text-slate-300 text-sm">التعليقات النهائية (مطلوب للإغلاق)</Label>
        <Textarea value={form.finalComments} onChange={(e) => upd('finalComments', e.target.value)} className="bg-slate-800 border-slate-600 text-white resize-none" placeholder="تعليقات نهائية قبل الإغلاق..." rows={2} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  DETAIL VIEW
// ══════════════════════════════════════════════════════════════════

function CAPADetailView({ capa, employees, onClose }: { capa: CAPACase; employees: Employee[]; onClose: () => void }) {
  const sc = getStatusConfig(capa.status);
  const SIcon = sc.icon;
  const pc = getPriorityConfig(capa.priority);
  const overdue = isOverdue(capa);
  const stageIdx = getStageIndex(capa.status);
  const progressPct = Math.min(100, Math.round(((stageIdx + 1) / WORKFLOW_STAGES.length) * 100));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-500 font-mono" dir="ltr">{capa.capaId || '—'}</span>
            {overdue && <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30"><Flame className="size-2.5" /> متأخرة</span>}
          </div>
          <h2 className="text-white font-bold text-lg">{capa.title}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${sc.color}`}><SIcon className="size-2.5" />{sc.label}</div>
            <div className={`px-2 py-0.5 rounded border text-[10px] font-medium ${pc.color}`}>{pc.label}</div>
            <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-700/50">{CATEGORY_LABELS[capa.issueCategory] || capa.issueCategory}</span>
            <span className="text-[10px] text-slate-500">{capa.department}</span>
          </div>
        </div>
      </div>

      {/* Workflow Progress */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]"><span className="text-slate-500">تقدم سير العمل</span><span className="text-violet-400 font-bold">{progressPct}%</span></div>
        <div className="flex items-center gap-1">
          {WORKFLOW_STAGES.map((stage, i) => {
            const reached = i <= stageIdx;
            const StageIcon = stage.icon;
            return (
              <div key={stage.key} className="flex-1 flex flex-col items-center gap-1">
                <div className={`size-6 rounded-full flex items-center justify-center border transition-colors ${reached ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-600'}`}><StageIcon className="size-3" /></div>
                <span className={`text-[8px] text-center leading-tight ${reached ? 'text-violet-400' : 'text-slate-600'}`}>{stage.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      <Separator className="!bg-slate-700/50" />

      {/* Source References — Reverse Links */}
      {(capa.relatedFollowUpId || capa.relatedQualityDeductionId || capa.relatedComplaintId || capa.relatedHrDeductionId) && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
          <h4 className="text-violet-400 text-xs font-semibold flex items-center gap-1.5"><ArrowRight className="size-3.5" />السجل المصدر</h4>
          <div className="grid grid-cols-1 gap-1.5 text-[11px]">
            {capa.relatedFollowUpId && (
              <button
                type="button"
                onClick={() => { onClose(); useAppStore.getState().navigateTo('followUps'); }}
                className="text-left text-violet-300 hover:text-violet-200 underline underline-offset-2 transition-colors"
              >
                ← متابعة مرتبطة (فتح صفحة المتابعات)
              </button>
            )}
            {capa.relatedQualityDeductionId && (
              <button
                type="button"
                onClick={() => { onClose(); useAppStore.getState().navigateTo('quality'); }}
                className="text-left text-violet-300 hover:text-violet-200 underline underline-offset-2 transition-colors"
              >
                ← خصم جودة مرتبط (فتح صفحة الجودة)
              </button>
            )}
            {capa.relatedComplaintId && (
              <button
                type="button"
                onClick={() => { onClose(); useAppStore.getState().navigateTo('complaints'); }}
                className="text-left text-violet-300 hover:text-violet-200 underline underline-offset-2 transition-colors"
              >
                ← شكوى عميل مرتبطة (فتح صفحة الشكاوى)
              </button>
            )}
            {capa.relatedHrDeductionId && (
              <button
                type="button"
                onClick={() => { onClose(); useAppStore.getState().navigateTo('hrDeductions'); }}
                className="text-left text-violet-300 hover:text-violet-200 underline underline-offset-2 transition-colors"
              >
                ← مخالفة HR مرتبطة (فتح صفحة خصومات HR)
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[11px]">
        <div><span className="text-slate-500">المسؤول:</span> <span className="text-slate-300 font-medium">{capa.assignedToName || '—'}</span></div>
        <div><span className="text-slate-500">القسم:</span> <span className="text-slate-300">{capa.department || '—'}</span></div>
        <div><span className="text-slate-500">SLA:</span> <span className="text-slate-300">{capa.slaDays || SLA_DAYS[capa.priority] || 7} يوم</span></div>
        <div><span className="text-slate-500">تاريخ الإنشاء:</span> <span className="text-slate-300" dir="ltr">{formatDate(capa.createdAt)}</span></div>
        <div><span className="text-slate-500">المصدر:</span> <span className="text-slate-300">{SOURCE_LABELS[capa.source] || capa.source}</span></div>
        {capa.closureDate && <div><span className="text-slate-500">تاريخ الإغلاق:</span> <span className="text-slate-300" dir="ltr">{capa.closureDate}</span></div>}
      </div>

      <Separator className="!bg-slate-700/50" />

      {/* Sections */}
      <div className="space-y-4">
        {/* Problem */}
        {capa.problemDescription && (
          <div className="rounded-lg border border-slate-700/30 bg-slate-800/30 p-3 space-y-2">
            <h4 className="text-slate-300 text-xs font-semibold flex items-center gap-1.5"><AlertOctagon className="size-3.5 text-amber-400" />وصف المشكلة</h4>
            <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">{capa.problemDescription}</p>
            {capa.impactDescription && <p className="text-slate-500 text-[11px] mt-1">التأثير: {capa.impactDescription}</p>}
          </div>
        )}

        {/* Root Cause */}
        {capa.rootCauseDescription && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
            <h4 className="text-amber-400 text-xs font-semibold flex items-center gap-1.5"><Brain className="size-3.5" />تحليل السبب الجذري</h4>
            <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">{capa.rootCauseDescription}</p>
            {capa.rootCauseVerification && <p className="text-slate-500 text-[11px]">الأدلة: {capa.rootCauseVerification}</p>}
          </div>
        )}

        {/* Corrective */}
        {capa.correctiveAction && (
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between"><h4 className="text-blue-400 text-xs font-semibold flex items-center gap-1.5"><Wrench className="size-3.5" />الإجراء التصحيحي</h4>{(() => { const ac = getActionStatusConfig(capa.correctiveStatus); return <span className={`px-2 py-0.5 rounded text-[10px] border ${ac.color}`}>{ac.label}</span>; })()}</div>
            <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">{capa.correctiveAction}</p>
            <div className="flex flex-wrap gap-3 text-[10px]">
              {capa.correctiveAssignedToName && <span className="text-slate-500">المسؤول: <span className="text-slate-300">{capa.correctiveAssignedToName}</span></span>}
              {capa.correctiveDueDate && <span className="text-slate-500">الموعد: <span className="text-slate-300" dir="ltr">{capa.correctiveDueDate}</span></span>}
            </div>
          </div>
        )}

        {/* Preventive */}
        {capa.preventiveAction && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between"><h4 className="text-violet-400 text-xs font-semibold flex items-center gap-1.5"><Shield className="size-3.5" />الإجراء الوقائي</h4>{(() => { const ac = getActionStatusConfig(capa.preventiveStatus); return <span className={`px-2 py-0.5 rounded text-[10px] border ${ac.color}`}>{ac.label}</span>; })()}</div>
            <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">{capa.preventiveAction}</p>
            <div className="flex flex-wrap gap-3 text-[10px]">
              {capa.preventiveAssignedToName && <span className="text-slate-500">المسؤول: <span className="text-slate-300">{capa.preventiveAssignedToName}</span></span>}
              {capa.preventiveDueDate && <span className="text-slate-500">الموعد: <span className="text-slate-300" dir="ltr">{capa.preventiveDueDate}</span></span>}
            </div>
          </div>
        )}

        {/* Verification */}
        {capa.verificationResult && (
          <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
            <h4 className="text-sky-400 text-xs font-semibold flex items-center gap-1.5"><ClipboardList className="size-3.5" />نتيجة التحقق</h4>
            <div className="flex items-center gap-2 text-xs">
              {capa.verificationResult === 'effective' && <span className="text-violet-400 font-medium">فعّال</span>}
              {capa.verificationResult === 'partially_effective' && <span className="text-amber-400 font-medium">فعّال جزئياً</span>}
              {capa.verificationResult === 'not_effective' && <span className="text-red-400 font-medium">غير فعّال</span>}
              {capa.verifiedByName && <span className="text-slate-500">بواسطة: <span className="text-slate-300">{capa.verifiedByName}</span></span>}
              {capa.verificationDate && <span className="text-slate-500">تاريخ: <span className="text-slate-300" dir="ltr">{capa.verificationDate}</span></span>}
            </div>
            {capa.verificationNotes && <p className="text-slate-400 text-xs mt-1">{capa.verificationNotes}</p>}
          </div>
        )}

        {/* Lessons Learned */}
        {capa.lessonsLearned && (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
            <h4 className="text-violet-400 text-xs font-semibold flex items-center gap-1.5"><Lightbulb className="size-3.5" />الدروس المستفادة</h4>
            <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">{capa.lessonsLearned}</p>
          </div>
        )}

        {/* Timeline */}
        {capa.timeline && capa.timeline.length > 0 && (
          <div className="rounded-lg border border-slate-700/30 bg-slate-800/30 p-3 space-y-2">
            <h4 className="text-slate-300 text-xs font-semibold flex items-center gap-1.5"><History className="size-3.5 text-slate-400" />سجل الأنشطة</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {[...capa.timeline].reverse().map((event: CAPATimelineEvent) => (
                <div key={event.id} className="flex items-start gap-2 text-[11px]">
                  <div className="size-1.5 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-300">{event.description}</p>
                    <p className="text-slate-600 text-[10px]">{event.performedByName || 'النظام'} — <span dir="ltr">{formatDate(event.timestamp)}</span></p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
