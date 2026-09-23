'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
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
import { Archive,
  Award,
  Plus,
  Pencil,
  Search,
  X,
  Link as LinkIcon,
  Trash2,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CalendarDays,
  Users,
  CheckCircle2,
  Copy,
  ClipboardCheck,
  Clock,
  XCircle,
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import type { QualityDeduction, Employee } from '@/types';
import {
  deductionTypeLabel, projectDeductionStatus,
  DEDUCTION_STATUS_LABELS,
} from '@/lib/quality-deductions/domain';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';
import { useAppStore } from '@/lib/store';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatNumber, formatInteger, formatMonthKey, displayLocale } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/dictionary';
import { todayDisplayDate, currentMonthKey } from '@/lib/date-utils';
import { PagePeriodIndicator } from '@/components/shared/PagePeriodIndicator';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CAPALinkBadge } from '@/components/shared/CAPALinkBadge';
import { InlineFormPanel } from '@/components/shared/InlineFormPanel';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
import { CAPAInlineForm, type CapaInlineFormState } from '@/components/shared/inline-forms';

interface QualityWithEmployee extends QualityDeduction {
  employee?: {
    id: string;
    name: string;
    department: string | null;
  };
}

const DAY_PRESETS = [
  { value: '0.25', label: 'ربع يوم' },
  { value: '0.5', label: 'نصف يوم' },
  { value: '0.75', label: 'ثلاثة أرباع يوم' },
  { value: '1', label: 'يوم كامل' },
  { value: '1.5', label: 'يوم ونصف' },
  { value: '2', label: 'يومين' },
  { value: 'custom', label: 'مخصص' },
];

function getDayLabel(days: number, locale: Locale = displayLocale()): string {
  const preset = DAY_PRESETS.find((p) => p.value === String(days));
  if (preset) return translateUIText(preset.label, locale);
  if (days === 0) return '—';
  return `${formatNumber(days, { locale })} ${translateUIText('يوم', locale)}`;
}

function parseDateToMonth(dateStr: string): string {
  try {
    const parts = dateStr.split('/');
    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
      return `${year}-${String(month).padStart(2, '0')}`;
    }
  } catch {
    // ignore
  }
  return '';
}

function getTypeBadge(type: string) {
  switch (type) {
    case 'safety':
      return { label: 'سلامة', color: 'bg-red-500/15 text-red-400 border-red-500/30', icon: ShieldAlert };
    case 'compliance':
      return { label: 'التزام', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30', icon: ShieldCheck };
    default:
      return { label: 'جودة', color: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: AlertTriangle };
  }
}

// §WORKFLOW — approval status chip for a discount row. Legacy rows
// (no approvalStatus) project to 'approved' and render NO chip, so
// the familiar card look is unchanged for already-effective records.
function getApprovalChip(status: ReturnType<typeof projectDeductionStatus>) {
  switch (status) {
    case 'pending':
      return { label: DEDUCTION_STATUS_LABELS.pending, cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', icon: Clock };
    case 'rejected':
      return { label: DEDUCTION_STATUS_LABELS.rejected, cls: 'bg-red-500/15 text-red-400 border-red-500/30', icon: XCircle };
    case 'draft':
      return { label: DEDUCTION_STATUS_LABELS.draft, cls: 'bg-slate-500/15 text-slate-400 border-slate-500/30', icon: Pencil };
    default:
      return null; // approved — no visual noise
  }
}

function getDaysColor(days: number): string {
  if (days >= 5) return 'bg-red-500/20 text-red-300 border-red-500/40';
  if (days >= 3) return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
  if (days >= 1) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-brand-500/20 text-brand-300 border-brand-500/30';
}

function formatDeductionForCopy(deduction: QualityWithEmployee, empName: string, locale: Locale = displayLocale()): string {
  const typeLabel = translateUIText(deductionTypeLabel(deduction.type), locale);
  const dayLabel = getDayLabel(deduction.deductionDays, locale);
  let text = `━━━━━━━━━━━━━━━━━━━\n`;
  text += `  ${translateUIText('خصم', locale)} ${typeLabel}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `  ${translateUIText('الموظف: ', locale)}${empName}\n`;
  text += `  ${translateUIText('التاريخ: ', locale)}${deduction.date}\n`;
  text += `  ${translateUIText('عدد الخصم: ', locale)}${dayLabel}\n`;
  if (deduction.deductionAmount > 0) {
    text += `  ${translateUIText('المبلغ: ', locale)}${formatNumber(deduction.deductionAmount, { locale })} ${translateUIText('جنيه', locale)}\n`;
  }
  text += `\n  ${translateUIText('التفاصيل:', locale)}\n  ${deduction.description || translateUIText('لا يوجد وصف', locale)}\n`;
  if (deduction.evidence) {
    text += `\n  ${translateUIText('الدليل: ', locale)}${deduction.evidence}\n`;
  }
  text += `\n━━━━━━━━━━━━━━━━━━━`;
  return text;
}

function formatAllDeductionsForCopy(empName: string, deductions: QualityWithEmployee[], locale: Locale = displayLocale()): string {
  const totalDays = deductions.reduce((s, d) => s + d.deductionDays, 0);
  const totalAmount = deductions.reduce((s, d) => s + d.deductionAmount, 0);

  let text = `══════════════════════════════\n`;
  text += `  ${translateUIText('ملخص خصومات الجودة', locale)}\n`;
  text += `══════════════════════════════\n\n`;
  text += `  ${translateUIText('الموظف: ', locale)}${empName}\n`;
  text += `  ${translateUIText('عدد الخصومات: ', locale)}${formatInteger(deductions.length, locale)}\n`;
  text += `  ${translateUIText('إجمالي الأيام: ', locale)}${formatNumber(totalDays, { locale })} ${translateUIText('يوم', locale)}\n`;
  if (totalAmount > 0) {
    text += `  ${translateUIText('إجمالي المبلغ: ', locale)}${formatNumber(totalAmount, { locale })} ${translateUIText('جنيه', locale)}\n`;
  }
  text += `\n──────────────────────────────\n\n`;

  deductions.forEach((d, idx) => {
    const typeLabel = translateUIText(deductionTypeLabel(d.type), locale);
    text += `  ${formatInteger(idx + 1, locale)}. ${translateUIText('خصم', locale)} ${typeLabel}\n`;
    text += `     ${translateUIText('التاريخ: ', locale)}${d.date}\n`;
    text += `     ${translateUIText('الخصم: ', locale)}${getDayLabel(d.deductionDays, locale)}\n`;
    if (d.deductionAmount > 0) {
      text += `     ${translateUIText('المبلغ: ', locale)}${formatNumber(d.deductionAmount, { locale })} ${translateUIText('جنيه', locale)}\n`;
    }
    text += `     ${translateUIText('التفاصيل: ', locale)}${d.description || translateUIText('لا يوجد وصف', locale)}\n`;
    if (d.evidence) {
      text += `     ${translateUIText('الدليل: ', locale)}${d.evidence}\n`;
    }
    text += `\n`;
  });

  text += `══════════════════════════════`;
  return text;
}

export default function QualityPage() {
  const { canEdit, canCreate, canUpdate, canDelete, canUpload, canApprove, canDoAction, canViewPage } = usePermissions('quality');
  const { locale } = useLanguage();
  // §2 AUDIT-IDENTITY — WHO registered a discount is audit metadata: the
  // canonical permission is the 'qualityAuditLog' page grant (System
  // Owner bypasses; managers/quality staff hold it by preset). The API
  // strips createdByName from the payload for everyone else, so this
  // flag only controls whether the AUTHORIZED card-level chip renders.
  const canSeeAuditIdentity = canViewPage('qualityAuditLog');
  // §WORKFLOW — reject authority: the dedicated 'reject' action OR the
  // legacy 'approve' grant (the API's verifyAnyAction mirrors this).
  const canReject = canDoAction('quality', 'reject') || canApprove;
  const isApprover = canApprove || canReject;
  // §12 GLOBAL INLINE FORM STANDARD — "إنشاء CAPA" from a quality note
  // opens the shared inline CAPA form HERE (gated by the CAPA page's
  // own create permission); it NEVER navigates away from Quality.
  const { canCreate: canCreateCapa } = usePermissions('capa');
  const [deductions, setDeductions] = useState<QualityWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Phase 6.3 (§8): filter context persists per user (session-scoped).
  // Milestone 7 §12: the period DEFAULT is the CURRENT MONTH (applies
  // only when the user has no persisted filter state — §27) — 'all'
  // remains one click away and is never re-imposed after Clear.
  // §17 — deep-link month seed: a navigation intent (search result /
  // dashboard card) wins over the remembered month for this mount.
  const navMonth = useAppStore((s) => {
    const m = s.navParams.month;
    return typeof m === 'string' && m.length === 7 && m[4] === '-' ? m : null;
  });
  const [qualityView, setQualityView] = usePageState<{ search: string; monthFilter: string; showArchived?: boolean }>({
    page: 'quality',
    slot: 'filters',
    version: 1,
    skipRestore: navMonth !== null,
    initial: () => ({ search: '', monthFilter: navMonth ?? currentMonthKey() }),
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { monthFilter?: unknown }).monthFilter === 'string'
        ? raw
        : null,
  });
  const search = qualityView.search;
  const setSearch = (v: string) => setQualityView((s) => ({ ...s, search: v }));
  const monthFilter = qualityView.monthFilter;
  const setMonthFilter = (v: string) => setQualityView((s) => ({ ...s, monthFilter: v }));
  // §ARCHIVE — optional historical view of archived deductions.
  const showArchived = qualityView.showArchived === true;
  const setShowArchived = (v: boolean) => {
    setQualityView((s) => ({ ...s, showArchived: v }));
    void fetchData(v);
  };
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null); // §ARCHIVE target
  const [archiveLoadingId, setArchiveLoadingId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [copiedDedId, setCopiedDedId] = useState<string | null>(null);
  const [copiedAllEmpId, setCopiedAllEmpId] = useState<string | null>(null);
  const [editingDeduction, setEditingDeduction] = useState<QualityWithEmployee | null>(null);
  // §12 — inline CAPA creation from a quality note: which employee block
  // hosts the form + the prefilled defaults. key forces a remount so a
  // second click on another note always starts from the NEW prefill.
  const [capaPrefill, setCapaPrefill] = useState<{ empId: string; defaults: Partial<CapaInlineFormState> } | null>(null);
  // System users for the CAPA form's "مُسند إليه" field (same source the
  // CAPA page and dashboard quick action use).
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);
  const [addForm, setAddForm] = useState({
    employeeId: '',
    date: '',
    type: 'quality_issue',
    description: '',
    dayPreset: '0.25',
    customDays: '',
    deductionAmount: '',
    evidence: '',
    month: '',
  });

  useEffect(() => {
    fetchData();
    // System users for the inline CAPA form (assigned-to field).
    authFetch('/api/dashboard/users?basic=1')
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => setSystemUsers(Array.isArray(list) ? list : []))
      .catch(() => setSystemUsers([]));
  }, []);

  async function fetchData(withArchived?: boolean) {
    const includeArchived = withArchived ?? showArchived;
    setError(null);
    try {
      const [qRes, empRes] = await Promise.all([
        authFetch(`/api/quality${includeArchived ? '?includeArchived=1' : ''}`),
        authFetch('/api/employees'),
      ]);
      if (qRes.ok) {
        const qData = await qRes.json();
        setDeductions(qData);
      }
      if (empRes.ok) {
        const empData = await empRes.json();
        setEmployees(empData);
      }
    } catch {
      setError('تعذّر تحميل بيانات الخصومات');
      setDeductions([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }

  const handleDateChange = (date: string) => {
    const month = parseDateToMonth(date);
    setAddForm((p) => ({ ...p, date, month }));
  };

  const handleSaveDeduction = async () => {
    if (!addForm.employeeId || !addForm.date) return;

    const deductionDays =
      addForm.dayPreset === 'custom'
        ? parseFloat(addForm.customDays) || 0
        : parseFloat(addForm.dayPreset) || 0;

    setSaving(true);
    try {
      if (editingDeduction) {
        // Edit mode
        const res = await authFetch(`/api/quality/${editingDeduction.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: addForm.date,
            type: addForm.type,
            description: addForm.description || '',
            deductionDays,
            deductionAmount: parseFloat(addForm.deductionAmount) || 0,
            evidence: addForm.evidence || null,
            month: addForm.month,
          }),
        });
        if (res.ok) {
          const empName = employees.find((e: any) => e.id === addForm.employeeId)?.name || '';
          logUpdate('quality', 'خصم جودة', `${empName} - ${addForm.description}`);
          await fetchData();
          setIsAddOpen(false);
          setEditingDeduction(null);
          setAddForm({
            employeeId: '',
            date: '',
            type: 'quality_issue',
            description: '',
            dayPreset: '0.25',
            customDays: '',
            deductionAmount: '',
            evidence: '',
            month: '',
          });
        }
      } else {
        // Create mode
        const res = await authFetch('/api/quality', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employeeId: addForm.employeeId,
            date: addForm.date,
            type: addForm.type,
            description: addForm.description || '',
            deductionDays,
            deductionAmount: parseFloat(addForm.deductionAmount) || 0,
            evidence: addForm.evidence || null,
            month: addForm.month,
          }),
        });
        if (res.ok) {
          const empName = employees.find((e: any) => e.id === addForm.employeeId)?.name || '';
          logCreate('quality', 'خصم جودة', `${empName} - ${addForm.description}`);
          await fetchData();
          setIsAddOpen(false);
          setEditingDeduction(null);
          setAddForm({
            employeeId: '',
            date: '',
            type: 'quality_issue',
            description: '',
            dayPreset: '0.25',
            customDays: '',
            deductionAmount: '',
            evidence: '',
            month: '',
          });
        }
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const copySingleDeduction = async (deduction: QualityWithEmployee, empName: string) => {
    const text = formatDeductionForCopy(deduction, empName, locale);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedDedId(deduction.id);
      setTimeout(() => setCopiedDedId(null), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedDedId(deduction.id);
      setTimeout(() => setCopiedDedId(null), 2000);
    }
  };

  const copyAllDeductionsForEmployee = async (empId: string, empName: string, empDeductions: QualityWithEmployee[]) => {
    const text = formatAllDeductionsForCopy(empName, empDeductions, locale);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAllEmpId(empId);
      setTimeout(() => setCopiedAllEmpId(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedAllEmpId(empId);
      setTimeout(() => setCopiedAllEmpId(null), 2000);
    }
  };

  const [deleteLoading, setDeleteLoading] = useState(false);
  const handleDelete = async (id: string) => {
    setDeleteLoading(true);
    try {
      const ded = deductions.find((d: any) => d.id === id);
      const res = await authFetch(`/api/quality/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (ded) logDelete('quality', 'خصم جودة', `${ded.employee?.name || ''} - ${ded.description || ''}`);
        setDeductions((prev) => prev.filter((d) => d.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    } finally {
      setDeleteLoading(false);
    }
  };

  // §ARCHIVE — archive/restore a discount (audited server-side).
  // Archived = historical: excluded from every active total & KPI.
  const handleArchive = async (id: string, archived: boolean) => {
    setArchiveLoadingId(id);
    try {
      const res = await authFetch(`/api/quality/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        setDeductions((prev) =>
          prev.filter((d) => (archived ? d.id !== id || showArchived : true)).map((d) =>
            d.id === id ? { ...d, archived, archivedAt: archived ? new Date().toISOString() : null } : d,
          ),
        );
        toast.success(archived ? translateUIText('تم أرشفة الخصم — لن يأثر على الإجماليات النشطة', locale) : translateUIText('تم استعادة الخصم من الأرشيف', locale));
        setArchivingId(null);
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || translateUIText('تعذّر تغيير حالة الأرشيف', locale));
      }
    } catch {
      toast.error(translateUIText('تعذّر الاتصال بالخادم', locale));
    } finally {
      setArchiveLoadingId(null);
    }
  };

  // ═══ §WORKFLOW — approve / reject a PENDING discount ═══
  // Only users with the 'approve' permission see these actions (the
  // API enforces the same permission — the UI never decides alone).
  const [approvalLoadingId, setApprovalLoadingId] = useState<string | null>(null);
  const handleApproval = async (id: string, action: 'approve' | 'reject') => {
    let body: Record<string, unknown> = {};
    if (action === 'reject') {
      const reason = window.prompt(translateUIText('سبب رفض الخصم (مطلوب):', locale));
      if (!reason || !reason.trim()) return;
      body = { reason: reason.trim() };
    }
    setApprovalLoadingId(id);
    try {
      const res = await authFetch(`/api/quality/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(action === 'approve' ? translateUIText('تم اعتماد الخصم — أصبح ساريًا في الحسابات', locale) : translateUIText('تم رفض الخصم', locale));
        await fetchData();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error || translateUIText('تعذّر تنفيذ الإجراء', locale));
      }
    } catch {
      toast.error(translateUIText('تعذّر تنفيذ الإجراء', locale));
    } finally {
      setApprovalLoadingId(null);
    }
  };

  const openEdit = (deduction: QualityWithEmployee) => {
    setEditingDeduction(deduction);
    const daysStr = String(deduction.deductionDays);
    const isPreset = DAY_PRESETS.some((p) => p.value === daysStr);
    setAddForm({
      employeeId: deduction.employeeId,
      date: deduction.date,
      type: deduction.type,
      description: deduction.description || '',
      dayPreset: isPreset ? daysStr : 'custom',
      customDays: isPreset ? '' : daysStr,
      deductionAmount: deduction.deductionAmount > 0 ? String(deduction.deductionAmount) : '',
      evidence: deduction.evidence || '',
      month: deduction.month || '',
    });
    setIsAddOpen(true);
  };

  const filtered = deductions.filter((d) => {
    const name = d.employee?.name?.toLowerCase() || '';
    const desc = d.description?.toLowerCase() || '';
    const matchesSearch = name.includes(search.toLowerCase()) || desc.includes(search.toLowerCase());
    const matchesMonth = monthFilter && monthFilter !== 'all'
      ? d.month === monthFilter
      : true;
    return matchesSearch && matchesMonth;
  });

  // ═══ §WORKFLOW — approval visibility (§PENDING-VISIBILITY) ═══
  // The pending queue is computed from the search/period view so an
  // approver ALWAYS sees what awaits a decision, independent of the
  // status filter below.
  const pendingItems = filtered
    .filter((d) => projectDeductionStatus(d) === 'pending')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const [pendingOpen, setPendingOpen] = useState(true);
  // Status chips (الكل / قيد الاعتماد / مرفوض) narrow the MAIN list.
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'rejected'>('all');
  const statusFiltered = statusFilter === 'all'
    ? filtered
    : filtered.filter((d) => projectDeductionStatus(d) === statusFilter);
  const rejectedCount = filtered.filter((d) => projectDeductionStatus(d) === 'rejected').length;

  /** Jump from the pending queue to the owning group in the main list. */
  const jumpToDeduction = (d: QualityWithEmployee) => {
    setStatusFilter('all');
    useAppStore.getState().setHighlightId(d.id);
    setExpandedRow(d.id);
  };

  // ═══ Group by employee ═══
  // §WORKFLOW — totals (days/amount) count APPROVED discounts ONLY;
  // pending records are shown with a chip but never inflate totals.
  const groupedByEmployee = statusFiltered.reduce<Record<string, {
    name: string;
    department: string | null;
    deductions: QualityWithEmployee[];
    totalDays: number;
    totalAmount: number;
    pendingCount: number;
  }>>((acc, d) => {
    if (!acc[d.employeeId]) {
      acc[d.employeeId] = {
        name: d.employee?.name || translateUIText('غير معروف', locale),
        department: d.employee?.department || null,
        deductions: [],
        totalDays: 0,
        totalAmount: 0,
        pendingCount: 0,
      };
    }
    acc[d.employeeId].deductions.push(d);
    if (projectDeductionStatus(d) === 'approved') {
      acc[d.employeeId].totalDays += d.deductionDays;
      acc[d.employeeId].totalAmount += d.deductionAmount;
    } else if (projectDeductionStatus(d) === 'pending') {
      acc[d.employeeId].pendingCount += 1;
    }
    return acc;
  }, {});

  // Sort by totalDays desc
  const sortedEmployees = Object.entries(groupedByEmployee)
    .sort((a, b) => b[1].totalDays - a[1].totalDays);

  // ═══ Deep-link container handling (Phase 6.3 §25) ═══
  // A search/evidence navigation into a DEDUCTION row must open the
  // owning employee group first — the record is otherwise unrenderable.
  // Same doctrine as FollowUpsPage's group auto-expand (Phase 5.3).
  const highlightId = useAppStore((s) => s.highlightId);
  useEffect(() => {
    if (!highlightId || loading) return;
    const ownerId = Object.keys(groupedByEmployee).find((id) =>
      groupedByEmployee[id].deductions.some((d) => d.id === highlightId),
    );
    if (!ownerId) return;
    // Deferred one frame (react-hooks/set-state-in-effect doctrine):
    // opening the container is a one-shot reaction to the deep-link.
    const raf = requestAnimationFrame(() => {
      setExpandedEmp((current) => (current === ownerId ? current : ownerId));
    });
    return () => cancelAnimationFrame(raf);
  }, [highlightId, loading, groupedByEmployee]);

  // Exact-record locate/scroll/highlight over data-record-id (§30).
  useRecordHighlight({ ready: !loading });

  const grandTotalDays = sortedEmployees.reduce((sum, [, e]) => sum + e.totalDays, 0);
  const grandTotalAmount = sortedEmployees.reduce((sum, [, e]) => sum + e.totalAmount, 0);
  // §WORKFLOW — pending count across the filtered view (never totals).
  const grandPendingCount = filtered.filter((d) => projectDeductionStatus(d) === 'pending').length;

  // Month options
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <div className="space-y-5">
      {/* ═══ Header (§25/§26 — sticky, primary action always accessible) ═══ */}
      <PageHeaderBar
        icon={<Award className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        title={translateUIText('خصومات الجودة', locale)}
        description={
          <>
            {formatInteger(filtered.length, locale)} <T>سجل خصم</T> — {formatInteger(sortedEmployees.length, locale)} <T>موظف</T>
            {grandPendingCount > 0 ? <> — {formatInteger(grandPendingCount, locale)} <T>قيد الاعتماد</T></> : null}
          </>
        }
        extras={
          <PagePeriodIndicator
            testId="quality-period-indicator"
            label={monthFilter && monthFilter !== 'all' ? formatMonthKey(monthFilter, locale) : translateUIText('كل الأشهر', locale)}
            filtered={!!monthFilter && monthFilter !== 'all'}
            onShowAll={() => setMonthFilter('all')}
          />
        }
        primaryAction={canCreate ? {
          label: translateUIText('إضافة خصم', locale),
          onClick: () => {
            setEditingDeduction(null);
            // §5: DEFAULT DATE = TODAY — month derives from it; the
            // user can still type any historical date before saving.
            const today = todayDisplayDate();
            setAddForm((p) => ({ ...p, date: today, month: parseDateToMonth(today) }));
            setIsAddOpen(true);
          },
        } : undefined}
      />

      {/* ═══ Stats Bar ═══ */}
      {filtered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5"
        >
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>إجمالي الأيام</T></p>
            <p className="text-amber-400 font-bold text-lg leading-tight">{formatNumber(grandTotalDays, { locale })}</p>
            <p className="text-slate-500 text-[10px]"><T>يوم خصم</T></p>
          </div>
          {grandTotalAmount > 0 && (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5"><T>إجمالي المبلغ</T></p>
              <p className="text-rose-400 font-bold text-lg leading-tight" dir="ltr">
                {formatNumber(grandTotalAmount, { locale })}
              </p>
              <p className="text-slate-500 text-[10px]"><T>جنيه</T></p>
            </div>
          )}
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5"><T>عدد الموظفين</T></p>
            <p className="text-cyan-400 font-bold text-lg leading-tight">{formatInteger(sortedEmployees.length, locale)}</p>
            <p className="text-slate-500 text-[10px]"><T>موظف</T></p>
          </div>
          {grandPendingCount > 0 && (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5"><T>قيد الاعتماد</T></p>
              <p className="text-amber-400 font-bold text-lg leading-tight">{formatInteger(grandPendingCount, locale)}</p>
              <p className="text-slate-500 text-[10px]"><T>لا تدخل في الإجماليات</T></p>
            </div>
          )}
        </motion.div>
      )}

      {/* ═══ Filters ═══ */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder={translateUIText('بحث بالاسم أو سبب الخصم...', locale)}
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
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-full sm:w-40 h-9 text-sm">
            <CalendarDays className="size-3.5 ml-1.5 text-slate-500" />
            <SelectValue placeholder={translateUIText('الشهر', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>كل الأشهر</T></SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m} className="text-white">{formatMonthKey(m, locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* §ARCHIVE — optional historical view */}
        <button
          type="button"
          onClick={() => setShowArchived(!showArchived)}
          aria-pressed={showArchived}
          className={`inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-colors ${
            showArchived
              ? 'bg-brand-500/15 text-brand-300 border-brand-500/30'
              : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:text-slate-200'
          }`}
        >
          <Archive className="size-3.5" />
          <T>المؤرشفة</T>
        </button>
      </div>

      {/* ═══ §PENDING-VISIBILITY — approval status chips ═══ */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {([
          { key: 'all' as const, label: 'الكل', count: filtered.length, cls: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
          { key: 'pending' as const, label: 'قيد الاعتماد', count: pendingItems.length, cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
          { key: 'rejected' as const, label: 'مرفوض', count: rejectedCount, cls: 'bg-red-500/15 text-red-300 border-red-500/30' },
        ]).map((chip) => (
          <button
            key={chip.key}
            onClick={() => setStatusFilter(chip.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-semibold transition-all ${
              statusFilter === chip.key
                ? chip.cls
                : 'bg-slate-800/50 text-slate-400 border-slate-700/50 hover:text-slate-200'
            }`}
          >
            {chip.label && <T>{chip.label}</T>}
            <span className={`min-w-4 text-center px-1 rounded-full text-[10px] ${statusFilter === chip.key ? 'bg-white/15' : 'bg-slate-700/60'}`}>
              {formatInteger(chip.count, locale)}
            </span>
          </button>
        ))}
      </div>

      {/* ═══ §PENDING-VISIBILITY — the Approval Queue ═══
          Always rendered for the CURRENT view when anything is pending
          (top of the page, amber, count-badged). Approvers act inline;
          everyone else sees what is in flight. Hidden while the user
          narrowed the list to the pending chip already. */}
      {pendingItems.length > 0 && statusFilter !== 'pending' && (
        <motion.section
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-amber-500/30 bg-amber-500/[0.04] overflow-hidden"
          aria-label={translateUIText('بانتظار الاعتماد', locale)}
        >
          <button
            onClick={() => setPendingOpen((v) => !v)}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-amber-500/[0.06] transition-colors"
          >
            <span className="flex items-center justify-center size-8 rounded-lg bg-amber-500/15 border border-amber-500/30 shrink-0">
              <Clock className="size-4 text-amber-400" />
            </span>
            <div className="text-right flex-1 min-w-0">
              <p className="text-sm font-bold text-amber-200 leading-tight"><T>بانتظار الاعتماد</T></p>
              <p className="text-[10px] text-slate-500 leading-tight mt-0.5">
                <T>{isApprover
                  ? 'خصومات جديدة تنتظر قرارك — لا تدخل في التقارير حتى اعتمادها'
                  : 'خصومات أُرسلت للمختصين ولن تدخل في التقارير حتى اعتمادها'}</T>
              </p>
            </div>
            <span className="flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full bg-amber-500 text-slate-950 text-xs font-bold shrink-0">
              {formatInteger(pendingItems.length, locale)}
            </span>
            <ChevronDown className={`size-4 text-amber-400/70 transition-transform ${pendingOpen ? 'rotate-180' : ''}`} />
          </button>
          <AnimatePresence initial={false}>
            {pendingOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="divide-y divide-amber-500/10 max-h-72 overflow-y-auto arm-scroll">
                  {pendingItems.map((d) => {
                    const badge = getTypeBadge(d.type);
                    const BadgeIcon = badge.icon;
                    return (
                      <div key={d.id} className="flex items-center gap-2 px-4 py-2">
                        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.color}`}>
                          <BadgeIcon className="size-2.5" />
                          <T>{badge.label}</T>
                        </span>
                        <EmployeeLink employeeId={d.employeeId} name={d.employee?.name || translateUIText('غير معروف', locale)} compact hideAvatar />
                        <span className="flex-shrink-0 text-slate-500 text-[11px]" dir="ltr">{d.date}</span>
                        <p className="flex-1 min-w-0 text-slate-400 text-xs truncate">{d.description || translateUIText('بدون وصف', locale)}</p>
                        <span className="flex-shrink-0 text-amber-400 font-bold text-xs">{formatNumber(d.deductionDays, { locale })}<T>ي</T></span>
                        {isApprover && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            {canApprove && (
                              <Button
                                size="sm"
                                className="h-7 text-[11px] bg-emerald-600/90 hover:bg-emerald-600 text-white"
                                disabled={approvalLoadingId === d.id}
                                onClick={() => void handleApproval(d.id, 'approve')}
                              >
                                <CheckCircle2 className="size-3 ml-1" />
                                <T>اعتماد</T>
                              </Button>
                            )}
                            {canReject && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                                disabled={approvalLoadingId === d.id}
                                onClick={() => void handleApproval(d.id, 'reject')}
                              >
                                <XCircle className="size-3 ml-1" />
                                <T>رفض</T>
                              </Button>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => jumpToDeduction(d)}
                          className="flex-shrink-0 text-[11px] text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20"
                          title={translateUIText('الانتقال إلى السجل في القائمة', locale)}
                        >
                          <T>عرض</T>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      )}

      {/* ═══ Loading ═══ */}
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3">
              <AlertTriangle className="size-6 text-rose-400" />
            </div>
            <p className="text-rose-300 text-sm font-medium">{error && <T>{error}</T>}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => fetchData()}><T>إعادة المحاولة</T></Button>
          </CardContent>
        </Card>
      ) : statusFiltered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <Award className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">
              <T>{statusFilter === 'pending' ? 'لا توجد خصومات قيد الاعتماد' : statusFilter === 'rejected' ? 'لا توجد خصومات مرفوضة' : 'لا توجد خصومات'}</T>
            </p>
            <p className="text-slate-600 text-xs mt-1">
              {/* §10/§56: the active period is NAMED in the empty state. */}
              {search
                ? <T>لم يتم العثور على نتائج</T>
                : statusFilter === 'all' && monthFilter && monthFilter !== 'all'
                  ? <><T>لا توجد خصومات مسجلة في </T>{formatMonthKey(monthFilter, locale)}.</>
                  : statusFilter === 'all' ? <T>لم يتم تسجيل أي خصومات بعد</T> : <T>جرّب تغيير عامل التصفية</T>}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sortedEmployees.map(([empId, emp]) => {
            const isEmpExpanded = expandedEmp === empId;
            const daysColor = getDaysColor(emp.totalDays);

            return (
              <motion.div
                key={empId}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                layout
              >
                {/* ═══ Employee Header Card ═══ */}
                <div
                  className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-700/40 bg-slate-800/50 cursor-pointer hover:bg-slate-800/70 transition-colors"
                  onClick={() => setExpandedEmp(isEmpExpanded ? null : empId)}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 size-9 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-600/50">
                    <span className="text-white text-sm font-bold">
                      {emp.name.charAt(0)}
                    </span>
                  </div>

                  {/* Name + Dept */}
                  <div className="flex-1 min-w-0">
                    <EmployeeLink employeeId={empId} name={emp.name} />
                    {emp.department && (
                      <p className="text-slate-500 text-[11px]">{emp.department}</p>
                    )}
                  </div>

                  {/* Bubbles: Total Days + Amount */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {/* Deductions count */}
                    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-700/50 border border-slate-600/30">
                      <span className="text-slate-400 text-[11px]">{formatInteger(emp.deductions.length, locale)}</span>
                      <span className="text-slate-500 text-[10px]"><T>خصم</T></span>
                    </div>

                    {/* Total Days Bubble */}
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border ${daysColor}`}>
                      <span className="font-bold text-xs">{formatNumber(emp.totalDays, { locale })}</span>
                      <span className="text-[10px]"><T>يوم</T></span>
                    </div>

                    {/* Total Amount Bubble */}
                    {emp.totalAmount > 0 && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        <span className="font-bold text-xs" dir="ltr">{formatNumber(emp.totalAmount, { locale })}</span>
                        <span className="text-[10px]"><T>ج</T></span>
                      </div>
                    )}

                    {/* §WORKFLOW — pending approvals awaiting a decision */}
                    {emp.pendingCount > 0 && (
                      <div
                        className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30"
                        title={translateUIText('خصومات قيد الاعتماد — لا تدخل في الإجماليات', locale)}
                      >
                        <Clock className="size-3" />
                        <span className="font-bold text-xs">{formatInteger(emp.pendingCount, locale)}</span>
                      </div>
                    )}
                  </div>

                  {/* Expand Arrow */}
                  <div className={`flex-shrink-0 text-slate-500 transition-transform duration-200 ${isEmpExpanded ? 'rotate-180' : ''}`}>
                    <ChevronDown className="size-4" />
                  </div>

                  {/* Copy All Deductions button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyAllDeductionsForEmployee(empId, emp.name, emp.deductions);
                    }}
                    className={`flex-shrink-0 transition-colors p-1 rounded-md ${
                      copiedAllEmpId === empId
                        ? 'text-brand-400 bg-brand-500/10'
                        : 'text-slate-600 hover:text-brand-400 hover:bg-brand-500/10'
                    }`}
                    title={translateUIText('نسخ كل الخصومات', locale)}
                  >
                    {copiedAllEmpId === empId ? (
                      <ClipboardCheck className="size-4" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </button>
                </div>

                {/* ═══ Employee Deductions (expandable) ═══ */}
                <AnimatePresence>
                  {isEmpExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="pr-4 pl-1 py-2 space-y-2 mr-5 border-r-2 border-slate-700/40">
                        {emp.deductions.map((d) => {
                          const badge = getTypeBadge(d.type);
                          const BadgeIcon = badge.icon;
                          const isRowExpanded = expandedRow === d.id;
                          // §WORKFLOW — legacy rows project to 'approved' (no chip).
                          const approvalStatus = projectDeductionStatus(d);
                          const approvalChip = getApprovalChip(approvalStatus);
                          const ApprovalChipIcon = approvalChip?.icon;

                          return (
                            <motion.div
                              key={d.id}
                              layout
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15 }}
                            >
                              <div
                                data-record-id={d.id}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg border bg-slate-800/30 cursor-pointer hover:bg-slate-800/50 transition-colors ${approvalStatus === 'rejected' ? 'border-red-500/20 opacity-70' : approvalStatus === 'pending' ? 'border-amber-500/25' : 'border-slate-700/30'}`}
                                onClick={() => setExpandedRow(isRowExpanded ? null : d.id)}
                              >
                                {/* Type Badge */}
                                <div className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.color}`}>
                                  <BadgeIcon className="size-2.5" />
                                  <span><T>{badge.label}</T></span>
                                </div>

                                {/* Employee name (for screenshot) */}
                                <EmployeeLink employeeId={empId} name={emp.name} compact hideAvatar />

                                {/* Date + Days */}
                                <span className="flex-shrink-0 text-slate-500 text-[11px]" dir="ltr">{d.date}</span>

                                {/* §2 AUDIT-IDENTITY — the SINGLE "recorded by"
                                    display point: card level only (never
                                    repeated in the expanded details), rendered
                                    only when the server authorized this viewer
                                    (createdByName is stripped from the payload
                                    otherwise). Legacy rows without the field
                                    render nothing. */}
                                {canSeeAuditIdentity && d.createdByName && (
                                  <span
                                    className="hidden md:inline-flex flex-shrink-0 items-center gap-1 text-[10px] text-slate-500 bg-slate-800/60 border border-slate-700/40 px-1.5 py-0.5 rounded"
                                    title={translateUIText('سجلها', locale)}
                                  >
                                    <T>بواسطة: </T><span className="text-slate-400">{d.createdByName}</span>
                                  </span>
                                )}

                                {/* §WORKFLOW — approval status chip. The creator
                                    identity is deliberately NOT shown anywhere on
                                    this card: it lives in the hidden audit metadata
                                    (and is stripped server-side for non-audit
                                    viewers), so a screenshot of the card can never
                                    reveal which Quality employee added the discount. */}
                                {approvalChip && ApprovalChipIcon && (
                                  <span className={`hidden sm:inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${approvalChip.cls}`}>
                                    <ApprovalChipIcon className="size-2.5" />
                                    <T>{approvalChip.label}</T>
                                  </span>
                                )}

                                {/* §ARCHIVE — visible archived state (historical only) */}
                                {d.archived && (
                                  <span className="hidden sm:inline-flex flex-shrink-0 items-center gap-1 px-1.5 py-0.5 rounded border border-slate-500/30 bg-slate-500/15 text-slate-300 text-[10px] font-medium">
                                    <Archive className="size-2.5" />
                                    <T>مؤرشف</T>
                                  </span>
                                )}

                                {/* Description preview */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-slate-300 text-xs truncate">
                                    {d.description || translateUIText('بدون وصف', locale)}
                                  </p>
                                </div>

                                {/* Days */}
                                <span className="flex-shrink-0 text-amber-400 font-bold text-xs">
                                  {formatNumber(d.deductionDays, { locale })}<T>ي</T>
                                </span>
                                {d.deductionAmount > 0 && (
                                  <span className="flex-shrink-0 text-rose-400 font-medium text-[11px]" dir="ltr">
                                    {formatNumber(d.deductionAmount, { locale })}<T>ج</T>
                                  </span>
                                )}

                                {/* Expand/Collapse */}
                                <div className={`flex-shrink-0 text-slate-600 transition-transform duration-150 ${isRowExpanded ? 'rotate-180' : ''}`}>
                                  <ChevronDown className="size-3" />
                                </div>

                                {/* §6/§2 — actions consolidated into the shared
                                    SmartActionMenu (icon fan with tooltips);
                                    copy stays visible as the primary action. */}
                                {(canUpdate || canDelete) && (
                                  <div className="flex-shrink-0">
                                    <SmartActionMenu
                                      size="sm"
                                      label={translateUIText('إجراءات الخصم', locale)}
                                      actions={[
                                        { key: 'edit', label: translateUIText('تعديل', locale), icon: <Pencil className="size-3.5" />, onSelect: () => openEdit(d), hidden: !canUpdate },
                                        { key: 'archive', label: translateUIText(d.archived ? 'استعادة من الأرشيف' : 'أرشفة', locale), icon: <Archive className="size-3.5" />, onSelect: () => (d.archived ? void handleArchive(d.id, false) : setArchivingId(d.id)), hidden: !canUpdate },
                                        { key: 'delete', label: translateUIText('حذف', locale), icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => setDeletingId(d.id), hidden: !canDelete },
                                      ]}
                                    />
                                  </div>
                                )}

                                {/* Copy to Clipboard */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copySingleDeduction(d, emp.name);
                                  }}
                                  className={`flex-shrink-0 transition-colors ${
                                    copiedDedId === d.id
                                      ? 'text-brand-400'
                                      : 'text-slate-600 hover:text-brand-400'
                                  }`}
                                  title={translateUIText('نسخ تفاصيل الخصم', locale)}
                                >
                                  {copiedDedId === d.id ? (
                                    <ClipboardCheck className="size-3" />
                                  ) : (
                                    <Copy className="size-3" />
                                  )}
                                </button>
                              </div>

                              {/* Expanded Description with employee name */}
                              <AnimatePresence>
                                {isRowExpanded && (
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.15 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="mr-6 mb-1 mt-1 px-3 py-2.5 rounded-lg bg-slate-900/60 border border-slate-700/25">
                                      {/* Employee name header for screenshot */}
                                      <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/20">
                                        <div className="flex-shrink-0 size-6 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-600/50">
                                          <span className="text-white text-[9px] font-bold">
                                            {emp.name.charAt(0)}
                                          </span>
                                        </div>
                                        <p className="text-white font-semibold text-xs">{emp.name}</p>
                                        {emp.department && (
                                          <p className="text-slate-600 text-[10px]">• {emp.department}</p>
                                        )}
                                      </div>
                                      <p className="text-slate-400 text-[10px] mb-1"><T>سبب الخصم</T></p>
                                      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap break-words">
                                        {d.description || translateUIText('لا يوجد وصف', locale)}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]">
                                        <span className="text-slate-500"><T>التاريخ: </T><span className="text-slate-400" dir="ltr">{d.date}</span></span>
                                        <span className="text-slate-500"><T>الشهر: </T><span className="text-slate-400" dir="ltr">{formatMonthKey(d.month, locale)}</span></span>
                                        <span className="text-slate-500"><T>الخصم: </T><span className="text-amber-400">{getDayLabel(d.deductionDays, locale)}</span></span>
                                        {d.deductionAmount > 0 && (
                                          <span className="text-slate-500"><T>المبلغ: </T><span className="text-rose-400" dir="ltr">{formatNumber(d.deductionAmount, { locale })} <T>جنيه</T></span></span>
                                        )}
                                        {/* §WORKFLOW — status only; WHO created/decided
                                            stays in the hidden audit metadata. */}
                                        {approvalChip && ApprovalChipIcon && (
                                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${approvalChip.cls}`}>
                                            <ApprovalChipIcon className="size-2.5" />
                                            <T>{approvalChip.label}</T>
                                          </span>
                                        )}
                                      </div>
                                      {/* §WORKFLOW — approver actions (pending only,
                                          permission-gated; the API enforces the same). */}
                                      {approvalStatus === 'pending' && (canApprove || canReject) && (
                                        <div className="flex items-center gap-2 mt-2">
                                          {canApprove && (
                                            <Button
                                              size="sm"
                                              className="h-7 text-[11px] bg-emerald-600/90 hover:bg-emerald-600 text-white"
                                              disabled={approvalLoadingId === d.id}
                                              onClick={(e) => { e.stopPropagation(); void handleApproval(d.id, 'approve'); }}
                                            >
                                              <CheckCircle2 className="size-3 ml-1" />
                                              <T>اعتماد</T>
                                            </Button>
                                          )}
                                          {canReject && (
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              className="h-7 text-[11px] border-red-500/30 text-red-400 hover:bg-red-500/10"
                                              disabled={approvalLoadingId === d.id}
                                              onClick={(e) => { e.stopPropagation(); void handleApproval(d.id, 'reject'); }}
                                            >
                                              <XCircle className="size-3 ml-1" />
                                              <T>رفض</T>
                                            </Button>
                                          )}
                                        </div>
                                      )}
                                      {d.evidence && (
                                        <a
                                          href={d.evidence}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 mt-2 text-cyan-400 hover:text-cyan-300 text-[11px] bg-cyan-500/10 px-2 py-1 rounded-md border border-cyan-500/20"
                                        >
                                          <LinkIcon className="size-2.5" />
                                          <T>عرض الدليل</T>
                                        </a>
                                      )}
                                      {/* ═══ CAPA Integration (Bidirectional) ═══ */}
                                      {(d as any).relatedCapaId && (
                                        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                                          <CAPALinkBadge capaId={(d as any).relatedCapaId} compact />
                                        </div>
                                      )}
                                      {!(d as any).relatedCapaId && canCreateCapa && (
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="mt-2 text-[11px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 h-7"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            // §12 GLOBAL INLINE FORM STANDARD — open the CAPA form
                                            // INLINE inside this employee block (prefilled from the
                                            // note); the user never leaves the Quality page.
                                            setCapaPrefill({
                                              empId: empId,
                                              defaults: {
                                                title: `خصم جودة — ${deductionTypeLabel(d.type)}`,
                                                department: emp.department || '',
                                                priority: d.deductionDays >= 3 ? 'high' : 'medium',
                                                employeeId: d.employeeId,
                                                problemDescription: d.description,
                                                source: 'automation',
                                                relatedQualityDeductionId: d.id,
                                              },
                                            });
                                          }}
                                        >
                                          <ShieldAlert className="size-3 ml-1" />
                                          <T>إنشاء CAPA</T>
                                        </Button>
                                      )}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}

                        {/* ━━━ §12 INLINE CAPA FORM — opens INSIDE this
                            employee block (directly below the note the
                            action was triggered from), prefilled from the
                            selected quality note. No page navigation. ━━━ */}
                        <AnimatePresence>
                          {canCreateCapa && capaPrefill?.empId === empId && (
                            <InlineFormPanel
                              tone="violet"
                              icon={<ShieldAlert className="size-3.5 text-brand-400" />}
                              title={translateUIText('إنشاء CAPA من خصم الجودة', locale)}
                              onClose={() => setCapaPrefill(null)}
                            >
                              <CAPAInlineForm
                                key={capaPrefill.defaults.relatedQualityDeductionId || JSON.stringify(capaPrefill.defaults)}
                                onClose={() => setCapaPrefill(null)}
                                onCreated={() => {
                                  setCapaPrefill(null);
                                  void fetchData();
                                }}
                                employees={employees}
                                systemUsers={systemUsers}
                                defaultValues={capaPrefill.defaults}
                              />
                            </InlineFormPanel>
                          )}
                        </AnimatePresence>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ═══ Add/Edit Dialog ═══ */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { if (!open) { setIsAddOpen(false); setEditingDeduction(null); } }}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white"><T>{editingDeduction ? 'تعديل خصم جودة' : 'إضافة خصم جودة'}</T></DialogTitle>
            <DialogDescription className="text-slate-400">
              <T>{editingDeduction ? 'عدّل تفاصيل الخصم' : 'أدخل تفاصيل الخصم'}</T> - <T>يتم حساب الشهر تلقائياً من التاريخ</T>
              {!editingDeduction && (
                <span className="block text-amber-400/90 text-[11px] mt-1">
                  <T>{isApprover
                    ? 'سيُحفظ الخصم بحالة «قيد الاعتماد» — يمكنك اعتماده فوراً من قائمة الانتظار أعلى الصفحة.'
                    : 'سيُرسل الخصم بحالة «قيد الاعتماد» ولن يؤثر في التقارير والإجماليات حتى اعتماده من المختصين.'}</T>
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editingDeduction && (
            <div className="sm:col-span-2">
              <EmployeeSearchInput
                employees={employees}
                value={addForm.employeeId}
                onChange={(id) => setAddForm((p) => ({ ...p, employeeId: id }))}
                label={translateUIText('الموظف', locale)}
                placeholder={translateUIText('ابحث عن اسم الموظف...', locale)}
              />
            </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm"><T>التاريخ</T></Label>
              <Input
                value={addForm.date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm"><T>النوع</T></Label>
              <Select
                value={addForm.type}
                onValueChange={(v) => setAddForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality_issue" className="text-white"><T>مشكلة جودة</T></SelectItem>
                  <SelectItem value="safety" className="text-white"><T>سلامة</T></SelectItem>
                  <SelectItem value="compliance" className="text-white"><T>التزام</T></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm"><T>نوع الخصم (بالأيام)</T></Label>
              <Select
                value={addForm.dayPreset}
                onValueChange={(v) => setAddForm((p) => ({ ...p, dayPreset: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAY_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value} className="text-white">
                      <T>{p.label}</T>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addForm.dayPreset === 'custom' && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm"><T>عدد الأيام (مخصص)</T></Label>
                <Input
                  type="number"
                  step="0.25"
                  value={addForm.customDays}
                  onChange={(e) => setAddForm((p) => ({ ...p, customDays: e.target.value }))}
                  className="bg-slate-800 border-slate-600 text-white"
                  placeholder="0.25"
                  dir="ltr"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm"><T>مبلغ الخصم (اختياري)</T></Label>
              <Input
                type="number"
                value={addForm.deductionAmount}
                onChange={(e) => setAddForm((p) => ({ ...p, deductionAmount: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder={translateUIText('اختياري', locale)}
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm"><T>الشهر (تلقائي)</T></Label>
              <Input
                value={addForm.month}
                readOnly
                className="bg-slate-800/50 border-slate-600 text-slate-400"
                placeholder="YYYY-MM"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm"><T>سبب الخصم</T></Label>
              <Textarea
                value={addForm.description}
                onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white resize-none"
                placeholder={translateUIText('اكتب سبب الخصم بالتفصيل...', locale)}
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm"><T>رابط الدليل (اختياري)</T></Label>
              <Input
                value={addForm.evidence}
                onChange={(e) => setAddForm((p) => ({ ...p, evidence: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="https://..."
                dir="ltr"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setIsAddOpen(false); setEditingDeduction(null); }}
              className="border-slate-600 text-slate-300"
            >
              <T>إلغاء</T>
            </Button>
            <Button
              onClick={handleSaveDeduction}
              disabled={saving || !addForm.date}
              className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all"
            >
              <T>{saving ? 'جاري الحفظ...' : (editingDeduction ? 'حفظ التعديل' : 'حفظ')}</T>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Dialog ═══ */}
      {/* ═══ Archive Dialog — unified ConfirmDialog (§4) ═══ */}
      <ConfirmDialog
        open={!!archivingId}
        onOpenChange={(o) => { if (!o) setArchivingId(null); }}
        title={translateUIText('أرشفة الخصم', locale)}
        description={translateUIText('الخصم المؤرشف يصبح سجلاً تاريخياً: لن يحسب في الإجماليات النشطة أو مؤشرات KPI الحالية، ويبقى قابلاً للتدقيق في الأرشيف.', locale)}
        itemName={archivingId ? deductions.find((d: { id: string }) => d.id === archivingId)?.description : undefined}
        confirmLabel={translateUIText('أرشفة', locale)}
        destructive={false}
        loading={archiveLoadingId === archivingId}
        onConfirm={async () => { if (archivingId) await handleArchive(archivingId, true); }}
      />

      {/* ═══ Delete Dialog — unified ConfirmDialog (§4) ═══ */}
      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(open) => { if (!open) setDeletingId(null); }}
        description={translateUIText('هل أنت متأكد من حذف هذا الخصم؟ لا يمكن التراجع عن هذا الإجراء.', locale)}
        itemName={deletingId ? deductions.find((d: { id: string; description?: string }) => d.id === deletingId)?.description : undefined}
        loading={deleteLoading}
        onConfirm={async () => { if (deletingId) await handleDelete(deletingId); }}
      />
    </div>
  );
}
