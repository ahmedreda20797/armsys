'use client';

import { useState, useEffect, useCallback } from 'react';
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
  Clock,
  Plus,
  Search,
  X,
  LogOut,
  Trash2,
} from 'lucide-react';
import type { Employee } from '@/types';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';

interface AttendanceRecord {
  id: string;
  employeeId: string;
  date: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  minutesLate: number;
  notes: string | null;
  approvedRequestId: string | null;
  createdAt: string;
  employee?: {
    id: string;
    name: string;
    department: string | null;
    shiftStart: string | null;
  };
}

function getTodayDate(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

const LATE_GRACE_PERIOD = 15; // minutes — first 15 min are free, late starts at minute 16

function calcMinutesLate(checkIn: string, shiftStart: string | null): number {
  if (!checkIn || !shiftStart) return 0;
  const [cH, cM] = checkIn.split(':').map(Number);
  const [wH, wM] = shiftStart.split(':').map(Number);
  const checkInMinutes = cH * 60 + cM;
  const shiftStartMinutes = wH * 60 + wM;
  const diff = checkInMinutes - shiftStartMinutes;
  return diff > 0 ? diff : 0;
}

function isLate(minutesLate: number): boolean {
  return minutesLate > LATE_GRACE_PERIOD;
}

export default function AttendancePage() {
  const { canEdit, canCreate, canUpdate, canDelete, canExport } = usePermissions('attendance');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [checkoutRecord, setCheckoutRecord] = useState<AttendanceRecord | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [addForm, setAddForm] = useState({
    employeeId: '',
    date: getTodayDate(),
    checkIn: '',
    status: '',
    notes: '',
  });

  const [editForm, setEditForm] = useState({
    checkOut: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [attRes, empRes] = await Promise.all([
        fetch('/api/attendance'),
        fetch('/api/employees'),
      ]);
      if (attRes.ok) {
        const attData = await attRes.json();
        setRecords(attData);
      }
      if (empRes.ok) {
        const empData = await empRes.json();
        setEmployees(empData);
      }
    } catch {
      setRecords([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAdd = async () => {
    if (!addForm.employeeId || !addForm.date) return;

    const selectedEmp = employees.find((e) => e.id === addForm.employeeId);
    const shiftStart = selectedEmp?.shiftStart || null;
    const checkIn = addForm.checkIn.trim();

    // Auto-detect status
    let status = addForm.status || 'present';
    let minutesLate = 0;

    if (checkIn && shiftStart) {
      minutesLate = calcMinutesLate(checkIn, shiftStart);
      if (isLate(minutesLate)) {
        status = 'late';
      } else if (!checkIn) {
        status = 'absent';
      } else {
        status = 'present';
      }
    } else if (!checkIn) {
      status = 'absent';
    }

    setSaving(true);
    try {
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: addForm.employeeId,
          date: addForm.date,
          checkIn: checkIn || null,
          checkOut: null,
          status,
          minutesLate,
          notes: addForm.notes || null,
        }),
      });
      if (res.ok) {
        const empName = employees.find((e: any) => e.id === addForm.employeeId)?.name || '';
        logCreate('attendance', 'سجل حضور', `${empName} - ${addForm.date}`);
        await fetchData();
        setIsAddOpen(false);
        setAddForm({
          employeeId: '',
          date: getTodayDate(),
          checkIn: '',
          status: '',
          notes: '',
        });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleCheckout = async () => {
    if (!checkoutRecord || !editForm.checkOut.trim()) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/attendance/${checkoutRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          checkOut: editForm.checkOut.trim(),
        }),
      });
      if (res.ok) {
        const empName = employees.find((e: any) => e.id === checkoutRecord.employeeId)?.name || '';
        logUpdate('attendance', 'تسجيل خروج', `${empName} - ${checkoutRecord.date}`);
        await fetchData();
        setCheckoutRecord(null);
        setEditForm({ checkOut: '' });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/attendance/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const rec = records.find((r) => r.id === id);
        if (rec) logDelete('attendance', 'سجل حضور', `${rec.employee?.name || ''} - ${rec.date}`);
        setRecords((prev) => prev.filter((r) => r.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    }
  };

  const getStatusBadge = (status: string, minutesLate: number) => {
    if (status === 'approved') {
      return <Badge className="bg-green-500/15 text-green-400 border-green-500/20">مؤيد</Badge>;
    }
    if (status === 'absent') {
      return <Badge className="bg-red-500/15 text-red-400 border-red-500/20">غائب</Badge>;
    }
    if (status === 'late' || minutesLate > 0) {
      let colorClass = 'bg-amber-500/15 text-amber-400 border-amber-500/20';
      if (minutesLate >= 60) {
        colorClass = 'bg-red-500/15 text-red-400 border-red-500/20';
      } else if (minutesLate >= 30) {
        colorClass = 'bg-orange-500/15 text-orange-400 border-orange-500/20';
      }
      return (
        <Badge className={colorClass}>
          متأخر ({minutesLate} د)
        </Badge>
      );
    }
    return <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20">حاضر</Badge>;
  };

  const filtered = records.filter((rec) => {
    const name = rec.employee?.name?.toLowerCase() || '';
    const matchesSearch = name.includes(search.toLowerCase()) || rec.date.includes(search);
    const matchesMonth = monthFilter && monthFilter !== 'all'
      ? rec.date.toLowerCase().includes(monthFilter)
      : true;
    return matchesSearch && matchesMonth;
  });

  // Generate month options
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
    months.push(val);
  }

  // Summary stats
  const totalPresent = filtered.filter((r) => r.status === 'present').length;
  const totalLate = filtered.filter((r) => r.status === 'late' || r.minutesLate > 0).length;
  const totalAbsent = filtered.filter((r) => r.status === 'absent').length;

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
            <Clock className="size-6 text-emerald-400" />
            سجل الحضور والانصراف
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {filtered.length} سجل حضور
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canCreate && (
            <Button
              onClick={() => {
                setAddForm({
                  employeeId: '',
                  date: getTodayDate(),
                  checkIn: '',
                  status: '',
                  notes: '',
                });
                setIsAddOpen(true);
              }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Plus className="size-4" />
              تسجيل حضور
            </Button>
          )}
        </div>
      </motion.div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="p-4 text-center">
            <p className="text-slate-400 text-xs mb-1">إجمالي السجلات</p>
            <p className="text-white text-2xl font-bold">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="p-4 text-center">
            <p className="text-slate-400 text-xs mb-1">حاضر</p>
            <p className="text-emerald-400 text-2xl font-bold">{totalPresent}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="p-4 text-center">
            <p className="text-slate-400 text-xs mb-1">متأخر</p>
            <p className="text-amber-400 text-2xl font-bold">{totalLate}</p>
          </CardContent>
        </Card>
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="p-4 text-center">
            <p className="text-slate-400 text-xs mb-1">غائب</p>
            <p className="text-red-400 text-2xl font-bold">{totalAbsent}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            placeholder="بحث باسم الموظف أو التاريخ..."
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
            <Clock className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد سجلات</p>
            <p className="text-slate-500 text-sm mt-1">
              {search || (monthFilter && monthFilter !== 'all') ? 'لم يتم العثور على نتائج' : 'ابدأ بتسجيل الحضور'}
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
                  <TableHead className="text-slate-400 text-sm font-medium">الحضور</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الانصراف</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">الحالة</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium hidden md:table-cell">ملاحظات</TableHead>
                  {(canUpdate || canDelete) && (
                    <TableHead className="text-slate-400 text-sm font-medium">إجراءات</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((rec) => (
                  <TableRow
                    key={rec.id}
                    className="border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <TableCell className="text-white font-medium">
                      {rec.employee?.name || 'غير معروف'}
                    </TableCell>
                    <TableCell className="text-slate-300" dir="ltr">{rec.date}</TableCell>
                    <TableCell className="text-slate-300" dir="ltr">
                      {rec.checkIn || '—'}
                    </TableCell>
                    <TableCell className="text-slate-300" dir="ltr">
                      {rec.checkOut ? (
                        <span>{rec.checkOut}</span>
                      ) : (
                        canUpdate ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCheckoutRecord(rec);
                              setEditForm({ checkOut: '' });
                            }}
                            className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 text-xs gap-1 h-7"
                          >
                            <LogOut className="size-3" />
                            تسجيل
                          </Button>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )
                      )}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(rec.status, rec.minutesLate)}
                    </TableCell>
                    <TableCell className="text-slate-400 text-sm hidden md:table-cell">
                      {rec.notes || '—'}
                    </TableCell>
                    {(canUpdate || canDelete) && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingId(rec.id)}
                            className="text-slate-400 hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 className="size-4" />
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

      {/* Add Attendance Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">تسجيل حضور</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل بيانات تسجيل الحضور - يتم حساب التأخير تلقائياً</DialogDescription>
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
                onChange={(e) => setAddForm((p) => ({ ...p, date: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">وقت الحضور</Label>
              <Input
                value={addForm.checkIn}
                onChange={(e) => setAddForm((p) => ({ ...p, checkIn: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="09:17"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">ملاحظات</Label>
              <Textarea
                value={addForm.notes}
                onChange={(e) => setAddForm((p) => ({ ...p, notes: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="ملاحظات إضافية (اختياري)..."
                rows={2}
              />
            </div>
            {/* Auto-calculation preview */}
            {addForm.employeeId && addForm.checkIn && (
              <div className="sm:col-span-2 rounded-lg bg-slate-800 border border-slate-700 p-3">
                <p className="text-xs text-slate-400 mb-1">📊 معاينة تلقائية:</p>
                {(() => {
                  const emp = employees.find((e) => e.id === addForm.employeeId);
                  const ws = emp?.shiftStart || null;
                  const late = calcMinutesLate(addForm.checkIn, ws);
                  return (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-slate-300">
                        وقت العمل: <span className="text-cyan-400" dir="ltr">{ws || 'غير محدد'}</span>
                      </span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-300">
                        وقت الحضور: <span className="text-white" dir="ltr">{addForm.checkIn}</span>
                      </span>
                      <span className="text-slate-500">|</span>
                      <span className={late > 0 ? 'text-amber-400' : 'text-emerald-400'}>
                        {late > 0 ? `متأخر ${late} دقيقة` : 'في الوقت'}
                      </span>
                    </div>
                  );
                })()}
              </div>
            )}
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

      {/* Checkout Dialog */}
      <Dialog open={!!checkoutRecord} onOpenChange={() => setCheckoutRecord(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white">تسجيل وقت الانصراف</DialogTitle>
            <DialogDescription className="text-slate-400">
              الموظف: {checkoutRecord?.employee?.name || 'غير معروف'} — {checkoutRecord?.date}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">وقت الانصراف</Label>
              <Input
                value={editForm.checkOut}
                onChange={(e) => setEditForm({ checkOut: e.target.value })}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="17:00"
                dir="ltr"
                autoFocus
              />
            </div>
            {checkoutRecord && (
              <div className="rounded-lg bg-slate-800 border border-slate-700 p-3">
                <p className="text-xs text-slate-400">وقت الحضور المسجل</p>
                <p className="text-white text-lg font-medium" dir="ltr">{checkoutRecord.checkIn || '—'}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCheckoutRecord(null)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleCheckout}
              disabled={saving || !editForm.checkOut.trim()}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? 'جاري الحفظ...' : 'تسجيل الانصراف'}
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
              هل أنت متأكد من حذف سجل الحضور هذا؟ لا يمكن التراجع عن هذا الإجراء.
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
