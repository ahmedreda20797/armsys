'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
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
import {
  Upload,
  Search,
  Fingerprint,
  Trash2,
  X,
  AlertTriangle,
  Archive,
  Calendar,
  Filter,
  ChevronDown,
} from 'lucide-react';
import type { BiometricRecord, Employee } from '@/types';
import { logCreate } from '@/lib/activity-logger';
import { authFetch } from '@/lib/api-fetch';

interface BiometricWithEmployee extends BiometricRecord {
  employeeName: string;
}

const ARABIC_MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function generateMonthOptions(): { value: string; label: string; isArchived?: boolean }[] {
  const now = new Date();
  const options: { value: string; label: string; isArchived?: boolean }[] = [
    { value: 'all', label: 'جميع الأشهر' },
  ];
  for (let i = -1; i <= 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${ARABIC_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    // Months older than 2 months are considered "archived"
    const isOld = i > 1;
    options.push({ value, label, isArchived: isOld });
  }
  return options;
}

const MONTH_OPTIONS = generateMonthOptions();

export default function BiometricPage() {
  const { canEdit, canUpload, canDelete, isAdmin } = usePermissions('biometric');
  const [records, setRecords] = useState<BiometricWithEmployee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [clearMonth, setClearMonth] = useState('');
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState('all');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [bioRes, empRes] = await Promise.all([
        authFetch('/api/biometric'),
        authFetch('/api/employees'),
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
      const res = await authFetch('/api/biometric/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        logCreate('biometric', 'سجل بصمة', `${data.imported || 0} سجل`);
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
      const res = await authFetch('/api/biometric/clear', {
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

  // Extract month from date string (DD/MM/YYYY -> YYYY-MM)
  const getMonthFromDate = (dateStr: string): string => {
    const parts = dateStr.split('/');
    if (parts.length >= 3) {
      const day = parts[0].padStart(2, '0');
      const month = parts[1].padStart(2, '0');
      const year = parts[2];
      return `${year}-${month}`;
    }
    return '';
  };

  const getEmployeeName = (employeeId: string): string => {
    const emp = employees.find((e) => e.id === employeeId);
    return emp?.name || 'غير معروف';
  };

  const filtered = useMemo(() => {
    let result = records.filter((rec) => {
      const name = getEmployeeName(rec.employeeId).toLowerCase();
      return name.includes(search.toLowerCase()) || rec.date.includes(search);
    });

    // Filter by selected month
    if (selectedMonth !== 'all') {
      result = result.filter((rec) => getMonthFromDate(rec.date) === selectedMonth);
    }

    // Filter by selected employee
    if (selectedEmployee !== 'all') {
      result = result.filter((rec) => rec.employeeId === selectedEmployee);
    }

    return result;
  }, [records, search, selectedMonth, selectedEmployee, employees]);

  // Group records by month for the table
  const groupedByMonth = useMemo(() => {
    const groups: { month: string; label: string; count: number; records: BiometricWithEmployee[] }[] = [];
    const monthMap = new Map<string, BiometricWithEmployee[]>();

    for (const rec of filtered) {
      const month = getMonthFromDate(rec.date);
      if (!month) continue;
      if (!monthMap.has(month)) monthMap.set(month, []);
      monthMap.get(month)!.push(rec);
    }

    // Sort months descending (newest first)
    const sortedMonths = Array.from(monthMap.keys()).sort((a, b) => b.localeCompare(a));

    for (const month of sortedMonths) {
      const recs = monthMap.get(month)!;
      const [y, m] = month.split('-');
      const monthIdx = parseInt(m, 10) - 1;
      const label = `${ARABIC_MONTHS[monthIdx]} ${y}`;
      groups.push({ month, label, count: recs.length, records: recs });
    }

    return groups;
  }, [filtered]);

  // Available months in current data (for clear dialog)
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    for (const rec of records) {
      const month = getMonthFromDate(rec.date);
      if (month) monthsSet.add(month);
    }
    return Array.from(monthsSet).sort().reverse();
  }, [records]);

  const selectedMonthLabel = MONTH_OPTIONS.find(m => m.value === selectedMonth)?.label || 'جميع الأشهر';

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
            <Fingerprint className="size-6 text-violet-400" />
            بيانات البصمة
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            {filtered.length} سجل بصري
            {selectedMonth !== 'all' && (
              <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-400 mr-2 text-[10px]">
                <Filter className="size-3 ml-1" />
                {selectedMonthLabel}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canUpload && (
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
          {canDelete && (
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

      {/* Month Filter + Employee Filter + Search */}
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
        <div className="relative min-w-50">
          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white pr-10">
              <SelectValue placeholder="فلتر حسب الشهر" />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-white">
                  <div className="flex items-center gap-2">
                    <span>{m.label}</span>
                    {m.isArchived && (
                      <Archive className="size-3 text-slate-500" />
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="relative min-w-45">
          <Fingerprint className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400 pointer-events-none" />
          <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white pr-10">
              <SelectValue placeholder="فلتر حسب الموظف" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white">جميع الموظفين</SelectItem>
              {employees.map((emp) => (
                <SelectItem key={emp.id} value={emp.id} className="text-white">
                  {emp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
        <div className="space-y-6">
          {groupedByMonth.map((group) => (
            <motion.div
              key={group.month}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-slate-700/50 bg-slate-800/50 overflow-hidden"
            >
              {/* Month Header */}
              <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/60 border-b border-slate-700/30">
                <div className="flex items-center gap-2">
                  <Calendar className="size-4 text-violet-400" />
                  <span className="text-white text-sm font-bold">{group.label}</span>
                </div>
                <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">
                  {group.count} سجل
                </Badge>
              </div>

              {/* Table */}
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
                    {group.records.map((rec) => (
                      <TableRow
                        key={rec.id}
                        className="border-slate-700/50 hover:bg-slate-700/30"
                      >
                        <TableCell>
                          <EmployeeLink employeeId={rec.employeeId} name={rec.employeeName} compact />
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
          ))}
        </div>
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
                  {availableMonths.length > 0 ? availableMonths.map((m) => {
                    const [y, mo] = m.split('-');
                    const monthIdx = parseInt(mo, 10) - 1;
                    const label = `${ARABIC_MONTHS[monthIdx]} ${y}`;
                    return (
                      <SelectItem key={m} value={m} className="text-white">
                        {label}
                      </SelectItem>
                    );
                  }) : (
                    <div className="px-3 py-2 text-slate-500 text-sm">لا توجد بيانات لمسحها</div>
                  )}
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
