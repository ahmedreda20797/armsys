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
} from 'lucide-react';
import type { RequestRecord, Employee } from '@/types';
import { useAppStore } from '@/lib/store';
import { useAuth } from '@/contexts/AuthContext';
import { getRequestTypeLabel, getRequestTypeColor } from '@/lib/date-utils';
import { logCreate, logApprove } from '@/lib/activity-logger';

interface RequestWithEmployee extends RequestRecord {
  employeeName: string;
}

export default function RequestsPage() {
  const { canEdit, canCreate, canApprove } = usePermissions('requests');
  const { user } = useAuth();
  const { highlightId, setHighlightId } = useAppStore();
  const highlightRef = useRef<HTMLDivElement>(null);
  const [requests, setRequests] = useState<RequestWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [addForm, setAddForm] = useState({
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

  const pending = requests.filter((r) => r.status === 'pending');
  const other = requests.filter((r) => r.status !== 'pending');
  const filteredPending = pending.filter(
    (r) =>
      (r.employeeName || '').toLowerCase().includes(search.toLowerCase()) ||
      r.date.includes(search)
  );
  const filteredOther = other.filter(
    (r) =>
      (r.employeeName || '').toLowerCase().includes(search.toLowerCase()) ||
      r.date.includes(search)
  );

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
            <FileText className="size-6 text-violet-400" />
            إدارة الطلبات
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {pending.length} طلب معلق
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              onClick={() => setIsAddOpen(true)}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              <Plus className="size-4" />
              تقديم طلب
            </Button>
          )}
        </div>
      </motion.div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
        <Input
          placeholder="بحث باسم الموظف أو التاريخ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-slate-800 border-slate-600 text-white pr-10 placeholder:text-slate-500"
        />
      </div>

      {/* Loading */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-slate-800" />
          ))}
        </div>
      ) : requests.length === 0 ? (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد طلبات</p>
            <p className="text-slate-500 text-sm mt-1">ابدأ بتقديم طلب جديد</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pending Requests */}
          {filteredPending.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
                <Clock className="size-5" />
                الطلبات المعلقة ({filteredPending.length})
              </h2>
              <div className="space-y-3">
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
                        className={`rounded-xl border bg-slate-800/50 p-4 hover:bg-slate-800/80 transition-all ${
                          isHighlighted
                            ? 'border-amber-500 ring-2 ring-amber-500 shadow-lg shadow-amber-500/20'
                            : 'border-amber-500/20'
                        }`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-white font-medium">{req.employeeName}</span>
                              <Badge className={getRequestTypeColor(req.type)}>
                                {getRequestTypeLabel(req.type)}
                              </Badge>
                              <span className="text-slate-400 text-sm" dir="ltr">{req.date}</span>
                            </div>
                            <p className="text-slate-400 text-sm">{req.reason}</p>
                          </div>
                          {canApprove && (
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => handleReview(req.id, 'approved')}
                                disabled={reviewing}
                                className="bg-green-600 hover:bg-green-700 text-white"
                              >
                                <Check className="size-3.5" />
                                قبول
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleReview(req.id, 'rejected')}
                                disabled={reviewing}
                                className="border-red-500/30 text-red-400 hover:bg-red-500/10"
                              >
                                <X className="size-3.5" />
                                رفض
                              </Button>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}

          {/* Other Requests */}
          {filteredOther.length > 0 && (
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
                      <TableHead className="text-slate-400 text-sm font-medium">التاريخ</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">السبب</TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium">الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOther.map((req) => (
                      <TableRow
                        key={req.id}
                        className="border-slate-700/50 hover:bg-slate-700/30"
                      >
                        <TableCell className="text-white font-medium">{req.employeeName}</TableCell>
                        <TableCell className="text-slate-300">{getRequestTypeLabel(req.type)}</TableCell>
                        <TableCell className="text-slate-300" dir="ltr">{req.date}</TableCell>
                        <TableCell className="text-slate-400 text-sm max-w-xs truncate">{req.reason}</TableCell>
                        <TableCell>{getStatusBadge(req.status)}</TableCell>
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
            <DialogTitle className="text-white">تقديم طلب جديد</DialogTitle>
            <DialogDescription className="text-slate-400">أدخل تفاصيل الطلب</DialogDescription>
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
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-slate-300">نوع الطلب</Label>
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
              <Label className="text-slate-300">التاريخ</Label>
              <Input
                value={addForm.date}
                onChange={(e) => setAddForm((p) => ({ ...p, date: e.target.value }))}
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
                placeholder="اكتب سبب الطلب..."
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
              disabled={saving || !addForm.employeeId || !addForm.date || !addForm.reason}
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white h-9 px-5 shadow-lg shadow-violet-500/20 transition-all"
            >
              {saving ? 'جاري التقديم...' : 'تقديم'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
