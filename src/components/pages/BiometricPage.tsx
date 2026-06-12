'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Upload,
  Search,
  Fingerprint,
  Trash2,
  X,
  AlertTriangle,
} from 'lucide-react';
import type { BiometricRecord, Employee } from '@/types';

interface BiometricWithEmployee extends BiometricRecord {
  employeeName: string;
}

export default function BiometricPage() {
  const { canEdit, isAdmin } = usePermissions('biometric');
  const [records, setRecords] = useState<BiometricWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [clearMonth, setClearMonth] = useState('');
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [bioRes, empRes] = await Promise.all([
        fetch('/api/biometric'),
        fetch('/api/employees'),
      ]);
      if (bioRes.ok) {
        const bioData = await bioRes.json();
        setRecords(bioData);
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
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/biometric/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        await fetchData();
      }
    } catch {
      // Error handled silently
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearMonth = async () => {
    if (!clearMonth) return;
    setClearing(true);
    try {
      const res = await fetch('/api/biometric/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: clearMonth }),
      });
      if (res.ok) {
        await fetchData();
        setIsClearOpen(false);
        setClearMonth('');
      }
    } catch {
      // Error handled silently
    } finally {
      setClearing(false);
    }
  };

  const getEmployeeName = (employeeId: string): string => {
    const emp = employees.find((e) => e.id === employeeId);
    return emp?.name || 'غير معروف';
  };

  const filtered = records.filter((rec) => {
    const name = getEmployeeName(rec.employeeId).toLowerCase();
    return name.includes(search.toLowerCase()) || rec.date.includes(search);
  });

  // Generate month options
  const now = new Date();
  const months: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push(val);
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
            <Fingerprint className="size-6 text-emerald-400" />
            بيانات البصمة
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {filtered.length} سجل بصري
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <>
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="border-slate-600 text-slate-300 hover:bg-slate-700"
              >
                {uploading ? 'جاري الرفع...' : <><Upload className="size-4" /> رفع Excel</>}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleUpload}
                className="hidden"
              />
            </>
          )}
          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => setIsClearOpen(true)}
              className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            >
              <Trash2 className="size-4" />
              مسح شهر
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
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-300"
          >
            <X className="size-4" />
          </button>
        )}
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
            <Fingerprint className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد سجلات</p>
            <p className="text-slate-500 text-sm mt-1">
              {search ? 'لم يتم العثور على نتائج' : 'ارفع ملف Excel لإضافة البيانات'}
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
                  <TableHead className="text-slate-400 text-sm font-medium">وقت الحضور</TableHead>
                  <TableHead className="text-slate-400 text-sm font-medium">وقت الانصراف</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((rec) => (
                  <TableRow
                    key={rec.id}
                    className="border-slate-700/50 hover:bg-slate-700/30"
                  >
                    <TableCell className="text-white font-medium">
                      {rec.employeeName}
                    </TableCell>
                    <TableCell className="text-slate-300" dir="ltr">{rec.date}</TableCell>
                    <TableCell className="text-slate-300" dir="ltr">
                      {rec.checkIn || '—'}
                    </TableCell>
                    <TableCell className="text-slate-300" dir="ltr">
                      {rec.checkOut || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}

      {/* Clear Month Dialog */}
      <Dialog open={isClearOpen} onOpenChange={setIsClearOpen}>
        <DialogContent className="backdrop-blur-xl bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <AlertTriangle className="size-5 text-red-400" />
              مسح بيانات الشهر
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              سيتم حذف جميع سجلات البصمة للشهر المحدد. لا يمكن التراجع عن هذا الإجراء.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300">اختر الشهر</Label>
              <Select value={clearMonth} onValueChange={setClearMonth}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="اختر شهراً" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m} className="text-white">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsClearOpen(false)}
              className="border-slate-600 text-slate-300"
            >
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearMonth}
              disabled={clearing || !clearMonth}
            >
              {clearing ? 'جاري المسح...' : 'مسح البيانات'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
