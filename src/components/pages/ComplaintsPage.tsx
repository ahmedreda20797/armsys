'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import {
  useComplaints,
  useEmployees,
  useCreateComplaint,
  useUpdateComplaint,
  useDeleteComplaint,
} from '@/hooks/use-queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
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
  MessageSquareWarning,
  Plus,
  Pencil,
  Search,
  X,
  Trash2,
  ShieldCheck,
  CheckCircle2,
  Clock,
  User,
  Users,
  FileText,
  AlertTriangle,
  ShieldAlert,
  Plane,
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import { CAPALinkBadge } from '@/components/shared/CAPALinkBadge';
import { FavoriteToggle, PinToggle } from '@/components/shared/NavigationMarks';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { complaintPrefillFromTravelIntent, hasCreateIntent } from '@/lib/record-prefill';
import { SmartActionMenu, type SmartAction } from '@/components/shared/SmartActionMenu';
import type { OverflowMenuItem } from '@/components/shared/OverflowMenu';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { useMarkState, useFavoriteToggleAction, usePinToggleAction } from '@/components/shared/NavigationMarks';
import { Star, Pin as PinIcon } from 'lucide-react';
import {
  ComplaintInlineForm,
  CAPAInlineForm,
  type CapaInlineFormState,
} from '@/components/shared/inline-forms';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatInteger } from '@/lib/i18n/format';

type ComplaintDescriptor = {
  targetType: 'record';
  targetId: string;
  route: string;
  label: string;
};

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface Complaint {
  id: string;
  customerName: string;
  customerContact?: string;
  dealId?: string;
  employeeId?: string;
  complaintType: string;
  description: string;
  severity: string;
  status: string;
  resolution?: string;
  responsiblePersonId?: string;
  compensation?: string;
  createdAt: string;
  updatedAt: string;
  employee?: { id: string; name: string; department: string | null } | null;
  responsiblePerson?: { id: string; name: string; department: string | null } | null;
}

interface ComplaintFormData {
  customerName: string;
  customerContact: string;
  dealId: string;
  employeeId: string;
  complaintType: string;
  description: string;
  severity: string;
  status: string;
  resolution: string;
  responsiblePersonId: string;
  compensation: string;
}

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════

const COMPLAINT_TYPES = [
  { value: 'service_quality', label: 'جودة الخدمة' },
  { value: 'pricing_error', label: 'خطأ في التسعير' },
  { value: 'communication', label: 'تواصل' },
  { value: 'delay', label: 'تأخير' },
  { value: 'product_issue', label: 'مشكلة في المنتج' },
  { value: 'other', label: 'أخرى' },
];

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'critical', label: 'حرج' },
];

const STATUS_OPTIONS = [
  { value: 'open', label: 'مفتوح' },
  { value: 'investigating', label: 'قيد التحقيق' },
  { value: 'pending_resolution', label: 'بانتظار الحل' },
  { value: 'resolved', label: 'تم الحل' },
  { value: 'closed', label: 'مغلقة' },
];

const emptyForm: ComplaintFormData = {
  customerName: '',
  customerContact: '',
  dealId: '',
  employeeId: '',
  complaintType: 'service_quality',
  description: '',
  severity: 'medium',
  status: 'open',
  resolution: '',
  responsiblePersonId: '',
  compensation: '',
};

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════

function getComplaintTypeBadge(type: string) {
  const found = COMPLAINT_TYPES.find((t) => t.value === type);
  return found?.label || type;
}

function getComplaintTypeColor(type: string) {
  switch (type) {
    case 'service_quality': return 'bg-brand-500/15 text-brand-400 border-brand-500/30';
    case 'pricing_error': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'communication': return 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30';
    case 'delay': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case 'product_issue': return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function getSeverityBadge(severity: string) {
  const found = SEVERITY_OPTIONS.find((s) => s.value === severity);
  return found?.label || severity;
}

function getSeverityColor(severity: string) {
  switch (severity) {
    case 'low': return 'bg-brand-500/15 text-brand-400 border-brand-500/30';
    case 'medium': return 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30';
    case 'high': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case 'critical': return 'bg-red-500/15 text-red-400 border-red-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

function getStatusBadge(status: string) {
  const found = STATUS_OPTIONS.find((s) => s.value === status);
  return found?.label || status;
}

function getStatusColor(status: string) {
  switch (status) {
    case 'open': return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
    case 'investigating': return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
    case 'pending_resolution': return 'bg-orange-500/15 text-orange-400 border-orange-500/30';
    case 'resolved': return 'bg-brand-500/15 text-brand-400 border-brand-500/30';
    case 'closed': return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ComplaintsPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('complaints');
  const { locale } = useLanguage();
  // §12 GLOBAL INLINE FORM STANDARD — creating a CAPA from a complaint
  // opens the shared inline CAPA form HERE (gated by CAPA's own
  // create permission); it never navigates to the CAPA page.
  const { canCreate: canCreateCapa } = usePermissions('capa');

  // Phase 6.3 (§8): filter context persists per user (session-scoped).
  // Milestone 7 §15: OPEN vs CLOSED case separation — open cases stay
  // operationally prominent (default tab); closed remain viewable.
  // Version 2: the shape grows caseTab; old state orphans cleanly.
  const [complaintsView, setComplaintsView, resetComplaintsView] = usePageState<{
    search: string;
    employeeFilter: string;
    statusFilter: string;
    severityFilter: string;
    complaintTypeFilter: string;
    caseTab: 'open' | 'closed' | 'all';
  }>({
    page: 'complaints',
    slot: 'filters',
    version: 2,
    initial: () => ({ search: '', employeeFilter: 'all', statusFilter: 'all', severityFilter: 'all', complaintTypeFilter: 'all', caseTab: 'open' }),
    validate: (raw) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null),
  });
  const search = complaintsView.search;
  const setSearch = (v: string) => setComplaintsView((s) => ({ ...s, search: v }));
  const employeeFilter = complaintsView.employeeFilter;
  const setEmployeeFilter = (v: string) => setComplaintsView((s) => ({ ...s, employeeFilter: v }));
  const statusFilter = complaintsView.statusFilter;
  const setStatusFilter = (v: string) => setComplaintsView((s) => ({ ...s, statusFilter: v }));
  const severityFilter = complaintsView.severityFilter;
  const setSeverityFilter = (v: string) => setComplaintsView((s) => ({ ...s, severityFilter: v }));
  const complaintTypeFilter = complaintsView.complaintTypeFilter;
  const setComplaintTypeFilter = (v: string) => setComplaintsView((s) => ({ ...s, complaintTypeFilter: v }));
  const caseTab = complaintsView.caseTab;
  const setCaseTab = (v: 'open' | 'closed' | 'all') => setComplaintsView((s) => ({ ...s, caseTab: v }));

  // Milestone 7 §7 — Travel → Complaint intent: read navParams BEFORE
  // dialog state so the mount-time initializer below can consume it.
  const navParams = useAppStore((s) => s.navParams);
  const mountIntent = complaintPrefillFromTravelIntent(navParams);
  const hasMountIntent = hasCreateIntent(navParams) && navParams?.source === 'travel';

  // UX Corrections §1 (ROOT CAUSE FIX) + §12 GLOBAL INLINE FORM
  // STANDARD: CREATE now opens the shared inline ComplaintInlineForm
  // card IN PAGE (same component Travel and the Dashboard use) —
  // the Dialog below is kept for EDIT only. Travel → Complaint
  // intents open the same inline card, prefilled.
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreateInlineOpen, setIsCreateInlineOpen] = useState(() => hasMountIntent);
  const [createDefaults, setCreateDefaults] = useState<Partial<ComplaintFormData>>(() => mountIntent);
  const [editingComplaint, setEditingComplaint] = useState<Complaint | null>(null);
  const [form, setForm] = useState<ComplaintFormData>(() => ({ ...emptyForm, ...mountIntent }));
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Source context when the complaint originates from another page —
  // persisted with the record for trace.
  const [sourceContext, setSourceContext] = useState<{ page: string; recordId: string } | null>(() =>
    hasMountIntent
      ? {
          page: 'travel',
          recordId: typeof navParams?.sourceRecordId === 'string' ? navParams.sourceRecordId : '',
        }
      : null,
  );

  // Queries
  const { data: complaintsData, isLoading } = useComplaints();
  const { data: employeesData } = useEmployees();
  const createMutation = useCreateComplaint();
  const updateMutation = useUpdateComplaint();
  const deleteMutation = useDeleteComplaint();

  // Deep-link highlight (Phase 5.2 §35) from Evidence Preview navigation.
  useRecordHighlight();
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);

  // Fetch system users
  useEffect(() => {
    authFetch('/api/dashboard/users')
      .then(r => r.ok ? r.json() : [])
      .then(data => setSystemUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Parse response data
  const complaints: Complaint[] = complaintsData?.data || complaintsData || [];
  const employees: any[] = employeesData || [];

  // Travel → Complaint intents arriving WHILE the page is already
  // mounted (the mount-time intent is handled by the initializers
  // above). Compiler-endorsed "adjust state during render" guard.
  // §12: opens the INLINE create card, prefilled — never the dialog.
  const [lastHandledNav, setLastHandledNav] = useState(navParams);
  if (navParams !== lastHandledNav) {
    setLastHandledNav(navParams);
    if (navParams?.source === 'travel') {
      setEditingComplaint(null);
      setSourceContext({
        page: 'travel',
        recordId: typeof navParams.sourceRecordId === 'string' ? navParams.sourceRecordId : '',
      });
      setCreateDefaults(complaintPrefillFromTravelIntent(navParams));
      setIsCreateInlineOpen(true);
    }
  }

  // §12 — inline CAPA creation from a complaint card / overflow menu.
  const [capaPrefill, setCapaPrefill] = useState<Partial<CapaInlineFormState> | null>(null);
  const openCapaFromComplaint = (complaint: Complaint) => {
    setCapaPrefill({
      title: `شكوى عميل — ${complaint.complaintType}`,
      department: '',
      priority: complaint.severity === 'critical' ? 'critical' : complaint.severity === 'high' ? 'high' : 'medium',
      employeeId: complaint.employeeId || '',
      problemDescription: complaint.description,
      source: 'complaint',
      relatedComplaintId: complaint.id,
    });
    requestAnimationFrame(() => {
      document.getElementById('complaints-inline-capa')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // §15 case classification — same vocabulary as the stats logic:
  // open = open/investigating/pending_resolution; closed = resolved/closed.
  const isClosedCase = (c: Complaint) => c.status === 'resolved' || c.status === 'closed';

  // Filtered complaints
  const filtered = useMemo(() => {
    return complaints.filter((c) => {
      const matchesSearch =
        !search ||
        c.customerName?.toLowerCase().includes(search.toLowerCase()) ||
        c.description?.toLowerCase().includes(search.toLowerCase()) ||
        c.dealId?.toLowerCase().includes(search.toLowerCase());

      const matchesEmployee =
        employeeFilter === 'all' || c.employeeId === employeeFilter;

      const matchesStatus =
        statusFilter === 'all' || c.status === statusFilter;

      const matchesSeverity =
        severityFilter === 'all' || c.severity === severityFilter;

      const matchesType =
        complaintTypeFilter === 'all' || c.complaintType === complaintTypeFilter;

      // §15 case-tab gate — the explicit open/closed separation.
      const matchesTab =
        caseTab === 'all' || (caseTab === 'closed' ? isClosedCase(c) : !isClosedCase(c));

      return matchesSearch && matchesEmployee && matchesStatus && matchesSeverity && matchesType && matchesTab;
    });
  }, [complaints, search, employeeFilter, statusFilter, severityFilter, complaintTypeFilter, caseTab]);

  // §15 case counts (over the whole scoped set, independent of search)
  const caseCounts = useMemo(() => {
    const open = complaints.filter((c) => !isClosedCase(c)).length;
    return { open, closed: complaints.length - open };
  }, [complaints]);

  // Stats
  const stats = useMemo(() => {
    const total = complaints.length;
    const openCount = complaints.filter((c) => c.status === 'open' || c.status === 'investigating' || c.status === 'pending_resolution').length;
    const resolvedCount = complaints.filter((c) => c.status === 'resolved' || c.status === 'closed').length;
    const resolved = complaints.filter((c) => c.status === 'resolved' || c.status === 'closed');
    const avgResolution = resolved.length > 0
      ? resolved.reduce((sum, c) => {
          if (c.createdAt && c.updatedAt) {
            const created = new Date(c.createdAt).getTime();
            const updated = new Date(c.updatedAt).getTime();
            const days = Math.max(1, Math.ceil((updated - created) / (1000 * 60 * 60 * 24)));
            return sum + days;
          }
          return sum;
        }, 0) / resolved.length
      : 0;
    return { total, openCount, resolvedCount, avgResolution };
  }, [complaints]);

  // ═══ Access denied guard ═══
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <ShieldCheck className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400"><T>صلاحية غير كافية</T></h2>
        <p className="text-slate-500 mt-2"><T>هذه الصفحة غير متاحة لحسابك</T></p>
      </div>
    );
  }

  // ═══ Form handlers ═══
  // §12 GLOBAL INLINE FORM STANDARD — create opens the shared inline
  // card (same component as Travel / Dashboard); the user stays on
  // the Complaints page the whole time.
  const openCreateInline = () => {
    setEditingComplaint(null);
    setSourceContext(null);
    setCreateDefaults({});
    setIsCreateInlineOpen(true);
    requestAnimationFrame(() => {
      document.getElementById('complaints-inline-create')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const openEditDialog = (complaint: Complaint) => {
    setEditingComplaint(complaint);
    setForm({
      customerName: complaint.customerName || '',
      customerContact: complaint.customerContact || '',
      dealId: complaint.dealId || '',
      employeeId: complaint.employeeId || '',
      complaintType: complaint.complaintType || 'service_quality',
      description: complaint.description || '',
      severity: complaint.severity || 'medium',
      status: complaint.status || 'open',
      resolution: complaint.resolution || '',
      responsiblePersonId: complaint.responsiblePersonId || '',
      compensation: complaint.compensation || '',
    });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.customerName.trim() || !form.description.trim()) return;

    const payload: Record<string, any> = {
      customerName: form.customerName.trim(),
      customerContact: form.customerContact.trim() || null,
      dealId: form.dealId.trim() || null,
      employeeId: form.employeeId || null,
      complaintType: form.complaintType,
      description: form.description.trim(),
      severity: form.severity,
      status: form.status,
      resolution: form.resolution.trim() || null,
      // Field keys match the API contract (responsiblePerson /
      // compensationProvided) so user input persists.
      responsiblePerson: form.responsiblePersonId || '',
      compensationProvided: form.compensation.trim() || null,
    };
    // Source trace (additive — Milestone 7 §7): a complaint opened from
    // Travel carries its source page + record for the audit trail.
    if (!editingComplaint && sourceContext?.recordId) {
      payload.sourcePage = sourceContext.page;
      payload.sourceRecordId = sourceContext.recordId;
    }

    try {
      if (editingComplaint) {
        await updateMutation.mutateAsync({ id: editingComplaint.id, data: payload });
        logUpdate('complaints', 'شكوى عميل', `${form.customerName} - ${form.description.substring(0, 50)}`);
      } else {
        await createMutation.mutateAsync(payload);
        logCreate('complaints', 'شكوى عميل', `${form.customerName} - ${form.description.substring(0, 50)}`);
      }
      setIsDialogOpen(false);
      setEditingComplaint(null);
      setSourceContext(null);
      setForm({ ...emptyForm });
    } catch {
      // Error handled silently
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const complaint = complaints.find((c) => c.id === id);
      await deleteMutation.mutateAsync(id);
      if (complaint) {
        logDelete('complaints', 'شكوى عميل', `${complaint.customerName} - ${complaint.description?.substring(0, 50) || ''}`);
      }
      setDeletingId(null);
    } catch {
      // Error handled silently
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-5">
      {/* ═══ Header (§25/§26 — sticky) ═══ */}
      <PageHeaderBar
        icon={<MessageSquareWarning className="size-5" />}
        iconClassName="bg-rose-500/15 border-rose-500/30 text-rose-400"
        title={translateUIText('شكاوى العملاء', locale)}
        description={<>{formatInteger(filtered.length, locale)} <T>شكوى مسجلة</T></>}
        primaryAction={canCreate ? { label: translateUIText('إضافة شكوى', locale), onClick: openCreateInline } : undefined}
      />

      {/* ━━━ §12 INLINE CREATE FORM — the SAME shared ComplaintInlineForm
          used by Travel deal cards and the Dashboard quick action, so the
          create experience is identical no matter where it was triggered.
          Shows the sky "تمت التعبئة تلقائياً" banner for Travel intents. ━━━ */}
      <AnimatePresence>
        {canCreate && isCreateInlineOpen && (
          <InlineFormPanel
            id="complaints-inline-create"
            tone="rose"
            icon={<Plus className="size-3.5 text-rose-400" />}
            title={translateUIText('إضافة شكوى جديدة', locale)}
            onClose={() => { setIsCreateInlineOpen(false); setSourceContext(null); }}
          >
            {sourceContext && (
              <div className="mb-3 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-300 flex items-center gap-1.5">
                <Plane className="size-3.5 shrink-0" />
                <T>تمت التعبئة تلقائياً من صفحة السفر — راجع البيانات وعدّلها قبل الحفظ.</T>
              </div>
            )}
            <ComplaintInlineForm
              key={JSON.stringify(createDefaults)}
              onClose={() => { setIsCreateInlineOpen(false); setSourceContext(null); }}
              onCreated={() => { setIsCreateInlineOpen(false); setSourceContext(null); }}
              employees={employees as never}
              systemUsers={systemUsers}
              sourceContext={sourceContext ?? undefined}
              defaultValues={createDefaults}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* ━━━ §12 INLINE CAPA FORM — opens here (prefilled from the
          triggering complaint) instead of navigating to the CAPA page. ━━━ */}
      <AnimatePresence>
        {canCreateCapa && capaPrefill && (
          <InlineFormPanel
            id="complaints-inline-capa"
            tone="violet"
            icon={<ShieldAlert className="size-3.5 text-brand-400" />}
            title={translateUIText('إنشاء CAPA من شكوى', locale)}
            onClose={() => setCapaPrefill(null)}
          >
            <CAPAInlineForm
              key={JSON.stringify(capaPrefill)}
              onClose={() => setCapaPrefill(null)}
              onCreated={() => setCapaPrefill(null)}
              employees={employees as never}
              systemUsers={systemUsers}
              defaultValues={capaPrefill}
            />
          </InlineFormPanel>
        )}
      </AnimatePresence>

      {/* ═══ Stats Row ═══ */}
      {complaints.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
        >
          <div className="rounded-lg border border-slate-500/25 bg-slate-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>إجمالي الشكاوى</T></p>
            <p className="text-slate-300 font-bold text-lg leading-tight">{formatInteger(stats.total, locale)}</p>
          </div>
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>مفتوحة</T></p>
            <p className="text-blue-400 font-bold text-lg leading-tight">{formatInteger(stats.openCount, locale)}</p>
          </div>
          <div className="rounded-lg border border-brand-500/30 bg-emerald-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>تم الحل</T></p>
            <p className="text-brand-400 font-bold text-lg leading-tight">{formatInteger(stats.resolvedCount, locale)}</p>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>متوسط وقت الحل</T></p>
            <p className="text-amber-400 font-bold text-lg leading-tight">
              {stats.avgResolution > 0 ? <>{formatInteger(Math.round(stats.avgResolution), locale)} <T>يوم</T></> : '—'}
            </p>
          </div>
        </motion.div>
      )}

      {/* ═══ §15 Open / Closed case tabs ═══ */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {[
          { key: 'open' as const, label: 'الحالات المفتوحة', count: caseCounts.open },
          { key: 'closed' as const, label: 'الحالات المغلقة', count: caseCounts.closed },
          { key: 'all' as const, label: 'الكل', count: complaints.length },
        ].map((tab) => (
          <button key={tab.key} onClick={() => setCaseTab(tab.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              caseTab === tab.key
                ? 'bg-rose-600 text-white shadow-md shadow-rose-500/20'
                : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}>
            <T>{tab.label}</T> ({formatInteger(tab.count, locale)})
          </button>
        ))}
      </div>

      {/* ═══ Filters ═══ */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder={translateUIText('بحث بالاسم أو الوصف أو رقم الصفقة...', locale)}
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
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <Users className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder={translateUIText('الموظف', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>
            {employees.map((emp: any) => (
              <SelectItem key={emp.id} value={emp.id} className="text-white">
                {emp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <Clock className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder={translateUIText('الحالة', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-white">
                <T>{s.label}</T>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <AlertTriangle className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder={translateUIText('الخطورة', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>
            {SEVERITY_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-white">
                <T>{s.label}</T>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={complaintTypeFilter} onValueChange={setComplaintTypeFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <FileText className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder={translateUIText('النوع', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>
            {COMPLAINT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-white">
                <T>{t.label}</T>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══ Loading ═══ */}
      {isLoading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <MessageSquareWarning className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium"><T>لا توجد شكاوى</T></p>
            <p className="text-slate-600 text-xs mt-1">
              {search || employeeFilter !== 'all' || statusFilter !== 'all' || severityFilter !== 'all' || complaintTypeFilter !== 'all'
                ? <T>لم يتم العثور على نتائج</T>
                : <T>لم يتم تسجيل أي شكاوى بعد</T>}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((complaint) => {
              const isResolved = complaint.status === 'resolved' || complaint.status === 'closed';

              return (
                <motion.div
                  key={complaint.id}
                  data-record-id={complaint.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5, transition: { duration: 0.15 } }}
                  layout
                >
                  <Card className="border-slate-700/40 bg-slate-800/50 hover:bg-slate-800/70 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      {/* Top row: name, badges */}
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="flex items-center justify-center size-8 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 border border-slate-600/50">
                            <span className="text-white text-xs font-bold">
                              {(complaint.customerName || '?').charAt(0)}
                            </span>
                          </div>
                          <span className="text-white font-semibold text-sm">{complaint.customerName}</span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getComplaintTypeColor(complaint.complaintType)}`}
                          >
                            <T>{getComplaintTypeBadge(complaint.complaintType)}</T>
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getSeverityColor(complaint.severity)}`}
                          >
                            <T>{getSeverityBadge(complaint.severity)}</T>
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getStatusColor(complaint.status)}`}
                          >
                            <T>{getStatusBadge(complaint.status)}</T>
                          </Badge>
                          {/* §6: secondary/contextual actions grouped in the ⋮ overflow */}
                          <ComplaintCardActions
                            complaint={complaint}
                            canUpdate={canUpdate}
                            canDelete={canDelete}
                            onEdit={() => openEditDialog(complaint)}
                            onDelete={() => setDeletingId(complaint.id)}
                            onCreateCapa={() => openCapaFromComplaint(complaint)}
                          />
                        </div>
                      </div>

                      {/* Description (truncated 2 lines) */}
                      <p className="text-slate-400 text-xs leading-relaxed line-clamp-2">
                        {complaint.description}
                      </p>

                      {/* Meta info row */}
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                        {complaint.employee && (
                          <span className="flex items-center gap-1">
                            <EmployeeLink
                                employeeId={complaint.employee?.id}
                                name={complaint.employee?.name}
                                compact
                                hideAvatar
                              />
                          </span>
                        )}
                        {complaint.responsiblePerson && (
                          <span className="flex items-center gap-1">
                            <EmployeeLink
                              employeeId={complaint.responsiblePerson?.id}
                              name={complaint.responsiblePerson?.name}
                              compact
                              hideAvatar
                            />
                          </span>
                        )}
                        {complaint.dealId && (
                          <span className="flex items-center gap-1">
                            <FileText className="size-3" />
                            {complaint.dealId}
                          </span>
                        )}
                      </div>

                      {/* Resolution section (if resolved) */}
                      {isResolved && complaint.resolution && (
                        <div className="rounded-lg bg-emerald-500/8 border border-brand-500/30 p-3 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-brand-400 text-[11px] font-medium">
                            <CheckCircle2 className="size-3.5" />
                            <T>الحل</T>
                          </div>
                          <p className="text-brand-300/80 text-xs leading-relaxed">
                            {complaint.resolution}
                          </p>
                          {complaint.compensation && (
                            <p className="text-brand-400/60 text-[10px] mt-1">
                              <T>التعويض: </T>{complaint.compensation}
                            </p>
                          )}
                        </div>
                      )}

                      {/* ═══ CAPA Integration (Bidirectional) ═══ */}
                      {(complaint as any).relatedCapaIds && (complaint as any).relatedCapaIds.length > 0 && (
                        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                          {(complaint as any).relatedCapaIds.map((capaId: string) => (
                            <CAPALinkBadge key={capaId} capaId={capaId} />
                          ))}
                        </div>
                      )}
                      {/* §14 — ONE authoritative create-CAPA entry point:
                          the record's SmartActionMenu (⋮) already carries
                          «إنشاء CAPA». The old card-level duplicate button
                          was removed — no second action path. */}
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* ═══ Add/Edit Dialog ═══ */}
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); setEditingComplaint(null); } }}>
        <DialogContent className="bg-slate-900 border-slate-700/60 max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">
              <T>{editingComplaint ? 'تعديل الشكوى' : 'إضافة شكوى جديدة'}</T>
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              <T>{editingComplaint ? 'قم بتعديل بيانات الشكوى' : 'أدخل بيانات الشكوى الجديدة'}</T>
            </DialogDescription>
          </DialogHeader>

          {/* §7 — source context banner: fields auto-filled from Travel */}
          {sourceContext && (
            <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-300 flex items-center gap-1.5">
              <Plane className="size-3.5 shrink-0" />
              <T>تمت التعبئة تلقائياً من صفحة السفر — راجع البيانات وعدّلها قبل الحفظ.</T>
            </div>
          )}

          <div className="space-y-4 py-2">
            {/* Row 1: Customer name + Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs"><T>اسم العميل *</T></Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder={translateUIText('اسم العميل', locale)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs"><T>بيانات الاتصال</T></Label>
                <Input
                  value={form.customerContact}
                  onChange={(e) => setForm((p) => ({ ...p, customerContact: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder={translateUIText('رقم الهاتف أو البريد', locale)}
                />
              </div>
            </div>

            {/* Row 2: Deal ID + Employee */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs"><T>رقم الصفقة</T></Label>
                <Input
                  value={form.dealId}
                  onChange={(e) => setForm((p) => ({ ...p, dealId: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder={translateUIText('رقم الصفقة (اختياري)', locale)}
                />
              </div>
              <div>
                <EmployeeSearchInput
                  employees={employees}
                  value={form.employeeId || ''}
                  onChange={(id) => setForm((p) => ({ ...p, employeeId: id }))}
                  label={translateUIText('الموظف المسؤول', locale)}
                  placeholder={translateUIText('ابحث عن اسم الموظف (اختياري)...', locale)}
                  allowClear
                  clearLabel={translateUIText('— بدون —', locale)}
                  variant="form"
                />
              </div>
            </div>

            {/* Row 3: Type + Severity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs"><T>نوع الشكوى</T></Label>
                <Select value={form.complaintType} onValueChange={(v) => setForm((p) => ({ ...p, complaintType: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPLAINT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-white">
                        <T>{t.label}</T>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs"><T>الخطورة</T></Label>
                <Select value={form.severity} onValueChange={(v) => setForm((p) => ({ ...p, severity: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-white">
                        <T>{s.label}</T>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Status */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs"><T>الحالة</T></Label>
              <Select value={form.status} onValueChange={(v) => setForm((p) => ({ ...p, status: v }))}>
                <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value} className="text-white">
                      <T>{s.label}</T>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs"><T>الوصف *</T></Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[80px] resize-none"
                placeholder={translateUIText('وصف الشكوى بالتفصيل', locale)}
              />
            </div>

            {/* Resolution */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs"><T>الحل</T></Label>
              <Textarea
                value={form.resolution}
                onChange={(e) => setForm((p) => ({ ...p, resolution: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder={translateUIText('وصف الحل المقدم', locale)}
              />
            </div>

            {/* Row 5: Responsible person — System User, not Employee */}
            <div className="space-y-1.5">
              <UserSearchInput
                users={systemUsers}
                value={form.responsiblePersonId}
                onChange={(id) => setForm((p) => ({ ...p, responsiblePersonId: id }))}
                label={translateUIText('المسؤول', locale)}
                placeholder={translateUIText('ابحث عن مستخدم مسؤول...', locale)}
                allowClear
                clearLabel={translateUIText('— بدون —', locale)}
              />
            </div>

            {/* Compensation */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs"><T>التعويض المقدم</T></Label>
              <Textarea
                value={form.compensation}
                onChange={(e) => setForm((p) => ({ ...p, compensation: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder={translateUIText('وصف التعويض المقدم للعميل', locale)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => { setIsDialogOpen(false); setEditingComplaint(null); }}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <T>إلغاء</T>
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.customerName.trim() || !form.description.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isSaving ? <T>جاري الحفظ...</T> : editingComplaint ? <T>حفظ التعديلات</T> : <T>إضافة الشكوى</T>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation — unified ConfirmDialog (§4) ═══ */}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
        description={translateUIText('هل أنت متأكد من حذف هذه الشكوى؟ لا يمكن التراجع عن هذا الإجراء.', locale)}
        itemName={deletingId ? complaints.find((c) => c.id === deletingId)?.customerName : undefined}
        loading={deleteMutation.isPending}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />
    </div>
  );
}
// ══════════════════════════════════════════════════════════════
//  ComplaintCardActions — §6 overflow pattern for a complaint card:
//  primary state stays visible on the card; edit / ⭐ favorite /
//  📌 pin / CAPA / delete are grouped in the reusable ⋮ menu.
// ══════════════════════════════════════════════════════════════
function ComplaintCardActions({
  complaint, canUpdate, canDelete, onEdit, onDelete, onCreateCapa,
}: {
  complaint: Complaint;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onCreateCapa: () => void;
}) {
  const { locale } = useLanguage();
  const descriptor: ComplaintDescriptor = {
    targetType: 'record',
    targetId: complaint.id,
    route: 'complaints',
    label: `${translateUIText('شكوى', locale)}: ${complaint.customerName}`,
  };
  const { favoriteActive, pinActive } = useMarkState(descriptor);
  const toggleFavorite = useFavoriteToggleAction();
  const togglePin = usePinToggleAction();

  const items: OverflowMenuItem[] = [];
  if (canUpdate) {
    items.push({ key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: onEdit });
  }
  items.push(
    {
      key: 'favorite',
      label: favoriteActive ? translateUIText('إزالة من المفضلة', locale) : translateUIText('مفضلة ⭐', locale),
      icon: <Star className={`size-3.5 ${favoriteActive ? 'text-amber-400 fill-amber-400' : ''}`} />,
      onSelect: () => void toggleFavorite(descriptor),
    },
    {
      key: 'pin',
      label: pinActive ? translateUIText('إزالة التثبيت', locale) : translateUIText('تثبيت 📌', locale),
      icon: <PinIcon className={`size-3.5 ${pinActive ? 'text-cyan-400 fill-cyan-400' : ''}`} />,
      onSelect: () => void togglePin(descriptor),
    },
    {
      key: 'capa',
      label: translateUIText('إنشاء CAPA', locale),
      icon: <ShieldAlert className="size-3.5" />,
      separatorBefore: true,
      // §12 GLOBAL INLINE FORM STANDARD — opens the inline CAPA form on
      // THIS page (no navigation to the CAPA page).
      onSelect: onCreateCapa,
    },
  );
  if (canDelete) {
    items.push({
      key: 'delete',
      label: translateUIText('حذف', locale),
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
      separatorBefore: true,
      onSelect: onDelete,
    });
  }

  return <SmartActionMenu actions={items} label={`${translateUIText('إجراءات شكوى', locale)} ${complaint.customerName}`} />;
}
