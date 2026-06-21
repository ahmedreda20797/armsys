'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
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
import {
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
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import type { QualityDeduction, Employee } from '@/types';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';

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

function getDayLabel(days: number): string {
  const preset = DAY_PRESETS.find((p) => p.value === String(days));
  if (preset) return preset.label;
  if (days === 0) return '—';
  return `${days} يوم`;
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

function getDaysColor(days: number): string {
  if (days >= 5) return 'bg-red-500/20 text-red-300 border-red-500/40';
  if (days >= 3) return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
  if (days >= 1) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
  return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
}

function formatDeductionForCopy(deduction: QualityWithEmployee, empName: string): string {
  const typeLabel = deduction.type === 'safety' ? 'سلامة' : deduction.type === 'compliance' ? 'التزام' : 'جودة';
  const dayLabel = getDayLabel(deduction.deductionDays);
  let text = `━━━━━━━━━━━━━━━━━━━\n`;
  text += `  خصم ${typeLabel}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;
  text += `  الموظف: ${empName}\n`;
  text += `  التاريخ: ${deduction.date}\n`;
  text += `  عدد الخصم: ${dayLabel}\n`;
  if (deduction.deductionAmount > 0) {
    text += `  المبلغ: ${deduction.deductionAmount.toLocaleString()} جنيه\n`;
  }
  text += `\n  التفاصيل:\n  ${deduction.description || 'لا يوجد وصف'}\n`;
  if (deduction.evidence) {
    text += `\n  الدليل: ${deduction.evidence}\n`;
  }
  text += `\n━━━━━━━━━━━━━━━━━━━`;
  return text;
}

function formatAllDeductionsForCopy(empName: string, deductions: QualityWithEmployee[]): string {
  const totalDays = deductions.reduce((s, d) => s + d.deductionDays, 0);
  const totalAmount = deductions.reduce((s, d) => s + d.deductionAmount, 0);

  let text = `══════════════════════════════\n`;
  text += `  ملخص خصومات الجودة\n`;
  text += `══════════════════════════════\n\n`;
  text += `  الموظف: ${empName}\n`;
  text += `  عدد الخصومات: ${deductions.length}\n`;
  text += `  إجمالي الأيام: ${totalDays} يوم\n`;
  if (totalAmount > 0) {
    text += `  إجمالي المبلغ: ${totalAmount.toLocaleString()} جنيه\n`;
  }
  text += `\n──────────────────────────────\n\n`;

  deductions.forEach((d, idx) => {
    const typeLabel = d.type === 'safety' ? 'سلامة' : d.type === 'compliance' ? 'التزام' : 'جودة';
    text += `  ${idx + 1}. خصم ${typeLabel}\n`;
    text += `     التاريخ: ${d.date}\n`;
    text += `     الخصم: ${getDayLabel(d.deductionDays)}\n`;
    if (d.deductionAmount > 0) {
      text += `     المبلغ: ${d.deductionAmount.toLocaleString()} جنيه\n`;
    }
    text += `     التفاصيل: ${d.description || 'لا يوجد وصف'}\n`;
    if (d.evidence) {
      text += `     الدليل: ${d.evidence}\n`;
    }
    text += `\n`;
  });

  text += `══════════════════════════════`;
  return text;
}

export default function QualityPage() {
  const { canEdit, canCreate, canUpdate, canDelete, canUpload } = usePermissions('quality');
  const [deductions, setDeductions] = useState<QualityWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [expandedEmp, setExpandedEmp] = useState<string | null>(null);
  const [copiedDedId, setCopiedDedId] = useState<string | null>(null);
  const [copiedAllEmpId, setCopiedAllEmpId] = useState<string | null>(null);
  const [editingDeduction, setEditingDeduction] = useState<QualityWithEmployee | null>(null);
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
  }, []);

  const fetchData = async () => {
    try {
      const [qRes, empRes] = await Promise.all([
        authFetch('/api/quality'),
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
      setDeductions([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

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
    const text = formatDeductionForCopy(deduction, empName);
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
    const text = formatAllDeductionsForCopy(empName, empDeductions);
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

  const handleDelete = async (id: string) => {
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

  // ═══ Group by employee ═══
  const groupedByEmployee = filtered.reduce<Record<string, {
    name: string;
    department: string | null;
    deductions: QualityWithEmployee[];
    totalDays: number;
    totalAmount: number;
  }>>((acc, d) => {
    if (!acc[d.employeeId]) {
      acc[d.employeeId] = {
        name: d.employee?.name || 'غير معروف',
        department: d.employee?.department || null,
        deductions: [],
        totalDays: 0,
        totalAmount: 0,
      };
    }
    acc[d.employeeId].deductions.push(d);
    acc[d.employeeId].totalDays += d.deductionDays;
    acc[d.employeeId].totalAmount += d.deductionAmount;
    return acc;
  }, {});

  // Sort by totalDays desc
  const sortedEmployees = Object.entries(groupedByEmployee)
    .sort((a, b) => b[1].totalDays - a[1].totalDays);

  const grandTotalDays = sortedEmployees.reduce((sum, [, e]) => sum + e.totalDays, 0);
  const grandTotalAmount = sortedEmployees.reduce((sum, [, e]) => sum + e.totalAmount, 0);

  // Month options
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-violet-500/15 border border-violet-500/30">
            <Award className="size-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">خصومات الجودة</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {filtered.length} سجل خصم — {sortedEmployees.length} موظف
            </p>
          </div>
        </div>
        {canCreate && (
          <Button
            onClick={() => { setEditingDeduction(null); setIsAddOpen(true); }}
            size="sm"
            className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
          >
            <Plus className="size-4 ml-1" />
            إضافة خصم
          </Button>
        )}
      </motion.div>

      {/* ═══ Stats Bar ═══ */}
      {filtered.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-3 gap-2.5"
        >
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">إجمالي الأيام</p>
            <p className="text-amber-400 font-bold text-lg leading-tight">{grandTotalDays}</p>
            <p className="text-slate-500 text-[10px]">يوم خصم</p>
          </div>
          {grandTotalAmount > 0 && (
            <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5">
              <p className="text-slate-500 text-[11px] mb-0.5">إجمالي المبلغ</p>
              <p className="text-rose-400 font-bold text-lg leading-tight" dir="ltr">
                {grandTotalAmount.toLocaleString()}
              </p>
              <p className="text-slate-500 text-[10px]">جنيه</p>
            </div>
          )}
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/8 px-3.5 py-2.5">
            <p className="text-slate-500 text-[11px] mb-0.5">عدد الموظفين</p>
            <p className="text-cyan-400 font-bold text-lg leading-tight">{sortedEmployees.length}</p>
            <p className="text-slate-500 text-[10px]">موظف</p>
          </div>
        </motion.div>
      )}

      {/* ═══ Filters ═══ */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث بالاسم أو سبب الخصم..."
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
            <SelectValue placeholder="الشهر" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m} className="text-white">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ═══ Loading ═══ */}
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <Award className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد خصومات</p>
            <p className="text-slate-600 text-xs mt-1">
              {search || (monthFilter && monthFilter !== 'all') ? 'لم يتم العثور على نتائج' : 'لم يتم تسجيل أي خصومات بعد'}
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
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-700/40 bg-slate-800/50 cursor-pointer hover:bg-slate-800/70 transition-colors"
                  onClick={() => setExpandedEmp(isEmpExpanded ? null : empId)}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 size-10 rounded-full bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center border border-slate-600/50">
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
                      <span className="text-slate-400 text-[11px]">{emp.deductions.length}</span>
                      <span className="text-slate-500 text-[10px]">خصم</span>
                    </div>

                    {/* Total Days Bubble */}
                    <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full border ${daysColor}`}>
                      <span className="font-bold text-xs">{emp.totalDays}</span>
                      <span className="text-[10px]">يوم</span>
                    </div>

                    {/* Total Amount Bubble */}
                    {emp.totalAmount > 0 && (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30">
                        <span className="font-bold text-xs" dir="ltr">{emp.totalAmount.toLocaleString()}</span>
                        <span className="text-[10px]">ج</span>
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
                        ? 'text-violet-400 bg-violet-500/10'
                        : 'text-slate-600 hover:text-violet-400 hover:bg-violet-500/10'
                    }`}
                    title="نسخ كل الخصومات"
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

                          return (
                            <motion.div
                              key={d.id}
                              layout
                              initial={{ opacity: 0, x: 10 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ duration: 0.15 }}
                            >
                              <div
                                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-700/30 bg-slate-800/30 cursor-pointer hover:bg-slate-800/50 transition-colors"
                                onClick={() => setExpandedRow(isRowExpanded ? null : d.id)}
                              >
                                {/* Type Badge */}
                                <div className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${badge.color}`}>
                                  <BadgeIcon className="size-2.5" />
                                  <span>{badge.label}</span>
                                </div>

                                {/* Employee name (for screenshot) */}
                                <EmployeeLink employeeId={empId} name={emp.name} compact hideAvatar />

                                {/* Date + Days */}
                                <span className="flex-shrink-0 text-slate-500 text-[11px]" dir="ltr">{d.date}</span>

                                {/* Description preview */}
                                <div className="flex-1 min-w-0">
                                  <p className="text-slate-300 text-xs truncate">
                                    {d.description || 'بدون وصف'}
                                  </p>
                                </div>

                                {/* Days */}
                                <span className="flex-shrink-0 text-amber-400 font-bold text-xs">
                                  {d.deductionDays}ي
                                </span>
                                {d.deductionAmount > 0 && (
                                  <span className="flex-shrink-0 text-rose-400 font-medium text-[11px]" dir="ltr">
                                    {d.deductionAmount.toLocaleString()}ج
                                  </span>
                                )}

                                {/* Expand/Collapse */}
                                <div className={`flex-shrink-0 text-slate-600 transition-transform duration-150 ${isRowExpanded ? 'rotate-180' : ''}`}>
                                  <ChevronDown className="size-3" />
                                </div>

                                {/* Edit */}
                                {canUpdate && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openEdit(d);
                                    }}
                                    className="flex-shrink-0 text-slate-600 hover:text-violet-400 transition-colors"
                                  >
                                    <Pencil className="size-3" />
                                  </button>
                                )}

                                {/* Delete */}
                                {canDelete && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDeletingId(d.id);
                                    }}
                                    className="flex-shrink-0 text-slate-600 hover:text-red-400 transition-colors"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                )}

                                {/* Copy to Clipboard */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    copySingleDeduction(d, emp.name);
                                  }}
                                  className={`flex-shrink-0 transition-colors ${
                                    copiedDedId === d.id
                                      ? 'text-violet-400'
                                      : 'text-slate-600 hover:text-violet-400'
                                  }`}
                                  title="نسخ تفاصيل الخصم"
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
                                      <p className="text-slate-400 text-[10px] mb-1">سبب الخصم</p>
                                      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap break-words">
                                        {d.description || 'لا يوجد وصف'}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[11px]">
                                        <span className="text-slate-500">التاريخ: <span className="text-slate-400" dir="ltr">{d.date}</span></span>
                                        <span className="text-slate-500">الشهر: <span className="text-slate-400" dir="ltr">{d.month}</span></span>
                                        <span className="text-slate-500">الخصم: <span className="text-amber-400">{getDayLabel(d.deductionDays)}</span></span>
                                        {d.deductionAmount > 0 && (
                                          <span className="text-slate-500">المبلغ: <span className="text-rose-400" dir="ltr">{d.deductionAmount.toLocaleString()} جنيه</span></span>
                                        )}
                                      </div>
                                      {d.evidence && (
                                        <a
                                          href={d.evidence}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          onClick={(e) => e.stopPropagation()}
                                          className="inline-flex items-center gap-1 mt-2 text-cyan-400 hover:text-cyan-300 text-[11px] bg-cyan-500/10 px-2 py-1 rounded-md border border-cyan-500/20"
                                        >
                                          <LinkIcon className="size-2.5" />
                                          عرض الدليل
                                        </a>
                                      )}
                                      {/* ═══ CAPA Integration (Tier 2) ═══ */}
                                      {(d as any).relatedCapaId && (
                                        <div className="mt-2 rounded-lg bg-cyan-500/5 border border-cyan-500/15 px-2.5 py-1.5">
                                          <p className="text-cyan-400 text-[10px] font-medium">حالة CAPA مرتبطة</p>
                                        </div>
                                      )}
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="mt-2 text-[11px] border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 h-7"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          useAppStore.getState().navigateTo('capa', undefined, {
                                            employeeId: d.employeeId,
                                            source: 'quality',
                                            sourceId: d.id,
                                          });
                                        }}
                                      >
                                        <ShieldAlert className="size-3 ml-1" />
                                        إنشاء CAPA
                                      </Button>
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </motion.div>
                          );
                        })}
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
            <DialogTitle className="text-white">{editingDeduction ? 'تعديل خصم جودة' : 'إضافة خصم جودة'}</DialogTitle>
            <DialogDescription className="text-slate-400">{editingDeduction ? 'عدّل تفاصيل الخصم' : 'أدخل تفاصيل الخصم'} - يتم حساب الشهر تلقائياً من التاريخ</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {!editingDeduction && (
            <div className="sm:col-span-2">
              <EmployeeSearchInput
                employees={employees}
                value={addForm.employeeId}
                onChange={(id) => setAddForm((p) => ({ ...p, employeeId: id }))}
                label="الموظف"
                placeholder="ابحث عن اسم الموظف..."
              />
            </div>
            )}
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">التاريخ</Label>
              <Input
                value={addForm.date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">النوع</Label>
              <Select
                value={addForm.type}
                onValueChange={(v) => setAddForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quality_issue" className="text-white">مشكلة جودة</SelectItem>
                  <SelectItem value="safety" className="text-white">سلامة</SelectItem>
                  <SelectItem value="compliance" className="text-white">التزام</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">نوع الخصم (بالأيام)</Label>
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
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {addForm.dayPreset === 'custom' && (
              <div className="space-y-2">
                <Label className="text-slate-300 text-sm">عدد الأيام (مخصص)</Label>
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
              <Label className="text-slate-300 text-sm">مبلغ الخصم (اختياري)</Label>
              <Input
                type="number"
                value={addForm.deductionAmount}
                onChange={(e) => setAddForm((p) => ({ ...p, deductionAmount: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="اختياري"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">الشهر (تلقائي)</Label>
              <Input
                value={addForm.month}
                readOnly
                className="bg-slate-800/50 border-slate-600 text-slate-400"
                placeholder="YYYY-MM"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">سبب الخصم</Label>
              <Textarea
                value={addForm.description}
                onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white resize-none"
                placeholder="اكتب سبب الخصم بالتفصيل..."
                rows={3}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">رابط الدليل (اختياري)</Label>
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
              إلغاء
            </Button>
            <Button
              onClick={handleSaveDeduction}
              disabled={saving || !addForm.date}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري الحفظ...' : (editingDeduction ? 'حفظ التعديل' : 'حفظ')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Dialog ═══ */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white">تأكيد الحذف</DialogTitle>
            <DialogDescription className="text-slate-400">
              هل أنت متأكد من حذف هذا الخصم؟ لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeletingId(null)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingId) handleDelete(deletingId);
              }}
            >
              حذف
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
