'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
  Award,
  Plus,
  Search,
  X,
  Link as LinkIcon,
  Trash2,
} from 'lucide-react';
import type { QualityDeduction, Employee } from '@/types';

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

export default function QualityPage() {
  const { canEdit } = usePermissions('quality');
  const [deductions, setDeductions] = useState<QualityWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
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
        fetch('/api/quality'),
        fetch('/api/employees'),
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

  const handleAdd = async () => {
    if (!addForm.employeeId || !addForm.date) return;

    const deductionDays =
      addForm.dayPreset === 'custom'
        ? parseFloat(addForm.customDays) || 0
        : parseFloat(addForm.dayPreset) || 0;

    setSaving(true);
    try {
      const res = await fetch('/api/quality', {
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
        await fetchData();
        setIsAddOpen(false);
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
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/quality/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeductions((prev) => prev.filter((d) => d.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    }
  };

  const filtered = deductions.filter((d) => {
    const name = d.employee?.name?.toLowerCase() || '';
    const matchesSearch = name.includes(search.toLowerCase());
    const matchesMonth = monthFilter && monthFilter !== 'all'
      ? d.month === monthFilter
      : true;
    return matchesSearch && matchesMonth;
  });

  // Per-employee totals - emphasize DAYS
  const totals = filtered.reduce<Record<string, { days: number; amount: number; name: string }>>((acc, d) => {
    if (!acc[d.employeeId]) {
      acc[d.employeeId] = { days: 0, amount: 0, name: d.employee?.name || 'غير معروف' };
    }
    acc[d.employeeId].days += d.deductionDays;
    acc[d.employeeId].amount += d.deductionAmount;
    return acc;
  }, {});

  // Grand totals
  const grandTotalDays = Object.values(totals).reduce((sum, t) => sum + t.days, 0);
  const grandTotalAmount = Object.values(totals).reduce((sum, t) => sum + t.amount, 0);

  // Month options
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

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
            <Award className="size-6 text-emerald-400" />
            خصومات الجودة
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {filtered.length} سجل خصم — إجمالي {grandTotalDays} يوم
          </p>
        </div>
        {canEdit && (
          <Button
            onClick={() => setIsAddOpen(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Plus className="size-4" />
            إضافة خصم
          </Button>
        )}
      </motion.div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            placeholder="بحث باسم الموظف..."
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
        <Select value={monthFilter} onValueChange={setMonthFilter}>
          <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-full sm:w-48">
            <SelectValue placeholder="تصفية بالشهر" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-white">الكل</SelectItem>
            {months.map((m) => (
              <SelectItem key={m} value={m} className="text-white">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Per-employee totals - DAYS emphasized */}
      {Object.keys(totals).length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {/* Grand total card */}
          <Card className="border-amber-500/30 bg-amber-500/5 col-span-1 sm:col-span-2 lg:col-span-1">
            <CardContent className="p-4">
              <p className="text-slate-400 text-xs mb-1">الإجمالي العام</p>
              <p className="text-amber-400 font-bold text-2xl">{grandTotalDays} <span className="text-sm font-normal">يوم</span></p>
              {grandTotalAmount > 0 && (
                <p className="text-rose-400 text-sm mt-1" dir="ltr">
                  {grandTotalAmount.toLocaleString()} جنيه
                </p>
              )}
            </CardContent>
          </Card>
          {Object.entries(totals).map(([empId, total]) => (
            <Card key={empId} className="border-slate-700/50 bg-slate-800/50">
              <CardContent className="p-4">
                <p className="text-white font-medium text-sm mb-2 truncate">{total.name}</p>
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-slate-500 text-xs">أيام الخصم</p>
                    <p className="text-amber-400 font-bold text-xl">{total.days}</p>
                  </div>
                  {total.amount > 0 && (
                    <div>
                      <p className="text-slate-500 text-xs">مبلغ</p>
                      <p className="text-rose-400 font-bold text-lg" dir="ltr">
                        {total.amount.toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Award className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد خصومات</p>
            <p className="text-slate-500 text-sm mt-1">
              {search || (monthFilter && monthFilter !== 'all') ? 'لم يتم العثور على نتائج' : 'لم يتم تسجيل أي خصومات بعد'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
        >
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700 hover:bg-transparent">
                  <TableHead className="text-slate-400 text-sm font-medium">الموظف</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">التاريخ</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden sm:table-cell">النوع</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الخصم</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden md:table-cell">الوصف</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden lg:table-cell">الدليل</TableHead>
                  {canEdit && (
                    <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow
                    key={d.id}
                    className="border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <TableCell className="text-white font-medium">{d.employee?.name || 'غير معروف'}</TableCell>
                    <TableCell className="text-slate-300" dir="ltr">{d.date}</TableCell>
                    <TableCell className="text-slate-300 hidden sm:table-cell">
                      {d.type === 'quality_issue' ? 'مشكلة جودة' : d.type === 'safety' ? 'سلامة' : 'التزام'}
                    </TableCell>
                    <TableCell className="text-amber-400 font-medium" dir="ltr">
                      {getDayLabel(d.deductionDays)}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm max-w-xs truncate hidden md:table-cell">
                      {d.description}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {d.evidence ? (
                        <a
                          href={d.evidence}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 text-sm"
                        >
                          <LinkIcon className="size-3.5" />
                          دليل
                        </a>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeletingId(d.id)}
                          className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Add Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-white">إضافة خصم جودة</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل تفاصيل الخصم - يتم حساب الشهر تلقائياً من التاريخ</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">الموظف</Label>
              <Select
                value={addForm.employeeId}
                onValueChange={(v) => setAddForm((p) => ({ ...p, employeeId: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر موظفاً" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id} className="text-white">
                      {emp.name} {emp.department ? `(${emp.department})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">التاريخ</Label>
              <Input
                value={addForm.date}
                onChange={(e) => handleDateChange(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">النوع</Label>
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
              <Label className="text-slate-300">نوع الخصم (بالأيام)</Label>
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
                <Label className="text-slate-300">عدد الأيام (مخصص)</Label>
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
              <Label className="text-slate-300">مبلغ الخصم (اختياري)</Label>
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
              <Label className="text-slate-300">الشهر (تلقائي)</Label>
              <Input
                value={addForm.month}
                readOnly
                className="bg-slate-800/50 border-slate-600 text-slate-400"
                placeholder="YYYY-MM"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">الوصف</Label>
              <Textarea
                value={addForm.description}
                onChange={(e) => setAddForm((p) => ({ ...p, description: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="وصف الخصم..."
                rows={2}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">رابط الدليل (اختياري)</Label>
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
              onClick={() => setIsAddOpen(false)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleAdd}
              disabled={saving || !addForm.employeeId || !addForm.date}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
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
