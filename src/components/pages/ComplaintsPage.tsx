'use client';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
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
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import { CAPALinkBadge } from '@/components/shared/CAPALinkBadge';

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
    case 'service_quality': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
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
    case 'low': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
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
    case 'resolved': return 'bg-violet-500/15 text-violet-400 border-violet-500/30';
    case 'closed': return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
    default: return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
  }
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function ComplaintsPage() {
  const { canView, canCreate, canUpdate, canDelete } = usePermissions('complaints');

  const [search, setSearch] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [complaintTypeFilter, setComplaintTypeFilter] = useState('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingComplaint, setEditingComplaint] = useState<Complaint | null>(null);
  const [form, setForm] = useState<ComplaintFormData>({ ...emptyForm });
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Queries
  const { data: complaintsData, isLoading } = useComplaints();
  const { data: employeesData } = useEmployees();
  const createMutation = useCreateComplaint();
  const updateMutation = useUpdateComplaint();
  const deleteMutation = useDeleteComplaint();
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

      return matchesSearch && matchesEmployee && matchesStatus && matchesSeverity && matchesType;
    });
  }, [complaints, search, employeeFilter, statusFilter, severityFilter, complaintTypeFilter]);

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
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <ShieldCheck className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400">صلاحية غير كافية</h2>
        <p className="text-slate-500 mt-2">هذه الصفحة غير متاحة لحسابك</p>
      </div>
    );
  }

  // ═══ Form handlers ═══
  const openCreateDialog = () => {
    setEditingComplaint(null);
    setForm({ ...emptyForm });
    setIsDialogOpen(true);
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
      responsiblePersonId: form.responsiblePersonId || null,
      compensation: form.compensation.trim() || null,
    };

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
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-rose-500/15 border border-rose-500/30">
            <MessageSquareWarning className="size-5 text-rose-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">شكاوى العملاء</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {filtered.length} شكوى مسجلة
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            onClick={openCreateDialog}
            size="sm"
            className="bg-rose-600 hover:bg-rose-700 text-white h-9 px-4"
          >
            <Plus className="size-4 ml-1" />
            إضافة شكوى
          </Button>
        )}
      </motion.div>

      {/* ═══ Stats Row ═══ */}
      {complaints.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
        >
          <div className="rounded-lg border border-slate-500/25 bg-slate-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">إجمالي الشكاوى</p>
            <p className="text-slate-300 font-bold text-lg leading-tight">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">مفتوحة</p>
            <p className="text-blue-400 font-bold text-lg leading-tight">{stats.openCount}</p>
          </div>
          <div className="rounded-lg border border-violet-500/30 bg-emerald-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">تم الحل</p>
            <p className="text-violet-400 font-bold text-lg leading-tight">{stats.resolvedCount}</p>
          </div>
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">متوسط وقت الحل</p>
            <p className="text-amber-400 font-bold text-lg leading-tight">
              {stats.avgResolution > 0 ? `${Math.round(stats.avgResolution)} يوم` : '—'}
            </p>
          </div>
        </motion.div>
      )}

      {/* ═══ Filters ═══ */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث بالاسم أو الوصف أو رقم الصفقة..."
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
            <SelectValue placeholder="الموظف" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
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
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <AlertTriangle className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder="الخطورة" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {SEVERITY_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value} className="text-white">
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={complaintTypeFilter} onValueChange={setComplaintTypeFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <FileText className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder="النوع" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {COMPLAINT_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="text-white">
                {t.label}
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
            <p className="text-slate-400 text-sm font-medium">لا توجد شكاوى</p>
            <p className="text-slate-600 text-xs mt-1">
              {search || employeeFilter !== 'all' || statusFilter !== 'all' || severityFilter !== 'all' || complaintTypeFilter !== 'all'
                ? 'لم يتم العثور على نتائج'
                : 'لم يتم تسجيل أي شكاوى بعد'}
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
                            {getComplaintTypeBadge(complaint.complaintType)}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getSeverityColor(complaint.severity)}`}
                          >
                            {getSeverityBadge(complaint.severity)}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-2 py-0 h-5 border ${getStatusColor(complaint.status)}`}
                          >
                            {getStatusBadge(complaint.status)}
                          </Badge>
                          {canUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-slate-700/50"
                              onClick={() => openEditDialog(complaint)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                              onClick={() => setDeletingId(complaint.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
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
                        <div className="rounded-lg bg-emerald-500/8 border border-violet-500/30 p-3 space-y-1.5">
                          <div className="flex items-center gap-1.5 text-violet-400 text-[11px] font-medium">
                            <CheckCircle2 className="size-3.5" />
                            الحل
                          </div>
                          <p className="text-violet-300/80 text-xs leading-relaxed">
                            {complaint.resolution}
                          </p>
                          {complaint.compensation && (
                            <p className="text-violet-400/60 text-[10px] mt-1">
                              التعويض: {complaint.compensation}
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
                      <div className="flex gap-2 mt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="flex-1 text-[11px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 h-7"
                          onClick={() => {
                            useAppStore.getState().navigateTo('capa', undefined, {
                              title: `شكوى عميل — ${complaint.complaintType}`,
                              department: '',
                              priority: complaint.severity === 'critical' ? 'critical' : complaint.severity === 'high' ? 'high' : 'medium',
                              employeeId: complaint.employeeId || '',
                              problemDescription: complaint.description,
                              source: 'complaint',
                              relatedComplaintId: complaint.id,
                            });
                          }}
                        >
                          <ShieldAlert className="size-3 ml-1" />
                          إنشاء CAPA من الشكوى
                        </Button>
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
      <Dialog open={isDialogOpen} onOpenChange={(open) => { if (!open) { setIsDialogOpen(false); setEditingComplaint(null); } }}>
        <DialogContent className="bg-slate-900 border-slate-700/60 max-h-[90vh] overflow-y-auto max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">
              {editingComplaint ? 'تعديل الشكوى' : 'إضافة شكوى جديدة'}
            </DialogTitle>
            <DialogDescription className="text-slate-500 text-xs">
              {editingComplaint ? 'قم بتعديل بيانات الشكوى' : 'أدخل بيانات الشكوى الجديدة'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Row 1: Customer name + Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">اسم العميل *</Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => setForm((p) => ({ ...p, customerName: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder="اسم العميل"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">بيانات الاتصال</Label>
                <Input
                  value={form.customerContact}
                  onChange={(e) => setForm((p) => ({ ...p, customerContact: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder="رقم الهاتف أو البريد"
                />
              </div>
            </div>

            {/* Row 2: Deal ID + Employee */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">رقم الصفقة</Label>
                <Input
                  value={form.dealId}
                  onChange={(e) => setForm((p) => ({ ...p, dealId: e.target.value }))}
                  className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm"
                  placeholder="رقم الصفقة (اختياري)"
                />
              </div>
              <div>
                <EmployeeSearchInput
                  employees={employees}
                  value={form.employeeId || ''}
                  onChange={(id) => setForm((p) => ({ ...p, employeeId: id }))}
                  label="الموظف المسؤول"
                  placeholder="ابحث عن اسم الموظف (اختياري)..."
                  allowClear
                  clearLabel="— بدون —"
                  variant="form"
                />
              </div>
            </div>

            {/* Row 3: Type + Severity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">نوع الشكوى</Label>
                <Select value={form.complaintType} onValueChange={(v) => setForm((p) => ({ ...p, complaintType: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPLAINT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-white">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-slate-300 text-xs">الخطورة</Label>
                <Select value={form.severity} onValueChange={(v) => setForm((p) => ({ ...p, severity: v }))}>
                  <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_OPTIONS.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-white">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row 4: Status */}
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

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الوصف *</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[80px] resize-none"
                placeholder="وصف الشكوى بالتفصيل"
              />
            </div>

            {/* Resolution */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">الحل</Label>
              <Textarea
                value={form.resolution}
                onChange={(e) => setForm((p) => ({ ...p, resolution: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder="وصف الحل المقدم"
              />
            </div>

            {/* Row 5: Responsible person — System User, not Employee */}
            <div className="space-y-1.5">
              <UserSearchInput
                users={systemUsers}
                value={form.responsiblePersonId}
                onChange={(id) => setForm((p) => ({ ...p, responsiblePersonId: id }))}
                label="المسؤول"
                placeholder="ابحث عن مستخدم مسؤول..."
                allowClear
                clearLabel="— بدون —"
              />
            </div>

            {/* Compensation */}
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">التعويض المقدم</Label>
              <Textarea
                value={form.compensation}
                onChange={(e) => setForm((p) => ({ ...p, compensation: e.target.value }))}
                className="bg-slate-800/70 border-slate-700/70 text-white text-sm min-h-[60px] resize-none"
                placeholder="وصف التعويض المقدم للعميل"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => { setIsDialogOpen(false); setEditingComplaint(null); }}
              className="text-slate-400 hover:text-white hover:bg-slate-800"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !form.customerName.trim() || !form.description.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isSaving ? 'جاري الحفظ...' : editingComplaint ? 'حفظ التعديلات' : 'إضافة الشكوى'}
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
              هل أنت متأكد من حذف هذه الشكوى؟ لا يمكن التراجع عن هذا الإجراء.
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