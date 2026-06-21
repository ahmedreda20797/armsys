'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  Banknote,
  Plus,
  Check,
  X,
  Clock,
  Search,
  Pencil,
  Trash2,
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import type { HrDeduction, Employee } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { authFetch } from '@/lib/api-fetch';

const DEDUCTION_TYPES = [
  { value: 'خصم تأخير', label: 'خصم تأخير' },
  { value: 'خصم غياب', label: 'خصم غياب' },
  { value: 'خصم جودة', label: 'خصم جودة' },
  { value: 'خصم آخر', label: 'خصم آخر' },
];

function generateMonthOptions(): { value: string; label: string }[] {
  const now = new Date();
  const options: { value: string; label: string }[] = [];
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const months = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
    ];
    const label = `${months[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value, label });
  }
  return options;
}

const MONTH_OPTIONS = generateMonthOptions();

function getTodayDate(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

interface HrDeductionWithEmployee extends HrDeduction {
  employeeName: string;
  employeeDepartment: string | null;
}

const EMPTY_FORM = {
  employeeId: '',
  type: 'خصم تأخير',
  amount: '',
  unit: 'EGP' as 'days' | 'EGP',
  month: MONTH_OPTIONS[1]?.value || MONTH_OPTIONS[0]?.value || '',
  reason: '',
  deductionDate: '',
};

export default function HrDeductionsPage() {
  const { canEdit, canCreate, canUpdate, canDelete, canApprove } = usePermissions('hrDeductions');
  const { user } = useAuth();
  const [deductions, setDeductions] = useState<HrDeductionWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM });
  const [editForm, setEditForm] = useState({ ...EMPTY_FORM, id: '' });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [dedRes, empRes] = await Promise.all([
        authFetch('/api/hr-deductions'),
        authFetch('/api/employees'),
      ]);
      if (dedRes.ok) {
        const dedData = await dedRes.json();
        setDeductions(dedData);
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

  const handleAdd = async () => {
    if (!addForm.employeeId || !addForm.type || !addForm.amount || !addForm.unit || !addForm.month) return;
    setSaving(true);
    try {
      const res = await authFetch('/api/hr-deductions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: addForm.employeeId,
          type: addForm.type,
          amount: Number(addForm.amount),
          unit: addForm.unit,
          month: addForm.month,
          reason: addForm.reason,
          deductionDate: addForm.deductionDate || null,
        }),
      });
      if (res.ok) {
        await fetchData();
        setIsAddOpen(false);
        setAddForm({ ...EMPTY_FORM });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editForm.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hr-deductions/${editForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: editForm.type,
          amount: Number(editForm.amount),
          unit: editForm.unit,
          month: editForm.month,
          reason: editForm.reason,
          deductionDate: editForm.deductionDate || null,
        }),
      });
      if (res.ok) {
        await fetchData();
        setIsEditOpen(false);
        setEditForm({ ...EMPTY_FORM, id: '' });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setReviewing(true);
    try {
      const res = await fetch(`/api/hr-deductions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, approvedBy: user?.id }),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      // Error handled silently
    } finally {
      setReviewing(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/hr-deductions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      // Error handled silently
    }
  };

  const openEditDialog = (deduction: HrDeductionWithEmployee) => {
    setEditForm({
      id: deduction.id,
      employeeId: deduction.employeeId,
      type: deduction.type,
      amount: String(deduction.amount),
      unit: deduction.unit,
      month: deduction.month,
      reason: deduction.reason,
      deductionDate: deduction.deductionDate || '',
    });
    setIsEditOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20">معلق</Badge>;
      case 'approved':
        return <Badge className="bg-green-500/15 text-green-400 border-green-500/20">مقبول</Badge>;
      case 'rejected':
        return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">مرفوض</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getUnitLabel = (unit: string) => {
    return unit === 'days' ? 'يوم' : 'جنيه';
  };

  // Filtering
  const filtered = deductions.filter((d) => {
    const matchesSearch =
      (d.employeeName || '').toLowerCase().includes(search.toLowerCase()) ||
      d.month.includes(search) ||
      d.type.includes(search);
    const matchesStatus = statusFilter === 'all' || d.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const pending = filtered.filter((d) => d.status === 'pending');
  const other = filtered.filter((d) => d.status !== 'pending');
  const allPendingCount = deductions.filter((d) => d.status === 'pending').length;

  const filterTabs = [
    { key: 'all' as const, label: 'الكل', count: deductions.length },
    { key: 'pending' as const, label: 'معلق', count: allPendingCount },
    { key: 'approved' as const, label: 'مقبول', count: deductions.filter((d) => d.status === 'approved').length },
    { key: 'rejected' as const, label: 'مرفوض', count: deductions.filter((d) => d.status === 'rejected').length },
  ];

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Banknote className="size-6 text-violet-400" />
            خصومات الموارد البشرية
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {allPendingCount} خصم معلق
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              onClick={() => { setIsAddOpen(true); setAddForm({ ...EMPTY_FORM, deductionDate: getTodayDate() }); }}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              <Plus className="size-4" />
              إضافة خصم
            </Button>
          )}
        </div>
      </motion.div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <Input
          placeholder="بحث باسم الموظف أو الشهر أو النوع..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-600 text-white pr-10 placeholder:text-slate-500"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {filterTabs.map((tab) => (
          <motion.button
            key={tab.key}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
              statusFilter === tab.key
                ? 'from-violet-600 to-indigo-600 text-white shadow-lg shadow-violet-900/30'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white border border-slate-700/50'
            }`}
          >
            {tab.label}
            <span className="mr-2 text-xs opacity-70">({tab.count})</span>
          </motion.button>
        ))}
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Banknote className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد خصومات</p>
            <p className="text-slate-500 text-sm mt-1">ابدأ بإضافة خصم جديد</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pending Deductions */}
          {pending.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
                <Clock className="size-5" />
                الخصومات المعلقة ({pending.length})
              </h2>
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {pending.map((ded) => (
                    <motion.div
                      key={ded.id}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      className="rounded-xl border border-amber-500/20 bg-slate-800/50 p-4 hover:bg-slate-800/80 transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <EmployeeLink employeeId={ded.employeeId} name={ded.employeeName} compact />
                            <Badge className="bg-slate-600/40 text-slate-300 border-slate-500/30">{ded.type}</Badge>
                            <span className="text-violet-400 font-semibold text-sm" dir="ltr">
                              {ded.amount} {getUnitLabel(ded.unit)}
                            </span>
                            <span className="text-slate-500 text-sm">{MONTH_OPTIONS.find((m) => m.value === ded.month)?.label || ded.month}</span>
                            {ded.deductionDate && (
                              <span className="text-slate-500 text-xs" dir="ltr">({ded.deductionDate})</span>
                            )}
                          </div>
                          <p className="text-slate-400 text-sm">{ded.reason}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {canUpdate && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(ded)}
                              className="border-slate-600 text-slate-300 hover:bg-slate-700"
                            >
                              <Pencil className="size-3.5" />
                              تعديل
                            </Button>
                          )}
                          {canApprove && (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleReview(ded.id, 'approved')}
                                disabled={reviewing}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <Check className="size-3.5" />
                                قبول
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReview(ded.id, 'rejected')}
                                disabled={reviewing}
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                              >
                                <X className="size-3.5" />
                                رفض
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(ded.id)}
                              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Approved / Rejected Table */}
          {other.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-sm font-medium">الموظف</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">النوع</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">المبلغ</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">الشهر</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">تاريخ الخصم</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">السبب</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">الحالة</TableHead>
                      {(canUpdate || canDelete) && (
                        <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {other.map((ded) => (
                      <TableRow
                        key={ded.id}
                        className="border-slate-700/50 hover:bg-slate-700/30"
                      >
                        <TableCell>
                          <EmployeeLink employeeId={ded.employeeId} name={ded.employeeName} compact />
                        </TableCell>
                        <TableCell className="text-slate-300">{ded.type}</TableCell>
                        <TableCell className="text-slate-300" dir="ltr">
                          {ded.amount} {getUnitLabel(ded.unit)}
                        </TableCell>
                        <TableCell className="text-slate-300">
                          {MONTH_OPTIONS.find((m) => m.value === ded.month)?.label || ded.month}
                        </TableCell>
                        <TableCell className="text-slate-300" dir="ltr">
                          {ded.deductionDate || '—'}
                        </TableCell>
                        <TableCell className="text-slate-400 text-sm max-w-xs truncate">{ded.reason}</TableCell>
                        <TableCell>{getStatusBadge(ded.status)}</TableCell>
                        {(canUpdate || canDelete) && (
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {canUpdate && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditDialog(ded)}
                                  className="text-slate-400 hover:text-violet-400 hover:bg-violet-500/10"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDelete(ded.id)}
                                  className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                                >
                                  <Trash2 className="size-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </motion.div>
          )}
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">إضافة خصم جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل تفاصيل الخصم</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <EmployeeSearchInput
                employees={employees}
                value={addForm.employeeId}
                onChange={(id) => setAddForm((p) => ({ ...p, employeeId: id }))}
                label="الموظف"
                placeholder="ابحث عن اسم الموظف..."
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">نوع الخصم</Label>
              <Select
                value={addForm.type}
                onValueChange={(v) => setAddForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEDUCTION_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value} className="text-white">
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">الوحدة</Label>
              <Select
                value={addForm.unit}
                onValueChange={(v) => setAddForm((p) => ({ ...p, unit: v as 'days' | 'EGP' }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="days" className="text-white">أيام</SelectItem>
                  <SelectItem value="EGP" className="text-white">جنيه</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">المبلغ / العدد</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={addForm.amount}
                onChange={(e) => setAddForm((p) => ({ ...p, amount: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="0"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">الشهر</Label>
              <Select
                value={addForm.month}
                onValueChange={(v) => setAddForm((p) => ({ ...p, month: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر الشهر" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-white">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">تاريخ الخصم</Label>
              <Input
                value={addForm.deductionDate}
                onChange={(e) => setAddForm((p) => ({ ...p, deductionDate: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">السبب</Label>
              <Textarea
                value={addForm.reason}
                onChange={(e) => setAddForm((p) => ({ ...p, reason: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="اكتب سبب الخصم..."
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddOpen(false)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !addForm.employeeId || !addForm.amount || !addForm.month || !addForm.reason}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري الحفظ...' : 'إضافة'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">تعديل الخصم</DialogTitle>
            <DialogDescription className="text-slate-400">قم بتعديل تفاصيل الخصم</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">نوع الخصم</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DEDUCTION_TYPES.map((dt) => (
                    <SelectItem key={dt.value} value={dt.value} className="text-white">
                      {dt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">الوحدة</Label>
              <Select
                value={editForm.unit}
                onValueChange={(v) => setEditForm((p) => ({ ...p, unit: v as 'days' | 'EGP' }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="days" className="text-white">أيام</SelectItem>
                  <SelectItem value="EGP" className="text-white">جنيه</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">المبلغ / العدد</Label>
              <Input
                type="number"
                min="0"
                step="any"
                value={editForm.amount}
                onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="0"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">الشهر</Label>
              <Select
                value={editForm.month}
                onValueChange={(v) => setEditForm((p) => ({ ...p, month: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر الشهر" />
                </SelectTrigger>
                <SelectContent>
                  {MONTH_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value} className="text-white">
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">تاريخ الخصم</Label>
              <Input
                value={editForm.deductionDate}
                onChange={(e) => setEditForm((p) => ({ ...p, deductionDate: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">السبب</Label>
              <Textarea
                value={editForm.reason}
                onChange={(e) => setEditForm((p) => ({ ...p, reason: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="اكتب سبب الخصم..."
                required
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditOpen(false)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleEdit}
              disabled={saving || !editForm.amount || !editForm.reason}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
