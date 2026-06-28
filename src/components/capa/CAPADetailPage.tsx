'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import { UserSearchInput } from '@/components/shared/UserSearchInput';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Pencil, Check, X, Loader2, Clock, Flame,
  AlertTriangle, ChevronDown, ChevronUp, History, Paperclip, Link as LinkIcon,
  Brain, Wrench, Shield, ClipboardList, Eye, Lightbulb,
  Search, Users, BarChart3, FileText, Trash2,
  CheckCircle2, ExternalLink, ArrowRight, ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { logUpdate } from '@/lib/activity-logger';
import { useAuth } from '@/contexts/AuthContext';
import { useAppStore } from '@/lib/store';
import { usePermissions } from '@/hooks/usePermissions';
import {
  STATUS_OPTIONS, PRIORITY_OPTIONS, ISSUE_CATEGORIES, ROOT_CAUSE_CATEGORIES,
  ACTION_STATUS_OPTIONS, VERIFICATION_RESULTS, DEPARTMENTS, SOURCE_LABELS,
} from '@/lib/capa-constants';
import {
  getStatusConfig, getPriorityConfig, getActionStatusConfig,
  formatDate, formatDateTime, isOverdue, getSLAInfo,
  getProgressSteps, calculateProgress, CATEGORY_LABELS,
} from '@/lib/capa-helpers';
import type { CAPACase, CAPATimelineEvent, Employee } from '@/types';

// ═══════════════════════════════════════════════════
//  Inline Editable Field Component
// ═══════════════════════════════════════════════════

function InlineField({ label, value, type = 'text', onSave, editable = true, rows, placeholder }: {
  label: string; value: string; type?: 'text' | 'textarea' | 'date';
  onSave: (val: string) => void; editable?: boolean; rows?: number; placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const handleSave = () => {
    if (draft !== value) onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    return (
      <div className="group">
        <p className="text-slate-500 text-[10px] mb-1">{label}</p>
        {value ? (
          <div className="flex items-start gap-1">
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap flex-1">{value}</p>
            {editable && (
              <button onClick={() => setEditing(true)} className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-slate-500 hover:text-violet-400">
                <Pencil className="size-3" />
              </button>
            )}
          </div>
        ) : (
          <button
            onClick={() => editable && setEditing(true)}
            className="text-slate-600 text-xs hover:text-violet-400 transition-colors border border-dashed border-slate-700 hover:border-violet-500/50 rounded px-2 py-1"
          >
            + إضافة {label}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-slate-500 text-[10px]">{label}</p>
      <div className="flex gap-1.5">
        {type === 'textarea' ? (
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={rows || 3}
            className="bg-slate-800 border-slate-600 text-white resize-none text-sm flex-1" autoFocus />
        ) : type === 'date' ? (
          <Input type="date" value={draft} onChange={(e) => setDraft(e.target.value)}
            className="bg-slate-800 border-slate-600 text-white flex-1 h-8 text-sm" dir="ltr" autoFocus />
        ) : (
          <Input value={draft} onChange={(e) => setDraft(e.target.value)}
            className="bg-slate-800 border-slate-600 text-white flex-1 h-8 text-sm" autoFocus />
        )}
        <Button size="sm" onClick={handleSave} className="bg-violet-600 hover:bg-violet-700 text-white h-8 px-2">
          <Check className="size-3.5" />
        </Button>
        <Button size="sm" variant="outline" onClick={handleCancel}
          className="border-slate-600 text-slate-400 hover:bg-slate-800 h-8 px-2">
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  Inline Select Field
// ═══════════════════════════════════════════════════

function InlineSelect({ label, value, options, onSave }: {
  label: string; value: string; options: { value: string; label: string }[];
  onSave: (val: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-slate-500 text-[10px]">{label}</p>
      <Select value={value || ''} onValueChange={onSave}>
        <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs w-full">
          <SelectValue placeholder="اختر..." />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-white">{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  Smart Progress Bar
// ═══════════════════════════════════════════════════

function SmartProgress({ capa }: { capa: CAPACase }) {
  const pct = calculateProgress(capa);
  const steps = getProgressSteps(capa);
  const completed = steps.filter((s) => s.completed).length;

  const colorClass = pct >= 85 ? 'bg-violet-500' : pct >= 60 ? 'bg-sky-500' : pct >= 35 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = pct >= 85 ? 'text-violet-400' : pct >= 60 ? 'text-sky-400' : pct >= 35 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-slate-300 text-xs font-semibold flex items-center gap-1.5">
          <BarChart3 className="size-3.5 text-violet-400" />
          تقدم الحالة
        </h3>
        <span className={`${textColor} font-bold text-lg`}>{pct}%</span>
      </div>
      {/* Progress bar */}
      <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`h-full rounded-full ${colorClass}`}
        />
      </div>
      {/* Steps */}
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => (
          <span key={step.key} className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
            step.completed
              ? 'bg-violet-500/15 text-violet-400 border-violet-500/30'
              : 'bg-slate-800/50 text-slate-600 border-slate-700/50'
          }`}>
            {step.completed ? '✓ ' : ''}{step.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  SLA Widget
// ═══════════════════════════════════════════════════

function SLAWidget({ capa }: { capa: CAPACase }) {
  const sla = getSLAInfo(capa);
  const stateConfig: Record<string, { color: string; label: string; icon: any }> = {
    normal: { color: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'ضمن المهلة', icon: Clock },
    warning: { color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'تحذير', icon: AlertTriangle },
    critical: { color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'حرج — تجاوز المهلة', icon: Flame },
    escalation: { color: 'text-red-500 bg-red-600/10 border-red-600/30', label: 'تصعيد — تجاوز مهلة مزدوجة', icon: AlertTriangle },
    closed: { color: 'text-slate-500 bg-slate-500/10 border-slate-500/20', label: 'مغلقة', icon: CheckCircle2 },
  };
  const cfg = stateConfig[sla.state];
  const SIcon = cfg.icon;

  return (
    <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${cfg.color}`}>
      <SIcon className="size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-medium">{cfg.label}</p>
        {sla.state !== 'closed' && (
          <p className="text-[10px] opacity-80">
            {sla.isOverdue ? `متأخرة ${sla.overdueDays} يوم` : `متبقي ${sla.daysRemaining} يوم`}
            {' — '}SLA: {sla.slaDays} يوم
          </p>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  Section Card Wrapper
// ═══════════════════════════════════════════════════

function SectionCard({ title, icon: Icon, color, children, defaultOpen = true }: {
  title: string; icon: any; color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`size-4 ${color}`} />
          <h3 className="text-slate-200 text-sm font-semibold">{title}</h3>
        </div>
        {open ? <ChevronUp className="size-4 text-slate-500" /> : <ChevronDown className="size-4 text-slate-500" />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-slate-700/30 pt-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  MAIN COMPONENT: CAPA Detail Page
// ═══════════════════════════════════════════════════

interface CAPADetailPageProps {
  capaId: string;
  onBack: () => void;
}

export default function CAPADetailPage({ capaId, onBack }: CAPADetailPageProps) {
  const { user } = useAuth();
  const { canUpdate, canDelete } = usePermissions('capa');
  const [capa, setCapa] = useState<CAPACase | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingField, setSavingField] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [systemUsers, setSystemUsers] = useState<{ id: string; name: string; email?: string; role?: string }[]>([]);

  // Fetch CAPA case
  const fetchCapa = useCallback(async () => {
    try {
      const res = await authFetch(`/api/capa-cases/${capaId}`);
      if (res.ok) {
        const data = await res.json();
        setCapa(data);
      } else {
        toast.error('لم يتم العثور على الحالة');
        onBack();
      }
    } catch {
      toast.error('حدث خطأ في تحميل الحالة');
      onBack();
    } finally {
      setLoading(false);
    }
  }, [capaId, onBack]);

  // Fetch employees & users
  useEffect(() => {
    fetchCapa();
    Promise.allSettled([
      authFetch('/api/employees').then((r) => r.ok ? r.json() : []),
      authFetch('/api/dashboard/users').then((r) => r.ok ? r.json() : []),
    ]).then(([empRes, usrRes]) => {
      if (empRes.status === 'fulfilled') setEmployees(Array.isArray(empRes.value) ? empRes.value : []);
      if (usrRes.status === 'fulfilled') setSystemUsers(Array.isArray(usrRes.value) ? usrRes.value : []);
    });
  }, [fetchCapa]);

  // ═══ Partial Update Handler ═══
  const saveField = async (fields: Record<string, any>, fieldLabel: string) => {
    if (!capa || !canUpdate) return;
    setSavingField(fieldLabel);
    try {
      const payload = {
        ...fields,
        updatedBy: user?.id || 'system',
        updatedByName: user?.name || 'النظام',
      };
      const res = await authFetch(`/api/capa-cases/${capa.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json();
        setCapa(updated);
        logUpdate('capa', 'حالة كابا', `${fieldLabel} — ${capa.capaId}`);
      } else {
        toast.error('فشل في التحديث');
      }
    } catch {
      toast.error('حدث خطأ');
    } finally {
      setSavingField(null);
    }
  };

  // ═══ Delete Handler ═══
  const handleDelete = async () => {
    if (!capa || !canDelete) return;
    setDeleting(true);
    try {
      const res = await authFetch(`/api/capa-cases/${capa.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('تم حذف الحالة');
        onBack();
      } else {
        toast.error('فشل في الحذف');
      }
    } catch { toast.error('حدث خطأ'); }
    finally { setDeleting(false); }
  };

  // ═══ Status Change Handler ═══
  const handleStatusChange = (newStatus: string) => {
    if (!capa) return;
    saveField({ status: newStatus }, 'تغيير الحالة');
  };

  // Loading state
  if (loading) {
    return (
      <div dir="rtl" className="space-y-4 p-1">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg bg-slate-800" />
          <Skeleton className="h-6 w-48 rounded bg-slate-800" />
        </div>
        <Skeleton className="h-32 w-full rounded-xl bg-slate-800" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40 w-full rounded-xl bg-slate-800" />
          ))}
        </div>
      </div>
    );
  }

  if (!capa) return null;

  const sc = getStatusConfig(capa.status);
  const SIcon = sc.icon;
  const pc = getPriorityConfig(capa.priority);

  return (
    <div dir="rtl" className="space-y-4">
      {/* ═══ Header ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}
            className="text-slate-400 hover:text-white hover:bg-slate-800 mt-1">
            <ArrowRight className="size-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs text-slate-500 font-mono" dir="ltr">{capa.capaId || '—'}</span>
              {isOverdue(capa) && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                  <Flame className="size-2.5" /> متأخرة
                </span>
              )}
            </div>
            <h1 className="text-white font-bold text-lg">{capa.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium ${sc.color}`}>
                <SIcon className="size-2.5" />{sc.label}
              </div>
              <div className={`px-2 py-0.5 rounded border text-[10px] font-medium ${pc.color}`}>{pc.label}</div>
              <span className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded bg-slate-700/50">
                {CATEGORY_LABELS[capa.issueCategory] || capa.issueCategory}
              </span>
              <span className="text-[10px] text-slate-500">{capa.department}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {canUpdate && (
            <Select value={capa.status} onValueChange={handleStatusChange}>
              <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-8 text-xs w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value} className="text-white">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {canDelete && (
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={deleting}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-2">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            </Button>
          )}
        </div>
      </motion.div>

      {/* ═══ Smart Progress + SLA ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2">
          <SmartProgress capa={capa} />
        </div>
        <SLAWidget capa={capa} />
      </div>

      {/* ═══ Main Content: Two Column ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column — Sections */}
        <div className="lg:col-span-2 space-y-3">

          {/* 1. Overview Section */}
          <SectionCard title="نظرة عامة" icon={Eye} color="text-blue-400">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InlineField label="العنوان" value={capa.title} onSave={(v) => saveField({ title: v }, 'العنوان')} />
              <InlineSelect label="القسم" value={capa.department} options={DEPARTMENTS.map((d) => ({ value: d, label: d }))} onSave={(v) => saveField({ department: v }, 'القسم')} />
              <InlineSelect label="الأولوية" value={capa.priority} options={PRIORITY_OPTIONS} onSave={(v) => saveField({ priority: v }, 'الأولوية')} />
              <InlineSelect label="تصنيف المشكلة" value={capa.issueCategory} options={ISSUE_CATEGORIES} onSave={(v) => saveField({ issueCategory: v }, 'تصنيف المشكلة')} />
              <div className="sm:col-span-2">
                <p className="text-slate-500 text-[10px] mb-1">الموظف المرتبط</p>
                <EmployeeSearchInput
                  employees={employees}
                  value={capa.employeeId || ''}
                  onChange={(id) => saveField({ employeeId: id }, 'الموظف المرتبط')}
                  placeholder="ابحث عن موظف..."
                />
              </div>
              <div>
                <p className="text-slate-500 text-[10px] mb-1">المسؤول</p>
                <UserSearchInput
                  users={systemUsers}
                  value={capa.assignedTo || ''}
                  onChange={(id) => saveField({ assignedTo: id }, 'المسؤول')}
                  placeholder="ابحث عن مستخدم..."
                />
              </div>
              <InlineField
                label="المصدر"
                value={SOURCE_LABELS[capa.source] || capa.source}
                editable={false}
                onSave={() => {}}
              />
            </div>
            <InlineField label="وصف المشكلة" value={capa.problemDescription} type="textarea" onSave={(v) => saveField({ problemDescription: v }, 'وصف المشكلة')} rows={4} />
            <InlineField label="مستوى التأثير" value={capa.impactDescription} type="textarea" onSave={(v) => saveField({ impactDescription: v }, 'مستوى التأثير')} rows={2} />
            {/* Meta info */}
            <Separator className="!bg-slate-700/30" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div><span className="text-slate-500">المنشئ:</span> <span className="text-slate-300">{capa.createdByName || '—'}</span></div>
              <div><span className="text-slate-500">تاريخ الإنشاء:</span> <span className="text-slate-300" dir="ltr">{formatDate(capa.createdAt)}</span></div>
              <div><span className="text-slate-500">المسؤول:</span> <span className="text-slate-300">{capa.assignedToName || '—'}</span></div>
              <div><span className="text-slate-500">SLA:</span> <span className="text-slate-300">{capa.slaDays || 7} يوم</span></div>
              {capa.closureDate && (
                <div><span className="text-slate-500">تاريخ الإغلاق:</span> <span className="text-slate-300" dir="ltr">{capa.closureDate}</span></div>
              )}
            </div>
          </SectionCard>

          {/* 2. Investigation Section */}
          <SectionCard title="التحقيق" icon={Search} color="text-cyan-400">
            <InlineField label="نتائج التحقيق" value={capa.rootCauseVerification} type="textarea" onSave={(v) => saveField({ rootCauseVerification: v }, 'نتائج التحقيق')} rows={4} placeholder="Document investigation findings, evidence collected, and interview summaries..." />
            <div className="text-[10px] text-slate-500 flex items-center gap-1">
              <InfoIcon /> أضف نتائج التحقيق لتحديث تقدم الحالة تلقائياً
            </div>
          </SectionCard>

          {/* 3. Root Cause Analysis Section */}
          <SectionCard title="تحليل السبب الجذري" icon={Brain} color="text-amber-400">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InlineSelect label="تصنيف السبب الجذري" value={capa.rootCauseCategory} options={ROOT_CAUSE_CATEGORIES} onSave={(v) => saveField({ rootCauseCategory: v }, 'تصنيف السبب الجذري')} />
            </div>
            <InlineField label="وصف السبب الجذري" value={capa.rootCauseDescription} type="textarea" onSave={(v) => saveField({ rootCauseDescription: v }, 'وصف السبب الجذري')} rows={4} />
            <InlineField label="التحقق من السبب الجذري" value={capa.rootCauseVerification} type="textarea" onSave={(v) => saveField({ rootCauseVerification: v }, 'التحقق من السبب الجذري')} rows={2} />
          </SectionCard>

          {/* 4. Corrective Action Section */}
          <SectionCard title="الإجراء التصحيحي" icon={Wrench} color="text-orange-400">
            <InlineField label="وصف الإجراء التصحيحي" value={capa.correctiveAction} type="textarea" onSave={(v) => saveField({ correctiveAction: v }, 'الإجراء التصحيحي')} rows={3} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-slate-500 text-[10px] mb-1">المسؤول عن التنفيذ</p>
                <UserSearchInput
                  users={systemUsers}
                  value={capa.correctiveAssignedTo || ''}
                  onChange={(id) => saveField({ correctiveAssignedTo: id }, 'مسؤول الإجراء التصحيحي')}
                  placeholder="ابحث..."
                />
              </div>
              <InlineField label="تاريخ الاستحقاق" value={capa.correctiveDueDate} type="date" onSave={(v) => saveField({ correctiveDueDate: v }, 'موعد الإجراء التصحيحي')} />
              <InlineSelect label="حالة التنفيذ" value={capa.correctiveStatus} options={ACTION_STATUS_OPTIONS} onSave={(v) => saveField({ correctiveStatus: v }, 'حالة الإجراء التصحيحي')} />
            </div>
            <InlineField label="الأدلة / التوثيق" value={capa.correctiveEvidence} type="textarea" onSave={(v) => saveField({ correctiveEvidence: v }, 'أدلة الإجراء التصحيحي')} rows={2} />
            {capa.correctiveStatus && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">الحالة:</span>
                {(() => { const ac = getActionStatusConfig(capa.correctiveStatus); return <span className={`px-2 py-0.5 rounded text-[10px] border ${ac.color}`}>{ac.label}</span>; })()}
              </div>
            )}
          </SectionCard>

          {/* 5. Preventive Action Section */}
          <SectionCard title="الإجراء الوقائي" icon={Shield} color="text-violet-400">
            <InlineField label="وصف الإجراء الوقائي" value={capa.preventiveAction} type="textarea" onSave={(v) => saveField({ preventiveAction: v }, 'الإجراء الوقائي')} rows={3} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-slate-500 text-[10px] mb-1">المسؤول عن التنفيذ</p>
                <UserSearchInput
                  users={systemUsers}
                  value={capa.preventiveAssignedTo || ''}
                  onChange={(id) => saveField({ preventiveAssignedTo: id }, 'مسؤول الإجراء الوقائي')}
                  placeholder="ابحث..."
                />
              </div>
              <InlineField label="تاريخ الاستحقاق" value={capa.preventiveDueDate} type="date" onSave={(v) => saveField({ preventiveDueDate: v }, 'موعد الإجراء الوقائي')} />
              <InlineSelect label="حالة التنفيذ" value={capa.preventiveStatus} options={ACTION_STATUS_OPTIONS} onSave={(v) => saveField({ preventiveStatus: v }, 'حالة الإجراء الوقائي')} />
            </div>
            <InlineField label="طريقة التحقق من عدم التكرار" value={capa.preventiveVerificationMethod} type="textarea" onSave={(v) => saveField({ preventiveVerificationMethod: v }, 'طريقة التحقق الوقائي')} rows={2} />
          </SectionCard>

          {/* 6. Verification Section */}
          <SectionCard title="التحقق" icon={ClipboardList} color="text-sky-400">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-slate-500 text-[10px] mb-1">المراجع</p>
                <UserSearchInput
                  users={systemUsers}
                  value={capa.verifiedBy || ''}
                  onChange={(id) => saveField({ verifiedBy: id }, 'المراجع')}
                  placeholder="ابحث..."
                  allowClear
                  clearLabel="— بدون —"
                />
              </div>
              <InlineField label="تاريخ التحقق" value={capa.verificationDate} type="date" onSave={(v) => saveField({ verificationDate: v }, 'تاريخ التحقق')} />
            </div>
            <InlineSelect label="نتيجة التحقق" value={capa.verificationResult || ''} options={[{ value: '', label: '— لم يتم التحديد —' }, ...VERIFICATION_RESULTS]} onSave={(v) => saveField({ verificationResult: v }, 'نتيجة التحقق')} />
            <InlineField label="ملاحظات التحقق" value={capa.verificationNotes} type="textarea" onSave={(v) => saveField({ verificationNotes: v }, 'ملاحظات التحقق')} rows={2} />
            {capa.verificationResult && (
              <div className={`rounded-lg p-2.5 text-xs border ${
                capa.verificationResult === 'effective' ? 'bg-green-500/10 border-green-500/20 text-green-400' :
                capa.verificationResult === 'partially_effective' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                'bg-red-500/10 border-red-500/20 text-red-400'
              }`}>
                النتيجة: {capa.verificationResult === 'effective' ? 'فعّال' : capa.verificationResult === 'partially_effective' ? 'فعّال جزئياً' : 'غير فعّال'}
                {capa.verifiedByName && ` — بواسطة: ${capa.verifiedByName}`}
              </div>
            )}
          </SectionCard>

          {/* 7. Timeline Section */}
          <SectionCard title="الجدول الزمني" icon={History} color="text-slate-400">
            {capa.timeline && capa.timeline.length > 0 ? (
              <div className="relative space-y-0">
                <div className="absolute right-[5px] top-0 bottom-0 w-px bg-slate-700/50" />
                {[...capa.timeline].reverse().map((event: CAPATimelineEvent) => (
                  <div key={event.id} className="flex items-start gap-3 py-2 relative">
                    <div className="size-[11px] rounded-full bg-violet-500 border-2 border-slate-900 mt-1.5 shrink-0 z-10" />
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-300 text-xs">{event.description}</p>
                      <p className="text-slate-600 text-[10px] mt-0.5">
                        {event.performedByName || 'النظام'} — <span dir="ltr">{formatDateTime(event.timestamp)}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-600 text-xs text-center py-4">لا توجد أحداث بعد</p>
            )}
          </SectionCard>

          {/* 8. Attachments Section */}
          <SectionCard title="المرفقات" icon={Paperclip} color="text-slate-400" defaultOpen={false}>
            {capa.attachments && capa.attachments.length > 0 ? (
              <div className="space-y-2">
                {capa.attachments.map((att) => (
                  <div key={att.id} className="flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-800/30 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-slate-500" />
                      <span className="text-slate-300 text-xs">{att.name}</span>
                    </div>
                    <span className="text-slate-600 text-[10px]" dir="ltr">{formatDate(att.uploadedAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-slate-600 text-xs text-center py-4">لا توجد مرفقات</p>
            )}
          </SectionCard>

          {/* 9. Linked Records Section */}
          <SectionCard title="السجلات المرتبطة" icon={LinkIcon} color="text-violet-400" defaultOpen={false}>
            <LinkedRecordsPanel capa={capa} />
          </SectionCard>

          {/* 10. Activity Log Section */}
          <SectionCard title="سجل الأنشطة" icon={BarChart3} color="text-slate-400" defaultOpen={false}>
            <ActivityLogView capa={capa} />
          </SectionCard>
        </div>

        {/* Right Column — Sidebar */}
        <div className="space-y-3">
          {/* Quick Info Card */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs text-slate-400 font-medium">معلومات سريعة</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 space-y-2 text-[11px]">
              <div className="flex justify-between"><span className="text-slate-500">الحالة</span>
                <span className={`px-2 py-0.5 rounded border text-[10px] ${sc.color}`}>{sc.label}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">الأولوية</span>
                <span className={`px-2 py-0.5 rounded border text-[10px] ${pc.color}`}>{pc.label}</span>
              </div>
              <Separator className="!bg-slate-700/30" />
              <div className="flex justify-between"><span className="text-slate-500">المسؤول</span>
                <span className="text-slate-300">{capa.assignedToName || '—'}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">القسم</span>
                <span className="text-slate-300">{capa.department || '—'}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">المصدر</span>
                <span className="text-slate-300">{SOURCE_LABELS[capa.source] || capa.source}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">المنشئ</span>
                <span className="text-slate-300">{capa.createdByName || '—'}</span>
              </div>
              <Separator className="!bg-slate-700/30" />
              <div className="flex justify-between"><span className="text-slate-500">تاريخ الإنشاء</span>
                <span className="text-slate-300" dir="ltr">{formatDate(capa.createdAt)}</span>
              </div>
              <div className="flex justify-between"><span className="text-slate-500">آخر تحديث</span>
                <span className="text-slate-300" dir="ltr">{formatDate(capa.updatedAt)}</span>
              </div>
              {capa.closureDate && (
                <div className="flex justify-between"><span className="text-slate-500">تاريخ الإغلاق</span>
                  <span className="text-slate-300" dir="ltr">{capa.closureDate}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Lessons Learned */}
          <Card className="bg-slate-800/30 border-slate-700/40">
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                <Lightbulb className="size-3.5 text-amber-400" />
                الدروس المستفادة
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <InlineField label="" value={capa.lessonsLearned} type="textarea" onSave={(v) => saveField({ lessonsLearned: v }, 'الدروس المستفادة')} rows={3} />
            </CardContent>
          </Card>

          {/* Final Comments (for closure) */}
          {(capa.status === 'verification' || capa.status === 'closed' || capa.status === 'reopened') && (
            <Card className="bg-slate-800/30 border-slate-700/40">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-slate-400 font-medium">التعليقات النهائية</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3">
                <InlineField label="" value={capa.finalComments} type="textarea" onSave={(v) => saveField({ finalComments: v }, 'التعليقات النهائية')} rows={3} />
              </CardContent>
            </Card>
          )}

          {/* Source References — Quick Navigation */}
          {(capa.relatedFollowUpId || capa.relatedQualityDeductionId || capa.relatedComplaintId || capa.relatedHrDeductionId) && (
            <Card className="bg-violet-500/5 border-violet-500/20">
              <CardHeader className="pb-2 pt-3 px-4">
                <CardTitle className="text-xs text-violet-400 font-medium flex items-center gap-1.5">
                  <ArrowLeft className="size-3.5" />
                  السجل المصدر
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-3 space-y-1.5 text-[11px]">
                {capa.relatedFollowUpId && (
                  <button type="button" onClick={() => { onBack(); useAppStore.getState().navigateTo('followUps'); }}
                    className="w-full text-right flex items-center gap-2 text-violet-300 hover:text-violet-200 transition-colors py-1">
                    <ExternalLink className="size-3" /> متابعة مرتبطة
                  </button>
                )}
                {capa.relatedQualityDeductionId && (
                  <button type="button" onClick={() => { onBack(); useAppStore.getState().navigateTo('quality'); }}
                    className="w-full text-right flex items-center gap-2 text-violet-300 hover:text-violet-200 transition-colors py-1">
                    <ExternalLink className="size-3" /> خصم جودة مرتبط
                  </button>
                )}
                {capa.relatedComplaintId && (
                  <button type="button" onClick={() => { onBack(); useAppStore.getState().navigateTo('complaints'); }}
                    className="w-full text-right flex items-center gap-2 text-violet-300 hover:text-violet-200 transition-colors py-1">
                    <ExternalLink className="size-3" /> شكوى عميل مرتبطة
                  </button>
                )}
                {capa.relatedHrDeductionId && (
                  <button type="button" onClick={() => { onBack(); useAppStore.getState().navigateTo('hrDeductions'); }}
                    className="w-full text-right flex items-center gap-2 text-violet-300 hover:text-violet-200 transition-colors py-1">
                    <ExternalLink className="size-3" /> مخالفة HR مرتبطة
                  </button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Employee Link */}
          {capa.employeeId && capa.employeeName && (
            <Card className="bg-slate-800/30 border-slate-700/40">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 text-[10px]">الموظف المرتبط</span>
                  <EmployeeLink employeeId={capa.employeeId} name={capa.employeeName} />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  Linked Records Panel
// ═══════════════════════════════════════════════════

function LinkedRecordsPanel({ capa }: { capa: CAPACase }) {
  const navigate = useAppStore((s) => s.navigateTo);

  const records = [
    { key: 'followUp', label: 'المتابعات', id: capa.relatedFollowUpId, page: 'followUps' as const, color: 'text-cyan-400' },
    { key: 'complaint', label: 'الشكاوى', id: capa.relatedComplaintId, page: 'complaints' as const, color: 'text-orange-400' },
    { key: 'quality', label: 'خصومات الجودة', id: capa.relatedQualityDeductionId, page: 'quality' as const, color: 'text-amber-400' },
    { key: 'hr', label: 'خصومات HR', id: capa.relatedHrDeductionId, page: 'hrDeductions' as const, color: 'text-red-400' },
  ];

  const linked = records.filter((r) => r.id);
  const hasEmployees = capa.relatedEmployeeIds && capa.relatedEmployeeIds.length > 0;

  if (linked.length === 0 && !hasEmployees) {
    return <p className="text-slate-600 text-xs text-center py-4">لا توجد سجلات مرتبطة</p>;
  }

  return (
    <div className="space-y-2">
      {linked.map((rec) => (
        <button
          key={rec.key}
          type="button"
          onClick={() => navigate(rec.page)}
          className="w-full flex items-center justify-between rounded-lg border border-slate-700/30 bg-slate-800/30 px-3 py-2.5 hover:bg-slate-800/60 transition-colors text-right"
        >
          <div className="flex items-center gap-2">
            <ExternalLink className={`size-3.5 ${rec.color}`} />
            <span className="text-slate-300 text-xs">{rec.label}</span>
          </div>
          <span className="text-slate-600 text-[10px] font-mono" dir="ltr">{rec.id?.slice(0, 8)}...</span>
        </button>
      ))}
      {hasEmployees && (
        <div className="rounded-lg border border-slate-700/30 bg-slate-800/30 px-3 py-2.5">
          <div className="flex items-center gap-2 mb-1.5">
            <Users className="size-3.5 text-violet-400" />
            <span className="text-slate-300 text-xs">الموظفون المرتبطون ({capa.relatedEmployeeIds!.length})</span>
          </div>
          <div className="space-y-1">
            {capa.relatedEmployeeIds!.map((empId) => (
              <EmployeeLink key={empId} employeeId={empId} compact />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════
//  Activity Log View (Timeline-based)
// ═══════════════════════════════════════════════════

function ActivityLogView({ capa }: { capa: CAPACase }) {
  if (!capa.timeline || capa.timeline.length === 0) {
    return <p className="text-slate-600 text-xs text-center py-4">لا توجد أنشطة مسجلة</p>;
  }

  const events = [...capa.timeline].reverse();

  return (
    <div className="space-y-0">
      <div className="absolute right-[5px] top-0 bottom-0 w-px bg-slate-700/50" />
      {events.map((event: CAPATimelineEvent) => (
        <div key={event.id} className="flex items-start gap-3 py-2 relative">
          <div className="size-[11px] rounded-full bg-violet-500 border-2 border-slate-900 mt-1.5 shrink-0 z-10" />
          <div className="flex-1 min-w-0">
            <p className="text-slate-300 text-xs">{event.description}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-slate-600 text-[10px]">{event.performedByName || 'النظام'}</span>
              <span className="text-slate-700 text-[10px]">•</span>
              <span className="text-slate-600 text-[10px]" dir="ltr">{formatDateTime(event.timestamp)}</span>
            </div>
            <span className="text-[9px] text-slate-700 px-1.5 py-0.5 rounded bg-slate-800 mt-1 inline-block">{event.action}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Placeholder icon
function InfoIcon() {
  return (
    <svg className="size-3 inline-block text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
    </svg>
  );
}