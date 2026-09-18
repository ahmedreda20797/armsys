'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { isOverdueFollowUp } from '@/lib/metrics/followUpMetrics';
import { ReportView } from '@/components/shared/reports/ReportView';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
import { CAPALinkBadge } from '@/components/shared/CAPALinkBadge';
import { AttentionPanel, type AttentionItem } from '@/components/shared/AttentionPanel';
import { SmartActionMenu, type SmartAction } from '@/components/shared/SmartActionMenu';
import type { OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { EvidenceLinkButton } from '@/components/shared/EvidenceLinkButton';
import { CAPAInlineForm, type CapaInlineFormState } from '@/components/shared/inline-forms';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BarChart3,
  Plus, Pencil, Search, X, Trash2, CalendarDays, Users,
  CheckCircle2, AlertTriangle, Clock, ClipboardList, UserCheck,
  ArrowUpCircle, ArrowDownCircle, ShieldAlert, Ban, Bell, ShieldCheck,
  ChevronDown, ChevronUp, Filter, Eye, FileText,
  TrendingUp, AlertOctagon, LayoutList, Table2, Paperclip,
  ExternalLink,
} from 'lucide-react';
import type { FollowUp, Employee } from '@/types';

interface SystemUser { id: string; name: string; email?: string; role?: string; }
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import { addDays, todayDayKey } from '@/lib/date-utils';

// ═══════════════════════════════════════════════════
//  Animation Variants
// ═══════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
} as const;

// ═══════════════════════════════════════════════════
//  Constants & Helpers
// ═══════════════════════════════════════════════════

const TYPE_OPTIONS = [
  { value: 'quality', label: 'مشكلة جودة' },
  { value: 'attendance', label: 'مشكلة حضور' },
  { value: 'behavior', label: 'مشكلة سلوك' },
  { value: 'productivity', label: 'مشكلة أداء' },
  { value: 'training', label: 'تدريب' },
  { value: 'coaching', label: 'توجيه / Couching' },
  { value: 'complaint', label: 'شكوى عميل' },
  { value: 'positive', label: 'ملاحظة إيجابية' },
  { value: 'improvement', label: 'فرصة تحسين' },
  { value: 'other', label: 'أخرى' },
];

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'critical', label: 'حرج' },
];

const STATUS_OPTIONS = [
  { value: 'open', label: 'مفتوح' },
  { value: 'under_review', label: 'قيد المراجعة' },
  { value: 'under_follow_up', label: 'قيد المتابعة' },
  { value: 'resolved', label: 'تم الحل' },
  { value: 'closed', label: 'مغلق' },
  { value: 'cancelled', label: 'ملغي' },
];

const ROOT_CAUSE_OPTIONS = [
  'نقص تدريب', 'ضغط عمل', 'إهمال', 'مشكلة نظام', 'مشكلة تواصل', 'أخرى',
];

const ACTION_OPTIONS = [
  'تحذير شفهي', 'جلسة توجيه', 'إعادة تدريب', 'تصحيح عملية',
  'مراقبة', 'تحذير كتابي', 'خصم', 'لا يتطلب إجراء',
];

const SCORE_MAP: Record<string, number> = { low: 1, medium: 3, high: 5, critical: 10 };

function getTypeBadge(type: string) {
  const map: Record<string, { label: string; color: string }> = {
    quality: { label: 'جودة', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    behavior: { label: 'سلوك', color: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
    attendance: { label: 'حضور', color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
    productivity: { label: 'أداء', color: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
    training: { label: 'تدريب', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    coaching: { label: 'توجيه', color: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
    complaint: { label: 'شكوى عميل', color: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
    positive: { label: 'إيجابية', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
    improvement: { label: 'تحسين', color: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
    other: { label: 'أخرى', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
  };
  return map[type] || { label: type, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

function getPriorityBadge(priority: string) {
  const map: Record<string, { label: string; color: string }> = {
    low: { label: 'منخفض', color: 'bg-green-500/15 text-green-400 border-green-500/30' },
    medium: { label: 'متوسط', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    high: { label: 'عالي', color: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    critical: { label: 'حرج', color: 'bg-red-500/15 text-red-400 border-red-500/30' },
  };
  return map[priority] || { label: priority, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

function getPriorityDot(priority: string) {
  const map: Record<string, string> = {
    low: 'bg-green-400',
    medium: 'bg-yellow-400',
    high: 'bg-orange-400',
    critical: 'bg-red-500',
  };
  return map[priority] || 'bg-slate-400';
}

function getStatusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    open: { label: 'مفتوح', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    under_review: { label: 'قيد المراجعة', color: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
    under_follow_up: { label: 'قيد المتابعة', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' },
    resolved: { label: 'تم الحل', color: 'bg-brand-500/15 text-brand-400 border-brand-500/30' },
    closed: { label: 'مغلق', color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' },
    cancelled: { label: 'ملغي', color: 'bg-slate-600/15 text-slate-500 border-slate-600/30' },
  };
  return map[status] || { label: status, color: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'open': return Clock;
    case 'under_review': return Eye;
    case 'under_follow_up': return Clock;
    case 'resolved': return CheckCircle2;
    case 'closed': return CheckCircle2;
    case 'cancelled': return Ban;
    default: return Clock;
  }
}

function getStatusColor(status: string) {
  const map: Record<string, string> = {
    open: 'border-blue-500/30',
    under_review: 'border-brand-500/30',
    under_follow_up: 'border-yellow-500/30',
    resolved: 'border-brand-500/30',
    closed: 'border-slate-600/30',
    cancelled: 'border-slate-700/30',
  };
  return map[status] || 'border-slate-700/40';
}

// ══════════════════════════════════════════════════════════════
//  Date helpers — shared implementations from lib/date-utils
//  (addDays + todayDayKey) so the page dialog and the inline
//  Home quick-action form can never drift apart.
// ══════════════════════════════════════════════════════════════

const getTodayStr = todayDayKey;

function getRiskLevel(score: number): { label: string; color: string } {
  if (score >= 26) return { label: 'مرتفع', color: 'text-red-400 bg-red-500/15 border-red-500/30' };
  if (score >= 11) return { label: 'متوسط', color: 'text-yellow-400 bg-yellow-500/15 border-yellow-500/30' };
  return { label: 'منخفض', color: 'text-green-400 bg-green-500/15 border-green-500/30' };
}

// ═══════════════════════════════════════════════════
//  Empty Form State
// ═══════════════════════════════════════════════════

const emptyForm = {
  employeeId: '',
  date: '',
  followUpType: 'quality',
  subject: '',
  detailedDescription: '',
  positiveNotes: '',
  negativeNotes: '',
  rootCause: '',
  actionTaken: '',
  department: '',
  position: '',
  priorityLevel: 'medium',
  responsiblePerson: '',
  nextFollowUpDate: '',
  followUpRequired: true,
  status: 'open',
  attachments: [] as string[],
  evidence: '',
};

// ═══════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════

export default function FollowUpsPage() {
  const { user } = useAuth();
  const { isAdmin, canView, canCreate, canUpdate, canDelete } = usePermissions('followUps');
  // §12 GLOBAL INLINE FORM STANDARD — creating a CAPA from a follow-up
  // opens the shared inline CAPA form HERE (no navigation). Gated by
  // the CAPA page's own create permission, not followUps'.
  const { canCreate: canCreateCapa } = usePermissions('capa');
  const isManagerOrAdmin = isAdmin || user?.role === 'admin' || user?.role === 'manager';

  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [employeeRiskScores, setEmployeeRiskScores] = useState<Record<string, number>>({});
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [systemUsers, setSystemUsers] = useState<SystemUser[]>([]);
  const [loading, setLoading] = useState(!canView); // start settled when the user lacks view permission
  const [error, setError] = useState<string | null>(null);
  // Phase 6.3 (§8): filter/view context persists per user (session-scoped).
  // collapsedEmployees (§25 container state) persists as an array so a
  // returning user finds the same groups collapsed.
  // §17 EXACT DEEP-LINKING — summary cards seed these filters at
  // mount (navParams win over persisted state for THIS mount, like
  // the EmployeesPage status seed). Keys: overdue / status / priority
  // / type / dueToday — e.g. "22 متابعة متأخرة" → exactly those 22.
  const navSeed = useAppStore((s) => s.navParams);
  const hasNavSeed = Boolean(navSeed.overdue || navSeed.status || navSeed.priority || navSeed.type || navSeed.dueToday);
  const [followUpsView, setFollowUpsView, resetFollowUpsView] = usePageState<{
    search: string;
    statusFilter: string;
    typeFilter: string;
    priorityFilter: string;
    deptFilter: string;
    startDate: string;
    endDate: string;
    overdueOnly?: boolean;
    viewMode: 'table' | 'cards';
    collapsedEmployees: string[];
  }>({
    page: 'followUps',
    slot: 'filters',
    version: 1,
    skipRestore: hasNavSeed,
    initial: () => {
      const todayKey = new Date().toISOString().split('T')[0];
      return {
        search: '',
        statusFilter: typeof navSeed.status === 'string' && navSeed.status ? navSeed.status : 'all',
        typeFilter: typeof navSeed.type === 'string' && navSeed.type ? navSeed.type : 'all',
        priorityFilter: typeof navSeed.priority === 'string' && navSeed.priority ? navSeed.priority : 'all',
        deptFilter: 'all',
        startDate: navSeed.dueToday === '1' ? todayKey : '',
        endDate: navSeed.dueToday === '1' ? todayKey : '',
        overdueOnly: navSeed.overdue === '1',
        viewMode: 'table',
        collapsedEmployees: [],
      };
    },
    validate: (raw) =>
      raw && typeof raw === 'object' && !Array.isArray(raw)
        && typeof (raw as { viewMode?: unknown }).viewMode === 'string'
        ? raw
        : null,
  });
  const search = followUpsView.search;
  const setSearch = (v: string) => setFollowUpsView((s) => ({ ...s, search: v }));
  const statusFilter = followUpsView.statusFilter;
  const setStatusFilter = (v: string) => setFollowUpsView((s) => ({ ...s, statusFilter: v }));
  const typeFilter = followUpsView.typeFilter;
  const setTypeFilter = (v: string) => setFollowUpsView((s) => ({ ...s, typeFilter: v }));
  const priorityFilter = followUpsView.priorityFilter;
  const setPriorityFilter = (v: string) => setFollowUpsView((s) => ({ ...s, priorityFilter: v }));
  const deptFilter = followUpsView.deptFilter;
  const setDeptFilter = (v: string) => setFollowUpsView((s) => ({ ...s, deptFilter: v }));
  const startDate = followUpsView.startDate;
  const setStartDate = (v: string) => setFollowUpsView((s) => ({ ...s, startDate: v }));
  const endDate = followUpsView.endDate;
  const setEndDate = (v: string) => setFollowUpsView((s) => ({ ...s, endDate: v }));
  const overdueOnly = followUpsView.overdueOnly === true;
  const setOverdueOnly = (v: boolean) => setFollowUpsView((s) => ({ ...s, overdueOnly: v }));
  const viewMode = followUpsView.viewMode;
  const setViewMode = (v: 'table' | 'cards') => setFollowUpsView((s) => ({ ...s, viewMode: v }));
  const collapsedEmployees = useMemo(
    () => new Set(followUpsView.collapsedEmployees),
    [followUpsView.collapsedEmployees],
  );
  const setCollapsedEmployees = (valueOrUpdater: Set<string> | ((prev: Set<string>) => Set<string>)) =>
    setFollowUpsView((s) => {
      const prev = new Set(s.collapsedEmployees);
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(prev) : valueOrUpdater;
      return { ...s, collapsedEmployees: [...next] };
    });

  // Deep-link highlight (Phase 5.2 §35) from Evidence Preview navigation.
  useRecordHighlight();

  // §24 — the follow-ups REPORT (deterministic analytics) lives in a
  // dialog on this page; it runs through the SAME unified reporting
  // architecture (registry + runner + ReportView) as every report.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportMode, setReportMode] = useState<'employee' | 'flat'>('employee');

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FollowUp | null>(null);
  const [viewingItem, setViewingItem] = useState<FollowUp | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [form, setForm] = useState(emptyForm);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [showEmployeeDropdown, setShowEmployeeDropdown] = useState(false);
  const employeeDropdownRef = useRef<HTMLDivElement>(null);

  // Collapsed employee cards — Phase 6.3: persisted via followUpsView
  // (the setter below adapts the existing function-updater call sites).
  const toggleCollapse = (employeeId: string) => {
    setCollapsedEmployees((prev) => {
      const next = new Set(prev);
      if (next.has(employeeId)) next.delete(employeeId);
      else next.add(employeeId);
      return next;
    });
  };

  // Phase 5.3 (spec §27): a deep-linked follow-up must be reachable in
  // the CARDS view too — auto-expand the employee group that owns the
  // highlighted record once data is loaded (the shared highlight hook
  // handles locate/scroll/highlight in both views).
  const highlightId = useAppStore((s) => s.highlightId);
  useEffect(() => {
    if (!highlightId || loading) return;
    const target = followUps.find((item) => item.id === highlightId);
    const ownerId = target?.employeeId;
    if (!ownerId) return;
    // Deferred one frame (react-hooks/set-state-in-effect): expand is a
    // one-shot reaction to the deep-link, not a render-phase adjustment.
    const raf = requestAnimationFrame(() => {
      setCollapsedEmployees((prev) => {
        if (!prev.has(ownerId)) return prev;
        const next = new Set(prev);
        next.delete(ownerId);
        return next;
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightId, loading, followUps]);

  const todayStr = getTodayStr();
  const todaysFollowUps = useMemo(() =>
    followUps.filter(f => f.nextFollowUpDate === todayStr && (f.status === 'open' || f.status === 'under_follow_up')),
    [followUps, todayStr]
  );
  // §8: overdue active follow-ups join the alert area as structured
  // items (display-only derivation — the canonical status/timing rules
  // in lib/metrics/followUpMetrics stay untouched).
  const overdueFollowUps = useMemo(() =>
    followUps
      // §17/§26 — the SAME canonical predicate the dashboard uses, so
      // the deep-link target list always matches the card's count.
      .filter(f => isOverdueFollowUp(f))
      .sort((a, b) => (a.nextFollowUpDate || '').localeCompare(b.nextFollowUpDate || '')),
    [followUps, todayStr]
    // §10 DATA INTEGRITY: no silent cap — the panel body scrolls
    // (bodyMaxHeight), so the group count and rows ALWAYS match the
    // real overdue records. The old slice(0, 6) under-counted.
  );

  // ═══ Departments ═══
  const departmentList = useMemo(() => {
    const depts = new Set<string>();
    for (const e of employees) if (e.department) depts.add(e.department);
    return Array.from(depts).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [employees]);

  // ═══ Fetch Data ═══
  useEffect(() => {
    if (!canView) return; // loading initialized to false for non-viewers
    fetchData();
  }, []);

  async function fetchData() {
    setError(null);
    try {
      const [fuRes, empRes, usrRes] = await Promise.allSettled([
        authFetch('/api/follow-ups'),
        authFetch('/api/employees'),
        authFetch('/api/dashboard/users'),
      ]);
      if (fuRes.status === 'fulfilled' && fuRes.value.ok) {
        const fuData = await fuRes.value.json();
        const items = fuData?.data || fuData || [];
        setFollowUps(Array.isArray(items) ? items : []);
        setEmployeeRiskScores(fuData?.employeeRiskScores || {});
      }
      if (empRes.status === 'fulfilled' && empRes.value.ok) {
        const empData = await empRes.value.json();
        setEmployees(Array.isArray(empData) ? empData : []);
      }
      if (usrRes.status === 'fulfilled' && usrRes.value.ok) {
        const usrData = await usrRes.value.json();
        setSystemUsers(Array.isArray(usrData) ? usrData : []);
      }
    } catch {
      setError('تعذّر تحميل المتابعات');
      setFollowUps([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  // ═══ Filtered Data ═══
  const filtered = useMemo(() => {
    return followUps.filter((item) => {
      if (startDate && item.date < startDate) return false;
      if (endDate && item.date > endDate) return false;
      if (deptFilter !== 'all' && item.department !== deptFilter) return false;
      if (priorityFilter !== 'all' && item.priorityLevel !== priorityFilter) return false;
      // §17 — the overdue deep-link shows EXACTLY the overdue records
      // the canonical metric counts on the dashboard.
      if (overdueOnly && !isOverdueFollowUp(item)) return false;

      const empName = item.employeeName || employees.find((e: any) => e.id === item.employeeId)?.name || '';
      const matchesSearch = search === '' ||
        empName.toLowerCase().includes(search.toLowerCase()) ||
        item.subject?.toLowerCase().includes(search.toLowerCase()) ||
        item.detailedDescription?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      const matchesType = typeFilter === 'all' || item.followUpType === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    }).sort((a, b) => {
      const dateCompare = (b.date || '').localeCompare(a.date || '');
      if (dateCompare !== 0) return dateCompare;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }, [followUps, startDate, endDate, deptFilter, priorityFilter, search, statusFilter, typeFilter, overdueOnly, employees]);

  // ═══ Group by Employee ═══
  const groupedByEmployee = useMemo(() => {
    const map = new Map<string, { employee: Employee | null; followUps: FollowUp[]; riskScore: number }>();
    for (const item of filtered) {
      if (!map.has(item.employeeId)) {
        const emp = employees.find((e: any) => e.id === item.employeeId) || null;
        map.set(item.employeeId, { employee: emp, followUps: [], riskScore: employeeRiskScores[item.employeeId] || 0 });
      }
      map.get(item.employeeId)!.followUps.push(item);
    }
    return Array.from(map.values()).sort((a, b) => {
      const nameA = a.employee?.name || a.followUps[0]?.employeeName || '';
      const nameB = b.employee?.name || b.followUps[0]?.employeeName || '';
      return nameA.localeCompare(nameB, 'ar');
    });
  }, [filtered, employees, employeeRiskScores]);

  // ═══ Stats ═══
  const totalCount = filtered.length;
  const openCount = filtered.filter(f => f.status === 'open').length;
  const underFollowCount = filtered.filter(f => f.status === 'under_follow_up' || f.status === 'under_review').length;
  const resolvedCount = filtered.filter(f => f.status === 'resolved' || f.status === 'closed').length;
  const highPriorityCount = filtered.filter(f => f.priorityLevel === 'high' || f.priorityLevel === 'critical').length;
  const monitoredEmployees = new Set(filtered.filter(f => f.status === 'open' || f.status === 'under_follow_up').map(f => f.employeeId)).size;

  // ═══ Employee Search for Form ═══
  const filteredEmployees = useMemo(() => {
    if (!employeeSearch) return employees;
    return employees.filter((e: any) => e.name.toLowerCase().includes(employeeSearch.toLowerCase()));
  }, [employees, employeeSearch]);


  // Close dropdowns
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (employeeDropdownRef.current && !employeeDropdownRef.current.contains(e.target as Node)) {
        setShowEmployeeDropdown(false);
      }

    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ═══ Row Actions (§6) — ONE ⋮ menu per row, shared by the table and
  //     card views so both can never drift. View is always available;
  //     Edit/Delete stay permission-gated exactly as the old icons were.
  const rowActionsFor = (item: FollowUp): OverflowMenuItem[] => [
    {
      key: 'view',
      label: 'عرض التفاصيل',
      icon: <Eye className="size-3.5" />,
      onSelect: () => setViewingItem(item),
    },
    ...(canUpdate
      ? [{
          key: 'edit',
          label: 'تعديل',
          icon: <Pencil className="size-3.5" />,
          separatorBefore: true,
          onSelect: () => openEdit(item),
        }]
      : []),
    ...(canDelete
      ? [{
          key: 'delete',
          label: 'حذف',
          icon: <Trash2 className="size-3.5" />,
          destructive: true,
          separatorBefore: true,
          onSelect: () => setDeletingId(item.id),
        }]
      : []),
  ];

  // ═══ Form Handlers ═══
  const openCreate = () => {
    setEditingItem(null);
    setForm({ ...emptyForm, date: todayStr });
    setEmployeeSearch('');
    setIsDialogOpen(true);
  };

  const openEdit = (item: FollowUp) => {
    setEditingItem(item);
    const empName = employees.find((e: any) => e.id === item.employeeId)?.name || '';
    setForm(formFromFollowUp(item));
    setEmployeeSearch(empName);
    setIsDialogOpen(true);
  };

  // AttentionPanel: reuses the same edit form for the ⋮ action.
  const formFromFollowUp = (item: FollowUp) => {
    const empName = employees.find((e: any) => e.id === item.employeeId)?.name || '';
    return {
      employeeId: item.employeeId,
      date: item.date,
      followUpType: item.followUpType,
      subject: item.subject || '',
      detailedDescription: item.detailedDescription || '',
      positiveNotes: item.positiveNotes || '',
      negativeNotes: item.negativeNotes || '',
      rootCause: item.rootCause || '',
      actionTaken: item.actionTaken || '',
      department: item.department || '',
      position: item.position || '',
      priorityLevel: item.priorityLevel,
      responsiblePerson: item.responsiblePerson || '',
      nextFollowUpDate: item.nextFollowUpDate || '',
      followUpRequired: item.followUpRequired !== false,
      status: item.status,
      attachments: item.attachments || [],
      evidence: item.evidence || '',
    };
  };

  // §12 GLOBAL INLINE FORM STANDARD: route a follow-up into the CAPA
  // create flow WITHOUT leaving this page — the shared inline CAPA
  // form opens below the alerts, prefilled from the follow-up
  // (previously this navigated to the CAPA page via navParams).
  const [capaPrefill, setCapaPrefill] = useState<Partial<CapaInlineFormState> | null>(null);
  const openCapaFromFollowUp = (item: FollowUp) => {
    setCapaPrefill({
      source: 'followUp',
      title: item.subject || TYPE_OPTIONS.find((t) => t.value === item.followUpType)?.label || '',
      department: item.department || '',
      priority: item.priorityLevel === 'critical' ? 'critical' : item.priorityLevel === 'high' ? 'high' : 'medium',
      employeeId: item.employeeId || '',
      problemDescription: item.detailedDescription || item.subject || '',
      relatedFollowUpId: item.id,
    });
    requestAnimationFrame(() => {
      document.getElementById('followups-inline-capa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDateChange = (date: string) => {
    setForm((p) => ({
      ...p,
      date,
      nextFollowUpDate: addDays(date, 7),
    }));
  };

  const handleSave = async () => {
    if (!form.employeeId || !form.date || !form.followUpType || !form.subject) {
      toast.error('الرجاء ملء الحقول المطلوبة (الموظف، التاريخ، النوع، الموضوع)');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        employeeId: form.employeeId,
        date: form.date,
        followUpType: form.followUpType,
        subject: form.subject,
        detailedDescription: form.detailedDescription || '',
        positiveNotes: form.positiveNotes || '',
        negativeNotes: form.negativeNotes || '',
        rootCause: form.rootCause || '',
        actionTaken: form.actionTaken || '',
        department: form.department || '',
        position: form.position || '',
        priorityLevel: form.priorityLevel,
        responsiblePerson: form.responsiblePerson || '',
        nextFollowUpDate: form.nextFollowUpDate || addDays(form.date, 7),
        followUpRequired: form.followUpRequired,
        status: isManagerOrAdmin || editingItem ? form.status : 'open',
        attachments: form.attachments || [],
        evidence: form.evidence || null,
      };

      if (editingItem) {
        const res = await authFetch(`/api/follow-ups/${editingItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const empName = employees.find((e: any) => e.id === form.employeeId)?.name || editingItem.employeeName || '';
          logUpdate('followUps', 'متابعة يومية', `${empName} - ${form.subject}`);
          toast.success('تم تحديث المتابعة بنجاح');
          await fetchData();
          setIsDialogOpen(false);
          setEditingItem(null);
        }
      } else {
        const res = await authFetch('/api/follow-ups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const empName = employees.find((e: any) => e.id === form.employeeId)?.name || '';
          logCreate('followUps', 'متابعة يومية', `${empName} - ${form.subject}`);
          toast.success('تم إضافة المتابعة بنجاح');
          await fetchData();
          setIsDialogOpen(false);
          setEditingItem(null);
        }
      }
    } catch {
      toast.error('حدث خطأ أثناء الحفظ');
    } finally {
      setSaving(false);
    }
  };

  const [deleteLoading, setDeleteLoading] = useState(false);
  const handleDelete = async (id: string) => {
    setDeleteLoading(true);
    try {
      const item = followUps.find(f => f.id === id);
      const res = await authFetch(`/api/follow-ups/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const empName = item?.employeeName || employees.find((e: any) => e.id === item?.employeeId)?.name || '';
        logDelete('followUps', 'متابعة يومية', `${empName} - ${item?.subject || ''}`);
        toast.success('تم حذف المتابعة');
        setFollowUps(prev => prev.filter(f => f.id !== id));
        setDeletingId(null);
      }
    } catch {
      toast.error('حدث خطأ أثناء الحذف');
    } finally {
      setDeleteLoading(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setTypeFilter('all');
    setPriorityFilter('all');
    setDeptFilter('all');
    setStartDate('');
    setEndDate('');
    setOverdueOnly(false);
  };

  const hasActiveFilters = search || statusFilter !== 'all' || typeFilter !== 'all' || priorityFilter !== 'all' || deptFilter !== 'all' || startDate || endDate || overdueOnly;

  // ═══ Permission Guard ═══
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldAlert className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">غير مصرح بالوصول</p>
        <p className="text-slate-600 text-xs mt-1">ليس لديك صلاحية لعرض هذه الصفحة</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ Header (§25/§26 — sticky) ═══ */}
      <PageHeaderBar
        icon={<ClipboardList className="size-5" />}
        iconClassName="bg-cyan-500/15 border-cyan-500/30 text-cyan-400"
        title="مركز المتابعة والملاحظات"
        description="إدارة وتتبع جميع ملاحظات الأداء والسلوك"
        primaryAction={canCreate ? { label: 'إضافة متابعة', onClick: openCreate } : undefined}
        actions={
          <div className="flex rounded-lg border border-slate-700/50 overflow-hidden shrink-0">
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 transition-colors ${viewMode === 'table' ? 'bg-cyan-500/15 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
              aria-label="عرض جدول"
            >
              <Table2 className="size-4" />
            </button>
            <button
              onClick={() => setViewMode('cards')}
              className={`p-2 transition-colors ${viewMode === 'cards' ? 'bg-cyan-500/15 text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`}
              aria-label="عرض بطاقات"
            >
              <LayoutList className="size-4" />
            </button>
          </div>
        }
      />

      {/* ═══ §8 Follow-up alerts — STRUCTURED items (icon · title ·
          employee · issue · status · date · action), mobile-stacked.
          Never one crowded horizontal line of names again. ═══ */}
      <AnimatePresence>
        {(todaysFollowUps.length > 0 || overdueFollowUps.length > 0) && (
          <AttentionPanel
            title="متابعات تحتاج انتباه"
            icon={<Bell className="size-3.5 text-amber-300" />}
            subtitle={`${todaysFollowUps.length} اليوم · ${overdueFollowUps.length} متأخرة`}
            persistKey="followUpsAttention"
            groups={[
              { key: 'overdue', label: 'متأخرة', count: overdueFollowUps.length },
              { key: 'due', label: 'مستحقة اليوم', count: todaysFollowUps.length },
            ]}
            emptyState={{
              icon: <CheckCircle2 className="size-7 text-emerald-500/50 mb-2" />,
              title: 'لا توجد متابعات متأخرة أو مستحقة اليوم',
              description: 'كل المتابعات في الموعد.',
            }}
            items={[
              ...overdueFollowUps.map((f) => {
                const empName = f.employeeName || employees.find((e: any) => e.id === f.employeeId)?.name || 'غير معروف';
                return {
                  id: f.id,
                  severity: f.priorityLevel === 'critical' ? 'critical' : 'urgent',
                  groupKey: 'overdue',
                  primary: empName,
                  secondary: f.subject || TYPE_OPTIONS.find((t) => t.value === f.followUpType)?.label || f.followUpType,
                  trailing: f.nextFollowUpDate && (
                    <span className="flex items-center gap-1">
                      <Clock className="size-2.5" /> {f.nextFollowUpDate}
                    </span>
                  ),
                  onClick: () => setViewingItem(f),
                  overflowItems: [
                    { key: 'view', label: 'عرض التفاصيل', icon: <Eye className="size-3.5" />, onSelect: () => setViewingItem(f) },
                    { key: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, separatorBefore: true, onSelect: () => openEdit(f) },
                    { key: 'capa', label: 'إنشاء CAPA', icon: <ShieldCheck className="size-3.5" />, separatorBefore: true, onSelect: () => openCapaFromFollowUp(f) },
                  ],
                } satisfies AttentionItem;
              }),
              ...todaysFollowUps
                .filter((f) => !overdueFollowUps.some((o) => o.id === f.id))
                .map((f) => {
                  const empName = f.employeeName || employees.find((e: any) => e.id === f.employeeId)?.name || 'غير معروف';
                  return {
                    id: f.id,
                    severity: 'warning',
                    groupKey: 'due',
                    primary: empName,
                    secondary: f.subject || TYPE_OPTIONS.find((t) => t.value === f.followUpType)?.label || f.followUpType,
                    trailing: f.nextFollowUpDate && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-2.5" /> اليوم
                      </span>
                    ),
                    onClick: () => setViewingItem(f),
                    overflowItems: [
                      { key: 'view', label: 'عرض التفاصيل', icon: <Eye className="size-3.5" />, onSelect: () => setViewingItem(f) },
                      { key: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, separatorBefore: true, onSelect: () => openEdit(f) },
                      { key: 'capa', label: 'إنشاء CAPA', icon: <ShieldCheck className="size-3.5" />, separatorBefore: true, onSelect: () => openCapaFromFollowUp(f) },
                    ],
                  } satisfies AttentionItem;
                }),
            ]}
          />
        )}
      </AnimatePresence>

      {/* ━━━ §12 INLINE CAPA FORM — opens here (prefilled from the
          triggering follow-up) instead of navigating to the CAPA page;
          the shared InlineFormPanel keeps the header/close standard. ━━━ */}
      <AnimatePresence>
        {canCreateCapa && capaPrefill && (
          <InlineFormPanel
            id="followups-inline-capa"
            tone="violet"
            icon={<ShieldAlert className="size-3.5 text-brand-400" />}
            title="إنشاء CAPA من متابعة"
            onClose={() => setCapaPrefill(null)}
          >
            <CAPAInlineForm
              key={JSON.stringify(capaPrefill)}
              onClose={() => setCapaPrefill(null)}
              onCreated={() => {
                setCapaPrefill(null);
                void fetchData();
              }}
              employees={employees}
              systemUsers={systemUsers}
              defaultValues={capaPrefill}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* ═══ Stats Cards ═══ */}
      <motion.div
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5"
      >
        <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">إجمالي المتابعات</p>
          <p className="text-cyan-400 font-bold text-lg leading-tight">{totalCount}</p>
        </div>
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">حالات مفتوحة</p>
          <p className="text-blue-400 font-bold text-lg leading-tight">{openCount}</p>
        </div>
        <div className="rounded-lg border border-brand-500/25 bg-brand-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">قيد المتابعة</p>
          <p className="text-brand-400 font-bold text-lg leading-tight">{underFollowCount}</p>
        </div>
        <div className="rounded-lg border border-brand-500/30 bg-emerald-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">حالات محلولة</p>
          <p className="text-brand-400 font-bold text-lg leading-tight">{resolvedCount}</p>
        </div>
        <div className="rounded-lg border border-orange-500/25 bg-orange-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">أولوية عالية / حرجة</p>
          <p className="text-orange-400 font-bold text-lg leading-tight">{highPriorityCount}</p>
        </div>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">موظفين تحت المراقبة</p>
          <p className="text-rose-400 font-bold text-lg leading-tight">{monitoredEmployees}</p>
        </div>
      </motion.div>

      {/* ═══ Filters ═══ */}
      <Card className="border-slate-700/40 bg-slate-800/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            {/* Search */}
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input
                placeholder="بحث بالاسم أو الموضوع..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {/* Department */}
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-9 text-sm">
                <Users className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="القسم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الأقسام</SelectItem>
                {departmentList.map(d => (
                  <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Type */}
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-9 text-sm">
                <Filter className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">الكل</SelectItem>
                {TYPE_OPTIONS.map(t => (
                  <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-9 text-sm">
                <AlertTriangle className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="الأولوية" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">الكل</SelectItem>
                {PRIORITY_OPTIONS.map(p => (
                  <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Status */}
            {/* §17 — overdue chip (deep-link target of the dashboard card) */}
            <button
              type="button"
              onClick={() => setOverdueOnly(!overdueOnly)}
              aria-pressed={overdueOnly}
              className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-colors ${
                overdueOnly
                  ? 'bg-red-500/15 text-red-300 border-red-500/30'
                  : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:text-slate-200'
              }`}
            >
              <AlertTriangle className="size-3.5" />
              متأخرة عن موعدها
            </button>
            {/* §24 — open the deterministic follow-ups report */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReportOpen(true)}
              className="border-brand-500/30 text-brand-300 hover:bg-brand-500/10 h-9"
            >
              <BarChart3 className="size-3.5 ml-1" />
              تقرير المتابعات
            </Button>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <Clock className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="الحالة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">الكل</SelectItem>
                {STATUS_OPTIONS.map(s => (
                  <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Date Range */}
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm"
              dir="ltr"
              placeholder="من تاريخ"
            />
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm"
              dir="ltr"
              placeholder="إلى تاريخ"
            />

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-slate-400 hover:text-white h-9 px-3">
                <X className="size-3.5 ml-1" />
                مسح
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Loading / Error / Empty / Content ═══ */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-48 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3">
              <AlertTriangle className="size-6 text-rose-400" />
            </div>
            <p className="text-rose-300 text-sm font-medium">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchData()}>إعادة المحاولة</Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <ClipboardList className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد بيانات</p>
            <p className="text-slate-600 text-xs mt-1">
              {hasActiveFilters ? 'لم يتم العثور على نتائج مع الفلاتر المحددة' : 'لم يتم تسجيل أي متابعات بعد'}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'table' ? (
        /* ═══ TABLE VIEW ═══ */
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <Card className="border-slate-700/40 bg-slate-800/30 overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40 bg-slate-800/50">
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">التاريخ</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الموظف</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">القسم</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">النوع</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الأولوية</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الموضوع</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الحالة</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">بواسطة</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">المتابعة القادمة</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">النقاط</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => {
                      const typeBadge = getTypeBadge(item.followUpType);
                      const priorityBadge = getPriorityBadge(item.priorityLevel);
                      const statusBadge = getStatusBadge(item.status);
                      const StatusIcon = getStatusIcon(item.status);
                      const empName = item.employeeName || employees.find((e: any) => e.id === item.employeeId)?.name || '—';
                      const isDueToday = item.nextFollowUpDate === todayStr && (item.status === 'open' || item.status === 'under_follow_up');
                      const isOverdue = item.nextFollowUpDate && item.nextFollowUpDate < todayStr && (item.status === 'open' || item.status === 'under_follow_up');

                      return (
                        <motion.tr
                          key={item.id}
                          data-record-id={item.id}
                          variants={itemVariants}
                          className={`border-b border-slate-700/20 hover:bg-slate-800/50 transition-colors ${isDueToday ? 'bg-amber-500/5' : isOverdue ? 'bg-red-500/3' : ''}`}
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-400 text-xs" dir="ltr">{item.date}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-white text-xs font-medium">{empName}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{item.department || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${typeBadge.color}`}>
                              {typeBadge.label}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <div className={`w-1.5 h-1.5 rounded-full ${getPriorityDot(item.priorityLevel)}`} />
                              <span className={`text-[10px] font-medium ${item.priorityLevel === 'critical' ? 'text-red-400' : item.priorityLevel === 'high' ? 'text-orange-400' : item.priorityLevel === 'medium' ? 'text-yellow-400' : 'text-green-400'}`}>
                                {priorityBadge.label}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-white text-xs max-w-[200px] truncate">{item.subject || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusBadge.color}`}>
                              <StatusIcon className="size-2.5" />
                              {statusBadge.label}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{item.createdByName || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {item.nextFollowUpDate ? (
                              <span className={`text-xs ${isOverdue ? 'text-red-400' : isDueToday ? 'text-amber-400' : 'text-slate-500'}`} dir="ltr">
                                {item.nextFollowUpDate}
                              </span>
                            ) : <span className="text-slate-600 text-xs">—</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <Badge variant="outline" className={`text-[10px] ${item.priorityLevel === 'critical' ? 'bg-red-500/15 text-red-400 border-red-500/30' : 'bg-slate-700/50 text-slate-400 border-slate-600/50'}`}>
                              {item.score ?? SCORE_MAP[item.priorityLevel] ?? 3}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {/* §6 — one ⋮ menu instead of three always-visible
                                icons; same actions, permission-gated. */}
                            <div className="flex items-center justify-center">
                              <SmartActionMenu
                                actions={rowActionsFor(item)}
                                label={`إجراءات المتابعة — ${empName}`}
                              />
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ) : (
        /* ═══ CARD VIEW ═══ */
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-4">
          {groupedByEmployee.map(({ employee, followUps: empFollowUps, riskScore }) => {
            const empName = employee?.name || empFollowUps[0]?.employeeName || 'غير معروف';
            const empDept = employee?.department || '';
            const empId = employee?.id || empFollowUps[0]?.employeeId;
            const initials = empName.charAt(0);
            const empOpen = empFollowUps.filter(f => f.status === 'open' || f.status === 'under_follow_up').length;
            const empResolved = empFollowUps.filter(f => f.status === 'resolved' || f.status === 'closed').length;
            const empHigh = empFollowUps.filter(f => f.priorityLevel === 'high' || f.priorityLevel === 'critical').length;
            const risk = getRiskLevel(riskScore);
            const isCollapsed = collapsedEmployees.has(empId);

            return (
              <motion.div key={empId} variants={itemVariants}>
                <Card className="border-slate-700/40 bg-slate-800/40 overflow-hidden">
                  <CardHeader className="pb-2 pt-3.5 px-4 border-b border-slate-700/25">
                    <div
                      className="flex items-center justify-between cursor-pointer select-none"
                      onClick={() => toggleCollapse(empId)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-shrink-0 size-10 rounded-full bg-gradient-to-br from-cyan-600/30 to-blue-600/30 flex items-center justify-center border border-cyan-500/25">
                          <span className="text-white text-sm font-bold">{initials}</span>
                        </div>
                        <div>
                          <CardTitle className="text-white text-sm font-semibold">
                            <EmployeeLink
                              employeeId={empId}
                              name={empName}
                              department={employees.find(e => e.id === empId)?.department}
                            />
                          </CardTitle>
                          {empDept && <p className="text-slate-500 text-[11px] mt-0.5">{empDept}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <motion.div
                          animate={{ rotate: isCollapsed ? 0 : 180 }}
                          transition={{ duration: 0.2 }}
                        >
                          <ChevronDown className="size-4 text-slate-500" />
                        </motion.div>
                        {empOpen > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-400 border-blue-500/25 px-1.5 py-0">
                            {empOpen} مفتوح
                          </Badge>
                        )}
                        {empHigh > 0 && (
                          <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-400 border-orange-500/25 px-1.5 py-0">
                            {empHigh} عالي
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] bg-brand-500/10 text-brand-400 border-brand-500/30 px-1.5 py-0">
                          {empResolved} محلول
                        </Badge>
                        {riskScore > 0 && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${risk.color}`}>
                            مخاطر: {risk.label} ({riskScore})
                          </Badge>
                        )}
                        <span className="text-slate-600 text-[10px]">{empFollowUps.length} متابعة</span>
                      </div>
                    </div>
                  </CardHeader>

                  <AnimatePresence initial={false}>
                    {!isCollapsed && (
                      <motion.div
                        key="content"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                        style={{ overflow: 'hidden' }}
                      >
                        <CardContent className="p-3">
                          <div className="space-y-2">
                            {empFollowUps.map((item) => {
                              const typeBadge = getTypeBadge(item.followUpType);
                              const priorityBadge = getPriorityBadge(item.priorityLevel);
                              const statusBadge = getStatusBadge(item.status);
                              const StatusIcon = getStatusIcon(item.status);
                              const responsibleName = systemUsers.find((u: any) => u.id === item.responsiblePerson)?.name || item.responsiblePerson || '—';
                              const isDueToday = item.nextFollowUpDate === todayStr && (item.status === 'open' || item.status === 'under_follow_up');
                              const isOverdue = item.nextFollowUpDate && item.nextFollowUpDate < todayStr && (item.status === 'open' || item.status === 'under_follow_up');

                              return (
                                <motion.div
                                  key={item.id}
                                  data-record-id={item.id}
                                  layout
                                  initial={{ opacity: 0, y: 5 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  className={`rounded-lg border ${isDueToday ? 'border-amber-500/40 bg-amber-500/5' : isOverdue ? 'border-red-500/30 bg-red-500/3' : 'border-slate-700/30 bg-slate-800/40'} p-3 space-y-2.5`}
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-slate-400 text-xs font-medium" dir="ltr">
                                      <CalendarDays className="inline size-3 ml-0.5 -mt-0.5" />
                                      {item.date}
                                    </span>
                                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${typeBadge.color}`}>
                                      {typeBadge.label}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <div className={`w-1.5 h-1.5 rounded-full ${getPriorityDot(item.priorityLevel)}`} />
                                      <span className="text-[10px] font-medium">{priorityBadge.label}</span>
                                    </div>
                                    <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusBadge.color}`}>
                                      <StatusIcon className="size-2.5" />
                                      {statusBadge.label}
                                    </div>
                                    {isDueToday && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium bg-amber-500/15 text-amber-400 border-amber-500/30">
                                        <Bell className="size-2.5" />
                                        متابعة اليوم
                                      </div>
                                    )}
                                    {isOverdue && (
                                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium bg-red-500/15 text-red-400 border-red-500/30">
                                        <AlertTriangle className="size-2.5" />
                                        تأخر
                                      </div>
                                    )}
                                    <div className="flex-1" />
                                    {/* §6 — same shared ⋮ row actions as the table view. */}
                                    <div className="flex items-center flex-shrink-0">
                                      <SmartActionMenu
                                        actions={rowActionsFor(item)}
                                        label={`إجراءات المتابعة — ${empName}`}
                                      />
                                    </div>
                                  </div>

                                  {/* Subject */}
                                  {item.subject && (
                                    <p className="text-white text-sm font-medium">{item.subject}</p>
                                  )}

                                  {/* Description */}
                                  {item.detailedDescription && (
                                    <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap break-words">{item.detailedDescription}</p>
                                  )}

                                  {/* Notes */}
                                  {(item.positiveNotes || item.negativeNotes) && (
                                    <div className={`grid ${item.positiveNotes && item.negativeNotes ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-2`}>
                                      {item.positiveNotes && (
                                        <div className="rounded-lg bg-emerald-500/5 border border-brand-500/30 px-3 py-2">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <ArrowUpCircle className="size-3 text-emerald-500" />
                                            <p className="text-brand-400 text-[10px] font-medium">ملاحظات إيجابية</p>
                                          </div>
                                          <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap break-words">{item.positiveNotes}</p>
                                        </div>
                                      )}
                                      {item.negativeNotes && (
                                        <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                                          <div className="flex items-center gap-1.5 mb-1">
                                            <ArrowDownCircle className="size-3 text-red-500" />
                                            <p className="text-red-400 text-[10px] font-medium">ملاحظات سلبية</p>
                                          </div>
                                          <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap break-words">{item.negativeNotes}</p>
                                        </div>
                                      )}
                                    </div>
                                  )}

                                  {/* Root Cause & Action Taken */}
                                  {item.rootCause && (
                                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2">
                                      <p className="text-amber-400 text-[10px] font-medium mb-0.5">السبب الجذري</p>
                                      <p className="text-slate-300 text-xs">{item.rootCause}</p>
                                    </div>
                                  )}
                                  {item.actionTaken && (
                                    <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2">
                                      <p className="text-blue-400 text-[10px] font-medium mb-0.5">الإجراء المتخذ</p>
                                      <p className="text-slate-300 text-xs">{item.actionTaken}</p>
                                    </div>
                                  )}

                                  {/* Bottom Row */}
                                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] pt-1 border-t border-slate-700/20">
                                    <span className="text-slate-500 flex items-center gap-1">
                                      <UserCheck className="size-2.5" />
                                      المسؤول: <span className="text-slate-300">{responsibleName}</span>
                                    </span>
                                    <span className="text-slate-500 flex items-center gap-1">
                                      <FileText className="size-2.5" />
                                      النقاط: <span className="text-slate-300">{item.score ?? SCORE_MAP[item.priorityLevel] ?? 3}</span>
                                    </span>
                                    {item.nextFollowUpDate && (
                                      <span className={`flex items-center gap-1 ${isOverdue ? 'text-red-400' : 'text-slate-500'}`}>
                                        <CalendarDays className="size-2.5" />
                                        المتابعة القادمة: <span dir="ltr">{item.nextFollowUpDate}</span>
                                      </span>
                                    )}
                                    {item.createdByName && (
                                      <span className="text-slate-500">
                                        بواسطة: <span className="text-slate-300">{item.createdByName}</span>
                                      </span>
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </CardContent>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* ═══ View Dialog ═══ */}
      <Dialog open={!!viewingItem} onOpenChange={open => { if (!open) setViewingItem(null); }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[85vh] overflow-y-auto">
          {viewingItem && (
            <>
              <DialogHeader>
                <DialogTitle className="text-white">تفاصيل المتابعة</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                {/* Employee Info */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/60 border border-slate-700/30">
                  <div className="size-10 rounded-full bg-gradient-to-br from-cyan-600/30 to-blue-600/30 flex items-center justify-center border border-cyan-500/25">
                    <span className="text-white text-sm font-bold">
                      {(viewingItem.employeeName || '?').charAt(0)}
                    </span>
                  </div>
                  <div>
                    <p className="text-white text-sm font-semibold">{viewingItem.employeeName || 'غير معروف'}</p>
                    <p className="text-slate-500 text-xs">{viewingItem.department || '—'} · {viewingItem.position || '—'}</p>
                  </div>
                </div>

                {/* Subject */}
                {viewingItem.subject && (
                  <div>
                    <p className="text-slate-500 text-[11px] mb-1">الموضوع</p>
                    <p className="text-white text-sm font-medium">{viewingItem.subject}</p>
                  </div>
                )}

                {/* Description */}
                {viewingItem.detailedDescription && (
                  <div>
                    <p className="text-slate-500 text-[11px] mb-1">التفاصيل</p>
                    <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{viewingItem.detailedDescription}</p>
                  </div>
                )}

                {/* Badges Row */}
                <div className="flex flex-wrap gap-2">
                  <div className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium ${getTypeBadge(viewingItem.followUpType).color}`}>
                    {getTypeBadge(viewingItem.followUpType).label}
                  </div>
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[11px] font-medium ${getPriorityBadge(viewingItem.priorityLevel).color}`}>
                    <div className={`w-2 h-2 rounded-full ${getPriorityDot(viewingItem.priorityLevel)}`} />
                    {getPriorityBadge(viewingItem.priorityLevel).label}
                  </div>
                  <div className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium ${getStatusBadge(viewingItem.status).color}`}>
                    {getStatusBadge(viewingItem.status).label}
                  </div>
                  <Badge variant="outline" className="text-[11px] bg-slate-700/50 text-slate-300 border-slate-600/50 px-2 py-0.5">
                    النقاط: {viewingItem.score ?? SCORE_MAP[viewingItem.priorityLevel] ?? 3}
                  </Badge>
                </div>

                {/* Root Cause */}
                {viewingItem.rootCause && (
                  <div className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2">
                    <p className="text-amber-400 text-[11px] font-medium mb-0.5">السبب الجذري</p>
                    <p className="text-slate-300 text-xs">{viewingItem.rootCause}</p>
                  </div>
                )}

                {/* Action Taken */}
                {viewingItem.actionTaken && (
                  <div className="rounded-lg bg-blue-500/5 border border-blue-500/15 px-3 py-2">
                    <p className="text-blue-400 text-[11px] font-medium mb-0.5">الإجراء المتخذ</p>
                    <p className="text-slate-300 text-xs">{viewingItem.actionTaken}</p>
                  </div>
                )}

                {/* Notes */}
                {(viewingItem.positiveNotes || viewingItem.negativeNotes) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {viewingItem.positiveNotes && (
                      <div className="rounded-lg bg-emerald-500/5 border border-brand-500/30 px-3 py-2">
                        <p className="text-brand-400 text-[10px] font-medium mb-1">إيجابي</p>
                        <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{viewingItem.positiveNotes}</p>
                      </div>
                    )}
                    {viewingItem.negativeNotes && (
                      <div className="rounded-lg bg-red-500/5 border border-red-500/15 px-3 py-2">
                        <p className="text-red-400 text-[10px] font-medium mb-1">سلبي</p>
                        <p className="text-slate-300 text-xs leading-relaxed whitespace-pre-wrap">{viewingItem.negativeNotes}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Info Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-lg bg-slate-800/40">
                    <p className="text-slate-500 text-[10px]">التاريخ</p>
                    <p className="text-white" dir="ltr">{viewingItem.date}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-800/40">
                    <p className="text-slate-500 text-[10px]">المتابعة القادمة</p>
                    <p className="text-white" dir="ltr">{viewingItem.nextFollowUpDate || 'غير محدد'}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-800/40">
                    <p className="text-slate-500 text-[10px]">المسؤول</p>
                    <p className="text-white">{systemUsers.find((u: any) => u.id === viewingItem.responsiblePerson)?.name || viewingItem.responsiblePerson || '—'}</p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-800/40">
                    <p className="text-slate-500 text-[10px]">بواسطة</p>
                    <p className="text-white">{viewingItem.createdByName || 'النظام'}</p>
                  </div>
                </div>

                {/* §EVIDENCE — dedicated evidence/link button (same shared
                    pattern as Risk Center / Quality; opens safely in a new
                    tab, http(s) only). */}
                {viewingItem.evidence && (
                  <div>
                    <p className="text-slate-500 text-[11px] mb-1.5">الدليل / الرابط</p>
                    <EvidenceLinkButton evidence={viewingItem.evidence} />
                  </div>
                )}

                {/* Attachments */}
                {viewingItem.attachments && viewingItem.attachments.length > 0 && (
                  <div>
                    <p className="text-slate-500 text-[11px] mb-1.5">المرفقات</p>
                    <div className="flex flex-wrap gap-2">
                      {viewingItem.attachments.map((url: any, i: any) => (
                        <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/30 text-cyan-400 text-[11px] hover:bg-cyan-500/10 transition-colors">
                          <Paperclip className="size-3" />
                          مرفق {i + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* ═══ CAPA Integration (Bidirectional) ═══ */}
                {(viewingItem as any).relatedCapaId && (
                  <CAPALinkBadge capaId={(viewingItem as any).relatedCapaId} />
                )}
                <div className="flex gap-2 pt-1">
                  {!editingItem && !(viewingItem as any).relatedCapaId && (
                    <Button
                      size="sm"
                      className="flex-1 bg-gradient-to-l from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white text-xs shadow-lg shadow-cyan-500/20"
                      onClick={() => {
                        // §12 GLOBAL INLINE FORM STANDARD — open the shared inline CAPA
                        // form on THIS page (prefilled); close the viewer, keep context.
                        setViewingItem(null);
                        setCapaPrefill({
                          title: viewingItem.subject,
                          department: viewingItem.department,
                          priority: viewingItem.priorityLevel === 'critical' ? 'critical' : viewingItem.priorityLevel === 'high' ? 'high' : 'medium',
                          employeeId: viewingItem.employeeId || '',
                          problemDescription: viewingItem.detailedDescription,
                          source: 'manual',
                          relatedFollowUpId: viewingItem.id,
                        });
                        requestAnimationFrame(() => {
                          document.getElementById('followups-inline-capa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        });
                      }}
                    >
                      <Plus className="size-3.5 ml-1" />
                      إنشاء CAPA من المتابعة
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Add/Edit Dialog ═══ */}
      <Dialog open={isDialogOpen} onOpenChange={open => { if (!open) { setIsDialogOpen(false); setEditingItem(null); } }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">{editingItem ? 'تعديل متابعة' : 'إضافة متابعة جديدة'}</DialogTitle>
            <DialogDescription className="text-slate-400">
              {editingItem ? 'عدّل تفاصيل المتابعة' : 'أدخل تفاصيل المتابعة'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Employee */}
            {!editingItem && (
              <div className="sm:col-span-2">
                <EmployeeSearchInput
                  employees={filteredEmployees}
                  value={form.employeeId}
                  onChange={(id, name) => {
                    setForm(p => ({ ...p, employeeId: id }));
                  }}
                  label="الموظف"
                  placeholder="ابحث عن اسم الموظف..."
                />
              </div>
            )}

            {editingItem && (
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-slate-300 text-sm">الموظف</Label>
                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-800 border border-slate-600">
                  <div className="size-7 rounded-full bg-slate-700 flex items-center justify-center">
                    <span className="text-[10px] font-bold text-white">{(employees.find((e: any) => e.id === form.employeeId)?.name || editingItem.employeeName || '?').charAt(0)}</span>
                  </div>
                  <span className="text-white text-sm">{employees.find((e: any) => e.id === form.employeeId)?.name || editingItem.employeeName || 'غير معروف'}</span>
                </div>
              </div>
            )}

            {/* Department (auto-filled) */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">القسم</Label>
              <Input value={form.department} readOnly className="bg-slate-800 border-slate-600 text-slate-400" placeholder="يتم ملؤه تلقائياً" />
            </div>

            {/* Position (auto-filled) */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">المنصب</Label>
              <Input value={form.position} readOnly className="bg-slate-800 border-slate-600 text-slate-400" placeholder="يتم ملؤه تلقائياً" />
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">التاريخ <span className="text-red-400">*</span></Label>
              <Input type="date" value={form.date} onChange={e => handleDateChange(e.target.value)} className="bg-slate-800 border-slate-600 text-white" dir="ltr" />
            </div>

            {/* Type */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">نوع المتابعة <span className="text-red-400">*</span></Label>
              <Select value={form.followUpType} onValueChange={v => setForm(p => ({ ...p, followUpType: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(t => (
                    <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Subject */}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">الموضوع <span className="text-red-400">*</span></Label>
              <Input value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} className="bg-slate-800 border-slate-600 text-white" placeholder="مثال: تأخر متكرر في الرد على العملاء" />
            </div>

            {/* Detailed Description */}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">التفاصيل <span className="text-red-400">*</span></Label>
              <Textarea
                value={form.detailedDescription}
                onChange={e => setForm(p => ({ ...p, detailedDescription: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white min-h-[80px]"
                placeholder="وصف تفصيلي للملاحظة أو المشكلة..."
              />
            </div>

            {/* §EVIDENCE — dedicated evidence/link field. NOT scraped from
                the description: a real field (URL, Drive link, screenshot
                or document link) rendered as a button in the details card. */}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">دليل / رابط</Label>
              <Input
                value={form.evidence}
                onChange={e => setForm(p => ({ ...p, evidence: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="https://… رابط Google Drive أو مستند أو لقطة شاشة"
                dir="ltr"
              />
              <p className="text-[10px] text-slate-500">رابط خارجي يظهر كزر «عرض الدليل» في بطاقة التفاصيل.</p>
            </div>

            {/* Priority */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">الأولوية <span className="text-red-400">*</span></Label>
              <Select value={form.priorityLevel} onValueChange={v => setForm(p => ({ ...p, priorityLevel: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITY_OPTIONS.map(p => (
                    <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            {(isManagerOrAdmin || editingItem) && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">الحالة</Label>
                <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => (
                      <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Root Cause */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">السبب الجذري</Label>
              <Select value={form.rootCause} onValueChange={v => setForm(p => ({ ...p, rootCause: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر السبب الجذري..." />
                </SelectTrigger>
                <SelectContent>
                  {ROOT_CAUSE_OPTIONS.map(r => (
                    <SelectItem key={r} value={r} className="text-white">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Action Taken */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">الإجراء المتخذ</Label>
              <Select value={form.actionTaken} onValueChange={v => setForm(p => ({ ...p, actionTaken: v }))}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر الإجراء..." />
                </SelectTrigger>
                <SelectContent>
                  {ACTION_OPTIONS.map(a => (
                    <SelectItem key={a} value={a} className="text-white">{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Positive Notes */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">ملاحظات إيجابية</Label>
              <Textarea value={form.positiveNotes} onChange={e => setForm(p => ({ ...p, positiveNotes: e.target.value }))} className="bg-slate-800 border-slate-600 text-white min-h-[60px]" placeholder="أي إنجازات أو سلوك إيجابي..." />
            </div>

            {/* Negative Notes */}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">ملاحظات سلبية</Label>
              <Textarea value={form.negativeNotes} onChange={e => setForm(p => ({ ...p, negativeNotes: e.target.value }))} className="bg-slate-800 border-slate-600 text-white min-h-[60px]" placeholder="المشاكل أو المخالفات المرصودة..." />
            </div>

            {/* Follow-Up Required */}
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">هل يتطلب متابعة؟</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="followUpRequired" checked={form.followUpRequired === true} onChange={() => setForm(p => ({ ...p, followUpRequired: true }))} className="accent-cyan-500" />
                  <span className="text-white text-sm">نعم</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="followUpRequired" checked={form.followUpRequired === false} onChange={() => setForm(p => ({ ...p, followUpRequired: false }))} className="accent-cyan-500" />
                  <span className="text-white text-sm">لا</span>
                </label>
              </div>
            </div>

            {/* Next Follow-Up Date */}
            {form.followUpRequired && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">تاريخ المتابعة القادمة</Label>
                <Input
                  type="date"
                  value={form.nextFollowUpDate || (form.date ? addDays(form.date, 7) : '')}
                  onChange={e => setForm(p => ({ ...p, nextFollowUpDate: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white"
                  dir="ltr"
                />
              </div>
            )}

            {/* Responsible Person — System User, not Employee */}
            <div className="sm:col-span-2">
              <UserSearchInput
                users={systemUsers}
                value={form.responsiblePerson}
                onChange={(id, name) => setForm(p => ({ ...p, responsiblePerson: id }))}
                label="المسؤول عن المتابعة"
                placeholder="ابحث عن مستخدم مسؤول..."
                allowClear
                clearLabel="— بدون —"
              />
            </div>
          </div>

          <DialogFooter className="mt-4">
            <Button variant="ghost" onClick={() => { setIsDialogOpen(false); setEditingItem(null); }} className="text-slate-400 hover:text-white">
              إلغاء
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.employeeId || !form.date || !form.subject} className="bg-cyan-600 hover:bg-cyan-700 text-white">
              {saving ? 'جاري الحفظ...' : editingItem ? 'تحديث' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation — unified ConfirmDialog (§4) ═══ */}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
        description="هل أنت متأكد من حذف هذه المتابعة؟ لا يمكن التراجع عن هذا الإجراء."
        itemName={deletingId ? followUps.find((f) => f.id === deletingId)?.subject : undefined}
        loading={deleteLoading}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />
      {/* ── §24 FOLLOW-UPS REPORT — deterministic analytics over the
          canonical data via the unified reporting architecture. Filters
          (employee/team/department/month/range/type/status) run
          SERVER-SIDE and respect the caller's data scope. ── */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <BarChart3 className="size-5 text-brand-400" />
              تقرير المتابعات
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              تحليل حتمي من البيانات الفعلية — بدون أي استنتاجات افتراضية
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-1 rounded-lg border border-slate-700/60 bg-slate-950/40 p-1 w-fit">
            <button
              type="button"
              onClick={() => setReportMode('employee')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${reportMode === 'employee' ? 'bg-brand-500/20 text-brand-300' : 'text-slate-400 hover:text-slate-200'}`}
            >
              مجمّع حسب الموظف
            </button>
            <button
              type="button"
              onClick={() => setReportMode('flat')}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${reportMode === 'flat' ? 'bg-brand-500/20 text-brand-300' : 'text-slate-400 hover:text-slate-200'}`}
            >
              تفصيلي
            </button>
          </div>
          {reportMode === 'employee' ? (
            <ReportView reportId="follow-ups-employee" insufficientBelow={5} />
          ) : (
            <ReportView reportId="follow-ups" insufficientBelow={5} />
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
// ══════════════════════════════════════════════════════════════
//  FollowUpAlertItem — REMOVED (§X refactor): all "mتابعات تحتاج
//  انتباه" UI now flows through the system-wide <AttentionPanel>.
//  The 3-column card grid wasted vertical space and duplicated the
//  design language across other attention surfaces.
// ══════════════════════════════════════════════════════════════
