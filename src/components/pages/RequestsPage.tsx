'use client';

import { useState, useEffect, useRef } from 'react';
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
  FileText,
  Plus,
  Check,
  X,
  Clock,
  Search,
  Pencil,
  Trash2,
  AlertTriangle,
  CalendarDays,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import { EmployeeSearchInput } from '@/components/shared/EmployeeSearchInput';
import type { RequestRecord, Employee } from '@/types';
import { useAppStore } from '@/lib/store';
import { useAuth } from '@/contexts/AuthContext';
import { getRequestTypeLabel, getRequestTypeColor } from '@/lib/date-utils';
import { logCreate, logApprove, logDelete } from '@/lib/activity-logger';
import { toast } from 'sonner';

interface RequestWithEmployee extends RequestRecord {
  employeeName: string;
  employee?: { id: string; name: string; department: string | null };
}

export default function RequestsPage() {
  const { canEdit, canCreate, canUpdate, canDelete, canApprove } = usePermissions('requests');
  const { user } = useAuth();
  const { highlightId, setHighlightId } = useAppStore();
  const highlightRef = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState<RequestWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{ created: number; skipped: number; errors: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [addForm, setAddForm] = useState({
    employeeId: '',
    type: 'leave',
    date: '',
    reason: '',
  });
  const [editForm, setEditForm] = useState({
    id: '',
    employeeId: '',
    type: 'leave',
    date: '',
    reason: '',
  });

  // Auto-scroll to highlighted card and clear highlight after 3 seconds
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => {
        setHighlightId(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightId, setHighlightId]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [reqRes, empRes] = await Promise.all([
        fetch('/api/requests'),
        fetch('/api/employees'),
      ]);
      if (reqRes.ok) {
        const reqData = await reqRes.json();
        setRequests(reqData);
      }
      if (empRes.ok) {
        const empData = await empRes.json();
        setEmployees(empData);
      }
    } catch {
      setRequests([]);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  };

   // ═══ Excel Upload Handler ═══
  const handleUploadExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/requests', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setUploadResult({ created: data.created, skipped: data.skipped, errors: data.errors || [] });
        logCreate('requests', 'رفع شيت اكسيل', `تم رفع ${data.created} طلب من ملف ${file.name}`);
        toast.success(`تم رفع ${data.created} طلب بنجاح${data.skipped > 0 ? ` — ${data.skipped} تم تخطيها` : ''}`);
        // Reset filters so new data is visible
        setSearch('');
        setMonthFilter('all');
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

  const openEditDialog = (req: RequestWithEmployee) => {
    setEditForm({
      id: req.id,
      employeeId: req.employeeId,
      type: req.type,
      date: req.date,
      reason: req.reason || '',
    });
    setIsEditOpen(true);
  };

  const handleAdd = async () => {
    if (!addForm.employeeId || !addForm.date || !addForm.reason) return;
    setSaving(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addForm),
      });
      if (res.ok) {
        const empName = employees.find((e: any) => e.id === addForm.employeeId)?.name || '';
        logCreate('requests', 'طلب', `${getRequestTypeLabel(addForm.type)} - ${empName}`);
        await fetchData();
        setIsAddOpen(false);
        setAddForm({ employeeId: '', type: 'leave', date: '', reason: '' });
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!editForm.employeeId || !editForm.date || !editForm.reason) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/requests/${editForm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: editForm.employeeId,
          type: editForm.type,
          date: editForm.date,
          reason: editForm.reason,
        }),
      });
      if (res.ok) {
        await fetchData();
        setIsEditOpen(false);
      }
    } catch {
      // Error handled silently
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const req = requests.find((r: any) => r.id === id);
      const res = await fetch(`/api/requests/${id}`, { method: 'DELETE' });
      if (res.ok) {
        if (req) logDelete('requests', 'طلب', `${req.employeeName || ''} - ${getRequestTypeLabel(req.type)}`);
        setRequests((prev) => prev.filter((r) => r.id !== id));
        setDeletingId(null);
      }
    } catch {
      // Error handled silently
    }
  };

  const handleReview = async (id: string, status: 'approved' | 'rejected') => {
    setReviewing(true);
    try {
      const res = await fetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, reviewedBy: user?.id }),
      });
      if (res.ok) {
        const req = requests.find((r: any) => r.id === id);
        if (req) logApprove('requests', 'طلب', `${req.employeeName || ''} - ${getRequestTypeLabel(req.type)}`, status);
        await fetchData();
      }
    } catch {
      // Error handled silently
    } finally {
      setReviewing(false);
    }
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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'pending':
        return <Clock className="size-3.5 text-amber-400" />;
      case 'approved':
        return <Check className="size-3.5 text-green-400" />;
      case 'rejected':
        return <X className="size-3.5 text-red-400" />;
      default:
        return null;
    }
  };

  // Month options
  const now = new Date();
  const monthOptions: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthOptions.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const extractMonth = (dateStr: string): string => {
    try {
      const parts = dateStr.split('/');
      const month = parseInt(parts[1], 10);
      const year = parseInt(parts[2], 10);
      if (!isNaN(month) && !isNaN(year)) {
        return `${year}-${String(month).padStart(2, '0')}`;
      }
    } catch { /* ignore */ }
    return '';
  };

  const pending = requests.filter((r) => r.status === 'pending');
  const other = requests.filter((r) => r.status !== 'pending');

  const matchesFilter = (r: RequestWithEmployee) => {
    const matchesSearch =
      (r.employeeName || '').toLowerCase().includes(search.toLowerCase()) ||
      r.date.includes(search) ||
      getRequestTypeLabel(r.type).includes(search);
    const matchesMonth = monthFilter && monthFilter !== 'all'
      ? extractMonth(r.date) === monthFilter
      : true;
    return matchesSearch && matchesMonth;
  };

  const filteredPending = pending.filter(matchesFilter);
  const filteredOther = other.filter(matchesFilter);

  return (
    <div dir="rtl" className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-violet-500/15 border border-violet-500/30">
            <FileText className="size-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">إدارة الطلبات</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              {requests.length} طلب — {pending.length} معلق
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              onClick={() => setIsAddOpen(true)}
              size="sm"
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              <Plus className="size-4 ml-1" />
              تقديم طلب
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
                size="sm"
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

      {/* Search + Month Filter */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
          <Input
            placeholder="بحث باسم الموظف أو التاريخ أو النوع..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-slate-800/70 border-slate-700/70 text-white pr-10 placeholder:text-slate-500 h-9 text-sm"
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
            {monthOptions.map((m) => (
              <SelectItem key={m} value={m} className="text-white">{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-xl bg-slate-800/50" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <FileText className="size-6 text-slate-600" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد طلبات</p>
            <p className="text-slate-600 text-xs mt-1">ابدأ بتقديم طلب جديد</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* ═══ Pending Requests — Cards ═══ */}
          {filteredPending.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-sm font-semibold text-amber-400 mb-3 flex items-center gap-2">
                <Clock className="size-4" />
                الطلبات المعلقة ({filteredPending.length})
              </h2>
              <div className="space-y-2.5">
                <AnimatePresence>
                  {filteredPending.map((req) => {
                    const isHighlighted = req.id === highlightId;
                    return (
                      <motion.div
                        key={req.id}
                        ref={isHighlighted ? highlightRef : undefined}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className={`rounded-xl border p-4 hover:bg-slate-800/80 transition-all ${
                          isHighlighted
                            ? 'border-amber-500 ring-2 ring-amber-500 shadow-lg shadow-amber-500/20 bg-slate-800/80'
                            : 'border-amber-500/20 bg-slate-800/50'
                        }`}
                      >
                        <div className="flex flex-col gap-3">
                          {/* Row 1: Employee + Type + Date */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <EmployeeLink employeeId={req.employeeId} name={req.employeeName} />
                              <Badge className={`${getRequestTypeColor(req.type)} text-[11px] px-2 py-0`}>
                                {getRequestTypeLabel(req.type)}
                              </Badge>
                              <span className="text-slate-500 text-xs" dir="ltr">{req.date}</span>
                            </div>
                            {/* Action buttons */}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {canUpdate && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditDialog(req)}
                                  className="text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 h-8 px-2.5"
                                >
                                  <Pencil className="size-3.5" />
                                  تعديل
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeletingId(req.id)}
                                  className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 h-8 px-2.5"
                                >
                                  <Trash2 className="size-3.5" />
                                  حذف
                                </Button>
                              )}
                              {canApprove && (
                                <>
                                  <Button
                                    size="sm"
                                    onClick={() => handleReview(req.id, 'approved')}
                                    disabled={reviewing}
                                    className="bg-green-600 hover:bg-green-700 text-white h-8 px-3"
                                  >
                                    <Check className="size-3.5 ml-1" />
                                    قبول
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleReview(req.id, 'rejected')}
                                    disabled={reviewing}
                                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 h-8 px-3"
                                  >
                                    <X className="size-3.5 ml-1" />
                                    رفض
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Row 2: Reason */}
                          <div className="pr-11">
                            <p className="text-slate-400 text-xs leading-relaxed">{req.reason}</p>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* ═══ Other Requests — Table ═══ */}
          {filteredOther.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="rounded-xl border border-slate-700/40 bg-slate-800/50 overflow-hidden"
            >
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700/50 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-xs font-semibold py-3 px-4">الموظف</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold py-3 px-3">النوع</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold py-3 px-3">التاريخ</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold py-3 px-3">السبب</TableHead>
                      <TableHead className="text-slate-400 text-xs font-semibold py-3 px-3">الحالة</TableHead>
                      {(canUpdate || canDelete) && (
                        <TableHead className="text-slate-400 text-xs font-semibold py-3 px-3 text-center">إجراءات</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOther.map((req, idx) => (
                      <TableRow
                        key={req.id}
                        className={`border-slate-700/30 hover:bg-slate-700/20 transition-colors ${
                          idx % 2 === 0 ? 'bg-slate-800/20' : 'bg-transparent'
                        }`}
                      >
                        <TableCell className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <EmployeeLink employeeId={req.employeeId} name={req.employeeName} compact />
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <Badge className={`${getRequestTypeColor(req.type)} text-[10px] px-1.5 py-0`}>
                            {getRequestTypeLabel(req.type)}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-slate-400 text-xs" dir="ltr">{req.date}</TableCell>
                        <TableCell className="py-3 px-3 text-slate-500 text-xs max-w-[200px] truncate" title={req.reason}>
                          {req.reason}
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            {getStatusIcon(req.status)}
                            {getStatusBadge(req.status)}
                          </div>
                        </TableCell>
                        {(canUpdate || canDelete) && (
                          <TableCell className="py-3 px-3">
                            <div className="flex items-center justify-center gap-1">
                              {canUpdate && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditDialog(req)}
                                  className="text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 size-7 p-0"
                                >
                                  <Pencil className="size-3" />
                                </Button>
                              )}
                              {canDelete && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setDeletingId(req.id)}
                                  className="text-slate-500 hover:text-red-400 hover:bg-red-500/10 size-7 p-0"
                                >
                                  <Trash2 className="size-3" />
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

      {/* ═══ Add Dialog ═══ */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">تقديم طلب جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل تفاصيل الطلب</DialogDescription>
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
              <Label className="text-slate-300 text-sm">نوع الطلب</Label>
              <Select
                value={addForm.type}
                onValueChange={(v) => setAddForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave" className="text-white">إجازة</SelectItem>
                  <SelectItem value="permission" className="text-white">استئذان</SelectItem>
                  <SelectItem value="excuse" className="text-white">غياب</SelectItem>
                  <SelectItem value="tardiness" className="text-white">تأخير</SelectItem>
                  <SelectItem value="remote" className="text-white">ريموتلي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">التاريخ</Label>
              <Input
                value={addForm.date}
                onChange={(e) => setAddForm((p) => ({ ...p, date: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">السبب</Label>
              <Textarea
                value={addForm.reason}
                onChange={(e) => setAddForm((p) => ({ ...p, reason: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white resize-none"
                placeholder="اكتب سبب الطلب..."
                required
                rows={3}
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
              disabled={saving || !addForm.employeeId || !addForm.date || !addForm.reason}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري التقديم...' : 'تقديم'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Edit Dialog ═══ */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">تعديل الطلب</DialogTitle>
            <DialogDescription className="text-slate-400">تعديل تفاصيل الطلب</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <EmployeeSearchInput
                employees={employees}
                value={editForm.employeeId}
                onChange={(id) => setEditForm((p) => ({ ...p, employeeId: id }))}
                label="الموظف"
                placeholder="ابحث عن اسم الموظف..."
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">نوع الطلب</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => setEditForm((p) => ({ ...p, type: v }))}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="leave" className="text-white">إجازة</SelectItem>
                  <SelectItem value="permission" className="text-white">استئذان</SelectItem>
                  <SelectItem value="excuse" className="text-white">غياب</SelectItem>
                  <SelectItem value="tardiness" className="text-white">تأخير</SelectItem>
                  <SelectItem value="remote" className="text-white">ريموتلي</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300 text-sm">التاريخ</Label>
              <Input
                value={editForm.date}
                onChange={(e) => setEditForm((p) => ({ ...p, date: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white"
                placeholder="DD/MM/YYYY"
                dir="ltr"
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label className="text-slate-300 text-sm">السبب</Label>
              <Textarea
                value={editForm.reason}
                onChange={(e) => setEditForm((p) => ({ ...p, reason: e.target.value }))}
                className="bg-slate-800 border-slate-600 text-white resize-none"
                placeholder="اكتب سبب الطلب..."
                rows={3}
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
              disabled={saving || !editForm.employeeId || !editForm.date || !editForm.reason}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ Delete Confirmation Dialog ═══ */}
      <Dialog open={!!deletingId} onOpenChange={() => setDeletingId(null)}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700 max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-400" />
              تأكيد الحذف
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              هل أنت متأكد من حذف هذا الطلب؟ لا يمكن التراجع عن هذا الإجراء.
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
            <DialogDescription className="text-slate-400">تفاصيل عملية رفع البيانات</DialogDescription>
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
