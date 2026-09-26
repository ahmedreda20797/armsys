'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { usePageState } from '@/hooks/use-page-state';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatInteger, formatMonthKey } from '@/lib/i18n/format';
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
import { PageIdentity } from '@/components/shared/PageIdentity';
import type { BiometricRecord, Employee } from '@/types';
import { logCreate } from '@/lib/activity-logger';
import { apiFetch } from '@/lib/api-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { useBiometricsList, useEmployees } from '@/hooks/use-queries';
import { DataFreshnessIndicator } from '@/components/shared/DataFreshnessIndicator';

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
  const { locale } = useLanguage();
  // ═══ DATA STATE (cache-backed, §4) — snapshot restore + background
  //  revalidation; page state below stays in usePageState (§4).
  const queryClient = useQueryClient();
  const biometricsQuery = useBiometricsList();
  const employeesQuery = useEmployees();
  const records = biometricsQuery.data ?? [];
  const employees = employeesQuery.data ?? [];
  const loading = biometricsQuery.isLoading || employeesQuery.isLoading;
  const revalidating = (biometricsQuery.isFetching || employeesQuery.isFetching) && !loading;
  // Phase 6.3 (§8): filter context persists per user (session-scoped).
  const [biometricView, setBiometricView] = usePageState<{
    search: string;
    selectedMonth: string;
    selectedEmployee: string;
  }>({
    page: 'biometric',
    slot: 'filters',
    version: 1,
    initial: () => ({ search: '', selectedMonth: 'all', selectedEmployee: 'all' }),
    validate: (raw) =>
      raw && typeof raw === 'object' && typeof (raw as { selectedMonth?: unknown }).selectedMonth === 'string'
        ? raw
        : null,
  });
  const search = biometricView.search;
  const setSearch = (v: string) => setBiometricView((s) => ({ ...s, search: v }));
  const selectedMonth = biometricView.selectedMonth;
  const setSelectedMonth = (v: string) => setBiometricView((s) => ({ ...s, selectedMonth: v }));
  const selectedEmployee = biometricView.selectedEmployee;
  const setSelectedEmployee = (v: string) => setBiometricView((s) => ({ ...s, selectedEmployee: v }));
  const [uploading, setUploading] = useState(false);
  const [clearMonth, setClearMonth] = useState('');
  const [isClearOpen, setIsClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ═══ Manual refresh / mutation revalidation (§26).
  const refreshData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['biometrics'] });
  }, [queryClient]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<any>('/api/biometric/upload', {
        method: 'POST',
        body: formData,
      });
      logCreate('biometric', 'سجل بصمة', `${data.imported || 0} سجل`);
      await refreshData();
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
      await apiFetch('/api/biometric/clear', {
        method: 'POST',
        body: JSON.stringify({ month: clearMonth }),
      });
      await refreshData();
      setIsClearOpen(false);
      setClearMonth('');
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
      // App-generated month header — canonical formatter, locale-aware.
      const label = formatMonthKey(month, locale);
      groups.push({ month, label, count: recs.length, records: recs });
    }

    return groups;
  }, [filtered, locale]);

  // Available months in current data (for clear dialog)
  const availableMonths = useMemo(() => {
    const monthsSet = new Set<string>();
    for (const rec of records) {
      const month = getMonthFromDate(rec.date);
      if (month) monthsSet.add(month);
    }
    return Array.from(monthsSet).sort().reverse();
  }, [records]);

  const selectedMonthLabel = selectedMonth === 'all'
    ? translateUIText('جميع الأشهر', locale)
    : formatMonthKey(selectedMonth, locale);

  return (
    <div className="space-y-6">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="biometric"
        icon={<Fingerprint className="size-5" />}
        iconClassName="bg-brand-500/15 border-brand-500/30 text-brand-400"
        description={
          <>
            {formatInteger(filtered.length, locale)} <T>سجل بصري</T>
            {selectedMonth !== 'all' && (
              <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-brand-400 mr-2 text-[10px]">
                <Filter className="size-3 ml-1" />
                {selectedMonthLabel}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            {canUpload && (
              <>
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="border-slate-600 text-slate-300 hover:bg-slate-700"
                >
                  {uploading ? <T>جاري الرفع...</T> : <><Upload className="size-4" /> <T>رفع Excel</T></>}
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
                <T>مسح شهر</T>
              </Button>
            )}
          </>
        }
      />

      {/* Month Filter + Employee Filter + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
          <Input
            placeholder={translateUIText('بحث باسم الموظف أو التاريخ...', locale)}
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
              <SelectValue placeholder={translateUIText('فلتر حسب الشهر', locale)} />
            </SelectTrigger>
            <SelectContent>
              {MONTH_OPTIONS.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-white">
                  <div className="flex items-center gap-2">
                    <span>{m.value === 'all' ? translateUIText('جميع الأشهر', locale) : formatMonthKey(m.value, locale)}</span>
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
              <SelectValue placeholder={translateUIText('فلتر حسب الموظف', locale)} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white"><T>جميع الموظفين</T></SelectItem>
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
      {/* Subtle background-revalidation state (§32) */}
      <DataFreshnessIndicator revalidating={revalidating} />

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
            <p className="text-slate-400 text-lg font-medium"><T>لا توجد سجلات</T></p>
            <p className="text-slate-500 text-sm mt-1">
              {/* §10/§56: the active period is NAMED in the empty state. */}
              {search
                ? <T>لم يتم العثور على نتائج</T>
                : selectedMonth && selectedMonth !== 'all'
                  ? <><T>لا توجد سجلات بصمة في </T>{formatMonthKey(selectedMonth, locale)}<T>.</T></>
                  : <T>ارفع ملف Excel لإضافة البيانات</T>}
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
                  <Calendar className="size-4 text-brand-400" />
                  <span className="text-white text-sm font-bold">{group.label}</span>
                </div>
                <Badge variant="outline" className="border-slate-600 text-slate-400 text-[10px]">
                  {formatInteger(group.count, locale)} <T>سجل</T>
                </Badge>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-700 hover:bg-transparent">
                      <TableHead className="text-slate-400 text-sm font-medium"><T>الموظف</T></TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium"><T>التاريخ</T></TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium"><T>وقت الحضور</T></TableHead>
                      <TableHead className="text-slate-400 text-sm font-medium"><T>وقت الانصراف</T></TableHead>
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
              <T>مسح بيانات الشهر</T>
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              <T>سيتم حذف جميع سجلات البصمة للشهر المحدد. لا يمكن التراجع عن هذا الإجراء.</T>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-slate-300"><T>اختر الشهر</T></Label>
              <Select value={clearMonth} onValueChange={setClearMonth}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder={translateUIText('اختر شهراً', locale)} />
                </SelectTrigger>
                <SelectContent>
                  {availableMonths.length > 0 ? availableMonths.map((m) => (
                    <SelectItem key={m} value={m} className="text-white">
                      {formatMonthKey(m, locale)}
                    </SelectItem>
                  )) : (
                    <div className="px-3 py-2 text-slate-500 text-sm"><T>لا توجد بيانات لمسحها</T></div>
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
              <T>إلغاء</T>
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearMonth}
              disabled={clearing || !clearMonth}
            >
              {clearing ? <T>جاري المسح...</T> : <T>مسح البيانات</T>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
