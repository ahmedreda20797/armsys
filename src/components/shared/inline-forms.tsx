'use client';

// ══════════════════════════════════════════════════════════════
//  InlineForms — REAL forms for inline action surfaces (PHASE 1)
//
//  These are the actual create/edit forms mounted inside
//  HomeQuickActionHost and other inline contexts. They are full
//  functional duplicates of the corresponding page-level create
//  dialogs (CAPA / Complaints / Employees / FollowUps / Requests /
//  Observations) — every field, the same validation, the same
//  TanStack mutation, the same toast, the same invalidation keys.
//
//  REUSE-FIRST PRINCIPLE: the page-level dialogs already use the
//  existing primitives (Dialog/Input/Select/EmployeeSearchInput/
//  UserSearchInput). These inline forms do not introduce new
//  primitives or parallel APIs. The page dialogs remain the
//  canonical entry from their own pages; the inline host is a
//  pure rendering context (no modal shell, no overlay, no nav).
// ══════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDomain } from '@/lib/cache/invalidation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { logCreate } from '@/lib/activity-logger';
import { useAuth } from '@/contexts/AuthContext';
import type { Employee } from '@/types';
import { EMPLOYEE_STATUS_LABELS_AR, EMPLOYEE_STATUSES } from '@/lib/organization/employee-status';
import { PRIORITY_OPTIONS, DEPARTMENTS, SOURCE_OPTIONS } from '@/lib/capa-constants';
import { addDays } from '@/lib/date-utils';

/* ── Shared types ── */
interface SystemUser { id: string; name: string; email?: string; role?: string; }

/* ══════════════════════════════════════════════════════════════ */
/*  CONSTANTS — same vocabulary as the page-level dialogs        */
/* ══════════════════════════════════════════════════════════════ */

const COMPLAINT_TYPES = [
  { value: 'service_quality', label: 'جودة الخدمة' },
  { value: 'pricing_error', label: 'خطأ في التسعير' },
  { value: 'communication', label: 'تواصل' },
  { value: 'delay', label: 'تأخير' },
  { value: 'product_issue', label: 'مشكلة في المنتج' },
  { value: 'other', label: 'أخرى' },
];

const COMPLAINT_SEVERITY = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'critical', label: 'حرج' },
];

const COMPLAINT_STATUS = [
  { value: 'open', label: 'مفتوح' },
  { value: 'investigating', label: 'قيد التحقيق' },
  { value: 'pending_resolution', label: 'بانتظار الحل' },
  { value: 'resolved', label: 'تم الحل' },
  { value: 'closed', label: 'مغلقة' },
];

const REQUEST_TYPES = [
  { value: 'leave', label: 'إجازة' },
  { value: 'permission', label: 'استئذان' },
  { value: 'excuse', label: 'غياب' },
  { value: 'tardiness', label: 'تأخير' },
  { value: 'remote', label: 'ريموتلي' },
];

const FOLLOWUP_TYPES = [
  { value: 'quality', label: 'مشكلة جودة' },
  { value: 'attendance', label: 'مشكلة حضور' },
  { value: 'behavior', label: 'مشكلة سلوك' },
  { value: 'productivity', label: 'مشكلة أداء' },
  { value: 'training', label: 'تدريب' },
  { value: 'coaching', label: 'توجيه / Coaching' },
  { value: 'complaint', label: 'شكوى عميل' },
  { value: 'positive', label: 'ملاحظة إيجابية' },
  { value: 'improvement', label: 'فرصة تحسين' },
  { value: 'other', label: 'أخرى' },
];

const FOLLOWUP_PRIORITY = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'critical', label: 'حرج' },
];

const OBSERVATION_TYPES = [
  { value: 'quality_observation', label: 'ملاحظة جودة' },
  { value: 'behavior', label: 'سلوك' },
  { value: 'attendance', label: 'حضور' },
  { value: 'productivity', label: 'إنتاجية' },
];

const OBSERVATION_SEVERITY = [
  { value: 'low', label: 'منخفض' },
  { value: 'medium', label: 'متوسط' },
  { value: 'high', label: 'عالي' },
  { value: 'critical', label: 'حرج' },
];

/* ══════════════════════════════════════════════════════════════ */
/*  EMPLOYEE INLINE FORM                                       */
/* ══════════════════════════════════════════════════════════════ */

interface EmployeeFormState {
  code: string; name: string; department: string; position: string;
  shiftStart: string; shiftEnd: string; hireDate: string;
  mobile: string; residence: string; status: string;
}

const EMPLOYEE_EMPTY: EmployeeFormState = {
  code: '', name: '', department: '', position: '',
  shiftStart: '', shiftEnd: '', hireDate: '',
  mobile: '', residence: '', status: 'active',
};

export function EmployeeInlineForm({ onClose, employees, onCreated }: {
  onClose: () => void;
  employees: Employee[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<EmployeeFormState>(EMPLOYEE_EMPTY);
  const [saving, setSaving] = useState(false);
  const upd = (k: keyof EmployeeFormState, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          createdBy: user?.id || 'system',
          createdByName: user?.name || 'النظام',
        }),
      });
      if (res.ok) {
        logCreate('employees', 'موظف', form.name);
        toast.success('تم إضافة الموظف بنجاح');
        // Canonical invalidation (fixes the old ['home-stats'] dead key):
        // employees surfaces + the Home aggregate update together.
        invalidateDomain(qc, 'employees');
        onCreated();
      } else {
        toast.error('فشل في إضافة الموظف');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">كود الموظف</Label>
          <Input value={form.code} onChange={(e) => upd('code', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="EMP-001" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الاسم *</Label>
          <Input value={form.name} onChange={(e) => upd('name', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" required autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">القسم</Label>
          <Input value={form.department} onChange={(e) => upd('department', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الوظيفة</Label>
          <Input value={form.position} onChange={(e) => upd('position', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">بداية الدوام</Label>
          <Input value={form.shiftStart} onChange={(e) => upd('shiftStart', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="08:00" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">نهاية الدوام</Label>
          <Input value={form.shiftEnd} onChange={(e) => upd('shiftEnd', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="17:00" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">تاريخ التعيين</Label>
          <Input value={form.hireDate} onChange={(e) => upd('hireDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="DD/MM/YYYY" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">رقم الموبايل</Label>
          <Input value={form.mobile} onChange={(e) => upd('mobile', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="01XXXXXXXXX" dir="ltr" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">مكان الإقامة</Label>
          <Input value={form.residence} onChange={(e) => upd('residence', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="المدينة / المنطقة" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">حالة الموظف</Label>
          <Select value={form.status} onValueChange={(v) => upd('status', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {EMPLOYEE_STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="text-white">{EMPLOYEE_STATUS_LABELS_AR[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-brand-600 hover:bg-brand-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          إضافة الموظف
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*  COMPLAINT INLINE FORM                                       */
/* ══════════════════════════════════════════════════════════════ */

interface ComplaintFormState {
  customerName: string; customerContact: string; dealId: string;
  employeeId: string; complaintType: string; description: string;
  severity: string; status: string; resolution: string;
  responsiblePersonId: string; compensation: string;
}

const COMPLAINT_EMPTY: ComplaintFormState = {
  customerName: '', customerContact: '', dealId: '', employeeId: '',
  complaintType: 'service_quality', description: '', severity: 'medium',
  status: 'open', resolution: '', responsiblePersonId: '', compensation: '',
};

export function ComplaintInlineForm({ onClose, employees, systemUsers, onCreated, defaultValues, sourceContext }: {
  onClose: () => void;
  employees: Employee[];
  systemUsers: SystemUser[];
  onCreated: () => void;
  /** prefill from a triggering context (Travel deal, …) */
  defaultValues?: Partial<ComplaintFormState>;
  /** audit-trail source (e.g. { page: 'travel', recordId }) — mirrors
   *  the ComplaintsPage sourceContext contract so the created record
   *  carries the same traceability no matter where the form opened. */
  sourceContext?: { page: string; recordId: string };
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<ComplaintFormState>(() => ({ ...COMPLAINT_EMPTY, ...defaultValues }));
  const [saving, setSaving] = useState(false);
  const upd = <K extends keyof ComplaintFormState>(k: K, v: ComplaintFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.customerName.trim() && form.description.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        customerName: form.customerName.trim(),
        customerContact: form.customerContact.trim() || null,
        dealId: form.dealId.trim() || null,
        employeeId: form.employeeId || null,
        description: form.description.trim(),
        resolution: form.resolution.trim() || null,
        compensationProvided: form.compensation.trim() || null,
        responsiblePerson: form.responsiblePersonId || '',
        createdBy: user?.id || 'system',
      };
      // Same source trace the ComplaintsPage writes (Milestone 7 §7).
      if (sourceContext?.recordId) {
        payload.sourcePage = sourceContext.page;
        payload.sourceRecordId = sourceContext.recordId;
      }
      const res = await authFetch('/api/complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        logCreate('complaints', 'شكوى عميل', `${form.customerName} - ${form.description.substring(0, 50)}`);
        toast.success('تم إضافة الشكوى بنجاح');
        // Canonical invalidation (fixes the old ['home-stats'] dead key).
        invalidateDomain(qc, 'complaints');
        onCreated();
      } else {
        toast.error('فشل في إضافة الشكوى');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">اسم العميل *</Label>
          <Input value={form.customerName} onChange={(e) => upd('customerName', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">بيانات الاتصال</Label>
          <Input value={form.customerContact} onChange={(e) => upd('customerContact', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="رقم أو بريد" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">رقم الصفقة</Label>
          <Input value={form.dealId} onChange={(e) => upd('dealId', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="اختياري" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الموظف المسؤول</Label>
          <EmployeeSearchInput employees={employees} value={form.employeeId} onChange={(id) => upd('employeeId', id)} placeholder="اختياري" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">نوع الشكوى</Label>
          <Select value={form.complaintType} onValueChange={(v) => upd('complaintType', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPLAINT_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الخطورة</Label>
          <Select value={form.severity} onValueChange={(v) => upd('severity', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPLAINT_SEVERITY.map((s) => <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الوصف *</Label>
          <Textarea value={form.description} onChange={(e) => upd('description', e.target.value)} rows={3} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" placeholder="وصف الشكوى..." />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الحل</Label>
          <Textarea value={form.resolution} onChange={(e) => upd('resolution', e.target.value)} rows={2} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" placeholder="اختياري" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">المسؤول</Label>
          <UserSearchInput users={systemUsers} value={form.responsiblePersonId} onChange={(id) => upd('responsiblePersonId', id)} placeholder="ابحث عن مستخدم..." allowClear clearLabel="— بدون —" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-rose-600 hover:bg-rose-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          إضافة الشكوى
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*  FOLLOW-UP INLINE FORM                                       */
/* ══════════════════════════════════════════════════════════════ */

interface FollowUpFormState {
  employeeId: string; date: string; followUpType: string; subject: string;
  detailedDescription: string; priorityLevel: string; responsiblePerson: string;
  nextFollowUpDate: string;
}

const FOLLOWUP_EMPTY = (): FollowUpFormState => ({
  employeeId: '',
  date: new Date().toISOString().split('T')[0],
  followUpType: 'quality',
  subject: '',
  detailedDescription: '',
  priorityLevel: 'medium',
  responsiblePerson: '',
  // Same default as the page-level dialog: follow-up date = today + 7.
  nextFollowUpDate: addDays(new Date().toISOString().split('T')[0], 7),
});

export function FollowUpInlineForm({ onClose, employees, systemUsers, onCreated }: {
  onClose: () => void;
  employees: Employee[];
  systemUsers: SystemUser[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<FollowUpFormState>(FOLLOWUP_EMPTY());
  const [saving, setSaving] = useState(false);
  const upd = <K extends keyof FollowUpFormState>(k: K, v: FollowUpFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  // Same date→next-follow-up behavior as the page dialog: changing the
  // record date re-seeds the next follow-up to date + 7 (still editable).
  const handleDateChange = (date: string) =>
    setForm((p) => ({ ...p, date, nextFollowUpDate: addDays(date, 7) }));

  // Auto-fill department/position when employee is selected
  const selectedEmployee = useMemo(
    () => employees.find((e) => e.id === form.employeeId),
    [employees, form.employeeId],
  );

  const canSave = form.employeeId && form.date && form.subject.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/follow-ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          department: selectedEmployee?.department || '',
          position: selectedEmployee?.position || '',
          status: 'open',
          // Same fallback contract as the page dialog — the field is
          // ALWAYS saved so the record shows up in due/overdue alerts.
          nextFollowUpDate: form.nextFollowUpDate || addDays(form.date, 7),
          createdBy: user?.id || 'system',
        }),
      });
      if (res.ok) {
        logCreate('followUps', 'متابعة', form.subject);
        toast.success('تم إضافة المتابعة بنجاح');
        // Canonical invalidation (fixes the old ['home-stats'] dead key):
        // Home's today's-follow-ups metric updates (§18/§38).
        invalidateDomain(qc, 'followUps', { employeeId: form.employeeId });
        onCreated();
      } else {
        toast.error('فشل في إضافة المتابعة');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الموظف *</Label>
          <EmployeeSearchInput employees={employees} value={form.employeeId} onChange={(id) => upd('employeeId', id)} placeholder="ابحث عن موظف..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">التاريخ *</Label>
          <Input type="date" value={form.date} onChange={(e) => handleDateChange(e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">نوع المتابعة *</Label>
          <Select value={form.followUpType} onValueChange={(v) => upd('followUpType', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FOLLOWUP_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الموضوع *</Label>
          <Input value={form.subject} onChange={(e) => upd('subject', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="مثال: تأخر متكرر..." />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">التفاصيل *</Label>
          <Textarea value={form.detailedDescription} onChange={(e) => upd('detailedDescription', e.target.value)} rows={3} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الأولوية</Label>
          <Select value={form.priorityLevel} onValueChange={(v) => upd('priorityLevel', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {FOLLOWUP_PRIORITY.map((p) => <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">المسؤول</Label>
          <UserSearchInput users={systemUsers} value={form.responsiblePerson} onChange={(id) => upd('responsiblePerson', id)} placeholder="ابحث عن مستخدم..." allowClear clearLabel="— بدون —" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">المتابعة القادمة</Label>
          <Input
            type="date"
            value={form.nextFollowUpDate}
            onChange={(e) => upd('nextFollowUpDate', e.target.value)}
            className="bg-slate-800 border-slate-600 text-white h-9 text-sm"
            dir="ltr"
          />
          <p className="text-[10px] text-slate-500">افتراضياً بعد ٧ أيام من التاريخ — عدّلها عند الحاجة.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-cyan-600 hover:bg-cyan-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          إضافة المتابعة
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*  REQUEST INLINE FORM                                         */
/* ══════════════════════════════════════════════════════════════ */

interface RequestFormState {
  employeeId: string; type: string; date: string; reason: string;
}

const REQUEST_EMPTY: RequestFormState = {
  employeeId: '', type: 'leave',
  date: new Date().toISOString().split('T')[0], reason: '',
};

export function RequestInlineForm({ onClose, employees, onCreated }: {
  onClose: () => void;
  employees: Employee[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<RequestFormState>(REQUEST_EMPTY);
  const [saving, setSaving] = useState(false);
  const upd = <K extends keyof RequestFormState>(k: K, v: RequestFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.employeeId && form.date && form.reason.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          createdBy: user?.id || 'system',
        }),
      });
      if (res.ok) {
        logCreate('requests', 'طلب', form.type);
        toast.success('تم تقديم الطلب بنجاح');
        // Canonical invalidation (fixes the old ['home-stats'] dead key).
        invalidateDomain(qc, 'requests');
        onCreated();
      } else {
        toast.error('فشل في تقديم الطلب');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الموظف *</Label>
          <EmployeeSearchInput employees={employees} value={form.employeeId} onChange={(id) => upd('employeeId', id)} placeholder="ابحث عن موظف..." />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">نوع الطلب</Label>
          <Select value={form.type} onValueChange={(v) => upd('type', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {REQUEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value} className="text-white">{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">التاريخ *</Label>
          <Input type="date" value={form.date} onChange={(e) => upd('date', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" dir="ltr" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">السبب *</Label>
          <Textarea value={form.reason} onChange={(e) => upd('reason', e.target.value)} rows={3} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-brand-600 hover:bg-brand-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          تقديم الطلب
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*  OBSERVATION INLINE FORM                                     */
/* ══════════════════════════════════════════════════════════════ */

interface ObservationFormState {
  employeeId: string; observationDate: string; type: string;
  categoryId: string; severity: string; notes: string; evidence: string;
  applyPoints: boolean; points: number | ''; isBonus: boolean;
  categories: Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>;
}

const OBSERVATION_EMPTY = (categories: ObservationFormState['categories']): ObservationFormState => ({
  employeeId: '',
  observationDate: new Date().toLocaleDateString('en-GB'),
  type: 'quality_observation',
  categoryId: '',
  severity: 'medium',
  notes: '',
  evidence: '',
  applyPoints: true,
  points: '',
  isBonus: false,
  categories,
});

export function ObservationInlineForm({ onClose, employees, categories, onCreated }: {
  onClose: () => void;
  employees: Employee[];
  categories: Array<{ id: string; name: string; defaultPointValue: number; isBonusDefault: boolean }>;
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<ObservationFormState>(() => OBSERVATION_EMPTY(categories));
  const [saving, setSaving] = useState(false);
  const upd = <K extends keyof ObservationFormState>(k: K, v: ObservationFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.employeeId && form.categoryId && form.type;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/quality-observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: form.employeeId,
          observationDate: form.observationDate,
          type: form.type,
          categoryId: form.categoryId,
          severity: form.severity,
          notes: form.notes,
          evidence: form.evidence,
          applyPointDeduction: form.applyPoints,
          points: form.applyPoints ? (form.points === '' ? undefined : form.points) : 0,
          isBonus: form.applyPoints ? form.isBonus : false,
          createdBy: user?.id || 'system',
          clientRequestId: `obs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      if (res.ok) {
        logCreate('observations', 'ملاحظة', form.employeeId);
        toast.success('تم إنشاء الملاحظة بنجاح');
        // Canonical invalidation (fixes the old ['observations'] and
        // ['home-stats'] dead keys): KPI surfaces, legacy quality view,
        // Home aggregate, risk + this employee's 360 (§20).
        invalidateDomain(qc, 'qualityObservations', { employeeId: form.employeeId });
        onCreated();
      } else {
        toast.error('فشل في إنشاء الملاحظة');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  function applyCategoryDefaults(catId: string) {
    const cat = form.categories.find((c) => c.id === catId);
    if (!cat) return;
    setForm((p) => ({
      ...p,
      categoryId: catId,
      points: cat.defaultPointValue,
      isBonus: cat.isBonusDefault,
    }));
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الموظف *</Label>
          <EmployeeSearchInput
            employees={employees}
            value={form.employeeId}
            onChange={(id) => upd('employeeId', id)}
            placeholder="ابحث عن موظف..."
            showDepartment
            showPosition
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">التاريخ *</Label>
          <Input value={form.observationDate} onChange={(e) => upd('observationDate', e.target.value)} className="bg-slate-800 border-slate-600 text-white h-9 text-sm" placeholder="DD/MM/YYYY" dir="ltr" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">التصنيف *</Label>
          <Select value={form.categoryId} onValueChange={applyCategoryDefaults}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
            <SelectContent>
              {categories.map((c) => <SelectItem key={c.id} value={c.id} className="text-white">{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الخطورة</Label>
          <Select value={form.severity} onValueChange={(v) => upd('severity', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OBSERVATION_SEVERITY.map((s) => <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الملاحظات</Label>
          <Textarea value={form.notes} onChange={(e) => upd('notes', e.target.value)} rows={2} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">الأدلة</Label>
          <Textarea value={form.evidence} onChange={(e) => upd('evidence', e.target.value)} rows={1} className="bg-slate-800 border-slate-600 text-white text-sm resize-none" />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-brand-600 hover:bg-brand-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          إنشاء الملاحظة
        </Button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
/*  CAPA INLINE FORM — same shape as CAPAQuickCreate, no modal  */
/* ══════════════════════════════════════════════════════════════ */

export interface CapaInlineFormState {
  title: string;
  department: string;
  priority: string;
  employeeId: string;
  assignedTo: string;
  source: string;
  problemDescription: string;
  // §12 GLOBAL INLINE FORM STANDARD — cross-module linking carried
  // from the triggering record (quality deduction / follow-up /
  // complaint / HR deduction). Same contract as CAPAQuickCreate so a
  // CAPA created inline from another page keeps its audit link.
  relatedFollowUpId?: string;
  relatedComplaintId?: string;
  relatedQualityDeductionId?: string;
  relatedHrDeductionId?: string;
}

const CAPA_INLINE_EMPTY: CapaInlineFormState = {
  title: '',
  department: '',
  priority: 'medium',
  employeeId: '',
  assignedTo: '',
  source: 'manual',
  problemDescription: '',
};

export function CAPAInlineForm({ onClose, employees, systemUsers, onCreated, defaultValues }: {
  onClose: () => void;
  employees: Employee[];
  systemUsers: SystemUser[];
  /** called after a successful create with the new CAPA case id
   *  (backward-compatible: existing callers may ignore the arg). */
  onCreated: (id?: string) => void;
  defaultValues?: Partial<CapaInlineFormState>;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState<CapaInlineFormState>(() => ({ ...CAPA_INLINE_EMPTY, ...defaultValues }));
  const [saving, setSaving] = useState(false);
  const upd = <K extends keyof CapaInlineFormState>(k: K, v: CapaInlineFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const canSave = form.title.trim() && form.department && form.assignedTo && form.problemDescription.trim();

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        createdBy: user?.id || 'system',
        createdByName: user?.name || 'النظام',
      };
      // Preserve cross-module linking from defaults (parity with
      // CAPAQuickCreate — the API persists these link columns).
      if (form.relatedFollowUpId) payload.relatedFollowUpId = form.relatedFollowUpId;
      if (form.relatedComplaintId) payload.relatedComplaintId = form.relatedComplaintId;
      if (form.relatedQualityDeductionId) payload.relatedQualityDeductionId = form.relatedQualityDeductionId;
      if (form.relatedHrDeductionId) payload.relatedHrDeductionId = form.relatedHrDeductionId;
      const res = await authFetch('/api/capa-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const created = await res.json().catch(() => null);
        const newId = (created && typeof created.id === 'string' ? created.id : undefined) as string | undefined;
        logCreate('capa', 'حالة كابا', form.title);
        toast.success('تم إنشاء حالة كابا بنجاح');
        // Canonical invalidation (fixes the old ['capa'] and
        // ['risk-center'] dead keys).
        invalidateDomain(qc, 'capaCases', { employeeId: form.employeeId });
        onCreated(newId);
      } else {
        toast.error('فشل في إنشاء الحالة');
      }
    } catch {
      toast.error('حدث خطأ في الاتصال');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">العنوان *</Label>
          <Input
            value={form.title}
            onChange={(e) => upd('title', e.target.value)}
            placeholder="وصف مختصر للمشكلة أو الإجراء المطلوب"
            className="bg-slate-800 border-slate-600 text-white h-9 text-sm"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">القسم *</Label>
          <Select value={form.department} onValueChange={(v) => upd('department', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
              <SelectValue placeholder="اختر القسم" />
            </SelectTrigger>
            <SelectContent>
              {DEPARTMENTS.map((d) => (
                <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الأولوية *</Label>
          <Select value={form.priority} onValueChange={(v) => upd('priority', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITY_OPTIONS.map((p) => (
                <SelectItem key={p.value} value={p.value} className="text-white">{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">الموظف المرتبط</Label>
          <EmployeeSearchInput
            employees={employees}
            value={form.employeeId}
            onChange={(id) => upd('employeeId', id)}
            placeholder="ابحث عن موظف..."
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-slate-300 text-xs">المسؤول *</Label>
          <UserSearchInput
            users={systemUsers}
            value={form.assignedTo}
            onChange={(id) => upd('assignedTo', id)}
            placeholder="ابحث عن مستخدم..."
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">المصدر *</Label>
          <Select value={form.source} onValueChange={(v) => upd('source', v)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-slate-300 text-xs">وصف المشكلة *</Label>
          <Textarea
            value={form.problemDescription}
            onChange={(e) => upd('problemDescription', e.target.value)}
            placeholder="صف المشكلة بالتفصيل..."
            className="bg-slate-800 border-slate-600 text-white resize-none text-sm"
            rows={3}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-slate-400 hover:text-white">إلغاء</Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave || saving} className="bg-brand-600 hover:bg-brand-700 text-white">
          {saving ? <Loader2 className="size-3.5 animate-spin ml-1" /> : <Plus className="size-3.5 ml-1" />}
          إنشاء الحالة
        </Button>
      </div>
    </div>
  );
}
