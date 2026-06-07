'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { generateMonthOptions } from '@/lib/date-utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  BarChart3,
  Download,
  Play,
  AlertCircle,
  TrendingUp,
  Clock,
  Wallet,
  ArrowUpDown,
  ShieldCheck,
  Users,
  CalendarCheck,
} from 'lucide-react';

interface ReportRow {
  employeeName: string;
  department: string;
  totalPresent: number;
  totalLate: number;
  totalAbsent: number;
  totalExempt: number;
  totalMinutesLate: number;
  totalDelays: number;
  lateDeductionDays: number;
  absenceDeductionDays: number;
  totalDeductionDays: number;
  totalQualityDeductions: number;
  totalDeductions: number;
  totalAmount: number;
  attendanceCompliance: number;
  workDays: number;
}

type SortField = 'employeeName' | 'attendanceCompliance' | 'totalMinutesLate' | 'totalDeductionDays' | 'totalAbsent' | 'totalExempt';
type FilterMode = 'all' | 'committed' | 'delayed' | 'absent';

export default function ReportsPage() {
  const { canEdit } = usePermissions('reports');
  const [month, setMonth] = useState('');
  const [report, setReport] = useState<ReportRow[]>([]);
  const [generating, setGenerating] = useState(false);
  const [hasReport, setHasReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('attendanceCompliance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const months = generateMonthOptions('YYYY-MM');

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('erp_report_data');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.month) setMonth(parsed.month);
        if (parsed.report && parsed.report.length > 0) {
          setReport(parsed.report);
          setHasReport(true);
        }
      } else {
        const now = new Date();
        setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      }
    } catch {
      const now = new Date();
      setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
    }
  }, []);
  useEffect(() => {
    if (hasReport && report.length > 0 && month) {
      sessionStorage.setItem('erp_report_data', JSON.stringify({ month, report }));
    }
  }, [hasReport, report, month]);

  const handleGenerate = async () => {
    if (!month) return;
    setGenerating(true);
    setError(null);
    setHasReport(false);
    setReport([]);
    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      if (res.ok) {
        const data = await res.json();
        const rows = data.rows || [];
        setReport(rows);
        setHasReport(true);
        // 3️⃣ نحفظه فوراً بعد التوليد
        sessionStorage.setItem('erp_report_data', JSON.stringify({ month, report: rows }));
      } else {
        const data = await res.json();
        setError(data.error || 'فشل في إنشاء التقرير');
      }
    } catch {
      setError('خطأ في الاتصال بالخادم');
    } finally {
      setGenerating(false);
    }
  };

  const handleExport = async () => {
    if (!month || report.length === 0) return;
    try {
      const res = await fetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, data: report }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `تقرير_خصومات_${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch {
      // Silent error
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const processed = (() => {
    let rows = [...report];

    if (filterMode === 'committed') {
      rows = rows.filter((r) => r.attendanceCompliance >= 80);
    } else if (filterMode === 'delayed') {
      rows = rows.filter((r) => r.totalDelays > 0);
    } else if (filterMode === 'absent') {
      rows = rows.filter((r) => r.totalAbsent > 0);
    }

    rows.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  })();

  const totalCompliance = report.length > 0
    ? Math.round(report.reduce((s, r) => s + r.attendanceCompliance, 0) / report.length)
    : 0;

  const totalTardiness = report.reduce((s, r) => s + r.totalMinutesLate, 0);
  const totalDeductionDays = report.reduce((s, r) => s + r.totalDeductionDays, 0);
  const totalExemptDays = report.reduce((s, r) => s + r.totalExempt, 0);
  const totalPresentDays = report.reduce((s, r) => s + r.totalPresent, 0);
  const totalEmployees = report.length;

  const getChartData = (field: 'attendanceCompliance' | 'totalMinutesLate' | 'totalDeductionDays', topN = 6) => {
    return [...report]
      .sort((a, b) => (field === 'attendanceCompliance' ? b[field] - a[field] : b[field] - a[field]))
      .slice(0, topN);
  };

  const complianceData = getChartData('attendanceCompliance');
  const tardinessData = getChartData('totalMinutesLate');
  const deductionsData = getChartData('totalDeductionDays');

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className="flex items-center justify-center gap-1 w-full text-slate-300 text-xs font-bold hover:text-emerald-400 transition-colors cursor-pointer"
    >
      <span>{label}</span>
      <ArrowUpDown className="size-3 opacity-50" />
    </button>
  );

  const getComplianceColor = (val: number) => {
    if (val >= 90) return 'text-emerald-400';
    if (val >= 75) return 'text-amber-400';
    if (val >= 50) return 'text-orange-400';
    return 'text-red-400';
  };

  const getComplianceBadgeVariant = (val: number): 'default' | 'secondary' | 'destructive' | 'outline' => {
    if (val >= 90) return 'default';
    if (val >= 75) return 'secondary';
    return 'destructive';
  };

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
            <BarChart3 className="size-6 text-emerald-400" />
            التقارير
          </h1>
          <p className="text-slate-400 mt-1 text-sm">
            تقرير الخصومات الشهري — نسخة المحاسب (بيانات البصمة + قواعد الخصم)
          </p>
        </div>
      </motion.div>

      {/* Controls */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row gap-3 items-start sm:items-end flex-wrap"
      >
        <div className="space-y-2">
          <label className="text-slate-300 text-sm"> الشهر</label>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-full sm:w-40">
              <SelectValue placeholder="إختر شهراً" />
            </SelectTrigger>
            <SelectContent>
              {months.map((m) => (
                <SelectItem key={m} value={m} className="text-white">{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-slate-300 text-sm">تصنيف الموظفين</label>
          <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
            <SelectTrigger className="bg-slate-800 border-slate-600 text-white w-full sm:w-40">
              <SelectValue placeholder="إختر فئة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="text-white">الكل</SelectItem>
              <SelectItem value="committed" className="text-white">الأكثر التزاماً</SelectItem>
              <SelectItem value="delayed" className="text-white">المتأخرون فقط</SelectItem>
              <SelectItem value="absent" className="text-white"> غياب فقط</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleGenerate}
            disabled={!canEdit || generating || !month}
            className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
          >
            {generating ? 'جاري الإنشاء...' : (
              <><Play className="size-4" />إنشاء التقرير</>
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={!canEdit || report.length === 0}
            className="border-slate-600 text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            <Download className="size-4" />
            تصدير Excel
          </Button>
        </div>
      </motion.div>

      {!canEdit && (
        <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm flex items-center gap-2">
          <AlertCircle className="size-4" />
          لديك صلاحية القراءة فقط
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-2">
          <AlertCircle className="size-4" />
          {error}
        </div>
      )}

      {generating && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg bg-slate-800" />
          ))}
        </div>
      )}

      {hasReport && report.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* ── Summary Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.05 }}>
              <Card className="border-slate-700/40 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Users className="size-5 text-blue-400" />
                    <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-400">إجمالي</Badge>
                  </div>
                  <p className="text-2xl font-bold text-white">{totalEmployees}</p>
                  <p className="text-slate-500 text-xs mt-1">موظف</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }}>
              <Card className="border-emerald-500/20 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <TrendingUp className="size-5 text-emerald-400" />
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">متوسط</Badge>
                  </div>
                  <p className={`text-2xl font-bold ${getComplianceColor(totalCompliance)}`}>{totalCompliance}%</p>
                  <p className="text-slate-500 text-xs mt-1">نسبة الالتزام</p>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${totalCompliance >= 80 ? 'bg-emerald-500' : totalCompliance >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(totalCompliance, 100)}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 }}>
              <Card className="border-emerald-500/20 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <CalendarCheck className="size-5 text-emerald-400" />
                    <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">إجمالي</Badge>
                  </div>
                  <p className="text-2xl font-bold text-emerald-400">{totalPresentDays}</p>
                  <p className="text-slate-500 text-xs mt-1">يوم حضور</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
              <Card className="border-amber-500/20 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Clock className="size-5 text-amber-400" />
                    <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">إجمالي</Badge>
                  </div>
                  <p className="text-2xl font-bold text-amber-400" dir="ltr">{totalTardiness.toLocaleString('ar-EG')}</p>
                  <p className="text-slate-500 text-xs mt-1">دقيقة تأخير</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25 }}>
              <Card className="border-red-500/20 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <Wallet className="size-5 text-red-400" />
                    <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">خصم</Badge>
                  </div>
                  <p className="text-2xl font-bold text-red-400" dir="ltr">{totalDeductionDays.toFixed(2)}</p>
                  <p className="text-slate-500 text-xs mt-1">يوم خصم</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
              <Card className="border-cyan-500/20 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <ShieldCheck className="size-5 text-cyan-400" />
                    <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-400">معفى</Badge>
                  </div>
                  <p className="text-2xl font-bold text-cyan-400">{totalExemptDays}</p>
                  <p className="text-slate-500 text-xs mt-1">يوم معفى</p>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* ── Charts Section ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
              <Card className="border-slate-700/40 bg-slate-800/70 backdrop-blur-sm h-full">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <TrendingUp className="size-4 text-emerald-400" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-sm font-bold">التزام الحضور</CardTitle>
                      <p className="text-slate-500 text-[11px]">أفضل {complianceData.length} موظفين</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2.5">
                    {complianceData.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-slate-400 text-[11px] w-16 truncate font-medium">{r.employeeName}</span>
                        <div className="flex-1 h-4 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              r.attendanceCompliance >= 80 ? 'bg-gradient-to-l from-emerald-500 to-emerald-600' :
                              r.attendanceCompliance >= 50 ? 'bg-gradient-to-l from-amber-500 to-amber-600' :
                              'bg-gradient-to-l from-red-500 to-red-600'
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max(r.attendanceCompliance, 5)}%` }}
                            transition={{ duration: 0.6, delay: i * 0.04, ease: 'easeOut' }}
                          />
                        </div>
                        <span className={`text-[11px] w-10 text-left font-bold ${getComplianceColor(r.attendanceCompliance)}`}>
                          {r.attendanceCompliance}%
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <Card className="border-slate-700/40 bg-slate-800/70 backdrop-blur-sm h-full">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <Clock className="size-4 text-amber-400" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-sm font-bold">معدل التأخير</CardTitle>
                      <p className="text-slate-500 text-[11px]">بالدقائق — أعلى {tardinessData.length} موظفين</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2.5">
                    {tardinessData.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-slate-400 text-[11px] w-16 truncate font-medium">{r.employeeName}</span>
                        <div className="flex-1 h-4 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div
                            className={`h-full rounded-full ${
                              r.totalMinutesLate > 120 ? 'bg-gradient-to-l from-red-500 to-rose-600' :
                              r.totalMinutesLate > 60 ? 'bg-gradient-to-l from-amber-500 to-orange-600' :
                              'bg-gradient-to-l from-yellow-500 to-amber-500'
                            }`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max((r.totalMinutesLate / Math.max(tardinessData[0]?.totalMinutesLate || 1, 1)) * 100, 5)}%` }}
                            transition={{ duration: 0.6, delay: i * 0.04, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="text-[11px] w-10 text-left font-bold text-slate-300" dir="ltr">{r.totalMinutesLate}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
              <Card className="border-slate-700/40 bg-slate-800/70 backdrop-blur-sm h-full">
                <CardHeader className="pb-2 pt-4 px-4">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                      <Wallet className="size-4 text-red-400" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-sm font-bold">الخصومات المطبقة</CardTitle>
                      <p className="text-slate-500 text-[11px]">بالأيام — أعلى {deductionsData.length} موظفين</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="space-y-2.5">
                    {deductionsData.map((r, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-slate-400 text-[11px] w-16 truncate font-medium">{r.employeeName}</span>
                        <div className="flex-1 h-4 rounded-full bg-slate-700/50 overflow-hidden">
                          <motion.div
                            className="h-full rounded-full bg-gradient-to-l from-rose-500 to-red-600"
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.max((r.totalDeductionDays / Math.max(deductionsData[0]?.totalDeductionDays || 1, 1)) * 100, 5)}%` }}
                            transition={{ duration: 0.6, delay: i * 0.04, ease: 'easeOut' }}
                          />
                        </div>
                        <span className="text-[11px] w-12 text-left font-bold text-rose-400" dir="ltr">{r.totalDeductionDays.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* ── Data Table ── */}
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="border-slate-700/40 bg-slate-800/70 backdrop-blur-sm overflow-hidden">
              <CardHeader className="pb-3 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center">
                      <BarChart3 className="size-4 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-sm font-bold">تفاصيل التقرير — نسخة المحاسب</CardTitle>
                      <p className="text-slate-500 text-[11px]">
                        {processed.length} موظف {filterMode !== 'all' && `— تم التصفية`}
                      </p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[11px] border-slate-600 text-slate-300">{month}</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[infinitepx]">
                  <div className="overflow-x-auto">
                    <Table className="w-full" dir="rtl">
                      <TableHeader>
                        <TableRow className="border-slate-700/50 hover:bg-transparent bg-slate-900/60">
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-6 w-[140px]">
                            <SortButton field="employeeName" label="الموظف" />
                          </TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-6 hidden lg:table-cell w-[100px]">القسم</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold text-center py-3 px-6 whitespace-nowrap w-[60px]">حضور</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-3 whitespace-nowrap w-[70px]">
                            <SortButton field="totalMinutesLate" label="تأخير" />
                          </TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-3 whitespace-nowrap w-[60px]">
                            <SortButton field="totalAbsent" label="غياب" />
                          </TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-3 whitespace-nowrap w-[60px]">
                            <SortButton field="totalExempt" label="معفى" />
                          </TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold text-center py-3 px-6 whitespace-nowrap w-[80px] hidden xl:table-cell">خصم تأخير</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold text-center py-3 px-6 whitespace-nowrap w-[80px] hidden xl:table-cell">خصم غياب</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold text-center py-3 px-6 whitespace-nowrap w-[80px] hidden xl:table-cell">خصم جودة</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold text-center py-3 px-6 whitespace-nowrap w-[70px]">التزام</TableHead>
                          <TableHead className="text-slate-300 text-[11px] font-bold py-3 px-6 whitespace-nowrap w-[80px]">
                            <SortButton field="totalDeductionDays" label="الإجمالي" />
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {processed.map((row, idx) => (
                          <TableRow key={idx} className="border-slate-700/30 hover:bg-slate-700/20 transition-colors">
                            <TableCell className="py-2.5 px-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-slate-700/50 flex items-center justify-center text-[12px] font-bold text-slate-400 shrink-0">
                                  {row.employeeName.charAt(0)}
                                </div>
                                <span className="text-white font-semibold text-xs truncate max-w-[200px]">{row.employeeName}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-slate-400 text-[11px] hidden lg:table-cell py-2.5 px-0">{row.department}</TableCell>
                            <TableCell className="text-center py-2.5 px-6">
                              <span className="text-emerald-400 font-bold text-xs">{row.totalPresent}</span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8">
                              <div className="flex flex-col items-center leading-tight">
                                <span className={`text-xs font-bold ${row.totalMinutesLate > 60 ? 'text-red-400' : row.totalMinutesLate > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
                                  {row.totalLate}
                                </span>
                                {row.totalMinutesLate > 0 && (
                                  <span className="text-[10px] text-slate-500 mt-0.5" dir="ltr">{row.totalMinutesLate}د</span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8">
                              <span className={`text-xs font-bold ${row.totalAbsent > 0 ? 'text-red-400' : 'text-slate-600'}`}>
                                {row.totalAbsent}
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8">
                              <span className={`text-xs font-bold ${row.totalExempt > 0 ? 'text-cyan-400' : 'text-slate-600'}`}>
                                {row.totalExempt}
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8 hidden xl:table-cell">
                              <span className={`text-[11px] font-bold ${row.lateDeductionDays > 0 ? 'text-amber-400' : 'text-slate-600'}`} dir="ltr">
                                {row.lateDeductionDays > 0 ? row.lateDeductionDays.toFixed(2) : '—'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8 hidden xl:table-cell">
                              <span className={`text-[11px] font-bold ${row.absenceDeductionDays > 0 ? 'text-red-400' : 'text-slate-600'}`} dir="ltr">
                                {row.absenceDeductionDays > 0 ? row.absenceDeductionDays.toFixed(2) : '—'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8 hidden xl:table-cell">
                              <span className={`text-[11px] font-bold ${row.totalQualityDeductions > 0 ? 'text-orange-400' : 'text-slate-600'}`} dir="ltr">
                                {row.totalQualityDeductions > 0 ? row.totalQualityDeductions.toFixed(2) : '—'}
                              </span>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8">
                              <Badge
                                variant={getComplianceBadgeVariant(row.attendanceCompliance)}
                                className={`text-[10px] font-bold px-1.5 py-0 h-5 ${
                                  row.attendanceCompliance >= 90 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' :
                                  row.attendanceCompliance >= 75 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                                  'bg-red-500/20 text-red-400 border-red-500/30'
                                }`}
                              >
                                {row.attendanceCompliance}%
                              </Badge>
                            </TableCell>
                            <TableCell className="text-center py-2.5 px-8">
                              <span className={`text-xs font-bold ${row.totalDeductionDays > 0 ? 'text-rose-400' : 'text-slate-600'}`} dir="ltr">
                                {row.totalDeductionDays.toFixed(2)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>
      )}

      {hasReport && report.length === 0 && (
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <BarChart3 className="size-12 text-slate-600 mb-4" />
            <p className="text-slate-400 text-lg font-medium">لا توجد بيانات للتقرير</p>
            <p className="text-slate-500 text-sm mt-1">لم يتم العثور على بيانات بصمة أو حضور لهذا الشهر</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}