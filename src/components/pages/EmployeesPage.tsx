'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { useAppStore } from '@/lib/store';
import {
  useEmployees,
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
  useOrgNodesForAssignment,
  useMoveEmployeeOrg,
} from '@/hooks/use-queries';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Archive, UserCircle } from 'lucide-react';
import { SmartActionMenu } from '@/components/shared/SmartActionMenu';
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
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import {
  Upload,
  Search,
  Plus,
  Pencil,
  Trash2,
  Users,
  FileSpreadsheet,
  X,
  Loader2,
  ArrowRightLeft,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import OrgAssignmentPicker from '@/components/shared/OrgAssignmentPicker';
import {
  projectAssignmentForPicker,
  buildNodePathLabel,
  type OrgAssignmentNode,
} from '@/lib/organization/assignment';
import {
  useMarkState,
  useFavoriteToggleAction,
  usePinToggleAction,
} from '@/components/shared/NavigationMarks';
import type { NavigationDescriptor } from '@/lib/personalization';
import { Star, Pin as PinIcon } from 'lucide-react';
import { PageHeaderBar } from '@/components/shared/PageHeaderBar';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS_AR,
  normalizeEmployeeStatus,
  type EmployeeStatus,
} from '@/lib/organization';
import type { Employee } from '@/types';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';

// ── Employee form shape ──
// The free-text department field is GONE: department/team are selected
// from the Organization Tree (OrgAssignmentPicker) and stored as the
// canonical node id — `orgNodeId = teamNodeId ?? departmentId`.
// `departmentId`/`teamNodeId` are FORM-ONLY state and are stripped
// before any API call. The stored display `department` string is
// derived server-side from the selected node at creation and is never
// rewritten here (historical integrity — same doctrine as org moves).
interface EmployeeFormData {
  code: string;
  name: string;
  departmentId: string | null;
  teamNodeId: string | null;
  position: string;
  shiftStart: string;
  shiftEnd: string;
  hireDate: string;
  mobile: string;
  residence: string;
  status: string;
}

const emptyForm: EmployeeFormData = {
  code: '',
  name: '',
  departmentId: null,
  teamNodeId: null,
  position: '',
  shiftStart: '',
  shiftEnd: '',
  hireDate: '',
  mobile: '',
  residence: '',
  status: 'active',
};

/** Canonical org node the current picker state resolves to. */
const pickerOrgNodeId = (f: Pick<EmployeeFormData, 'departmentId' | 'teamNodeId'>): string | null =>
  f.teamNodeId ?? f.departmentId ?? null;

// M0.6-A lifecycle badges (display only)
const STATUS_BADGE_CLASS: Record<EmployeeStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  inactive: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  archived: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

// ═══════════════════════════════════════════════════════════════
//  §3 EMPLOYEE ROW ACTIONS — EVERY action lives inside the ONE
//  SmartActionMenu: View · Edit · Favorite · Pin · Delete. The old
//  external ⭐/📌/👤 buttons are gone (no duplicates, no hidden
//  layout placeholders). The menu reflects CURRENT state:
//    إضافة للمفضلة ⇄ إزالة من المفضلة
//    تثبيت ⇄ إلغاء التثبيت
//  and permission filters items declaratively (hidden flags).
// ═══════════════════════════════════════════════════════════════
const EmployeeRowActions = memo(function EmployeeRowActions({
  emp,
  canOpenEmployee360,
  canUpdate,
  canDelete,
  onOpen360,
  onEdit,
  onDelete,
  onArchive,
}: {
  emp: Employee;
  canOpenEmployee360: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onOpen360: (id: string) => void;
  onEdit: (emp: Employee) => void;
  onDelete: (id: string) => void;
  onArchive: (emp: Employee, archive: boolean) => void;
}) {
  const descriptor = useMemo<NavigationDescriptor>(() => ({
    targetType: 'record',
    targetId: emp.id,
    route: 'employees',
    label: emp.name,
    navigationContext: normalizeEmployeeStatus(emp.status) !== 'active'
      ? { status: normalizeEmployeeStatus(emp.status) }
      : undefined,
  }), [emp.id, emp.name, emp.status]);
  const { favoriteActive, pinActive } = useMarkState(descriptor);
  const toggleFavorite = useFavoriteToggleAction();
  const togglePin = usePinToggleAction();

  return (
    <SmartActionMenu
      label={`إجراءات الموظف ${emp.name}`}
      actions={[
        { key: 'view', label: 'الملف الشخصي', icon: <UserCircle className="size-3.5" />, onSelect: () => onOpen360(emp.id), hidden: !canOpenEmployee360 },
        { key: 'edit', label: 'تعديل', icon: <Pencil className="size-3.5" />, onSelect: () => onEdit(emp), hidden: !canUpdate },
        {
          key: 'favorite',
          label: favoriteActive ? 'إزالة من المفضلة' : 'إضافة للمفضلة',
          icon: <Star className={cn('size-3.5', favoriteActive && 'fill-amber-400 text-amber-400')} />,
          onSelect: () => void toggleFavorite(descriptor),
        },
        {
          key: 'pin',
          label: pinActive ? 'إلغاء التثبيت' : 'تثبيت',
          icon: <PinIcon className={cn('size-3.5', pinActive && 'fill-cyan-400 text-cyan-400')} />,
          onSelect: () => void togglePin(descriptor),
        },
        // §19 — Archive directly from the three-dot menu (with
        // confirmation); restore is offered for archived employees.
        // No "Edit → change status → save" detour.
        {
          key: 'archive',
          label: normalizeEmployeeStatus(emp.status) === 'archived' ? 'استعادة من الأرشيف' : 'أرشفة',
          icon: <Archive className="size-3.5" />,
          onSelect: () => onArchive(emp, normalizeEmployeeStatus(emp.status) !== 'archived'),
          hidden: !canUpdate,
        },
        { key: 'delete', label: 'حذف', icon: <Trash2 className="size-3.5" />, destructive: true, onSelect: () => onDelete(emp.id), hidden: !canDelete },
      ]}
    />
  );
});

export default function EmployeesPage() {
  const { locale } = useLanguage();
  const { canEdit, canCreate, canUpdate, canDelete, canExport, canUpload, canSeeField, canDoAction } = usePermissions('employees');
  const { canViewPage } = usePermissions('employee360');
  const canOpenEmployee360 = canViewPage('employee360');
  // ── ORGANIZATION TRANSFER AUTHORITY (M0.4 separation preserved) ──
  // Editing profile fields is the 'employees' permission; MOVING an
  // employee between org nodes is the privileged organization
  // operation ('organization' update — admin by stock preset). The
  // edit dialog's org picker is editable only for holders; a change
  // is applied through the SAME move route the org page uses.
  const canManageOrg = canDoAction('organization', 'update');
  // Field selectors (NOT selectorless useAppStore()): a selectorless
  // subscription re-renders this whole page on EVERY store write —
  // including the header identity registration this page performs on
  // each render (its icon is a fresh JSX element), which loops into
  // React's maximum update depth.
  const highlightId = useAppStore((s) => s.highlightId);
  const setHighlightId = useAppStore((s) => s.setHighlightId);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);

  // ── React Query: data fetching with automatic caching ──
  const { data: employees = [], isLoading } = useEmployees();
  const createEmployee = useCreateEmployee();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();
  
  // Phase 6.1 (Global Search §8/§13): a deep-linked archived/inactive
  // employee seeds this filter from navParams.status so the exact row
  // is reachable; the store's highlightId row mechanic does the rest.
  const navStatus = useAppStore((s) => s.navParams.status);
  // Phase 6.3 (§8/§43): work context persists per user — an explicit
  // navigation seed (navParams.status) still wins for that mount.
  const [employeesView, setEmployeesView] = usePageState<{
    search: string;
    statusFilter: 'all' | EmployeeStatus;
  }>({
    page: 'employees',
    slot: 'filters',
    version: 1,
    initial: () => ({
      search: '',
      statusFilter:
        navStatus === 'archived' || navStatus === 'inactive' ? navStatus : 'active',
    }),
    skipRestore: navStatus === 'archived' || navStatus === 'inactive',
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { statusFilter?: unknown }).statusFilter === 'string'
        ? (raw as { search: string; statusFilter: 'all' | EmployeeStatus })
        : null,
  });
  const search = employeesView.search;
  const setSearch = (v: string) => setEmployeesView((s) => ({ ...s, search: v }));
  const statusFilter = employeesView.statusFilter;
  const setStatusFilter = (v: 'all' | EmployeeStatus) =>
    setEmployeesView((s) => ({ ...s, statusFilter: v }));
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [form, setForm] = useState<EmployeeFormData>(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Organization assignment data ──
  // Nodes load lazily with the form dialog (one cached request — no
  // per-department reads). The picker derives departments/teams from
  // these nodes with the SAME pure helpers the server validates with.
  const formOpen = isAddOpen || !!editingEmployee;
  const orgNodesQuery = useOrgNodesForAssignment(formOpen);
  const orgNodes: OrgAssignmentNode[] = useMemo(
    () => orgNodesQuery.data?.nodes ?? [],
    [orgNodesQuery.data],
  );
  const moveEmployeeOrg = useMoveEmployeeOrg();
  // Pending organization transfer (edit dialog): captured at save so
  // the ConfirmDialog can gate the privileged move explicitly.
  const [pendingTransfer, setPendingTransfer] = useState<{
    employee: Employee;
    fromNodeId: string | null;
    toNodeId: string | null;
    profilePayload: Record<string, unknown>;
  } | null>(null);
  // M0.6-A addendum §2/§20: the management list defaults to the
  // CURRENT (active) workforce — archived employees "disappear" from
  // the default list and remain reachable through this filter (the
  // archive search view). Nothing is deleted.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);

  // Swipe to delete state
  const [swipeId, setSwipeId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  // Auto-clear highlight after 3 seconds and scroll into view
  useEffect(() => {
    if (!highlightId) return;

    const timer = setTimeout(() => {
      setHighlightId(null);
    }, 3000);

    requestAnimationFrame(() => {
      highlightRowRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    });

    return () => clearTimeout(timer);
  }, [highlightId, setHighlightId]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await authFetch('/api/employees/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        // React Query will auto-invalidate via mutation, but for upload we need manual
        // The mutation onSuccess handles invalidation, so we can just let it refetch
        window.location.reload();
      }
    } catch {
      // Error handled silently
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Form-only org fields never reach an API payload.
  const stripOrgFormFields = (f: EmployeeFormData): Record<string, unknown> => {
    const { departmentId: _d, teamNodeId: _t, ...profile } = f;
    return profile;
  };

  const handleSave = async () => {
    const profilePayload = stripOrgFormFields(form);
    if (editingEmployee) {
      const currentOrgNodeId = editingEmployee.orgNodeId ?? null;
      const requestedOrgNodeId = pickerOrgNodeId(form);
      if (requestedOrgNodeId !== currentOrgNodeId) {
        // ── ORGANIZATION TRANSFER (§7) ── a department/team change on
        // an existing employee is a transfer: profile save + the
        // privileged move, gated by an explicit confirmation.
        if (!canManageOrg) {
          toast.error('نقل الموظف بين العقد التنظيمية يتم من صفحة الهيكل التنظيمي فقط');
          return;
        }
        setPendingTransfer({
          employee: editingEmployee,
          fromNodeId: currentOrgNodeId,
          toNodeId: requestedOrgNodeId,
          profilePayload,
        });
        return;
      }
      updateEmployee.mutate(
        { id: editingEmployee.id, data: profilePayload },
        {
          onSuccess: () => {
            logUpdate('employees', 'موظف', form.name);
            setEditingEmployee(null);
            setIsAddOpen(false);
            setForm(emptyForm);
          },
          // Phase 5.3 (spec §19): a failed lifecycle update (archive/
          // restore) must never masquerade as success — the old silent
          // no-op made the archive regression invisible in the UI.
          onError: (error: Error) => {
            toast.error('فشل حفظ بيانات الموظف', {
              description: error?.message || 'لم يتم حفظ التغييرات — حاول مرة أخرى',
            });
          },
        }
      );
    } else {
      // Creation accepts the canonical node: the server validates it
      // against the live tree and derives the display department.
      createEmployee.mutate(
        { ...profilePayload, orgNodeId: pickerOrgNodeId(form) },
        {
          onSuccess: () => {
            logCreate('employees', 'موظف', form.name);
            setIsAddOpen(false);
            setForm(emptyForm);
          },
          onError: (error: Error) => {
            toast.error('فشل إنشاء الموظف', {
              description: error?.message || 'لم يتم إنشاء الموظف — حاول مرة أخرى',
            });
          },
        },
      );
    }
  };

  // Confirmed transfer: profile fields first, then the privileged
  // move (membership ledger + audit + manager notifications run
  // server-side inside that route).
  const executeConfirmedTransfer = async () => {
    const t = pendingTransfer;
    if (!t) return;
    setPendingTransfer(null);
    try {
      await updateEmployee.mutateAsync({ id: t.employee.id, data: t.profilePayload });
      await moveEmployeeOrg.mutateAsync({ employeeId: t.employee.id, orgNodeId: t.toNodeId });
      toast.success('تم حفظ البيانات ونقل الموظف تنظيمياً');
      logUpdate('employees', 'موظف', t.employee.name);
      setEditingEmployee(null);
      setIsAddOpen(false);
      setForm(emptyForm);
    } catch (error) {
      toast.error('فشل النقل التنظيمي', {
        description: error instanceof Error ? error.message : 'تم حفظ البيانات الأساسية — أعد المحاولة من صفحة الهيكل التنظيمي',
      });
    }
  };

  // Seed the edit form's org selection once the node list arrives
  // (the dialog can open before the lazy fetch resolves).
  const seededEditIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editingEmployee || !orgNodesQuery.isSuccess) return;
    if (seededEditIdRef.current === editingEmployee.id) return;
    seededEditIdRef.current = editingEmployee.id;
    const assignment = projectAssignmentForPicker(orgNodes, editingEmployee.orgNodeId);
    setForm((prev) => ({ ...prev, departmentId: assignment.departmentId, teamNodeId: assignment.teamNodeId }));
  }, [editingEmployee, orgNodesQuery.isSuccess, orgNodes]);

  // §19 — archive/restore straight from the row menu, with the
  // unified ConfirmDialog for the archive step. Uses the SAME
  // updateEmployee mutation as the edit dialog (one lifecycle path).
  const [archivingEmployee, setArchivingEmployee] = useState<Employee | null>(null);
  const openArchiveConfirm = (emp: Employee, archive: boolean) => {
    if (archive) {
      setArchivingEmployee(emp);
      return;
    }
    updateEmployee.mutate(
      { id: emp.id, data: { status: 'active' } },
      {
        onSuccess: () => toast.success('تم استعادة الموظف من الأرشيف'),
        onError: (error: Error) => toast.error('فشل الاستعادة', { description: error?.message }),
      },
    );
  };

  const handleDelete = async (id: string) => {
    const empName = employees.find((e: any) => e.id === id)?.name || '';
    setDeleteLoading(true);
    deleteEmployee.mutate(id, {
      onSuccess: () => {
        logDelete('employees', 'موظف', empName);
        setSwipeId(null);
        setDeletingId(null);
      },
      onSettled: () => setDeleteLoading(false),
    });
  };

  const openEdit = (emp: Employee) => {
    seededEditIdRef.current = null;
    setEditingEmployee(emp);
    setForm({
      ...emptyForm,
      code: emp.code || '',
      name: emp.name,
      position: emp.position || '',
      shiftStart: emp.shiftStart || '',
      shiftEnd: emp.shiftEnd || '',
      hireDate: emp.hireDate || '',
      mobile: emp.mobile || '',
      residence: (emp as any).residence || '',
      status: normalizeEmployeeStatus(emp.status),
    });
  };

  const filtered = employees.filter(
    (emp: any) =>
      emp.name.toLowerCase().includes(search.toLowerCase()) ||
      (emp.code || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.department || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.position || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.residence || '').toLowerCase().includes(search.toLowerCase()) ||
      (emp.mobile || '').toLowerCase().includes(search.toLowerCase())
  ).filter((emp: any) =>
    statusFilter === 'all' || normalizeEmployeeStatus(emp.status) === statusFilter
  );

  // Touch handlers for swipe-to-delete (RTL: swipe left means swipe right visually)
  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    touchStartX.current = e.touches[0].clientX;
    touchCurrentX.current = e.touches[0].clientX;
    setSwipeId(null);
  };

  const handleTouchMove = (e: React.TouchEvent, id: string) => {
    if (touchStartX.current === null) return;
    touchCurrentX.current = e.touches[0].clientX;
    const diff = touchStartX.current - touchCurrentX.current;
    if (diff < -60) {
      setSwipeId(id);
    } else {
      setSwipeId(null);
    }
  };

  const handleTouchEnd = () => {
    touchStartX.current = null;
    touchCurrentX.current = null;
  };

  const updateForm = useCallback((field: keyof EmployeeFormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const isSaving = createEmployee.isPending || updateEmployee.isPending;

  const renderFormDialog = (title: string, open: boolean, onOpenChange: (v: boolean) => void) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400"><T>أدخل بيانات الموظف</T></DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-slate-300"><T>كود الموظف</T></Label>
            <Input
              value={form.code}
              onChange={(e) => updateForm('code', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="EMP-001"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>الاسم</T></Label>
            <Input
              value={form.name}
              onChange={(e) => updateForm('name', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              required
            />
          </div>
          <OrgAssignmentPicker
            nodes={orgNodes}
            departmentId={form.departmentId}
            teamNodeId={form.teamNodeId}
            onDepartmentChange={(departmentId, teamNodeId) =>
              setForm((prev) => ({ ...prev, departmentId, teamNodeId }))
            }
            onTeamChange={(teamNodeId) => setForm((prev) => ({ ...prev, teamNodeId }))}
            disabled={!!editingEmployee && !canManageOrg}
          />
          {editingEmployee && (
            <div className="sm:col-span-2 space-y-1">
              <p className="text-[10px] text-slate-500">
                <T>الإسناد الحالي:</T>{' '}
                <span className="text-slate-300">
                  {editingEmployee.orgNodeId
                    ? (buildNodePathLabel(orgNodes, editingEmployee.orgNodeId) || 'عقدة تنظيمية')
                    : 'بدون إسناد تنظيمي'}
                </span>
              </p>
              {(() => {
                const requested = pickerOrgNodeId(form);
                const changed = requested !== (editingEmployee.orgNodeId ?? null);
                if (!changed) return null;
                if (canManageOrg) {
                  return (
                    <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
                      <ArrowRightLeft className="size-3 shrink-0" />
                      <T>تغيير الإسناد = نقل تنظيمي — سيُطلب التأكيد عند الحفظ</T>
                    </p>
                  );
                }
                return (
                  <p className="text-[10px] text-slate-500">
                    <T>للعرض فقط — نقل الموظف بين العقد يتم من صفحة الهيكل التنظيمي</T>
                  </p>
                );
              })()}
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-300"><T>الوظيفة</T></Label>
            <Input
              value={form.position}
              onChange={(e) => updateForm('position', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>بداية الدوام</T></Label>
            <Input
              value={form.shiftStart}
              onChange={(e) => updateForm('shiftStart', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="08:00"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>نهاية الدوام</T></Label>
            <Input
              value={form.shiftEnd}
              onChange={(e) => updateForm('shiftEnd', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="17:00"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>تاريخ التعيين</T></Label>
            <Input
              value={form.hireDate}
              onChange={(e) => updateForm('hireDate', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="DD/MM/YYYY"
              dir="ltr"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-300"><T>رقم الموبايل</T></Label>
            <Input
              value={form.mobile}
              onChange={(e) => updateForm('mobile', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="01XXXXXXXXX"
              dir="ltr"
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label className="text-slate-300"><T>مكان الإقامة</T></Label>
            <Input
              value={form.residence}
              onChange={(e) => updateForm('residence', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder={translateUIText('المدينة / المنطقة — قابلة للبحث', locale)}
            />
          </div>
          {editingEmployee && (
            <div className="space-y-2">
              <Label className="text-slate-300"><T>حالة الموظف</T></Label>
              {/* M0.6-A lifecycle: deactivation preserves the employee and all history */}
              <Select value={form.status} onValueChange={(v) => updateForm('status', v)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EMPLOYEE_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="text-white">
                      {EMPLOYEE_STATUS_LABELS_AR[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setForm(emptyForm);
              setEditingEmployee(null);
            }}
            className="border-slate-600 text-slate-300"
          >
            <T>إلغاء</T>
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving || !form.name}
            className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all"
          >
            {isSaving ? (
              <><Loader2 className="size-4 animate-spin" /><T> جاري الحفظ...</T></>
            ) : 'حفظ'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className="space-y-6">
      {/* Header (§25/§26 — sticky, primary action always accessible) */}
      <PageHeaderBar
        icon={<Users className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        title={translateUIText('إدارة الموظفين', locale)}
        description={`${filtered.length} من ${employees.length} موظف`}
        primaryAction={canCreate ? {
          label: 'إضافة موظف',
          onClick: () => {
            setForm(emptyForm);
            setEditingEmployee(null);
            setIsAddOpen(true);
          },
        } : undefined}
        actions={canUpload ? (
          <>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="border-slate-600 text-slate-300 hover:bg-slate-700"
            >
              {uploading ? (
                <><Loader2 className="size-4 animate-spin" /><T> جاري الرفع...</T></>
              ) : (
                <>
                  <Upload className="size-4" />
                  <T>رفع Excel</T>
                </>
              )}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUpload}
              className="hidden"
            />
          </>
        ) : undefined}
      />

      {/* Search + M0.6-A lifecycle filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[240px]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <Input
          placeholder={translateUIText('بحث بالاسم، الكود، القسم، الوظيفة، أو الموبايل...', locale)}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-600 text-white pr-10 placeholder:text-slate-500"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
          >
            <X className="size-4" />
          </button>
        )}
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'all' | EmployeeStatus)}>
          <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-32 h-10 text-sm">
            <SelectValue placeholder={translateUIText('الحالة', locale)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white"><T>كل الحالات</T></SelectItem>
            {EMPLOYEE_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-white">
                {EMPLOYEE_STATUS_LABELS_AR[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-slate-800 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileSpreadsheet className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium"><T>لا يوجد موظفون</T></p>
            <p className="text-slate-500 text-sm mt-1">
              {search ? 'لم يتم العثور على نتائج' : 'ابدأ بإضافة موظفين جدد'}
            </p>
          </CardContent>
        </Card>
      ) : (
        /* Table */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-sm font-medium"><T>الكود</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium"><T>الاسم</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden sm:table-cell"><T>القسم</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden md:table-cell"><T>الوظيفة</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden lg:table-cell"><T>الإقامة</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden xl:table-cell"><T>الدوام</T></TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden xl:table-cell"><T>الموبايل</T></TableHead>
                  {/* §3 — the actions column renders for every viewer: the
                      menu holds personal marks (⭐/📌) too, not just
                      update/delete actions. */}
                  <TableHead className="text-slate-400 text-sm font-medium"><T>إجراءات</T></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((emp: any) => {
                  const isHighlighted = emp.id === highlightId;
                  return (
                    <TableRow
                      key={emp.id}
                      ref={isHighlighted ? highlightRowRef : undefined}
                      className={`border-slate-700/50 hover:bg-slate-700/30 relative transition-all duration-500 ${
                        isHighlighted ? 'ring-2 ring-blue-500 bg-blue-500/5' : ''
                      }`}
                      onTouchStart={(e) => handleTouchStart(e, emp.id)}
                      onTouchMove={(e) => handleTouchMove(e, emp.id)}
                      onTouchEnd={handleTouchEnd}
                    >
                      <TableCell className="font-mono text-sm" dir="ltr">
                        <EmployeeLink employeeId={emp.id} code={emp.code || '—'} compact hideAvatar textClassName="text-blue-400" />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 flex-wrap">
                          <EmployeeLink employeeId={emp.id} name={emp.name} department={emp.department} />
                          {(() => {
                            const st = normalizeEmployeeStatus(emp.status);
                            return (
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] leading-none ${STATUS_BADGE_CLASS[st]}`}
                              >
                                {EMPLOYEE_STATUS_LABELS_AR[st]}
                              </span>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="text-slate-300 hidden sm:table-cell">{emp.department || '—'}</TableCell>
                      <TableCell className="text-slate-300 hidden md:table-cell">{emp.position || '—'}</TableCell>
                      <TableCell className="text-slate-300 hidden lg:table-cell">{emp.residence || '—'}</TableCell>
                      <TableCell className="text-slate-300 hidden xl:table-cell" dir="ltr">
                        {emp.shiftStart && emp.shiftEnd ? `${emp.shiftStart} - ${emp.shiftEnd}` : '—'}
                      </TableCell>
                      <TableCell className="text-slate-300 hidden xl:table-cell" dir="ltr">
                        {canSeeField('employees', 'mobile') ? emp.mobile || '—' : '—'}
                      </TableCell>
                      <TableCell>
                        {/* §3 — ALL row actions inside the ONE SmartActionMenu
                            (view/edit/favorite/pin/delete). No external
                            duplicate buttons remain; the menu reflects the
                            current favorite/pin state and the caller's
                            permissions. */}
                        <EmployeeRowActions
                          emp={emp}
                          canOpenEmployee360={canOpenEmployee360}
                          canUpdate={canUpdate}
                          canDelete={canDelete}
                          onOpen360={openEmployee360}
                          onEdit={openEdit}
                          onDelete={setDeletingId}
                          onArchive={openArchiveConfirm}
                        />
                      </TableCell>
                      {/* Swipe delete indicator (mobile) */}
                      <AnimatePresence>
                        {swipeId === emp.id && (
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: 80 }}
                            exit={{ width: 0 }}
                            className="absolute left-0 top-0 h-full bg-red-500 flex items-center justify-center sm:hidden"
                            style={{ position: 'absolute' }}
                          >
                            <Trash2 className="size-5 text-white" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Add Dialog */}
      {renderFormDialog('إضافة موظف جديد', isAddOpen, setIsAddOpen)}

      {/* Edit Dialog */}
      {renderFormDialog(
        `تعديل بيانات ${editingEmployee?.name}`,
        !!editingEmployee,
        (v) => {
          if (!v) setEditingEmployee(null);
        }
      )}

      {/* §19 Archive Confirm Dialog — non-destructive (history kept) */}
      <ConfirmDialog
        open={!!archivingEmployee}
        onOpenChange={(o) => { if (!o) setArchivingEmployee(null); }}
        title={translateUIText('أرشفة الموظف', locale)}
        description={translateUIText('سيصبح الموظف مؤرشفاً: لن يظهر في القوائم النشطة، ويبقى سجله التاريخي كاملاً قابلاً للاستعادة والتدقيق.', locale)}
        itemName={archivingEmployee?.name}
        confirmLabel={translateUIText('أرشفة', locale)}
        destructive={false}
        loading={updateEmployee.isPending}
        onConfirm={() => {
          if (!archivingEmployee) return;
          const emp = archivingEmployee;
          setArchivingEmployee(null);
          updateEmployee.mutate(
            { id: emp.id, data: { status: 'archived' } },
            {
              onSuccess: () => toast.success('تم أرشفة الموظف'),
              onError: (error: Error) => toast.error('فشل أرشفة الموظف', { description: error?.message }),
            },
          );
        }}
      />

      {/* ── Organization transfer confirm (edit dialog, §7/§13) ──
              An already-assigned employee is NEVER moved silently:
              the explicit confirmation names both nodes before the
              privileged move route runs. */}
      <ConfirmDialog
        open={!!pendingTransfer}
        onOpenChange={(o) => { if (!o) setPendingTransfer(null); }}
        title={translateUIText('تأكيد النقل التنظيمي', locale)}
        description={`سيُنقل الموظف من "${
          pendingTransfer?.fromNodeId
            ? (buildNodePathLabel(orgNodes, pendingTransfer.fromNodeId) || 'عقدة تنظيمية')
            : 'بدون إسناد'
        }" إلى "${
          pendingTransfer?.toNodeId
            ? (buildNodePathLabel(orgNodes, pendingTransfer.toNodeId) || 'عقدة تنظيمية')
            : 'بدون إسناد'
        }". نطاق بياناته يتحدث تلقائياً، ولا يمس النقل أي سجل تاريخي.`}
        itemName={pendingTransfer?.employee.name}
        confirmLabel={translateUIText('تأكيد النقل', locale)}
        loading={updateEmployee.isPending || moveEmployeeOrg.isPending}
        onConfirm={() => void executeConfirmedTransfer()}
      />

      {/* Delete Confirm Dialog — unified ConfirmDialog (§4) */}
      <ConfirmDialog
        open={!!deletingId || !!swipeId}
        onOpenChange={(open) => { if (!open) { setDeletingId(null); setSwipeId(null); } }}
        description={translateUIText('هل أنت متأكد من حذف هذا الموظف؟ لا يمكن التراجع عن هذا الإجراء.', locale)}
        itemName={(() => { const id = deletingId || swipeId; return id ? employees.find((e: { id: string; name?: string }) => e.id === id)?.name : undefined; })()}
        loading={deleteLoading}
        onConfirm={async () => { const id = deletingId || swipeId; if (id) await handleDelete(id); }}
      />
    </div>
  );
}
