'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
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
  Clock,
  Plus,
  Search,
  X,
  LogOut,
  Trash2,
  FileSpreadsheet,
  Pencil,
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import type { Employee } from '@/types';
import { logCreate, logUpdate, logDelete } from '@/lib/activity-logger';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';

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
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [addForm, setAddForm] = useState({
    employeeId: '',
    date: getTodayDate(),
    checkIn: '',
    status: '',
    notes: '',
  });

  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editForm, setEditForm] = useState({
    checkOut: '',
  });
  const [editAttendanceForm, setEditAttendanceForm] = useState({
    date: '',
    checkIn: '',
    checkOut: '',
    status: '',
    notes: '',
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = useCallback(async () => {
    try {
      const [attRes, empRes] = await Promise.all([
        authFetch('/api/attendance'),
        authFetch('/api/employees'),
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

  // ═══ Excel Upload Handler ═══
  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await authFetch('/api/attendance/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setUploadResult({ created: data.created, skipped: data.skipped, errors: data.errors || [] });
        logCreate('attendance', 'رفع شيت اكسيل', `تم رفع ${data.created} سجل حضور من ملف ${file.name}`);
        toast.success(`تم رفع ${data.created} سجل حضور بنجاح${data.skipped > 0 ? ` — ${data.skipped} تم تخطيها` : ''}`);
        await fetchData();
      } else {
        toast.error(data.error || 'فشل رفع الملف');
      }
    } catch {
      toast.error('حدث خطأ أثناء رفع الملف');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
      const res = await authFetch('/api/attendance', {
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

  const handleEditAttendance = async () => {
    if (!editingRecord) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/attendance/${editingRecord.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: editAttendanceForm.date,
          checkIn: editAttendanceForm.checkIn || null,
          checkOut: editAttendanceForm.checkOut || null,
          status: editAttendanceForm.status,
          notes: editAttendanceForm.notes || null,
        }),
      });
      if (res.ok) {
        const empName = editingRecord.employee?.name || '';
        logUpdate('attendance', 'تعديل سجل حضور', `${empName} - ${editAttendanceForm.date}`);
        toast.success('تم تعديل سجل الحضور بنجاح');
        await fetchData();
        setEditingRecord(null);
      }
    } catch {
      toast.error('حدث خطأ أثناء تعديل السجل');
    } finally {
      setSaving(false);
    }
  };

  const openEditDialog = (rec: AttendanceRecord) => {
    setEditingRecord(rec);
    setEditAttendanceForm({
      date: rec.date,
      checkIn: rec.checkIn || '',
      checkOut: rec.checkOut || '',
      status: rec.status,
      notes: rec.notes || '',
    });
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
    return <Badge className="bg-violet-500/15 text-violet-400 border-violet-500/30">حاضر</Badge>;
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
            <Clock className="size-6 text-blue-400" />
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
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              <Plus className="size-4" />
              تسجيل حضور
            </Button>
          )}
          {canCreate && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleUploadExcel}
                className="hidden"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                variant="outline"
                className="border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white h-9 px-4 transition-all"
              >
                {uploading ? (
                  <>
                    <motion.div
                      className="size-4 border-2 border-slate-500 border-t-white rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    />
                    جاري الرفع...
                  </>
                ) : (
                  <>
                    <FileSpreadsheet className="size-4 ml-1" />
                    رفع شيت إكسيل
                  </>
                )}
              </Button>
            </>
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
            <p className="text-violet-400 text-2xl font-bold">{totalPresent}</p>
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
                    <TableCell>
                      <EmployeeLink
                        employeeId={rec.employeeId}
                        name={rec.employee?.name}
                        department={rec.employee?.department}
                      />
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
                          {canUpdate && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(rec)}
                            className="text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                          >
                            <Pencil className="size-4" />
                          </Button>
                          )}
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
                      <span className={late > 0 ? 'text-amber-400' : 'text-violet-400'}>
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
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
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
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white"
            >
              {saving ? 'جاري الحفظ...' : 'تسجيل الانصراف'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Attendance Dialog */}
      <Dialog open={!!editingRecord} onOpenChange={() => setEditingRecord(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="size-5 text-emerald-400" />
              تعديل سجل الحضور
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              تعديل بيانات سجل الحضور — الموظف: {editingRecord?.employee?.name || 'غير معروف'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-300">التاريخ</Label>
              <Input
                value={editAttendanceForm.date}
                onChange={(e) => setEditAttendanceForm((p) => ({ ...p, date: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">الحالة</Label>
              <Select
                value={editAttendanceForm.status}
                onValueChange={(v) => setEditAttendanceForm((p) => ({ ...p, status: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="present" className="text-white">حاضر</SelectItem>
                  <SelectItem value="late" className="text-white">متأخر</SelectItem>
                  <SelectItem value="absent" className="text-white">غائب</SelectItem>
                  <SelectItem value="approved" className="text-white">مؤيد</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">وقت الحضور</Label>
              <Input
                value={editAttendanceForm.checkIn}
                onChange={(e) => setEditAttendanceForm((p) => ({ ...p, checkIn: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="09:00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">وقت الانصراف</Label>
              <Input
                value={editAttendanceForm.checkOut}
                onChange={(e) => setEditAttendanceForm((p) => ({ ...p, checkOut: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="17:00"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300">ملاحظات</Label>
              <Textarea
                value={editAttendanceForm.notes}
                onChange={(e) => setEditAttendanceForm((p) => ({ ...p, notes: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="ملاحظات إضافية (اختياري)..."
                rows={2}
              />
            </div>
            {/* Auto-calculation preview */}
            {editingRecord && editAttendanceForm.checkIn && (
              <div className="sm:col-span-2 rounded-lg bg-slate-800 border border-slate-700 p-3">
                <p className="text-xs text-slate-400 mb-1">📊 معاينة التأخير:</p>
                {(() => {
                  const emp = employees.find((e) => e.id === editingRecord.employeeId);
                  const ws = emp?.shiftStart || null;
                  const late = calcMinutesLate(editAttendanceForm.checkIn, ws);
                  return (
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-slate-300">
                        وقت العمل: <span className="text-cyan-400" dir="ltr">{ws || 'غير محدد'}</span>
                      </span>
                      <span className="text-slate-500">|</span>
                      <span className="text-slate-300">
                        وقت الحضور: <span className="text-white" dir="ltr">{editAttendanceForm.checkIn}</span>
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
              onClick={() => setEditingRecord(null)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleEditAttendance}
              disabled={saving || !editAttendanceForm.date || !editAttendanceForm.status}
              className="bg-gradient-to-l from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white h-9 px-5 shadow-lg shadow-emerald-500/20 transition-all"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
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

      {/* ═══ Upload Result Dialog ═══ */}
      <Dialog open={!!uploadResult} onOpenChange={() => setUploadResult(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-emerald-400" />
              نتيجة رفع الشيت
            </DialogTitle>
            <DialogDescription className="text-slate-400">تفاصيل عملية رفع بيانات الحضور</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                <p className="text-2xl font-bold text-emerald-400">{uploadResult?.created || 0}</p>
                <p className="text-slate-400 text-xs mt-1">تم رفعها بنجاح</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                <p className="text-2xl font-bold text-amber-400">{uploadResult?.skipped || 0}</p>
                <p className="text-slate-400 text-xs mt-1">تم تخطيها</p>
              </div>
            </div>
            {uploadResult && uploadResult.errors.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-slate-400 text-xs font-medium">الأخطاء:</p>
                <div className="max-h-40 overflow-y-auto rounded-lg bg-slate-800/60 border border-slate-700/50 p-3">
                  {uploadResult.errors.map((err, i) => (
                    <p key={i} className="text-red-400 text-xs leading-relaxed">{err}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => setUploadResult(null)}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20"
            >
              تم
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
