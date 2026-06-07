'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { getDaysRemaining, isUrgent, getRequestTypeLabel, getRequestTypeColor } from '@/lib/date-utils';
import {
  Clock, FileText, Plane, AlertTriangle, Bell, CheckCircle2, XCircle,
  UserCheck, UserX, MapPin, ChevronDown, ChevronUp, Hotel, CreditCard,
  Car, Palmtree, TrendingDown, TrendingUp, BarChart3, CalendarDays,
  Timer, DollarSign, CalendarClock, Flame, Search, RefreshCw, Eye,
  Activity, Users, Zap, ArrowUpRight, ArrowDownRight, Shield, Scale,
  Award, Fingerprint, Database, FileSpreadsheet, Target, Gauge,
  ChevronLeft, ChevronRight, AlertCircle, CircleCheck, CircleX,
  Lock, Wifi, WifiOff, Download, ExternalLink,
} from 'lucide-react';
import { playNotificationSound } from '@/lib/sounds';

/* ═══════════════════════════════════════════════════════════
   TYPES
   ═══════════════════════════════════════════════════════════ */

interface PendingRequestDetail {
  id: string; employeeId: string; type: string; date: string;
  reason: string; status: string; employeeName: string;
  employeeDepartment: string; createdAt: string;
}

interface TravelAlertItem {
  id: string; employeeId: string; employeeName: string;
  employeeDepartment: string; destination: string; departureDate: string;
  returnDate: string | null; dealerName: string | null; customerNames: string | null;
  hasFlight: boolean; hasHotel: boolean; hasVisa: boolean;
  hasTours: boolean; hasTransportation: boolean;
  flightStatus: string | null; hotelStatus: string | null;
  visaStatus: string | null; toursStatus: string | null;
  transportationStatus: string | null; notes: string | null; status: string;
}

interface EmployeePerformanceItem {
  employeeId: string; employeeName: string; department: string;
  delayCount: number; totalDelayMinutes: number; deductionAmount: number;
  deductionDays: number; presentDays: number; absentDays: number;
}

interface DepartmentPerformanceSummary {
  departmentName: string; employeeCount: number; totalDelays: number;
  totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number;
  presentDays: number; absentDays: number; employees: EmployeePerformanceItem[];
}

interface MonthlyPerformance {
  monthLabel: string; monthKey: string; totalDelays: number;
  totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number;
  totalPresent: number; totalAbsent: number; totalWorkingDays: number;
  departments: DepartmentPerformanceSummary[];
}

interface DeptTodayStat { name: string; employeeCount: number; presentToday: number; lateToday: number; absentToday: number; }
interface RequestTypeSummary { type: string; label: string; pending: number; approved: number; rejected: number; }
interface TopOffender { employeeId: string; employeeName: string; department: string; delayCount: number; totalDelayMinutes: number; deductionAmount: number; }
interface RuleSummary { key: string; label: string; amount: number; unit: string; }

interface HomeStats {
  totalEmployees: number; todayAttendance: number; presentCount: number;
  absentCount: number; lateCount: number; attendanceRate: number;
  departmentList: { name: string; count: number }[];
  deptTodayStats: DeptTodayStat[];
  pendingRequests: number; pendingRequestsDetails: PendingRequestDetail[];
  requestTypeSummary: RequestTypeSummary[];
  activeTravel: number; completedTravelCount: number; inProgressTravelCount: number;
  upcomingTravel: TravelAlertItem[];
  lateEmployees: { id: string; employeeName: string; department: string; checkIn: string | null; minutesLate: number }[];
  lastMonthPerformance: MonthlyPerformance;
  currentMonthPerformance: MonthlyPerformance;
  topOffenders: TopOffender[];
  rulesSummary: RuleSummary[];
  qualitySummary: { totalCases: number; totalAmount: number; totalDays: number; byType: Record<string, number> };
  biometricLastSync: string | null; biometricRecordCount: number;
}

const emptyPerf: MonthlyPerformance = {
  monthLabel: '', monthKey: '', totalDelays: 0, totalDelayMinutes: 0,
  totalDeductionAmount: 0, totalDeductionDays: 0, totalPresent: 0, totalAbsent: 0,
  totalWorkingDays: 22, departments: [],
};

const defaultStats: HomeStats = {
  totalEmployees: 0, todayAttendance: 0, presentCount: 0, absentCount: 0,
  lateCount: 0, attendanceRate: 0, departmentList: [], deptTodayStats: [],
  pendingRequests: 0, pendingRequestsDetails: [], requestTypeSummary: [],
  activeTravel: 0, completedTravelCount: 0, inProgressTravelCount: 0,
  upcomingTravel: [], lateEmployees: [],
  lastMonthPerformance: emptyPerf, currentMonthPerformance: emptyPerf,
  topOffenders: [], rulesSummary: [],
  qualitySummary: { totalCases: 0, totalAmount: 0, totalDays: 0, byType: {} },
  biometricLastSync: null, biometricRecordCount: 0,
};

/* ═══════════════════════════════════════════════════════════
   HOOKS & HELPERS
   ═══════════════════════════════════════════════════════════ */

function useAnimatedCounter(target: number, duration = 900) {
  const [count, setCount] = useState(0);
  const raf = useRef<number | undefined>(undefined);
  useEffect(() => {
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(2, -10 * p);
      setCount(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, duration]);
  return count;
}

function useLiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setTime(`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function useLiveDate() {
  const [date, setDate] = useState('');
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const days = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      const months = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
      setDate(`${days[n.getDay()]} ${n.getDate()} ${months[n.getMonth()]} ${n.getFullYear()}`);
    };
    tick(); const id = setInterval(tick, 60000); return () => clearInterval(id);
  }, []);
  return date;
}

/* ── Micro Components ── */

function ProgressBar({ value, max, colorClass, label }: { value: number; max: number; colorClass: string; label?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      {label && <div className="flex items-center justify-between text-[10px]"><span className="text-slate-400">{label}</span><span className="text-slate-300 font-mono">{Math.round(pct)}%</span></div>}
      <div className="h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
        <motion.div className={`h-full rounded-full ${colorClass}`} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 1, delay: 0.3, ease: [0.4,0,0.2,1] as const }} />
      </div>
    </div>
  );
}

function Pill({ icon, label, value, color, bg }: { icon?: React.ReactNode; label: string; value: string | number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border ${bg} text-[10px]`}>
      {icon && <span className={color}>{icon}</span>}
      <span className="text-slate-400">{label}:</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-700/40 overflow-hidden w-full">
      <motion.div className={`h-full rounded-full ${color}`} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
    </div>
  );
}

function EmptyState({ icon, message, color = 'text-slate-600' }: { icon: React.ReactNode; message: string; color?: string }) {
  return (
    <motion.div className="flex flex-col items-center justify-center py-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
      <motion.div className={`mb-3 ${color}`} animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}>{icon}</motion.div>
      <p className="text-slate-500 text-sm">{message}</p>
    </motion.div>
  );
}

function SectionCard({ title, icon, iconBg, iconColor, borderClr, children, extra, scrollHeight }: {
  title: string; icon: React.ReactNode; iconBg: string; iconColor: string; borderClr: string;
  children: React.ReactNode; extra?: React.ReactNode; scrollHeight?: string;
}) {
  const contentEl = scrollHeight ? (
    <ScrollArea className={`${scrollHeight} w-full overflow-hidden`}>
      <div className="pl-3 pb-2 pr-1">{children}</div>
    </ScrollArea>
  ) : children;
  return (
    <Card className={`${borderClr} bg-slate-800/30 backdrop-blur-sm flex flex-col py-0 gap-0 overflow-hidden hover-glow`}>
      <CardHeader className="pb-2 pt-4 px-5 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className={`flex items-center gap-2.5 ${iconColor} text-base`}>
            <div className={`p-1.5 rounded-lg ${iconBg} shadow-sm transition-transform hover:scale-110`}>{icon}</div>
            {title}
          </CardTitle>
          {extra}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4 px-5 flex-1 min-h-0 overflow-hidden">{contentEl}</CardContent>
    </Card>
  );
}

function NavBtn({ onClick, label, icon, color }: { onClick: () => void; label: string; icon?: React.ReactNode; color?: string }) {
  return (
    <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-slate-700/40 bg-slate-700/20 hover:bg-slate-700/40 transition-colors ${color || 'text-slate-300'}`}>
      {icon}{label}
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════════
   KPI CARD
   ═══════════════════════════════════════════════════════════ */

function KPICard({ title, value, subtitle, icon, gradient, glow, trend, trendLabel }: {
  title: string; value: number | string; subtitle?: string;
  icon: React.ReactNode; gradient: string; glow: string;
  trend?: 'up' | 'down' | 'neutral'; trendLabel?: string;
}) {
  const numericVal = typeof value === 'number' ? value : 0;
  const animated = useAnimatedCounter(numericVal);
  const display = typeof value === 'number' ? animated : value;
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div whileHover={{ y: -4, scale: 1.02 }} whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Card className={`relative overflow-hidden border-0 ${hovered ? `shadow-xl ${glow}` : 'shadow-none'} transition-shadow duration-300`}>
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-80 transition-opacity group-hover:opacity-100`} />
        {/* Shimmer overlay on hover */}
        {hovered && (
          <motion.div
            className="absolute inset-0 opacity-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.2 }}
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.08) 45%, rgba(255,255,255,0.15) 50%, rgba(255,255,255,0.08) 55%, transparent 60%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }}
          />
        )}
        <div className="absolute inset-0 bg-slate-900/30" />
        <CardContent className="relative p-4">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5">
              <p className="text-slate-300/70 text-[11px] font-medium">{title}</p>
              <p className="text-2xl font-bold text-white tabular-nums">{display}</p>
              <div className="flex items-center gap-1.5">
                {subtitle && <span className="text-slate-400 text-[10px]">{subtitle}</span>}
                {trendLabel && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-medium ${trend === 'up' ? 'text-emerald-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400'}`}>
                    {trend === 'up' ? <ArrowUpRight className="size-3" /> : trend === 'down' ? <ArrowDownRight className="size-3" /> : null}
                    {trendLabel}
                  </span>
                )}
              </div>
            </div>
            <motion.div className="p-2.5 rounded-xl bg-white/[0.06] backdrop-blur-sm border border-white/[0.04]" animate={hovered ? { rotate: [0, -8, 8, 0], scale: 1.05 } : { scale: 1 }} transition={{ duration: 0.4 }}>
              {icon}
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DEPARTMENT PERFORMANCE ROW
   ═══════════════════════════════════════════════════════════ */

const DEPT_GRADIENTS = [
  'from-indigo-500/20 to-indigo-600/10', 'from-purple-500/20 to-purple-600/10',
  'from-cyan-500/20 to-cyan-600/10', 'from-rose-500/20 to-rose-600/10',
  'from-amber-500/20 to-amber-600/10', 'from-emerald-500/20 to-emerald-600/10',
  'from-blue-500/20 to-blue-600/10', 'from-pink-500/20 to-pink-600/10',
];

function DeptRow({ dept, idx, accentBg, accentColor }: { dept: DepartmentPerformanceSummary; idx: number; accentBg: string; accentColor: string }) {
  const barMax = dept.presentDays + dept.absentDays + dept.totalDelays || 1;
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}
      className="p-3 rounded-xl bg-slate-700/15 hover:bg-slate-700/25 transition-colors">
      {/* Header row: name + badges */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${DEPT_GRADIENTS[idx % DEPT_GRADIENTS.length]} flex items-center justify-center shrink-0`}>
            <Users className="size-3.5 text-slate-200" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium">{dept.departmentName}</p>
            <p className="text-slate-500 text-[10px]">{dept.employeeCount} موظف</p>
          </div>
        </div>
        {/* Stats badges - allow wrapping on small screens */}
        <div className="flex items-center gap-1 flex-wrap justify-end">
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-medium whitespace-nowrap">{dept.presentDays} حاضر</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-medium whitespace-nowrap">{dept.totalDelays} تأخير</span>
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 font-medium whitespace-nowrap">{dept.totalDeductionAmount.toFixed(0)} ج.م</span>
        </div>
      </div>
      {/* Stacked progress bars with labels */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-12 shrink-0 text-right">حضور</span><MiniBar value={dept.presentDays} max={barMax} color="bg-gradient-to-l from-emerald-500 to-cyan-500" /></div>
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-12 shrink-0 text-right">تأخير</span><MiniBar value={dept.totalDelays} max={barMax} color="bg-gradient-to-l from-amber-500 to-orange-500" /></div>
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-12 shrink-0 text-right">غياب</span><MiniBar value={dept.absentDays} max={barMax} color="bg-gradient-to-l from-red-500 to-rose-500" /></div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { canView, canEdit, isAdmin } = usePermissions('home');
  const { canView: canViewEmployees } = usePermissions('employees');
  const { canView: canViewAttendance } = usePermissions('attendance');
  const { canView: canViewRequests } = usePermissions('requests');
  const { canView: canViewTravel } = usePermissions('travel');
  const { canView: canViewReports } = usePermissions('reports');
  const { canView: canViewQuality } = usePermissions('quality');
  const { canView: canViewBiometric } = usePermissions('biometric');
  const { canView: canViewRules } = usePermissions('rules');
  const { canView: canViewFirebase } = usePermissions('firebase');
  const navigateTo = useAppStore((s) => s.navigateTo);

  const [stats, setStats] = useState<HomeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'travel' | 'quality'>('overview');
  const soundRef = useRef(false);
  const clock = useLiveClock();
  const todayDate = useLiveDate();

  const fetchStats = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const res = await fetch('/api/home/stats');
      if (res.ok) {
        const data = await res.json();
        setStats({
          ...data,
          lastMonthPerformance: data.lastMonthPerformance || emptyPerf,
          currentMonthPerformance: data.currentMonthPerformance || emptyPerf,
        });
      } else setStats(defaultStats);
    } catch { setStats(defaultStats); }
    finally { setLoading(false); if (showRefresh) setRefreshing(false); }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  useEffect(() => {
    if (stats && !soundRef.current) {
      soundRef.current = true;
      if (stats.pendingRequests > 0) playNotificationSound('request');
      if (stats.upcomingTravel.some((t) => isUrgent(t.departureDate))) setTimeout(() => playNotificationSound('travel'), 800);
    }
  }, [stats]);

  const handleRequestAction = async (requestId: string, action: 'approved' | 'rejected') => {
    setActionLoading(requestId);
    try {
      const res = await fetch(`/api/requests/${requestId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: action }) });
      if (res.ok) { toast.success(action === 'approved' ? 'تمت الموافقة' : 'تم الرفض'); playNotificationSound('success'); await fetchStats(); }
      else { toast.error('حدث خطأ'); playNotificationSound('error'); }
    } catch { toast.error('خطأ في الاتصال'); playNotificationSound('error'); }
    finally { setActionLoading(null); }
  };

  const stagger = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } } };
  const fadeUp = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.4,0,0.2,1] as const } } };
  const scaleIn = { hidden: { opacity: 0, scale: 0.97 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.3 } } };

  // ── Loading ──
  if (loading) {
    return (
      <div dir="rtl" className="space-y-5">
        <div className="flex items-center justify-between"><div className="space-y-2"><Skeleton className="h-7 w-48 bg-slate-800 rounded-lg" /><Skeleton className="h-4 w-64 bg-slate-800 rounded-lg" /></div><Skeleton className="h-10 w-24 bg-slate-800 rounded-lg" /></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-[100px] rounded-xl bg-slate-800/50" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-[400px] rounded-xl bg-slate-800/50" />)}</div>
      </div>
    );
  }

  if (!stats) return (
    <div dir="rtl"><h1 className="text-2xl font-bold text-white">لوحة التحكم</h1>
      <Card className="border-slate-700/50 bg-slate-800/50"><CardContent className="py-16"><EmptyState icon={<BarChart3 className="size-12" />} message="لا توجد بيانات" /></CardContent></Card>
    </div>
  );

  const perf = stats.currentMonthPerformance;
  const lastPerf = stats.lastMonthPerformance;
  const delayChange = lastPerf.totalDelays > 0 ? ((perf.totalDelays - lastPerf.totalDelays) / lastPerf.totalDelays * 100).toFixed(0) : '—';
  const dedChange = lastPerf.totalDeductionAmount > 0 ? ((perf.totalDeductionAmount - lastPerf.totalDeductionAmount) / lastPerf.totalDeductionAmount * 100).toFixed(0) : '—';

  return (
    <div dir="rtl" className="space-y-5 pb-6">
      {/* ══════════ HEADER ══════════ */}
      <motion.div className="flex items-start justify-between flex-wrap gap-3" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <motion.span animate={{ rotate: [0,10,-10,0] }} transition={{ duration: 1.5, delay: 0.5 }}>👋</motion.span>
            لوحة القيادة الرئيسية
          </h1>
          <p className="text-slate-400 text-xs mt-1">نظرة شاملة على كل أقسام النظام في مكان واحد</p>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col items-end px-3 py-1.5 rounded-xl bg-slate-800/50 border border-slate-700/30">
            <span className="text-slate-400 text-[10px]">{todayDate}</span>
            <span className="text-slate-200 text-sm font-mono tabular-nums flex items-center gap-1"><Clock className="size-3 text-indigo-400" />{clock}</span>
          </div>
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button variant="outline" size="sm" className="border-slate-700/40 bg-slate-800/40 hover:bg-slate-700/50 text-slate-300 gap-1.5 text-xs" onClick={() => fetchStats(true)} disabled={refreshing}>
              <motion.div animate={refreshing ? { rotate: 360 } : {}} transition={{ duration: 1, repeat: refreshing ? Infinity : 0, ease: 'linear' }}><RefreshCw className="size-3.5" /></motion.div>
              تحديث
            </Button>
          </motion.div>
        </div>
      </motion.div>

      {/* ══════════ NAV TABS ══════════ */}
      <div className="flex items-center gap-1 bg-slate-800/40 rounded-xl p-1 border border-slate-700/20 overflow-x-auto">
        {([
          { id: 'overview' as const, label: 'نظرة عامة', icon: <Gauge className="size-3.5" /> },
          { id: 'performance' as const, label: 'الأداء والتأخيرات', icon: <BarChart3 className="size-3.5" /> },
          { id: 'travel' as const, label: 'السفر والتنبيهات', icon: <Plane className="size-3.5" /> },
          { id: 'quality' as const, label: 'الجودة والخصومات', icon: <Award className="size-3.5" /> },
        ]).map(tab => (
          <motion.button key={tab.id} onClick={() => setActiveTab(tab.id)} layout
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-slate-700/70 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/30'}`}>
            {tab.icon}{tab.label}
          </motion.button>
        ))}
      </div>

      {/* ══════════ 6 KPI CARDS ══════════ */}
      <motion.div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3" variants={stagger} initial="hidden" animate="visible">
        <motion.div variants={fadeUp}>
          <KPICard title="إجمالي الموظفين" value={stats.totalEmployees} subtitle={`${stats.departmentList.length} قسم`}
            icon={<Users className="size-5 text-indigo-400" />} gradient="from-indigo-500/15 to-blue-500/5" glow="shadow-indigo-500/10" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="نسبة الحضور" value={`${stats.attendanceRate}%`} subtitle={`${stats.presentCount} حاضر`}
            icon={<UserCheck className="size-5 text-emerald-400" />} gradient="from-emerald-500/15 to-green-500/5" glow="shadow-emerald-500/10"
            trend={stats.attendanceRate >= 80 ? 'up' : stats.attendanceRate >= 50 ? 'neutral' : 'down'} trendLabel="اليوم" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="المتأخرون" value={stats.lateCount} subtitle={`${stats.absentCount} غائب`}
            icon={<AlertTriangle className="size-5 text-amber-400" />} gradient="from-amber-500/15 to-orange-500/5" glow="shadow-amber-500/10" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="طلبات معلقة" value={stats.pendingRequests} subtitle={`${stats.requestTypeSummary.length} نوع`}
            icon={<Bell className="size-5 text-rose-400" />} gradient="from-rose-500/15 to-pink-500/5" glow="shadow-rose-500/10"
            trend={stats.pendingRequests > 5 ? 'up' : 'neutral'} trendLabel={stats.pendingRequests > 5 ? 'تحتاج مراجعة' : undefined} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="تأخيرات الشهر" value={perf.totalDelays} subtitle={`${perf.totalDelayMinutes} دقيقة`}
            icon={<Flame className="size-5 text-orange-400" />} gradient="from-orange-500/15 to-red-500/5" glow="shadow-orange-500/10"
            trend={Number(delayChange) > 0 ? 'up' : Number(delayChange) < 0 ? 'down' : 'neutral'} trendLabel={`${delayChange}% عن الشهر الماضي`} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="خصومات الشهر" value={`${perf.totalDeductionAmount.toFixed(0)}`} subtitle={`${perf.totalDeductionDays.toFixed(1)} يوم`}
            icon={<DollarSign className="size-5 text-red-400" />} gradient="from-red-500/15 to-rose-500/5" glow="shadow-red-500/10"
            trend={Number(dedChange) > 0 ? 'up' : Number(dedChange) < 0 ? 'down' : 'neutral'} trendLabel={`${dedChange}% عن الشهر الماضي`} />
        </motion.div>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
         TAB: OVERVIEW
         ════════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        {activeTab === 'overview' && (
          <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-5">

            {/* Row 1: Requests + Late + Quick Links */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
              {/* Pending Requests */}
              {canViewRequests() && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="الطلبات المعلقة" icon={<FileText className="size-4" />} iconBg="bg-amber-500/10" iconColor="text-amber-400" borderClr="border-amber-500/15"
                    extra={<NavBtn onClick={() => navigateTo('requests')} label="عرض الكل" icon={<ExternalLink className="size-3" />} color="text-amber-400" />}
                    scrollHeight="max-h-[420px]">
                    {stats.pendingRequestsDetails.length > 0 ? (
                      <div className="space-y-2">
                        {stats.pendingRequestsDetails.map((req, idx) => (
                          <motion.div key={req.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                            className="p-3 rounded-xl border border-slate-700/30 bg-slate-700/15 hover:bg-slate-700/25 transition-all">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-white text-sm font-medium">{req.employeeName}</span>
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 whitespace-nowrap ${getRequestTypeColor(req.type)}`}>{getRequestTypeLabel(req.type)}</span>
                                </div>
                                <p className="text-slate-500 text-[10px] mt-0.5">{req.date}</p>
                                <p className="text-slate-300 text-xs mt-1.5">{req.reason}</p>
                              </div>
                            </div>
                            {canEdit('requests') && (
                              <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-slate-700/20">
                                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                                  <Button size="sm" className="bg-emerald-600/80 hover:bg-emerald-600 text-white text-[10px] gap-1 px-2 h-7"
                                    disabled={actionLoading === req.id} onClick={(e) => { e.stopPropagation(); handleRequestAction(req.id, 'approved'); }}>
                                    {actionLoading === req.id ? <motion.div className="size-2.5 border-2 border-white/30 border-t-white rounded-full" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} /> : <CheckCircle2 className="size-3" />}
                                    موافقة
                                  </Button>
                                </motion.div>
                                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                                  <Button size="sm" variant="outline" className="border-red-500/20 text-red-400 hover:bg-red-500/10 text-[10px] gap-1 px-2 h-7"
                                    disabled={actionLoading === req.id} onClick={(e) => { e.stopPropagation(); handleRequestAction(req.id, 'rejected'); }}>
                                    {actionLoading === req.id ? <motion.div className="size-2.5 border-2 border-red-400/30 border-t-red-400 rounded-full" animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} /> : <XCircle className="size-3" />}
                                    رفض
                                  </Button>
                                </motion.div>
                              </div>
                            )}
                          </motion.div>
                        ))}
                      </div>
                    ) : <EmptyState icon={<CheckCircle2 className="size-10" />} message="لا توجد طلبات معلقة - كل شيء على ما يرام!" color="text-emerald-500/30" />}
                  </SectionCard>
                </motion.div>
              )}

              {/* Late Employees + Attendance */}
              {canViewAttendance() && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="الحضور اليوم" icon={<Clock className="size-4" />} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" borderClr="border-cyan-500/15"
                    extra={<NavBtn onClick={() => navigateTo('attendance')} label="التفاصيل" icon={<ExternalLink className="size-3" />} color="text-cyan-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <Pill icon={<UserCheck className="size-3" />} label="حاضر" value={stats.presentCount} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/15" />
                      <Pill icon={<AlertTriangle className="size-3" />} label="متأخر" value={stats.lateCount} color="text-amber-400" bg="bg-amber-500/10 border-amber-500/15" />
                      <Pill icon={<UserX className="size-3" />} label="غائب" value={stats.absentCount} color="text-red-400" bg="bg-red-500/10 border-red-500/15" />
                      <Pill icon={<Activity className="size-3" />} label="نسبة الحضور" value={`${stats.attendanceRate}%`} color="text-cyan-400" bg="bg-cyan-500/10 border-cyan-500/15" />
                    </div>
                    {stats.totalEmployees > 0 && <ProgressBar value={stats.presentCount} max={stats.totalEmployees} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" label="نسبة الحضور الإجمالية" />}
                    {stats.lateEmployees.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-slate-500 text-[10px] font-medium mb-2">المتأخرون:</p>
                        <div className="space-y-1.5">
                          {stats.lateEmployees.map((late, idx) => (
                            <motion.div key={late.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
                              className="flex items-center justify-between p-2 rounded-lg bg-slate-700/15 hover:bg-slate-700/25 transition-colors">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className="w-6 h-6 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0"><Clock className="size-3 text-amber-400" /></div>
                                <span className="text-white text-xs">{late.employeeName}</span>
                              </div>
                              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/15 text-[10px] shrink-0">{late.minutesLate} د</Badge>
                            </motion.div>
                          ))}
                        </div>
                      </div>
                    ) : <EmptyState icon={<CheckCircle2 className="size-8" />} message="لا يوجد متأخرون - ممتاز!" color="text-emerald-500/30" />}
                  </SectionCard>
                </motion.div>
              )}

              {/* Quick Access + System Status */}
              <motion.div variants={scaleIn} initial="hidden" animate="visible">
                <SectionCard title="الوصول السريع" icon={<Zap className="size-4" />} iconBg="bg-indigo-500/10" iconColor="text-indigo-400" borderClr="border-indigo-500/15"
                  scrollHeight="max-h-[420px]">
                  <div className="grid grid-cols-2 gap-2">
                    {canViewEmployees() && <QuickLink icon={<Users className="size-4" />} label="الموظفين" sub={`${stats.totalEmployees} موظف`} color="from-indigo-500/10 to-indigo-600/5" onClick={() => navigateTo('employees')} />}
                    {canViewBiometric() && <QuickLink icon={<Fingerprint className="size-4" />} label="البصمة" sub={`${stats.biometricRecordCount} سجل`} color="from-purple-500/10 to-purple-600/5" onClick={() => navigateTo('biometric')} />}
                    {canViewAttendance() && <QuickLink icon={<Clock className="size-4" />} label="الحضور" sub={`${stats.attendanceRate}% حضور`} color="from-cyan-500/10 to-cyan-600/5" onClick={() => navigateTo('attendance')} />}
                    {canViewRequests() && <QuickLink icon={<FileText className="size-4" />} label="الطلبات" sub={`${stats.pendingRequests} معلق`} color="from-amber-500/10 to-amber-600/5" onClick={() => navigateTo('requests')} />}
                    {canViewRules() && <QuickLink icon={<Scale className="size-4" />} label="قواعد الخصم" sub={`${stats.rulesSummary.length} قاعدة`} color="from-rose-500/10 to-rose-600/5" onClick={() => navigateTo('rules')} />}
                    {canViewQuality() && <QuickLink icon={<Award className="size-4" />} label="الجودة" sub={`${stats.qualitySummary.totalCases} حالة`} color="from-orange-500/10 to-orange-600/5" onClick={() => navigateTo('quality')} />}
                    {canViewTravel() && <QuickLink icon={<Plane className="size-4" />} label="السفر" sub={`${stats.activeTravel} نشط`} color="from-rose-500/10 to-rose-600/5" onClick={() => navigateTo('travel')} />}
                    {canViewReports() && <QuickLink icon={<FileSpreadsheet className="size-4" />} label="التقارير" sub="تصدير Excel" color="from-emerald-500/10 to-emerald-600/5" onClick={() => navigateTo('reports')} />}
                  </div>
                  {/* System Status */}
                  <div className="mt-3 pt-3 border-t border-slate-700/20">
                    <p className="text-slate-500 text-[10px] font-medium mb-2">حالة النظام</p>
                    <div className="space-y-1.5">
                      <StatusRow icon={<Fingerprint className="size-3" />} label="آخر مزامنة بصمة" value={stats.biometricLastSync ? new Date(stats.biometricLastSync).toLocaleDateString('ar-EG') : 'لم يتم بعد'} ok={!!stats.biometricLastSync} />
                      <StatusRow icon={<Users className="size-3" />} label="إجمالي السجلات" value={`${stats.biometricRecordCount.toLocaleString()} سجل`} ok={stats.biometricRecordCount > 0} />
                      <StatusRow icon={<Database className="size-3" />} label="قاعدة البيانات" value="SQLite - نشطة" ok />
                    </div>
                  </div>
                </SectionCard>
              </motion.div>
            </div>

            {/* Row 2: Request Types + Departments */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Request Type Analytics */}
              {canViewRequests() && stats.requestTypeSummary.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="تحليل الطلبات حسب النوع" icon={<BarChart3 className="size-4" />} iconBg="bg-violet-500/10" iconColor="text-violet-400" borderClr="border-violet-500/15"
                    extra={<NavBtn onClick={() => navigateTo('requests')} label="التفاصيل" icon={<ExternalLink className="size-3" />} color="text-violet-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="space-y-3">
                      {stats.requestTypeSummary.map((rt) => {
                        const total = rt.pending + rt.approved + rt.rejected;
                        const pPct = total > 0 ? (rt.pending / total * 100) : 0;
                        const aPct = total > 0 ? (rt.approved / total * 100) : 0;
                        const rPct = total > 0 ? (rt.rejected / total * 100) : 0;
                        const colors: Record<string, string> = { leave: 'bg-cyan-500', permission: 'bg-violet-500', excuse: 'bg-rose-500', tardiness: 'bg-amber-500', remote: 'bg-emerald-500' };
                        return (
                          <div key={rt.type} className="p-3 rounded-xl bg-slate-700/15">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${colors[rt.type] || 'bg-slate-400'}`} />
                                <span className="text-white text-sm font-medium">{rt.label}</span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600/30 text-slate-300 font-medium shrink-0">{total} طلب</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 h-4 rounded-full overflow-hidden bg-slate-700/30">
                              {aPct > 0 && <motion.div className="h-full bg-emerald-500" initial={{ width: 0 }} animate={{ width: `${aPct}%` }} transition={{ duration: 0.8 }} />}
                              {pPct > 0 && <motion.div className="h-full bg-amber-500" initial={{ width: 0 }} animate={{ width: `${pPct}%` }} transition={{ duration: 0.8 }} />}
                              {rPct > 0 && <motion.div className="h-full bg-red-500" initial={{ width: 0 }} animate={{ width: `${rPct}%` }} transition={{ duration: 0.8 }} />}
                            </div>
                            <div className="flex items-center justify-between mt-1.5 text-[10px]">
                              <span className="text-emerald-400">موافق: {rt.approved}</span>
                              <span className="text-amber-400">معلق: {rt.pending}</span>
                              <span className="text-red-400">مرفوض: {rt.rejected}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Departments Overview */}
              {canViewEmployees() && stats.deptTodayStats.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="أقسام الشركة" icon={<Users className="size-4" />} iconBg="bg-indigo-500/10" iconColor="text-indigo-400" borderClr="border-indigo-500/15"
                    extra={<NavBtn onClick={() => navigateTo('employees')} label="عرض الموظفين" icon={<ExternalLink className="size-3" />} color="text-indigo-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="space-y-2">
                      {stats.deptTodayStats.map((dept, idx) => (
                        <motion.div key={dept.name} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
                          className="p-3 rounded-xl bg-slate-700/15 hover:bg-slate-700/25 transition-colors">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${DEPT_GRADIENTS[idx % DEPT_GRADIENTS.length]} flex items-center justify-center shrink-0`}>
                                <span className="text-white text-[10px] font-bold">{dept.name[0]}</span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-white text-sm font-medium">{dept.name}</p>
                                <p className="text-slate-500 text-[10px]">{dept.employeeCount} موظف</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 flex-wrap justify-end">
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-medium">{dept.presentToday} حاضر</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-medium">{dept.lateToday} متأخر</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 font-medium">{dept.absentToday} غائب</span>
                            </div>
                          </div>
                          {dept.employeeCount > 0 && <ProgressBar value={dept.presentToday} max={dept.employeeCount} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" />}
                        </motion.div>
                      ))}
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════
           TAB: PERFORMANCE
           ════════════════════════════════════════════════════════════ */}
        {activeTab === 'performance' && (
          <motion.div key="performance" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-5">

            {/* Month Comparison Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Last Month */}
              {canViewAttendance() && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title={lastPerf.monthLabel || 'الشهر الماضي'} icon={<TrendingDown className="size-4" />} iconBg="bg-purple-500/10" iconColor="text-purple-400" borderClr="border-purple-500/15"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير مفصل" icon={<FileSpreadsheet className="size-3" />} color="text-purple-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <Pill icon={<Flame className="size-3" />} label="تأخيرات" value={lastPerf.totalDelays} color="text-amber-400" bg="bg-amber-500/10 border-amber-500/15" />
                      <Pill icon={<Clock className="size-3" />} label="إجمالي الدقائق" value={lastPerf.totalDelayMinutes} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/15" />
                      <Pill icon={<DollarSign className="size-3" />} label="خصومات" value={`${lastPerf.totalDeductionAmount.toFixed(0)} ج.م`} color="text-red-400" bg="bg-red-500/10 border-red-500/15" />
                      <Pill icon={<CalendarClock className="size-3" />} label="أيام مخصومة" value={lastPerf.totalDeductionDays.toFixed(1)} color="text-purple-400" bg="bg-purple-500/10 border-purple-500/15" />
                      <Pill icon={<UserCheck className="size-3" />} label="أيام حضور" value={lastPerf.totalPresent} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/15" />
                    </div>
                    <div className="space-y-2">
                      {lastPerf.departments.map((dept, idx) => <DeptRow key={dept.departmentName} dept={dept} idx={idx} accentBg="bg-purple-500/10" accentColor="text-purple-400" />)}
                      {lastPerf.departments.length === 0 && <EmptyState icon={<BarChart3 className="size-8" />} message="لا توجد بيانات" />}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Current Month */}
              {canViewAttendance() && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title={perf.monthLabel || 'الشهر الحالي'} icon={<TrendingUp className="size-4" />} iconBg="bg-indigo-500/10" iconColor="text-indigo-400" borderClr="border-indigo-500/15"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير مفصل" icon={<FileSpreadsheet className="size-3" />} color="text-indigo-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <Pill icon={<Flame className="size-3" />} label="تأخيرات" value={perf.totalDelays} color="text-amber-400" bg="bg-amber-500/10 border-amber-500/15" />
                      <Pill icon={<Clock className="size-3" />} label="إجمالي الدقائق" value={perf.totalDelayMinutes} color="text-orange-400" bg="bg-orange-500/10 border-orange-500/15" />
                      <Pill icon={<DollarSign className="size-3" />} label="خصومات" value={`${perf.totalDeductionAmount.toFixed(0)} ج.م`} color="text-red-400" bg="bg-red-500/10 border-red-500/15" />
                      <Pill icon={<CalendarClock className="size-3" />} label="أيام مخصومة" value={perf.totalDeductionDays.toFixed(1)} color="text-purple-400" bg="bg-purple-500/10 border-purple-500/15" />
                      <Pill icon={<UserCheck className="size-3" />} label="أيام حضور" value={perf.totalPresent} color="text-emerald-400" bg="bg-emerald-500/10 border-emerald-500/15" />
                    </div>
                    <div className="space-y-2">
                      {perf.departments.map((dept, idx) => <DeptRow key={dept.departmentName} dept={dept} idx={idx} accentBg="bg-indigo-500/10" accentColor="text-indigo-400" />)}
                      {perf.departments.length === 0 && <EmptyState icon={<BarChart3 className="size-8" />} message="لا توجد بيانات" />}
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </div>

            {/* Top Offenders + Deduction Rules */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Top 5 Offenders */}
              {canViewAttendance() && stats.topOffenders.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="أكثر 5 موظفين تأخيراً" icon={<AlertTriangle className="size-4" />} iconBg="bg-red-500/10" iconColor="text-red-400" borderClr="border-red-500/15"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير كامل" icon={<FileSpreadsheet className="size-3" />} color="text-red-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="space-y-2">
                      {stats.topOffenders.map((offender, idx) => (
                        <motion.div key={offender.employeeId} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.06 }}
                          className="flex items-center gap-3 p-3 rounded-xl bg-slate-700/15 hover:bg-slate-700/25 transition-colors">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${idx === 0 ? 'bg-red-500/20 text-red-400' : idx === 1 ? 'bg-orange-500/20 text-orange-400' : idx === 2 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600/20 text-slate-400'}`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-medium">{offender.employeeName}</p>
                            <p className="text-slate-500 text-[10px]">{offender.department}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 font-medium whitespace-nowrap"><Flame className="size-2.5 inline ml-0.5" />{offender.delayCount}x</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-500/10 text-orange-400 font-medium whitespace-nowrap">{offender.totalDelayMinutes}د</span>
                            {offender.deductionAmount > 0 && <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 font-medium whitespace-nowrap">{offender.deductionAmount.toFixed(0)} ج.م</span>}
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Deduction Rules */}
              {canViewRules() && stats.rulesSummary.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="جدول قواعد الخصم" icon={<Scale className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/15"
                    extra={<NavBtn onClick={() => navigateTo('rules')} label="إدارة القواعد" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
                    scrollHeight="max-h-[420px]">
                    <div className="space-y-1.5">
                      {stats.rulesSummary.map((rule) => (
                        <div key={rule.key} className="flex items-center justify-between p-3 rounded-xl bg-slate-700/15 hover:bg-slate-700/25 transition-colors">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="w-8 h-8 rounded-lg bg-rose-500/10 flex items-center justify-center shrink-0"><Scale className="size-3.5 text-rose-400" /></div>
                            <span className="text-white text-sm">{rule.label}</span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-600/30 text-slate-200 shrink-0 font-medium">{rule.amount} {rule.unit === 'days' ? 'يوم' : 'ج.م'}</span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════
           TAB: TRAVEL
           ════════════════════════════════════════════════════════════ */}
        {activeTab === 'travel' && (
          <motion.div key="travel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-5">
            {/* Travel Stats Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard title="رحلات نشطة" value={stats.activeTravel} icon={<Plane className="size-5 text-rose-400" />} gradient="from-rose-500/15 to-pink-500/5" glow="shadow-rose-500/10" />
              <KPICard title="قيد التنفيذ" value={stats.inProgressTravelCount} icon={<Activity className="size-5 text-amber-400" />} gradient="from-amber-500/15 to-orange-500/5" glow="shadow-amber-500/10" />
              <KPICard title="مكتملة" value={stats.completedTravelCount} icon={<CheckCircle2 className="size-5 text-emerald-400" />} gradient="from-emerald-500/15 to-green-500/5" glow="shadow-emerald-500/10" />
              <KPICard title="إجمالي الوجهات" value={new Set(stats.upcomingTravel.map(t => t.destination)).size} icon={<MapPin className="size-5 text-cyan-400" />} gradient="from-cyan-500/15 to-blue-500/5" glow="shadow-cyan-500/10" />
            </div>
            {/* Active Travel List */}
            {canViewTravel() && (
              <SectionCard title="الرحلات النشطة والقادمة" icon={<Plane className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/15"
                extra={<NavBtn onClick={() => navigateTo('travel')} label="إدارة الرحلات" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
                scrollHeight="max-h-[520px]">
                {stats.upcomingTravel.length > 0 ? (
                  <div className="space-y-2">
                    {stats.upcomingTravel.map((trip, idx) => {
                      const daysLeft = getDaysRemaining(trip.departureDate);
                      const urgent = isUrgent(trip.departureDate);
                      const missing: { l: string; i: React.ReactNode }[] = [];
                      if (!trip.hasFlight) missing.push({ l: 'طيران', i: <Plane className="size-3" /> });
                      if (!trip.hasHotel) missing.push({ l: 'فندق', i: <Hotel className="size-3" /> });
                      if (!trip.hasVisa) missing.push({ l: 'تأشيرة', i: <CreditCard className="size-3" /> });
                      if (!trip.hasTours) missing.push({ l: 'جولات', i: <Palmtree className="size-3" /> });
                      if (!trip.hasTransportation) missing.push({ l: 'مواصلات', i: <Car className="size-3" /> });
                      return (
                        <motion.div key={trip.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                          whileHover={{ scale: 1.005, y: -1 }} whileTap={{ scale: 0.995 }}
                          className={`p-4 rounded-xl border cursor-pointer transition-all ${urgent ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 shadow-sm shadow-rose-500/5' : 'border-slate-700/30 bg-slate-700/15 hover:bg-slate-700/25'}`}
                          onClick={() => navigateTo('travel', trip.id)}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-medium">{trip.employeeName}</span>
                                {trip.employeeDepartment && <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600/30 text-slate-300 font-medium whitespace-nowrap">{trip.employeeDepartment}</span>}
                                {urgent && <motion.span className="relative flex h-2 w-2 shrink-0" animate={{ scale: [1,1.5,1], opacity: [1,0.5,1] }} transition={{ duration: 1.2, repeat: Infinity }}><span className="absolute inset-0 rounded-full bg-red-500" /><span className="absolute inset-0 rounded-full bg-red-500 animate-ping" /></motion.span>}
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap ${urgent ? 'bg-red-500/10 text-red-400' : daysLeft <= 7 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-600/20 text-slate-400'}`}>
                                  <MapPin className="size-2.5 inline ml-0.5" />{trip.destination}
                                </span>
                              </div>
                              <div className="mt-1.5 space-y-0.5">
                                <p className="text-slate-400 text-[10px]">السفر: {trip.departureDate} {trip.returnDate ? `← العودة: ${trip.returnDate}` : ''}</p>
                                {trip.dealerName && <p className="text-slate-500 text-[10px]">الديل: {trip.dealerName}</p>}
                              </div>
                              {missing.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                  {missing.map(m => <span key={m.l} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-rose-500/10 text-rose-400 font-medium whitespace-nowrap"><AlertTriangle className="size-2.5" />{m.i}{m.l}</span>)}
                                </div>
                              )}
                            </div>
                            <div className="shrink-0 text-center min-w-[40px]">
                              <span className={`text-xl font-bold ${urgent ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>{daysLeft > 0 ? daysLeft : daysLeft === 0 ? '!' : '✓'}</span>
                              <p className={`text-[10px] ${urgent ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>{daysLeft > 0 ? 'يوم' : daysLeft === 0 ? 'اليوم!' : 'انتهى'}</p>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : <EmptyState icon={<Plane className="size-10" />} message="لا توجد رحلات سفر قادمة" />}
              </SectionCard>
            )}
          </motion.div>
        )}

        {/* ════════════════════════════════════════════════════════════
           TAB: QUALITY
           ════════════════════════════════════════════════════════════ */}
        {activeTab === 'quality' && (
          <motion.div key="quality" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }} className="space-y-5">
            {/* Quality Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KPICard title="حالات الجودة" value={stats.qualitySummary.totalCases} icon={<AlertCircle className="size-5 text-orange-400" />} gradient="from-orange-500/15 to-amber-500/5" glow="shadow-orange-500/10" />
              <KPICard title="إجمالي المبلغ" value={`${stats.qualitySummary.totalAmount.toFixed(0)}`} subtitle="جنيه" icon={<DollarSign className="size-5 text-red-400" />} gradient="from-red-500/15 to-rose-500/5" glow="shadow-red-500/10" />
              <KPICard title="أيام مخصومة" value={stats.qualitySummary.totalDays.toFixed(1)} icon={<CalendarClock className="size-5 text-purple-400" />} gradient="from-purple-500/15 to-violet-500/5" glow="shadow-purple-500/10" />
              <KPICard title="تأخيرات الشهر" value={perf.totalDelays} subtitle={`${perf.totalDelayMinutes} دقيقة`} icon={<Flame className="size-5 text-amber-400" />} gradient="from-amber-500/15 to-orange-500/5" glow="shadow-amber-500/10" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Quality Breakdown */}
              {canViewQuality() && (
                <SectionCard title="تفصيل حالات الجودة" icon={<Award className="size-4" />} iconBg="bg-orange-500/10" iconColor="text-orange-400" borderClr="border-orange-500/15"
                  extra={<NavBtn onClick={() => navigateTo('quality')} label="إدارة الجودة" icon={<ExternalLink className="size-3" />} color="text-orange-400" />}
                  scrollHeight="max-h-[420px]">
                  <div className="space-y-3">
                    {[
                      { type: 'quality_issue', label: 'مشاكل جودة', color: 'text-orange-400', bg: 'bg-orange-500', icon: <AlertTriangle className="size-4" /> },
                      { type: 'safety', label: 'السلامة والأمان', color: 'text-red-400', bg: 'bg-red-500', icon: <Shield className="size-4" /> },
                      { type: 'compliance', label: 'الالتزام', color: 'text-purple-400', bg: 'bg-purple-500', icon: <Lock className="size-4" /> },
                    ].map(item => {
                      const count = stats.qualitySummary.byType[item.type] || 0;
                      const total = Math.max(stats.qualitySummary.totalCases, 1);
                      return (
                        <div key={item.type} className="p-4 rounded-xl bg-slate-700/15">
                          <div className="flex items-center justify-between mb-2 gap-2">
                            <div className="flex items-center gap-2 min-w-0 flex-1"><div className={`p-2 rounded-lg bg-slate-700/30 ${item.color} shrink-0`}>{item.icon}</div><span className="text-white text-sm font-medium">{item.label}</span></div>
                            <span className={`px-2 py-0.5 rounded text-[11px] font-mono bg-slate-600/30 ${item.color} shrink-0 font-medium`}>{count} حالة</span>
                          </div>
                          <ProgressBar value={count} max={total} colorClass={item.bg} />
                        </div>
                      );
                    })}
                    {stats.qualitySummary.totalCases === 0 && <EmptyState icon={<CheckCircle2 className="size-10" />} message="لا توجد حالات جودة هذا الشهر - ممتاز!" color="text-emerald-500/30" />}
                  </div>
                </SectionCard>
              )}

              {/* Monthly Deductions Overview */}
              {canViewAttendance() && (
                <SectionCard title="ملخص الخصومات الشهرية" icon={<DollarSign className="size-4" />} iconBg="bg-red-500/10" iconColor="text-red-400" borderClr="border-red-500/15"
                  extra={<NavBtn onClick={() => navigateTo('reports')} label="تصدير تقرير" icon={<Download className="size-3" />} color="text-red-400" />}
                  scrollHeight="max-h-[420px]">
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/5 border border-indigo-500/10">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-indigo-300 text-sm font-medium">{perf.monthLabel || 'الشهر الحالي'}</span>
                        <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/20">{perf.totalWorkingDays} يوم عمل</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-2.5 rounded-lg bg-slate-700/20 text-center"><p className="text-amber-400 text-lg font-bold">{perf.totalDelays}</p><p className="text-slate-400 text-[10px]">تأخير</p></div>
                        <div className="p-2.5 rounded-lg bg-slate-700/20 text-center"><p className="text-red-400 text-lg font-bold">{perf.totalDeductionAmount.toFixed(0)}</p><p className="text-slate-400 text-[10px]">ج.م خصم</p></div>
                        <div className="p-2.5 rounded-lg bg-slate-700/20 text-center"><p className="text-emerald-400 text-lg font-bold">{perf.totalPresent}</p><p className="text-slate-400 text-[10px]">يوم حضور</p></div>
                        <div className="p-2.5 rounded-lg bg-slate-700/20 text-center"><p className="text-purple-400 text-lg font-bold">{perf.totalDeductionDays.toFixed(1)}</p><p className="text-slate-400 text-[10px]">أيام مخصومة</p></div>
                      </div>
                    </div>
                    {/* Performance department bars */}
                    <div className="space-y-2">
                      {perf.departments.slice(0, 8).map((dept, idx) => (
                        <motion.div key={dept.departmentName} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                          className="p-2.5 rounded-lg bg-slate-700/15">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-white text-xs font-medium flex-1 min-w-0">{dept.departmentName}</span>
                            <span className="text-red-400 text-[10px] font-mono shrink-0 mr-2">{dept.totalDeductionAmount.toFixed(0)} ج.م</span>
                          </div>
                          <MiniBar value={dept.totalDeductionAmount} max={Math.max(...perf.departments.map(d => d.totalDeductionAmount), 1)} color="bg-gradient-to-l from-red-500 to-rose-500" />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </SectionCard>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HELPER: Quick Link Card
   ═══════════════════════════════════════════════════════════ */

function QuickLink({ icon, label, sub, color, onClick }: { icon: React.ReactNode; label: string; sub: string; color: string; onClick: () => void }) {
  return (
    <motion.button whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }} onClick={onClick}
      className={`p-3 rounded-xl bg-gradient-to-br ${color} border border-slate-700/20 hover:border-slate-600/30 transition-all text-right`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-slate-300">{icon}</span>
        <span className="text-white text-xs font-medium">{label}</span>
      </div>
      <p className="text-slate-500 text-[10px]">{sub}</p>
    </motion.button>
  );
}

/* ═══════════════════════════════════════════════════════════
   HELPER: Status Row
   ═══════════════════════════════════════════════════════════ */

function StatusRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-slate-700/10">
      <div className="flex items-center gap-2">
        <span className={ok ? 'text-emerald-400' : 'text-slate-500'}>{icon}</span>
        <span className="text-slate-400 text-[10px]">{label}</span>
      </div>
      <span className={`text-[10px] ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>{value}</span>
    </div>
  );
}
