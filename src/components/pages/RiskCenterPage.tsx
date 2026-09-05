'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, ShieldCheck, ShieldAlert, AlertCircle, ShieldX,
  Clock, Users, TrendingUp, TrendingDown, Minus, ChevronLeft,
  ChevronRight, X, Search, Activity, Eye, FileWarning,
  UserCheck, Award, Zap, BarChart3, Target, FilePlus, FileText,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { useAppStore } from '@/lib/store';
import { formatMonthLabelAr } from '@/lib/month-label';

/** Last 12 month keys, newest first (§14 month selector options). */
function buildMonthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════

interface EmployeeRisk {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  // Canonical breakdown shape — one { count, points } entry per factor.
  breakdown: Record<string, { count: number; points: number }>;
  openCases: number;
  lastActivity: string;
  trend: 'increasing' | 'stable' | 'improving';
  recommendations: string[];
  capaIds: string[];
}

interface SummaryStats {
  totalEmployees: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  openCasesTotal: number;
  immediateActionCount: number;
}

// ═══════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
} as const;

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

function getRiskLevelConfig(level: string) {
  const map: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    low: { label: 'منخفض', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/25', dot: 'bg-green-400' },
    medium: { label: 'متوسط', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/25', dot: 'bg-yellow-400' },
    high: { label: 'مرتفع', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/25', dot: 'bg-orange-400' },
    critical: { label: 'حرج', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/25', dot: 'bg-red-500' },
  };
  return map[level] || map.low;
}

function getTrendIcon(trend: string) {
  switch (trend) {
    case 'increasing': return <TrendingUp className="size-3.5 text-red-400" />;
    case 'improving': return <TrendingDown className="size-3.5 text-green-400" />;
    default: return <Minus className="size-3.5 text-slate-500" />;
  }
}

function getTrendLabel(trend: string) {
  switch (trend) {
    case 'increasing': return 'تصاعدي';
    case 'improving': return 'تحسن';
    default: return 'مستقر';
  }
}

// ═══════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════

export default function RiskCenterPage() {
  const { canView } = usePermissions('riskCenter');

  const [employees, setEmployees] = useState<EmployeeRisk[]>([]);
  const [summary, setSummary] = useState<SummaryStats | null>(null);
  const [deptAnalysis, setDeptAnalysis] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(!canView); // start settled when the user lacks view permission
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRisk | null>(null);
  // ═══ Milestone 7 §14 — monthly view + comparison ═══
  // Default view stays the rolling snapshot (''); selecting a month
  // switches to month-attributed factors (traceable records only).
  const [basis, setBasis] = useState<'rolling' | 'month'>('rolling');
  const [basisLabel, setBasisLabel] = useState<string>('لقطة متجددة');
  const [month, setMonth] = useState<string>('');
  const [compareRows, setCompareRows] = useState<Record<string, number> | null>(null);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);
  const [compareState, setCompareState] = useState<'idle' | 'loading' | 'ready' | 'insufficient'>('idle');

  useEffect(() => {
    if (!canView) return; // loading initialized to false for non-viewers
    fetchRiskData();
  }, []);

  async function fetchRiskData() {
    setLoading(true);
    setError(null);
    setCompareRows(null);
    setCompareState('idle');
    setCompareLabel(null);
    try {
      const qs = month ? `?month=${month}` : '';
      const res = await authFetch(`/api/risk-center${qs}`);
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
        setSummary(data.summary || null);
        setDeptAnalysis(data.departmentAnalysis || {});
        setBasis(data.basis === 'month' ? 'month' : 'rolling');
        setBasisLabel(data.basisLabel || 'لقطة متجددة');
      } else {
        setError('تعذر تحميل بيانات المخاطر');
        setEmployees([]);
        setSummary(null);
        setDeptAnalysis({});
      }
    } catch {
      setError('تعذر تحميل بيانات المخاطر');
      setEmployees([]);
      setSummary(null);
      setDeptAnalysis({});
    } finally {
      setLoading(false);
    }
  }

  const previousMonthKeyOf = (key: string): string => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // §14 month comparison: same month-attributed computation on the
  // previous month; deltas are shown ONLY where source data exists —
  // otherwise the UI says explicitly that the comparison cannot be
  // calculated (no fabricated history).
  async function loadComparison() {
    if (!month) return;
    setCompareState('loading');
    try {
      const prev = previousMonthKeyOf(month);
      const res = await authFetch(`/api/risk-center?month=${prev}`);
      if (!res.ok) {
        setCompareState('insufficient');
        setCompareLabel(null);
        return;
      }
      const data = await res.json();
      const rows: Record<string, number> = {};
      let anyData = false;
      for (const emp of (data.employees || []) as EmployeeRisk[]) {
        const hadFactors = Object.values(emp.breakdown || {}).some((f: any) => (f?.count ?? 0) > 0);
        if (hadFactors) anyData = true;
        rows[emp.employeeId] = emp.riskScore;
      }
      if (!anyData) {
        setCompareState('insufficient');
        setCompareRows(null);
        setCompareLabel(null);
        return;
      }
      setCompareRows(rows);
      setCompareLabel(prev);
      setCompareState('ready');
    } catch {
      setCompareState('insufficient');
    }
  }

  const deltaFor = (employeeId: string, currentScore: number): { delta: number; comparable: boolean } => {
    if (compareState !== 'ready' || !compareRows) return { delta: 0, comparable: false };
    if (!(employeeId in compareRows)) return { delta: 0, comparable: false };
    const hasFactorsNow = employees.some(
      (e) => e.employeeId === employeeId &&
        Object.values(e.breakdown || {}).some((f: any) => (f?.count ?? 0) > 0),
    );
    const hadFactorsPrev = (compareRows[employeeId] ?? 0) > 0;
    // Both months genuinely zero for this employee → "no data" in both;
    // a 0-vs-0 delta would fabricate meaning where nothing happened.
    if (!hasFactorsNow && !hadFactorsPrev) return { delta: 0, comparable: false };
    return { delta: currentScore - (compareRows[employeeId] ?? 0), comparable: true };
  };

  // ── Department list for filters ──
  const departmentList = useMemo(() => {
    return Object.keys(deptAnalysis).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [deptAnalysis]);

  // ── Filtered data ──
  const filtered = useMemo(() => {
    return employees.filter(emp => {
      if (levelFilter !== 'all' && emp.riskLevel !== levelFilter) return false;
      if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return emp.employeeName.toLowerCase().includes(s) || emp.department.toLowerCase().includes(s);
      }
      return true;
    });
  }, [employees, levelFilter, deptFilter, search]);

  // ── Top risky employees (need action) ──
  const topRisky = useMemo(() => employees.filter(e => e.riskScore >= 21).slice(0, 10), [employees]);

  // ── Department table ──
  const deptTable = useMemo(() => {
    return Object.entries(deptAnalysis)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [deptAnalysis]);

  const hasFilters = search || levelFilter !== 'all' || deptFilter !== 'all';

  // ── Permission guard ──
  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldAlert className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium">غير مصرح بالوصول</p>
        <p className="text-slate-600 text-xs mt-1">ليس لديك صلاحية لعرض مركز المخاطر</p>
      </div>
    );
  }

  return (
    <div dir="rtl" className="space-y-5">
      {/* ═══ Header ═══ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-red-500/15 border border-red-500/30">
            <ShieldAlert className="size-5 text-red-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">مركز المخاطر</h1>
            <p className="text-slate-500 text-xs mt-0.5">نظام الإنذار المبكر — مَن يحتاج تدخل اليوم؟</p>
            {/* §14: which attribution produced these numbers — visible. */}
            <p className="text-slate-600 text-[10px] mt-0.5">{basisLabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* §14 month selector — rolling snapshot is the default */}
          <Select
            value={month || 'rolling'}
            onValueChange={(v) => { setMonth(v === 'rolling' ? '' : v); }}
          >
            <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-44 h-9 text-sm">
              <SelectValue placeholder="لقطة متجددة" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rolling" className="text-white">لقطة متجددة (الحالية)</SelectItem>
              {buildMonthOptions().map((m) => (
                <SelectItem key={m} value={m} className="text-white">{formatMonthLabelAr(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {month && compareState !== 'loading' && (
            <Button variant="outline" size="sm" onClick={() => void loadComparison()} className="border-slate-700/70 text-slate-300 hover:bg-slate-800 h-9">
              <BarChart3 className="size-3.5 ml-1" />
              مقارنة بالشهر السابق
            </Button>
          )}
          {compareState === 'loading' && <Loader2 className="size-4 animate-spin text-slate-400" />}
          <Button variant="ghost" size="sm" onClick={fetchRiskData} className="text-slate-400 hover:text-white">
            <Activity className="size-4 ml-1" />
            تحديث
          </Button>
        </div>
      </motion.div>

      {/* §14 explicit comparison-impossible notice (never fake history) */}
      {month && compareState === 'insufficient' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 flex items-center gap-2">
          <AlertCircle className="size-3.5 shrink-0" />
          لا يمكن حساب المقارنة مع الشهر السابق — لا توجد بيانات مخاطر مسجلة فيه ضمن صلاحياتك.
        </div>
      )}

      {/* ═══ Summary Stats ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <div className="rounded-lg border border-slate-700/25 bg-slate-800/40 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">إجمالي الموظفين</p>
          <p className="text-white font-bold text-lg leading-tight">{summary?.totalEmployees || 0}</p>
        </div>
        <div className="rounded-lg border border-green-500/25 bg-green-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">مخاطر منخفضة</p>
          <p className="text-green-400 font-bold text-lg leading-tight">{summary?.lowRiskCount || 0}</p>
        </div>
        <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">مخاطر متوسطة</p>
          <p className="text-yellow-400 font-bold text-lg leading-tight">{summary?.mediumRiskCount || 0}</p>
        </div>
        <div className="rounded-lg border border-orange-500/25 bg-orange-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">مخاطر مرتفعة</p>
          <p className="text-orange-400 font-bold text-lg leading-tight">{summary?.highRiskCount || 0}</p>
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">حرج</p>
          <p className="text-red-400 font-bold text-lg leading-tight">{summary?.criticalRiskCount || 0}</p>
        </div>
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">حالات مفتوحة</p>
          <p className="text-blue-400 font-bold text-lg leading-tight">{summary?.openCasesTotal || 0}</p>
        </div>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5">يحتاج تدخل فوري</p>
          <p className="text-rose-400 font-bold text-lg leading-tight">{summary?.immediateActionCount || 0}</p>
        </div>
      </motion.div>

      {/* ═══ Immediate Action Alert ═══ */}
      <AnimatePresence>
        {topRisky.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="border-red-500/40 bg-red-500/5">
              <CardContent className="p-3.5">
                <div className="flex items-start gap-2.5">
                  <div className="flex-shrink-0 size-8 rounded-full bg-red-500/15 flex items-center justify-center mt-0.5">
                    <Zap className="size-4 text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-red-300 text-sm font-semibold">موظفين يحتاجون تدخل فوري ({topRisky.length})</p>
                    <p className="text-red-200/70 text-xs mt-1 leading-relaxed">
                      {topRisky.slice(0, 5).map(e => e.employeeName).join(' · ')}
                      {topRisky.length > 5 && ` +${topRisky.length - 5} آخرين`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ Filters ═══ */}
      <Card className="border-slate-700/40 bg-slate-800/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input placeholder="بحث بالاسم أو القسم..." value={search} onChange={e => setSearch(e.target.value)} className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="size-3.5" /></button>
              )}
            </div>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <ShieldAlert className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="مستوى المخاطر" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">الكل</SelectItem>
                <SelectItem value="low" className="text-white">منخفض</SelectItem>
                <SelectItem value="medium" className="text-white">متوسط</SelectItem>
                <SelectItem value="high" className="text-white">مرتفع</SelectItem>
                <SelectItem value="critical" className="text-white">حرج</SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <Users className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder="القسم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white">كل الأقسام</SelectItem>
                {departmentList.map(d => (
                  <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setLevelFilter('all'); setDeptFilter('all'); }} className="text-slate-400 hover:text-white h-9 px-3">
                <X className="size-3.5 ml-1" /> مسح
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ═══ Loading ═══ */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3">
              <AlertCircle className="size-6 text-rose-400" />
            </div>
            <p className="text-rose-300 text-sm font-medium">{error}</p>
            <p className="text-slate-600 text-xs mt-1">تعذّر الاتصال بقاعدة البيانات</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={fetchRiskData}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="border-slate-700/40 bg-slate-800/30">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
              <ShieldCheck className="size-6 text-emerald-500/60" />
            </div>
            <p className="text-slate-400 text-sm font-medium">لا توجد مخاطر حالياً</p>
            <p className="text-slate-600 text-xs mt-1">جميع الموظفين في المستوى الطبيعي</p>
          </CardContent>
        </Card>
      ) : (
        /* ═══ Employees Risk Table ═══ */
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <Card className="border-slate-700/40 bg-slate-800/30 overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40 bg-slate-800/50">
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الموظف</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">القسم</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">المركز</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">نقاط المخاطر</th>
                      {compareState === 'ready' && compareLabel && (
                        <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">
                          تغيّر ({formatMonthLabelAr(compareLabel)})
                        </th>
                      )}
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">مستوى المخاطر</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">حالات مفتوحة</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">جودة</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">موارد بشرية</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">غياب</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">تأخير</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap">الاتجاه</th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">تفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((emp) => {
                      const rl = getRiskLevelConfig(emp.riskLevel);
                      const cmp = compareState === 'ready' ? deltaFor(emp.employeeId, emp.riskScore) : { delta: 0, comparable: false };
                      return (
                        <motion.tr
                          key={emp.employeeId}
                          variants={itemVariants}
                          className={`border-b border-slate-700/20 hover:bg-slate-800/50 transition-colors cursor-pointer ${emp.riskLevel === 'critical' ? 'bg-red-500/3' : ''}`}
                          onClick={() => setSelectedEmployee(emp)}
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className={`size-7 rounded-full flex items-center justify-center flex-shrink-0 ${rl.bg} border ${rl.border}`}>
                                <span className={`text-[10px] font-bold ${rl.color}`}>{emp.employeeName.charAt(0)}</span>
                              </div>
                              <span className="text-white text-xs font-medium">{emp.employeeName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{emp.department || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{emp.position || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`font-bold text-sm ${rl.color}`}>{emp.riskScore}</span>
                          </td>
                          {compareState === 'ready' && compareLabel && (
                            <td className="px-3 py-2.5 whitespace-nowrap text-center">
                              {cmp.comparable ? (
                                <span className={`text-xs font-bold flex items-center justify-center gap-1 ${cmp.delta > 0 ? 'text-red-400' : cmp.delta < 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                                  {cmp.delta > 0 ? <TrendingUp className="size-3" /> : cmp.delta < 0 ? <TrendingDown className="size-3" /> : <Minus className="size-3" />}
                                  {cmp.delta > 0 ? `+${cmp.delta}` : cmp.delta}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-600">— لا بيانات كافية</span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${rl.bg} ${rl.color} ${rl.border}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${rl.dot}`} />
                              {rl.label}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <Badge variant="outline" className={`text-[10px] ${emp.openCases > 0 ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' : 'bg-slate-700/50 text-slate-500 border-slate-600/50'}`}>
                              {emp.openCases}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.quality?.count || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.hr?.count || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.absence?.count || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.delay?.count || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {getTrendIcon(emp.trend)}
                              <span className="text-[10px] text-slate-500">{getTrendLabel(emp.trend)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <button className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors">
                              <Eye className="size-3.5" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ═══ Department Risk Analysis ═══ */}
      {deptTable.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="size-5 text-slate-400" />
            <h2 className="text-white text-sm font-semibold">تحليل مخاطر الأقسام</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deptTable.map(dept => {
              const avgLevel = dept.avgScore >= 36 ? 'critical' : dept.avgScore >= 21 ? 'high' : dept.avgScore >= 11 ? 'medium' : 'low';
              const dl = getRiskLevelConfig(avgLevel);
              return (
                <Card key={dept.name} className={`border ${dl.border} ${dl.bg}`}>
                  <CardContent className="p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-white text-sm font-medium">{dept.name}</h3>
                      <Badge variant="outline" className={`text-[10px] ${dl.color} ${dl.border}`}>
                        متوسط: {dept.avgScore}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <div className="flex justify-between text-slate-400">
                        <span>موظفين:</span>
                        <span className="text-white">{dept.count}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>حالات مفتوحة:</span>
                        <span className="text-blue-400">{dept.openCases}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>مخالفات جودة:</span>
                        <span className="text-amber-400">{dept.qualityViolations}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>مشاكل حضور:</span>
                        <span className="text-red-400">{dept.attendanceIssues}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* ═══ Employee Details Side Panel ═══ */}
      <AnimatePresence>
        {selectedEmployee && (
          <>
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setSelectedEmployee(null)}
            />
            {/* Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="fixed left-0 top-0 bottom-0 w-full max-w-lg bg-slate-900 border-l border-slate-700/50 z-50 overflow-y-auto"
              dir="rtl"
            >
              <div className="p-5 space-y-4">
                {/* Panel Header */}
                <div className="flex items-center justify-between">
                  <h2 className="text-white text-lg font-bold">تفاصيل المخاطر</h2>
                  <button onClick={() => setSelectedEmployee(null)} className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
                    <X className="size-5" />
                  </button>
                </div>

                {/* Employee Info */}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700/30">
                  <div className={`size-14 rounded-xl flex items-center justify-center border ${getRiskLevelConfig(selectedEmployee.riskLevel).bg} ${getRiskLevelConfig(selectedEmployee.riskLevel).border}`}>
                    <span className={`text-xl font-bold ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>
                      {selectedEmployee.employeeName.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-base font-semibold">{selectedEmployee.employeeName}</p>
                    <p className="text-slate-500 text-xs">{selectedEmployee.department} · {selectedEmployee.position}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${getRiskLevelConfig(selectedEmployee.riskLevel).bg} ${getRiskLevelConfig(selectedEmployee.riskLevel).color} ${getRiskLevelConfig(selectedEmployee.riskLevel).border}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${getRiskLevelConfig(selectedEmployee.riskLevel).dot}`} />
                        {getRiskLevelConfig(selectedEmployee.riskLevel).label}
                      </div>
                      <div className="flex items-center gap-1">
                        {getTrendIcon(selectedEmployee.trend)}
                        <span className="text-[10px] text-slate-500">{getTrendLabel(selectedEmployee.trend)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risk Score */}
                <Card className={`border ${getRiskLevelConfig(selectedEmployee.riskLevel).border} ${getRiskLevelConfig(selectedEmployee.riskLevel).bg}`}>
                  <CardContent className="p-4 text-center">
                    <p className="text-slate-500 text-xs mb-1">نقاط المخاطر</p>
                    <p className={`text-4xl font-bold ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>{selectedEmployee.riskScore}</p>
                    <p className={`text-xs mt-1 ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>
                      {selectedEmployee.riskScore >= 36 ? 'خطر حرج — تصعيد فوري' : selectedEmployee.riskScore >= 21 ? 'مرتفع — يتطلب تدخل عاجل' : selectedEmployee.riskScore >= 11 ? 'متوسط — يحتاج متابعة' : 'منخفض — مراقبة عادية'}
                    </p>
                  </CardContent>
                </Card>

                {/* Risk Breakdown */}
                <Card className="border-slate-700/40 bg-slate-800/30">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <Target className="size-4 text-cyan-400" />
                      تحليل أسباب المخاطر
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="space-y-2">
                      {[
                        { label: 'تأخير حضور', key: 'delay', icon: Clock, color: 'text-cyan-400' },
                        { label: 'غياب', key: 'absence', icon: AlertCircle, color: 'text-red-400' },
                        { label: 'مخالفات جودة', key: 'quality', icon: Award, color: 'text-amber-400' },
                        { label: 'مخالفات موارد بشرية', key: 'hr', icon: UserCheck, color: 'text-violet-400' },
                        { label: 'حالات متابعة مفتوحة', key: 'openFollowUp', icon: Activity, color: 'text-blue-400' },
                        { label: 'متابعة أولوية عالية', key: 'highPriorityFollowUp', icon: AlertTriangle, color: 'text-orange-400' },
                        { label: 'متابعة حرجة', key: 'criticalFollowUp', icon: ShieldX, color: 'text-red-500' },
                        { label: 'شكاوى عملاء', key: 'complaint', icon: FileWarning, color: 'text-rose-400' },
                        { label: 'مشكلة متكررة', key: 'repeatedIssue', icon: FileWarning, color: 'text-yellow-400' },
                        // CAPA breakdown items
                        { label: 'حالات كابا مفتوحة', key: 'openCapa', icon: FileText, color: 'text-teal-400' },
                        { label: 'حالات كابا متأخرة', key: 'overdueCapa', icon: AlertCircle, color: 'text-red-400' },
                        { label: 'حالات كابا حرجة', key: 'criticalCapa', icon: ShieldX, color: 'text-red-500' },
                        { label: 'حالات كابا معاد فتحها', key: 'reopenedCapa', icon: ShieldAlert, color: 'text-orange-500' },
                      ].map((item) => {
                        const factor = selectedEmployee.breakdown[item.key] || { count: 0, points: 0 };
                        if (factor.count === 0) return null;
                        return (
                          <div key={item.key} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-slate-800/50">
                            <div className="flex items-center gap-2">
                              <item.icon className={`size-3.5 ${item.color}`} />
                              <span className="text-slate-300 text-xs">{item.label}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-[10px]">×{factor.count}</span>
                              <Badge variant="outline" className={`text-[10px] bg-slate-700/50 ${item.color} border-slate-600/50`}>
                                +{factor.points}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/30 flex items-center justify-between">
                      <span className="text-slate-400 text-xs font-medium">الإجمالي</span>
                      <span className={`font-bold text-sm ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>{selectedEmployee.riskScore} نقطة</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Recommendations */}
                {selectedEmployee.recommendations.length > 0 && (
                  <Card className="border-amber-500/25 bg-amber-500/5">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-white text-sm flex items-center gap-2">
                        <Zap className="size-4 text-amber-400" />
                        التوصيات
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-2">
                        {selectedEmployee.recommendations.map((rec, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                            <div className="size-5 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Target className="size-3 text-amber-400" />
                            </div>
                            <p className="text-amber-200/80 text-xs leading-relaxed">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* CAPA Actions */}
                {selectedEmployee.capaIds && selectedEmployee.capaIds.length > 0 && (
                  <Card className="border-teal-500/25 bg-teal-500/5">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-white text-sm flex items-center gap-2">
                        <FileText className="size-4 text-teal-400" />
                        إجراءات كابا
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs bg-teal-500/10 border-teal-500/30 text-teal-300 hover:bg-teal-500/20 hover:text-teal-200"
                        onClick={() => {
                          // SPA navigation (the page router is not URL-based).
                          useAppStore.getState().navigateTo('capa', undefined, {
                            employeeId: selectedEmployee.employeeId,
                          });
                        }}
                      >
                        <Eye className="size-3.5 ml-1" />
                        عرض حالات كابا ({selectedEmployee.capaIds.length})
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs bg-teal-500/10 border-teal-500/30 text-teal-300 hover:bg-teal-500/20 hover:text-teal-200"
                        onClick={() => {
                          // §1: create intent — navigates AND auto-opens the
                          // CAPA dialog with the employee pre-filled.
                          useAppStore.getState().navigateTo('capa', undefined, {
                            source: 'risk_center',
                            employeeId: selectedEmployee.employeeId,
                            employeeName: selectedEmployee.employeeName,
                            problemDescription: selectedEmployee.recommendations[0] || '',
                          });
                        }}
                      >
                        <FilePlus className="size-3.5 ml-1" />
                        إنشاء كابا جديد
                      </Button>
                    </CardContent>
                  </Card>
                )}

                {/* Last Activity */}
                {selectedEmployee.lastActivity && (
                  <div className="text-center text-slate-500 text-[10px]">
                    آخر نشاط: {selectedEmployee.lastActivity}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}