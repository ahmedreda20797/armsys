'use client';

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { useHomeStats, useUpdateRequest, useInvalidateQueries, queryKeys } from '@/hooks/use-queries';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardCard, DashboardGrid, type DashboardCardSize } from '@/components/dashboard/DashboardCard';
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
  Lock, Wifi, WifiOff, Download, ExternalLink, ClipboardList, Globe,
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
  hasInternationalFlight: boolean; hasDomesticFlight: boolean; hasHotel: boolean; hasVisa: boolean;
  hasTours: boolean; hasTransportation: boolean;
  internationalFlightStatus: string | null; domesticFlightStatus: string | null; hotelStatus: string | null;
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
interface TodayFollowUpItem { id: string; employeeId: string; employeeName: string; employeeDepartment: string; responsiblePersonName: string; responsiblePersonId: string; followUpType: string; priorityLevel: string; status: string; nextFollowUpDate: string; }
interface FollowUpsSummary { totalActive: number; totalOverdue: number; totalCompleted: number; todaysScheduled: number; }

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
  todaysFollowUps: TodayFollowUpItem[];
  followUpsSummary: FollowUpsSummary;
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
  todaysFollowUps: [],
  followUpsSummary: { totalActive: 0, totalOverdue: 0, totalCompleted: 0, todaysScheduled: 0 },
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

/* ═══════════════════════════════════════════════════════════
   MICRO COMPONENTS
   ═══════════════════════════════════════════════════════════ */

const ProgressBar = memo(function ProgressBar({ value, max, colorClass, label }: { value: number; max: number; colorClass: string; label?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1.5">
      {label && <div className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-mono font-medium">{Math.round(pct)}%</span></div>}
      <div className="h-2 rounded-full bg-slate-700/40 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass} transition-all duration-1000 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
});

const Pill = memo(function Pill({ icon, label, value, color, bg }: { icon?: React.ReactNode; label: string; value: string | number; color: string; bg: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${bg} text-[11px]`}>
      {icon && <span className={color}>{icon}</span>}
      <span className="text-slate-400">{label}:</span>
      <span className={`font-bold ${color}`}>{value}</span>
    </div>
  );
});

const MiniBar = memo(function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-700/40 overflow-hidden w-full">
      <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${w}%` }} />
    </div>
  );
});

const EmptyState = memo(function EmptyState({ icon, message, color = 'text-slate-600' }: { icon: React.ReactNode; message: string; color?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10" style={{ animation: 'fadeIn 0.3s ease-out' }}>
      <div className={`mb-3 ${color}`} style={{ animation: 'float-sm 2.5s ease-in-out infinite' }}>{icon}</div>
      <p className="text-slate-400 text-sm">{message}</p>
    </div>
  );
});

const GradientDivider = memo(function GradientDivider() {
  return (
    <div className="relative h-px w-full my-1">
      <div className="absolute inset-0 bg-gradient-to-l from-transparent via-slate-600/40 to-transparent" />
    </div>
  );
});

/* SectionCard — backward-compatible wrapper around DashboardCard
   Uses size presets for consistent height management instead of hardcoded scrollHeight.
   scrollHeight is kept for backward compat — maps to maxHeight when provided.
   size prop takes priority when both are present.
*/
const SectionCard = memo(function SectionCard({ title, icon, iconBg, iconColor, borderClr, children, extra, scrollHeight, size, badge, empty, emptyIcon, emptyMessage, onOpenFull, footer }: {
  title: string; icon: React.ReactNode; iconBg: string; iconColor: string; borderClr: string;
  children: React.ReactNode; extra?: React.ReactNode; scrollHeight?: string;
  size?: DashboardCardSize; badge?: string | number; empty?: boolean; emptyIcon?: React.ReactNode;
  emptyMessage?: string; onOpenFull?: () => void; footer?: React.ReactNode;
}) {
  return (
    <DashboardCard
      title={title} icon={icon} iconBg={iconBg} iconColor={iconColor} borderClr={borderClr}
      scrollable={!!scrollHeight || !!size}
      size={size || 'medium'}
      maxHeight={scrollHeight || undefined}
      actions={extra}
      badge={badge}
      empty={empty}
      emptyIcon={emptyIcon}
      emptyMessage={emptyMessage}
      onOpenFull={onOpenFull}
      footer={footer}
    >
      {children}
    </DashboardCard>
  );
});

const NavBtn = memo(function NavBtn({ onClick, label, icon, color }: { onClick: () => void; label: string; icon?: React.ReactNode; color?: string }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-medium border border-slate-700/30 bg-slate-700/15 hover:bg-slate-700/30 hover:scale-[1.03] active:scale-[0.97] transition-all duration-150 ${color || 'text-slate-300'}`}>
      {icon}{label}
    </button>
  );
});

/* ═══════════════════════════════════════════════════════════
   KPI CARD — Premium Glass Style
   ═══════════════════════════════════════════════════════════ */

const KPICard = memo(function KPICard({ title, value, subtitle, icon, gradient, glow, trend, trendLabel }: {
  title: string; value: number | string; subtitle?: string;
  icon: React.ReactNode; gradient: string; glow: string;
  trend?: 'up' | 'down' | 'neutral'; trendLabel?: string;
}) {
  const numericVal = typeof value === 'number' ? value : 0;
  const animated = useAnimatedCounter(numericVal);
  const display = typeof value === 'number' ? animated : value;
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div whileHover={{ y: -6, scale: 1.02 }} whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <Card className={`relative overflow-hidden rounded-2xl border-0 transition-all duration-400 ${hovered ? `shadow-2xl ${glow} ring-1 ring-white/[0.06]` : 'shadow-lg shadow-black/20'}`}>
        {/* Main gradient */}
        <div className={`absolute inset-0 bg-gradient-to-br ${gradient} transition-opacity`} style={{ opacity: hovered ? 1 : 0.85 }} />
        {/* Glassmorphism overlay */}
        <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" />
        {/* Shimmer on hover */}
        {hovered && (
          <motion.div
            className="absolute inset-0 opacity-20"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.15 }}
            style={{
              background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 55%, transparent 60%)',
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }}
          />
        )}
        <CardContent className="relative p-5">
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <p className="text-slate-300/80 text-[11px] font-medium tracking-wide">{title}</p>
              <p className="text-3xl font-bold text-white tabular-nums">{display}</p>
              <div className="flex items-center gap-1.5">
                {subtitle && <span className="text-slate-400/80 text-[10px]">{subtitle}</span>}
                {trendLabel && (
                  <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${trend === 'up' ? 'text-violet-400' : trend === 'down' ? 'text-red-400' : 'text-slate-400'}`}>
                    {trend === 'up' ? <ArrowUpRight className="size-3" /> : trend === 'down' ? <ArrowDownRight className="size-3" /> : null}
                    {trendLabel}
                  </span>
                )}
              </div>
            </div>
            <motion.div className="p-3 rounded-2xl bg-white/[0.08] backdrop-blur-sm border border-white/[0.06] shadow-inner" animate={hovered ? { rotate: [0, -8, 8, 0], scale: 1.1 } : { scale: 1 }} transition={{ duration: 0.4 }}>
              {icon}
            </motion.div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
});

/* ═══════════════════════════════════════════════════════════
   QUICK STAT CARD — Small glass tile
   ═══════════════════════════════════════════════════════════ */

const QuickStatCard = memo(function QuickStatCard({ icon, label, value, color, gradient }: {
  icon: React.ReactNode; label: string; value: string | number; color: string; gradient: string;
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-br p-5 shadow-lg shadow-black/15 hover:-translate-y-0.5 hover:shadow-xl transition-all duration-200 cursor-default">
      <div className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-100`} />
      <div className="absolute top-0 left-0 w-20 h-20 rounded-full bg-white/[0.03] -translate-x-1/2 -translate-y-1/2" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-3">
          <div className={`p-2.5 rounded-xl bg-white/[0.08] ${color}`}>{icon}</div>
          <span className="text-slate-400 text-xs font-medium">{label}</span>
        </div>
        <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   DEPARTMENT PERFORMANCE ROW
   ═══════════════════════════════════════════════════════════ */

const DEPT_GRADIENTS = [
  'from-violet-500/20 to-purple-600/10', 'from-cyan-500/20 to-teal-600/10',
  'from-rose-500/20 to-pink-600/10', 'from-amber-500/20 to-orange-600/10',
  'from-emerald-500/20 to-green-600/10', 'from-red-500/20 to-rose-600/10',
  'from-sky-500/20 to-blue-600/10', 'from-fuchsia-500/20 to-pink-600/10',
];

const DeptRow = memo(function DeptRow({ dept, idx, accentBg, accentColor }: { dept: DepartmentPerformanceSummary; idx: number; accentBg: string; accentColor: string }) {
  const barMax = dept.presentDays + dept.absentDays + dept.totalDelays || 1;
  return (
    <div className="p-4 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 border border-transparent hover:border-slate-600/15">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${DEPT_GRADIENTS[idx % DEPT_GRADIENTS.length]} flex items-center justify-center shrink-0 shadow-sm`}>
            <Users className="size-4 text-white/80" />
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-semibold">{dept.departmentName}</p>
            <p className="text-slate-500 text-[10px]">{dept.employeeCount} موظف</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <span className="px-2 py-1 rounded-lg text-[10px] bg-violet-500/10 text-violet-400 font-semibold whitespace-nowrap">{dept.presentDays} حاضر</span>
          <span className="px-2 py-1 rounded-lg text-[10px] bg-amber-500/10 text-amber-400 font-semibold whitespace-nowrap">{dept.totalDelays} تأخير</span>
          <span className="px-2 py-1 rounded-lg text-[10px] bg-red-500/10 text-red-400 font-semibold whitespace-nowrap">{dept.totalDeductionAmount.toFixed(0)} ج.م</span>
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-14 shrink-0 text-right font-medium">حضور</span><MiniBar value={dept.presentDays} max={barMax} color="bg-gradient-to-l from-emerald-500 to-cyan-500" /></div>
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-14 shrink-0 text-right font-medium">تأخير</span><MiniBar value={dept.totalDelays} max={barMax} color="bg-gradient-to-l from-amber-500 to-orange-500" /></div>
        <div className="flex items-center gap-2"><span className="text-[10px] text-slate-500 w-14 shrink-0 text-right font-medium">غياب</span><MiniBar value={dept.absentDays} max={barMax} color="bg-gradient-to-l from-red-500 to-rose-500" /></div>
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════
   ANIMATION VARIANTS (stable — defined once, outside component)
   ═══════════════════════════════════════════════════════════ */

const stagger = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.4,0,0.2,1] as const } } };
const scaleIn = { hidden: { opacity: 0, scale: 0.96 }, visible: { opacity: 1, scale: 1, transition: { duration: 0.35 } } };

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { canView, canEdit, isAdmin, canEditPage, canViewPage: hookCanViewPage } = usePermissions('home');
  const navigateTo = useAppStore((s) => s.navigateTo);

  // Helper to check if user can view other pages (admin sees all)
  const canViewPage = (pid: string) => hookCanViewPage(pid);

  // ── React Query: cached data fetching with automatic background refresh ──
  const { data: rawStats, isLoading: loading, refetch, isFetching: refreshing } = useHomeStats();
  const updateRequestMutation = useUpdateRequest();

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'performance' | 'travel' | 'quality'>('overview');
  const soundRef = useRef(false);
  const clock = useLiveClock();
  const todayDate = useLiveDate();

  // Normalize stats data with defaults for missing fields
  const stats = useMemo(() => {
    if (!rawStats) return null;
    return {
      ...rawStats,
      lastMonthPerformance: rawStats.lastMonthPerformance || emptyPerf,
      currentMonthPerformance: rawStats.currentMonthPerformance || emptyPerf,
    };
  }, [rawStats]);

  // Play notification sounds on first load
  useEffect(() => {
    if (stats && !soundRef.current) {
      soundRef.current = true;
      if (stats.pendingRequests > 0) playNotificationSound('request');
      if (stats.upcomingTravel && stats.upcomingTravel.some((t: any) => isUrgent(t.departureDate))) setTimeout(() => playNotificationSound('travel'), 800);
    }
  }, [stats]);

  const handleRequestAction = useCallback(async (requestId: string, action: 'approved' | 'rejected') => {
    setActionLoading(requestId);
    try {
      updateRequestMutation.mutate(
        { id: requestId, data: { status: action } },
        {
          onSuccess: () => {
            toast.success(action === 'approved' ? 'تمت الموافقة' : 'تم الرفض');
            playNotificationSound('success');
          },
          onError: () => {
            toast.error('حدث خطأ');
            playNotificationSound('error');
          },
          onSettled: () => setActionLoading(null),
        }
      );
    } catch { toast.error('خطأ في الاتصال'); playNotificationSound('error'); setActionLoading(null); }
  }, [updateRequestMutation]);

  // ── Loading Skeleton ──
  if (loading) {
    return (
      <div dir="rtl" className="space-y-6">
        <div className="relative overflow-hidden rounded-2xl h-32">
          <Skeleton className="h-full w-full bg-slate-800/60 rounded-2xl" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-[120px] rounded-2xl bg-slate-800/40" />)}</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-[100px] rounded-2xl bg-slate-800/40" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">{Array.from({length:3}).map((_,i)=><Skeleton key={i} className="h-[440px] rounded-2xl bg-slate-800/40" />)}</div>
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
    <div dir="rtl" className="space-y-6 pb-8">

      {/* ══════════════════════════════════════════════════════════
         HEADER BANNER — Premium Gradient
         ══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.4,0,0.2,1] as const }}
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 backdrop-blur-xl shadow-2xl shadow-black/30"
      >
        {/* Decorative background orbs */}
        <div className="absolute -top-20 -left-20 w-56 h-56 rounded-full bg-emerald-500/[0.07] blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-48 h-48 rounded-full bg-violet-500/[0.06] blur-3xl pointer-events-none" />
        <div className="absolute top-1/2 left-1/3 w-32 h-32 rounded-full bg-cyan-500/[0.04] blur-3xl pointer-events-none" />

        <div className="relative flex items-center justify-between flex-wrap gap-4 p-6 md:p-8">
          <div className="flex items-center gap-4">
            <motion.div
              className="p-3.5 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/10 border border-violet-500/30 shadow-lg shadow-violet-500/20"
              animate={{ rotate: [0, 5, -5, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Gauge className="size-7 text-violet-400" />
            </motion.div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-white tracking-tight">لوحة القيادة الرئيسية</h1>
              <p className="text-slate-400 text-sm mt-1">نظرة شاملة على كل أقسام النظام في مكان واحد</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end px-4 py-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
              <span className="text-slate-400 text-[10px] font-medium">{todayDate}</span>
              <span className="text-slate-100 text-base font-mono tabular-nums flex items-center gap-1.5 mt-0.5">
                <Clock className="size-3.5 text-violet-400" />{clock}
              </span>
            </div>
            <motion.div whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.94 }}>
              <Button variant="outline" size="sm" className="border-white/[0.08] bg-white/[0.04] hover:bg-white/[0.08] text-slate-200 gap-2 text-xs h-10 px-4 rounded-xl backdrop-blur-sm" onClick={() => refetch()} disabled={refreshing}>
                <motion.div animate={refreshing ? { rotate: 360 } : {}} transition={{ duration: 1, repeat: refreshing ? Infinity : 0, ease: 'linear' }}><RefreshCw className="size-4" /></motion.div>
                تحديث
              </Button>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════
         NAVIGATION TABS — Pill style
         ══════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4 }}
        className="flex items-center gap-1 bg-slate-800/30 backdrop-blur-md rounded-2xl p-1.5 border border-white/[0.05] overflow-x-auto"
      >
        {([
          { id: 'overview' as const, label: 'نظرة عامة', icon: <Gauge className="size-4" /> },
          { id: 'performance' as const, label: 'الأداء والتأخيرات', icon: <BarChart3 className="size-4" /> },
          { id: 'travel' as const, label: 'السفر والتنبيهات', icon: <Plane className="size-4" /> },
          { id: 'quality' as const, label: 'الجودة والخصومات', icon: <Award className="size-4" /> },
        ]).map(tab => (
          <motion.button key={tab.id} onClick={() => setActiveTab(tab.id)} layout
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all duration-200 ${activeTab === tab.id ? 'bg-white/[0.08] text-white shadow-lg shadow-black/10 border border-white/[0.06]' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.03]'}`}>
            {tab.icon}{tab.label}
          </motion.button>
        ))}
      </motion.div>

      {/* ══════════════════════════════════════════════════════════
         6 KPI CARDS — Premium Glass
         ══════════════════════════════════════════════════════════ */}
      <motion.div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4" variants={stagger} initial="hidden" animate="visible">
        <motion.div variants={fadeUp}>
          <KPICard title="إجمالي الموظفين" value={stats.totalEmployees} subtitle={`${stats.departmentList.length} قسم`}
            icon={<Users className="size-5 text-violet-400" />} gradient="from-violet-500/20 to-purple-600/10" glow="shadow-violet-500/15" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="نسبة الحضور" value={`${stats.attendanceRate}%`} subtitle={`${stats.presentCount} حاضر`}
            icon={<UserCheck className="size-5 text-violet-400" />} gradient="from-emerald-500/20 to-green-600/10" glow="shadow-violet-500/20"
            trend={stats.attendanceRate >= 80 ? 'up' : stats.attendanceRate >= 50 ? 'neutral' : 'down'} trendLabel="اليوم" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="المتأخرون" value={stats.lateCount} subtitle={`${stats.absentCount} غائب`}
            icon={<AlertTriangle className="size-5 text-amber-400" />} gradient="from-amber-500/20 to-orange-600/10" glow="shadow-amber-500/15" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="طلبات معلقة" value={stats.pendingRequests} subtitle={`${stats.requestTypeSummary.length} نوع`}
            icon={<Bell className="size-5 text-rose-400" />} gradient="from-rose-500/20 to-pink-600/10" glow="shadow-rose-500/15"
            trend={stats.pendingRequests > 5 ? 'up' : 'neutral'} trendLabel={stats.pendingRequests > 5 ? 'تحتاج مراجعة' : undefined} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="تأخيرات الشهر" value={perf.totalDelays} subtitle={`${perf.totalDelayMinutes} دقيقة`}
            icon={<Flame className="size-5 text-orange-400" />} gradient="from-orange-500/20 to-red-600/10" glow="shadow-orange-500/15"
            trend={Number(delayChange) > 0 ? 'up' : Number(delayChange) < 0 ? 'down' : 'neutral'} trendLabel={`${delayChange}% عن الشهر الماضي`} />
        </motion.div>
        <motion.div variants={fadeUp}>
          <KPICard title="خصومات الشهر" value={`${perf.totalDeductionAmount.toFixed(0)}`} subtitle={`${perf.totalDeductionDays.toFixed(1)} يوم`}
            icon={<DollarSign className="size-5 text-red-400" />} gradient="from-red-500/20 to-rose-600/10" glow="shadow-red-500/15"
            trend={Number(dedChange) > 0 ? 'up' : Number(dedChange) < 0 ? 'down' : 'neutral'} trendLabel={`${dedChange}% عن الشهر الماضي`} />
        </motion.div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════
         QUICK STATISTICS — 3x2 Glass Tiles
         ══════════════════════════════════════════════════════════ */}
      <motion.div className="grid grid-cols-2 sm:grid-cols-3 gap-4" variants={stagger} initial="hidden" animate="visible">
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<Users className="size-5" />} label="المستخدمين" value={stats.totalEmployees} color="text-violet-400" gradient="from-violet-500/10 to-purple-600/5" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<FileText className="size-5" />} label="الطلبات" value={stats.pendingRequests + (stats.requestTypeSummary.reduce((s,r) => s + r.approved + r.rejected, 0))} color="text-cyan-400" gradient="from-cyan-500/10 to-blue-600/5" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<Fingerprint className="size-5" />} label="البصمات" value={stats.biometricRecordCount.toLocaleString()} color="text-purple-400" gradient="from-purple-500/10 to-fuchsia-600/5" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<Users className="size-5" />} label="الأقسام" value={stats.departmentList.length} color="text-violet-400" gradient="from-emerald-500/10 to-green-600/5" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<AlertCircle className="size-5" />} label="حالات الجودة" value={stats.qualitySummary.totalCases} color="text-orange-400" gradient="from-orange-500/10 to-amber-600/5" />
        </motion.div>
        <motion.div variants={fadeUp}>
          <QuickStatCard icon={<FileSpreadsheet className="size-5" />} label="التقارير" value="✓" color="text-rose-400" gradient="from-rose-500/10 to-pink-600/5" />
        </motion.div>
      </motion.div>

      {/* ══════════════════════════════════════════════════════════
         TAB CONTENT
         ══════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">

        {/* ══════════════════════════════════════════════════════════
           TAB: OVERVIEW
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <motion.div key="overview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="space-y-6">

            <GradientDivider />

            {/* Row 1: Requests + Attendance + Quick Links */}
            <DashboardGrid columns={3}>

              {/* Pending Requests */}
              {canViewPage('requests') && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="الطلبات المعلقة" icon={<FileText className="size-4" />} iconBg="bg-amber-500/10" iconColor="text-amber-400" borderClr="border-amber-500/10"
                    size="medium"
                    badge={stats.pendingRequestsDetails.length || undefined}
                    onOpenFull={() => navigateTo('requests')}
                    empty={stats.pendingRequestsDetails.length === 0}
                    emptyIcon={<CheckCircle2 className="size-10" />}
                    emptyMessage="لا توجد طلبات معلقة - كل شيء على ما يرام!"
                    footer={stats.pendingRequestsDetails.length > 0 ? (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500 text-[10px]">{stats.pendingRequestsDetails.length} طلب معلق</span>
                        <button onClick={() => navigateTo('requests')} className="text-amber-400 text-[10px] font-medium hover:text-amber-300 transition-colors flex items-center gap-1">عرض الكل <ExternalLink className="size-3" /></button>
                      </div>
                    ) : undefined}
                    >
                    <div className="space-y-2.5">
                      {stats.pendingRequestsDetails.map((req, idx) => (
                        <div key={req.id} className="p-4 rounded-xl border border-slate-700/20 bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 hover:border-slate-600/20">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-semibold">{req.employeeName}</span>
                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 whitespace-nowrap ${getRequestTypeColor(req.type)}`}>{getRequestTypeLabel(req.type)}</span>
                              </div>
                              <p className="text-slate-500 text-[10px] mt-1">{req.date}</p>
                              <p className="text-slate-300 text-xs mt-2">{req.reason}</p>
                            </div>
                          </div>
                          {canEditPage('requests') && (
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-700/15">
                              <Button size="sm" className="bg-emerald-600/70 text-white text-[10px] gap-1.5 px-3 h-8 rounded-xl"
                                disabled={actionLoading === req.id}
                                onClick={(e) => { e.stopPropagation(); handleRequestAction(req.id, 'approved'); }}>
                                {actionLoading === req.id ? 'جاري...' : 'موافقة'}
                              </Button>
                              <Button size="sm" variant="outline" className="border-red-500/15 text-red-400 hover:bg-red-500/10 text-[10px] gap-1.5 px-3 h-8 rounded-xl"
                                disabled={actionLoading === req.id}
                                onClick={(e) => { e.stopPropagation(); handleRequestAction(req.id, 'rejected'); }}>
                                {actionLoading === req.id ? 'جاري...' : 'رفض'}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Today's Attendance */}
              {canViewPage('attendance') && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="الحضور اليوم" icon={<Clock className="size-4" />} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" borderClr="border-cyan-500/10"
                    extra={<NavBtn onClick={() => navigateTo('attendance')} label="التفاصيل" icon={<ExternalLink className="size-3" />} color="text-cyan-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Pill icon={<UserCheck className="size-3.5" />} label="حاضر" value={stats.presentCount} color="text-violet-400" bg="bg-emerald-500/8 border-violet-500/30" />
                      <Pill icon={<AlertTriangle className="size-3.5" />} label="متأخر" value={stats.lateCount} color="text-amber-400" bg="bg-amber-500/8 border-amber-500/12" />
                      <Pill icon={<UserX className="size-3.5" />} label="غائب" value={stats.absentCount} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
                      <Pill icon={<Activity className="size-3.5" />} label="نسبة الحضور" value={`${stats.attendanceRate}%`} color="text-cyan-400" bg="bg-cyan-500/8 border-cyan-500/12" />
                    </div>
                    {stats.totalEmployees > 0 && <ProgressBar value={stats.presentCount} max={stats.totalEmployees} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" label="نسبة الحضور الإجمالية" />}
                    {stats.lateEmployees.length > 0 ? (
                      <div className="mt-4">
                        <p className="text-slate-500 text-[10px] font-semibold mb-2.5 flex items-center gap-1.5"><AlertTriangle className="size-3" /> المتأخرون:</p>
                        <div className="space-y-2">
                          {stats.lateEmployees.map((late, idx) => (
                            <motion.div key={late.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
                              className="flex items-center justify-between p-3 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 border border-transparent hover:border-slate-600/10">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Clock className="size-3 text-amber-400" /></div>
                                <span className="text-white text-xs font-medium">{late.employeeName}</span>
                              </div>
                              <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/12 text-[10px] shrink-0 rounded-lg px-2">{late.minutesLate} د</Badge>
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
                <SectionCard title="الوصول السريع" icon={<Zap className="size-4" />} iconBg="bg-violet-500/10" iconColor="text-violet-400" borderClr="border-violet-500/10"
                  scrollHeight="max-h-[440px]">
                  <div className="grid grid-cols-2 gap-2.5">
                    {canViewPage('employees') && <QuickLink icon={<Users className="size-4" />} label="الموظفين" sub={`${stats.totalEmployees} موظف`} color="from-violet-500/10 to-purple-600/5" onClick={() => navigateTo('employees')} />}
                    {canViewPage('biometric') && <QuickLink icon={<Fingerprint className="size-4" />} label="البصمة" sub={`${stats.biometricRecordCount} سجل`} color="from-purple-500/10 to-fuchsia-600/5" onClick={() => navigateTo('biometric')} />}
                    {canViewPage('attendance') && <QuickLink icon={<Clock className="size-4" />} label="الحضور" sub={`${stats.attendanceRate}% حضور`} color="from-cyan-500/10 to-teal-600/5" onClick={() => navigateTo('attendance')} />}
                    {canViewPage('requests') && <QuickLink icon={<FileText className="size-4" />} label="الطلبات" sub={`${stats.pendingRequests} معلق`} color="from-amber-500/10 to-orange-600/5" onClick={() => navigateTo('requests')} />}
                    {canViewPage('rules') && <QuickLink icon={<Scale className="size-4" />} label="قواعد الخصم" sub={`${stats.rulesSummary.length} قاعدة`} color="from-rose-500/10 to-pink-600/5" onClick={() => navigateTo('rules')} />}
                    {canViewPage('quality') && <QuickLink icon={<Award className="size-4" />} label="الجودة" sub={`${stats.qualitySummary.totalCases} حالة`} color="from-orange-500/10 to-amber-600/5" onClick={() => navigateTo('quality')} />}
                    {canViewPage('travel') && <QuickLink icon={<Plane className="size-4" />} label="السفر" sub={`${stats.activeTravel} نشط`} color="from-rose-500/10 to-pink-600/5" onClick={() => navigateTo('travel')} />}
                    {canViewPage('reports') && <QuickLink icon={<FileSpreadsheet className="size-4" />} label="التقارير" sub="تصدير Excel" color="from-emerald-500/10 to-green-600/5" onClick={() => navigateTo('reports')} />}
                  </div>
                  {/* System Status */}
                  <div className="mt-4 pt-4 border-t border-slate-700/15">
                    <p className="text-slate-500 text-[10px] font-semibold mb-2.5 flex items-center gap-1.5"><Activity className="size-3" /> حالة النظام</p>
                    <div className="space-y-2">
                      <StatusRow icon={<Fingerprint className="size-3.5" />} label="آخر مزامنة بصمة" value={stats.biometricLastSync ? new Date(stats.biometricLastSync).toLocaleDateString('ar-EG') : 'لم يتم بعد'} ok={!!stats.biometricLastSync} />
                      <StatusRow icon={<Users className="size-3.5" />} label="إجمالي السجلات" value={`${stats.biometricRecordCount.toLocaleString()} سجل`} ok={stats.biometricRecordCount > 0} />
                      <StatusRow icon={<Database className="size-3.5" />} label="قاعدة البيانات" value="SQLite - نشطة" ok />
                    </div>
                  </div>
                </SectionCard>
              </motion.div>
            </DashboardGrid>

            <GradientDivider />

            {/* Row 2: Request Types + Departments */}
            <DashboardGrid>

              {/* Request Type Analytics */}
              {canViewPage('requests') && stats.requestTypeSummary.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="تحليل الطلبات حسب النوع" icon={<BarChart3 className="size-4" />} iconBg="bg-violet-500/10" iconColor="text-violet-400" borderClr="border-violet-500/10"
                    extra={<NavBtn onClick={() => navigateTo('requests')} label="التفاصيل" icon={<ExternalLink className="size-3" />} color="text-violet-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="space-y-3">
                      {stats.requestTypeSummary.map((rt) => {
                        const total = rt.pending + rt.approved + rt.rejected;
                        const pPct = total > 0 ? (rt.pending / total * 100) : 0;
                        const aPct = total > 0 ? (rt.approved / total * 100) : 0;
                        const rPct = total > 0 ? (rt.rejected / total * 100) : 0;
                        const colors: Record<string, string> = { leave: 'bg-cyan-500', permission: 'bg-violet-500', excuse: 'bg-rose-500', tardiness: 'bg-amber-500', remote: 'bg-emerald-500' };
                        return (
                          <div key={rt.type} className="p-4 rounded-xl bg-slate-700/10 border border-slate-700/10">
                            <div className="flex items-center justify-between mb-2.5">
                              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                <div className={`w-3 h-3 rounded-full shrink-0 ${colors[rt.type] || 'bg-slate-400'}`} />
                                <span className="text-white text-sm font-medium">{rt.label}</span>
                                <span className="px-2 py-0.5 rounded-lg text-[10px] bg-slate-600/20 text-slate-300 font-semibold shrink-0">{total} طلب</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-0.5 h-3 rounded-full overflow-hidden bg-slate-700/30">
                              {aPct > 0 && <motion.div className="h-full bg-emerald-500 first:rounded-l-full last:rounded-r-full" initial={{ width: 0 }} animate={{ width: `${aPct}%` }} transition={{ duration: 0.8 }} />}
                              {pPct > 0 && <motion.div className="h-full bg-amber-500 first:rounded-l-full last:rounded-r-full" initial={{ width: 0 }} animate={{ width: `${pPct}%` }} transition={{ duration: 0.8 }} />}
                              {rPct > 0 && <motion.div className="h-full bg-red-500 first:rounded-l-full last:rounded-r-full" initial={{ width: 0 }} animate={{ width: `${rPct}%` }} transition={{ duration: 0.8 }} />}
                            </div>
                            <div className="flex items-center justify-between mt-2 text-[10px] font-medium">
                              <span className="text-violet-400 flex items-center gap-1"><CheckCircle2 className="size-2.5" />موافق: {rt.approved}</span>
                              <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="size-2.5" />معلق: {rt.pending}</span>
                              <span className="text-red-400 flex items-center gap-1"><XCircle className="size-2.5" />مرفوض: {rt.rejected}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Departments Overview */}
              {canViewPage('employees') && stats.deptTodayStats.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="أقسام الشركة" icon={<Users className="size-4" />} iconBg="bg-violet-500/10" iconColor="text-violet-400" borderClr="border-violet-500/10"
                    extra={<NavBtn onClick={() => navigateTo('employees')} label="عرض الموظفين" icon={<ExternalLink className="size-3" />} color="text-violet-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="space-y-2.5">
                      {stats.deptTodayStats.map((dept, idx) => (
                        <motion.div key={dept.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.03 }}
                          className="p-4 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 border border-transparent hover:border-slate-600/15">
                          <div className="flex items-center justify-between mb-3 gap-3">
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${DEPT_GRADIENTS[idx % DEPT_GRADIENTS.length]} flex items-center justify-center shrink-0 shadow-sm`}>
                                <span className="text-white text-[11px] font-bold">{dept.name[0]}</span>
                              </div>
                              <div className="min-w-0">
                                <p className="text-white text-sm font-semibold">{dept.name}</p>
                                <p className="text-slate-500 text-[10px]">{dept.employeeCount} موظف</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <span className="px-2 py-1 rounded-lg text-[10px] bg-violet-500/10 text-violet-400 font-semibold">{dept.presentToday} حاضر</span>
                              <span className="px-2 py-1 rounded-lg text-[10px] bg-amber-500/10 text-amber-400 font-semibold">{dept.lateToday} متأخر</span>
                              <span className="px-2 py-1 rounded-lg text-[10px] bg-red-500/10 text-red-400 font-semibold">{dept.absentToday} غائب</span>
                            </div>
                          </div>
                          {dept.employeeCount > 0 && <ProgressBar value={dept.presentToday} max={dept.employeeCount} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" />}
                        </motion.div>
                      ))}
                  </div>
                </SectionCard>
                </motion.div>
              )}
            </DashboardGrid>

            {/* Today's Follow-ups Alert */}
            {canViewPage('followUps') && stats.todaysFollowUps.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <SectionCard title="متابعات مجدولة اليوم" icon={<ClipboardList className="size-4" />} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" borderClr="border-cyan-500/10"
                  extra={<NavBtn onClick={() => navigateTo('followUps')} label="عرض المتابعات" icon={<ExternalLink className="size-3" />} color="text-cyan-400" />}
                  scrollHeight="max-h-[440px]">
                  <div className="space-y-2">
                    {stats.todaysFollowUps.map((fu, idx) => {
                      const typeLabels: Record<string, string> = { quality: 'جودة', behavior: 'سلوك', attendance: 'حضور', productivity: 'إنتاجية', training: 'تدريب', customerHandling: 'التعامل مع العملاء' };
                      const priorityColors: Record<string, string> = { high: 'text-red-400 bg-red-500/10', medium: 'text-amber-400 bg-amber-500/10', low: 'text-violet-400 bg-violet-500/10' };
                      return (
                        <motion.div key={fu.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                          className="flex items-center gap-3 p-3 rounded-lg border border-cyan-500/15 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors">
                          <div className="size-8 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                            <ClipboardList className="size-3.5 text-cyan-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-white text-xs font-semibold">{fu.employeeName}</span>
                              {fu.employeeDepartment && <span className="text-slate-500 text-[10px]">{fu.employeeDepartment}</span>}
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-600/20 text-slate-300">{typeLabels[fu.followUpType] || fu.followUpType}</span>
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${priorityColors[fu.priorityLevel] || 'bg-slate-600/20 text-slate-300'}`}>
                                {fu.priorityLevel === 'high' ? 'عالي' : fu.priorityLevel === 'medium' ? 'متوسط' : 'منخفض'}
                              </span>
                            </div>
                            <p className="text-slate-500 text-[10px] mt-0.5">
                              المسؤول: {fu.responsiblePersonName}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </SectionCard>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════════════
           TAB: PERFORMANCE
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'performance' && (
          <motion.div key="performance" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="space-y-6">

            <GradientDivider />

            {/* Month Comparison Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Last Month */}
              {canViewPage('attendance') && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title={lastPerf.monthLabel || 'الشهر الماضي'} icon={<TrendingDown className="size-4" />} iconBg="bg-purple-500/10" iconColor="text-purple-400" borderClr="border-purple-500/10"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير مفصل" icon={<FileSpreadsheet className="size-3" />} color="text-purple-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Pill icon={<Flame className="size-3.5" />} label="تأخيرات" value={lastPerf.totalDelays} color="text-amber-400" bg="bg-amber-500/8 border-amber-500/12" />
                      <Pill icon={<Clock className="size-3.5" />} label="إجمالي الدقائق" value={lastPerf.totalDelayMinutes} color="text-orange-400" bg="bg-orange-500/8 border-orange-500/12" />
                      <Pill icon={<DollarSign className="size-3.5" />} label="خصومات" value={`${lastPerf.totalDeductionAmount.toFixed(0)} ج.م`} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
                      <Pill icon={<CalendarClock className="size-3.5" />} label="أيام مخصومة" value={lastPerf.totalDeductionDays.toFixed(1)} color="text-purple-400" bg="bg-purple-500/8 border-purple-500/12" />
                      <Pill icon={<UserCheck className="size-3.5" />} label="أيام حضور" value={lastPerf.totalPresent} color="text-violet-400" bg="bg-emerald-500/8 border-violet-500/30" />
                    </div>
                    <div className="space-y-2.5">
                      {lastPerf.departments.map((dept, idx) => <DeptRow key={dept.departmentName} dept={dept} idx={idx} accentBg="bg-purple-500/10" accentColor="text-purple-400" />)}
                      {lastPerf.departments.length === 0 && <EmptyState icon={<BarChart3 className="size-8" />} message="لا توجد بيانات" />}
                    </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Current Month */}
              {canViewPage('attendance') && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title={perf.monthLabel || 'الشهر الحالي'} icon={<TrendingUp className="size-4" />} iconBg="bg-violet-500/10" iconColor="text-violet-400" borderClr="border-violet-500/10"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير مفصل" icon={<FileSpreadsheet className="size-3" />} color="text-violet-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="flex flex-wrap gap-2 mb-4">
                      <Pill icon={<Flame className="size-3.5" />} label="تأخيرات" value={perf.totalDelays} color="text-amber-400" bg="bg-amber-500/8 border-amber-500/12" />
                      <Pill icon={<Clock className="size-3.5" />} label="إجمالي الدقائق" value={perf.totalDelayMinutes} color="text-orange-400" bg="bg-orange-500/8 border-orange-500/12" />
                      <Pill icon={<DollarSign className="size-3.5" />} label="خصومات" value={`${perf.totalDeductionAmount.toFixed(0)} ج.م`} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
                      <Pill icon={<CalendarClock className="size-3.5" />} label="أيام مخصومة" value={perf.totalDeductionDays.toFixed(1)} color="text-purple-400" bg="bg-purple-500/8 border-purple-500/12" />
                      <Pill icon={<UserCheck className="size-3.5" />} label="أيام حضور" value={perf.totalPresent} color="text-violet-400" bg="bg-emerald-500/8 border-violet-500/30" />
                    </div>
                    <div className="space-y-2.5">
                      {perf.departments.map((dept, idx) => <DeptRow key={dept.departmentName} dept={dept} idx={idx} accentBg="bg-violet-500/10" accentColor="text-violet-400" />)}
                      {perf.departments.length === 0 && <EmptyState icon={<BarChart3 className="size-8" />} message="لا توجد بيانات" />}
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </div>

            {/* Top Offenders + Deduction Rules */}
            <DashboardGrid>

              {/* Top 5 Offenders */}
              {canViewPage('attendance') && stats.topOffenders.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="أكثر 5 موظفين تأخيراً" icon={<AlertTriangle className="size-4" />} iconBg="bg-red-500/10" iconColor="text-red-400" borderClr="border-red-500/10"
                    extra={<NavBtn onClick={() => navigateTo('reports')} label="تقرير كامل" icon={<FileSpreadsheet className="size-3" />} color="text-red-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="space-y-2.5">
                      {stats.topOffenders.map((offender, idx) => (
                        <motion.div key={offender.employeeId} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.06 }}
                          className="flex items-center gap-3 p-4 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 border border-transparent hover:border-slate-600/10">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${idx === 0 ? 'bg-red-500/20 text-red-400 shadow-sm shadow-red-500/10' : idx === 1 ? 'bg-orange-500/20 text-orange-400' : idx === 2 ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-600/20 text-slate-400'}`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white text-sm font-semibold">{offender.employeeName}</p>
                            <p className="text-slate-500 text-[10px]">{offender.department}</p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-2 py-1 rounded-lg text-[10px] bg-amber-500/10 text-amber-400 font-semibold whitespace-nowrap"><Flame className="size-2.5 inline ml-0.5" />{offender.delayCount}x</span>
                            <span className="px-2 py-1 rounded-lg text-[10px] bg-orange-500/10 text-orange-400 font-semibold whitespace-nowrap">{offender.totalDelayMinutes}د</span>
                            {offender.deductionAmount > 0 && <span className="px-2 py-1 rounded-lg text-[10px] bg-red-500/10 text-red-400 font-semibold whitespace-nowrap">{offender.deductionAmount.toFixed(0)} ج.م</span>}
                          </div>
                        </motion.div>
                      ))}
                  </div>
                  </SectionCard>
                </motion.div>
              )}

              {/* Deduction Rules */}
              {canViewPage('rules') && stats.rulesSummary.length > 0 && (
                <motion.div variants={scaleIn} initial="hidden" animate="visible">
                  <SectionCard title="جدول قواعد الخصم" icon={<Scale className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/10"
                    extra={<NavBtn onClick={() => navigateTo('rules')} label="إدارة القواعد" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
                    scrollHeight="max-h-[440px]">
                    <div className="space-y-2">
                      {stats.rulesSummary.map((rule) => (
                        <div key={rule.key} className="flex items-center justify-between p-4 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200 border border-transparent hover:border-slate-600/10">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0"><Scale className="size-4 text-rose-400" /></div>
                            <span className="text-white text-sm font-medium">{rule.label}</span>
                          </div>
                          <span className="px-3 py-1 rounded-xl text-[11px] font-mono bg-slate-600/20 text-slate-200 shrink-0 font-semibold">{rule.amount} {rule.unit === 'days' ? 'يوم' : 'ج.م'}</span>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </motion.div>
              )}
            </DashboardGrid>
          </motion.div>
        )}

        {/* ══════════════════════════════════════════════════════════
           TAB: TRAVEL
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'travel' && (
          <motion.div key="travel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="space-y-6">

            <GradientDivider />

            {/* Travel Stats Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard title="رحلات نشطة" value={stats.activeTravel} icon={<Plane className="size-5 text-rose-400" />} gradient="from-rose-500/20 to-pink-600/10" glow="shadow-rose-500/15" />
              <KPICard title="قيد التنفيذ" value={stats.inProgressTravelCount} icon={<Activity className="size-5 text-amber-400" />} gradient="from-amber-500/20 to-orange-600/10" glow="shadow-amber-500/15" />
              <KPICard title="مكتملة" value={stats.completedTravelCount} icon={<CheckCircle2 className="size-5 text-violet-400" />} gradient="from-emerald-500/20 to-green-600/10" glow="shadow-violet-500/20" />
              <KPICard title="إجمالي الوجهات" value={new Set(stats.upcomingTravel.map(t => t.destination)).size} icon={<MapPin className="size-5 text-cyan-400" />} gradient="from-cyan-500/20 to-blue-600/10" glow="shadow-cyan-500/15" />
            </div>

            {/* Active Travel List */}
            {canViewPage('travel') && (
              <SectionCard title="الرحلات النشطة والقادمة" icon={<Plane className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/10"
                extra={<NavBtn onClick={() => navigateTo('travel')} label="إدارة الرحلات" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
                scrollHeight="max-h-[540px]">
                {stats.upcomingTravel.length > 0 ? (
                  <div className="space-y-3">
                    {stats.upcomingTravel.map((trip, idx) => {
                      const daysLeft = getDaysRemaining(trip.departureDate);
                      const urgent = isUrgent(trip.departureDate);
                      const missing: { l: string; i: React.ReactNode }[] = [];
                      if (!trip.hasInternationalFlight) missing.push({ l: 'طيران دولي', i: <Plane className="size-3" /> });
                      if (!trip.hasDomesticFlight) missing.push({ l: 'طيران داخلي', i: <Globe className="size-3" /> });
                      if (!trip.hasHotel) missing.push({ l: 'فندق', i: <Hotel className="size-3" /> });
                      if (!trip.hasVisa) missing.push({ l: 'تأشيرة', i: <CreditCard className="size-3" /> });
                      if (!trip.hasTours) missing.push({ l: 'جولات', i: <Palmtree className="size-3" /> });
                      if (!trip.hasTransportation) missing.push({ l: 'مواصلات', i: <Car className="size-3" /> });
                      return (
                        <motion.div key={trip.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                          whileHover={{ scale: 1.005, y: -1 }} whileTap={{ scale: 0.995 }}
                          className={`p-5 rounded-xl border cursor-pointer transition-all duration-200 ${urgent ? 'border-rose-500/25 bg-rose-500/5 hover:bg-rose-500/10 shadow-sm shadow-rose-500/5' : 'border-slate-700/15 bg-slate-700/10 hover:bg-slate-700/20'}`}
                          onClick={() => navigateTo('travel', trip.id)}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-white text-sm font-semibold">{trip.employeeName}</span>
                                {trip.employeeDepartment && <span className="px-2 py-0.5 rounded-lg text-[10px] bg-slate-600/20 text-slate-300 font-semibold whitespace-nowrap">{trip.employeeDepartment}</span>}
                                {urgent && <motion.span className="relative flex h-2.5 w-2.5 shrink-0" animate={{ scale: [1,1.5,1], opacity: [1,0.5,1] }} transition={{ duration: 1.2, repeat: Infinity }}><span className="absolute inset-0 rounded-full bg-red-500" /><span className="absolute inset-0 rounded-full bg-red-500 animate-ping" /></motion.span>}
                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold whitespace-nowrap ${urgent ? 'bg-red-500/10 text-red-400' : daysLeft <= 7 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-600/15 text-slate-400'}`}>
                                  <MapPin className="size-2.5 inline ml-0.5" />{trip.destination}
                                </span>
                              </div>
                              <div className="mt-2 space-y-0.5">
                                <p className="text-slate-400 text-[10px]">السفر: {trip.departureDate} {trip.returnDate ? `← العودة: ${trip.returnDate}` : ''}</p>
                                {trip.dealerName && <p className="text-slate-500 text-[10px]">الديل: {trip.dealerName}</p>}
                              </div>
                              {missing.length > 0 && (
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                  {missing.map(m => <span key={m.l} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] bg-rose-500/10 text-rose-400 font-semibold whitespace-nowrap"><AlertTriangle className="size-2.5" />{m.i}{m.l}</span>)}
                                </div>
                              )}
                            </div>
                            <div className="shrink-0 text-center min-w-[48px]">
                              <span className={`text-2xl font-bold ${urgent ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-slate-300'}`}>{daysLeft > 0 ? daysLeft : daysLeft === 0 ? '!' : '✓'}</span>
                              <p className={`text-[10px] font-medium ${urgent ? 'text-red-400' : daysLeft <= 7 ? 'text-amber-400' : 'text-slate-500'}`}>{daysLeft > 0 ? 'يوم' : daysLeft === 0 ? 'اليوم!' : 'انتهى'}</p>
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

        {/* ══════════════════════════════════════════════════════════
           TAB: QUALITY
           ══════════════════════════════════════════════════════════ */}
        {activeTab === 'quality' && (
          <motion.div key="quality" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="space-y-6">

            <GradientDivider />

            {/* Quality Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KPICard title="حالات الجودة" value={stats.qualitySummary.totalCases} icon={<AlertCircle className="size-5 text-orange-400" />} gradient="from-orange-500/20 to-amber-600/10" glow="shadow-orange-500/15" />
              <KPICard title="إجمالي المبلغ" value={`${stats.qualitySummary.totalAmount.toFixed(0)}`} subtitle="جنيه" icon={<DollarSign className="size-5 text-red-400" />} gradient="from-red-500/20 to-rose-600/10" glow="shadow-red-500/15" />
              <KPICard title="أيام مخصومة" value={stats.qualitySummary.totalDays.toFixed(1)} icon={<CalendarClock className="size-5 text-purple-400" />} gradient="from-purple-500/20 to-violet-600/10" glow="shadow-purple-500/15" />
              <KPICard title="تأخيرات الشهر" value={perf.totalDelays} subtitle={`${perf.totalDelayMinutes} دقيقة`} icon={<Flame className="size-5 text-amber-400" />} gradient="from-amber-500/20 to-orange-600/10" glow="shadow-amber-500/15" />
            </div>

            <DashboardGrid>

              {/* Quality Breakdown */}
              {canViewPage('quality') && (
                <SectionCard title="تفصيل حالات الجودة" icon={<Award className="size-4" />} iconBg="bg-orange-500/10" iconColor="text-orange-400" borderClr="border-orange-500/10"
                  extra={<NavBtn onClick={() => navigateTo('quality')} label="إدارة الجودة" icon={<ExternalLink className="size-3" />} color="text-orange-400" />}
                  scrollHeight="max-h-[440px]">
                  <div className="space-y-3">
                    {[
                      { type: 'quality_issue', label: 'مشاكل جودة', color: 'text-orange-400', bg: 'bg-orange-500', icon: <AlertTriangle className="size-4" /> },
                      { type: 'safety', label: 'السلامة والأمان', color: 'text-red-400', bg: 'bg-red-500', icon: <Shield className="size-4" /> },
                      { type: 'compliance', label: 'الالتزام', color: 'text-purple-400', bg: 'bg-purple-500', icon: <Lock className="size-4" /> },
                    ].map(item => {
                      const count = stats.qualitySummary.byType[item.type] || 0;
                      const total = Math.max(stats.qualitySummary.totalCases, 1);
                      return (
                        <div key={item.type} className="p-4 rounded-xl bg-slate-700/10 border border-slate-700/10">
                          <div className="flex items-center justify-between mb-3 gap-2">
                            <div className="flex items-center gap-3 min-w-0 flex-1"><div className={`p-2.5 rounded-xl bg-slate-700/20 ${item.color} shrink-0`}>{item.icon}</div><span className="text-white text-sm font-semibold">{item.label}</span></div>
                            <span className={`px-3 py-1 rounded-xl text-[11px] font-mono bg-slate-600/20 ${item.color} shrink-0 font-semibold`}>{count} حالة</span>
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
              {canViewPage('attendance') && (
                <SectionCard title="ملخص الخصومات الشهرية" icon={<DollarSign className="size-4" />} iconBg="bg-red-500/10" iconColor="text-red-400" borderClr="border-red-500/10"
                  extra={<NavBtn onClick={() => navigateTo('reports')} label="تصدير تقرير" icon={<Download className="size-3" />} color="text-red-400" />}
                  scrollHeight="max-h-[440px]">
                  <div className="space-y-4">
                    <div className="p-5 rounded-2xl bg-gradient-to-br from-violet-500/10 to-purple-600/5 border border-violet-500/10">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-violet-300 text-sm font-semibold">{perf.monthLabel || 'الشهر الحالي'}</span>
                        <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/15 rounded-lg px-3">{perf.totalWorkingDays} يوم عمل</Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-xl bg-slate-700/20 text-center border border-slate-700/10"><p className="text-amber-400 text-xl font-bold">{perf.totalDelays}</p><p className="text-slate-400 text-[10px] mt-0.5">تأخير</p></div>
                        <div className="p-3 rounded-xl bg-slate-700/20 text-center border border-slate-700/10"><p className="text-red-400 text-xl font-bold">{perf.totalDeductionAmount.toFixed(0)}</p><p className="text-slate-400 text-[10px] mt-0.5">ج.م خصم</p></div>
                        <div className="p-3 rounded-xl bg-slate-700/20 text-center border border-slate-700/10"><p className="text-violet-400 text-xl font-bold">{perf.totalPresent}</p><p className="text-slate-400 text-[10px] mt-0.5">يوم حضور</p></div>
                        <div className="p-3 rounded-xl bg-slate-700/20 text-center border border-slate-700/10"><p className="text-purple-400 text-xl font-bold">{perf.totalDeductionDays.toFixed(1)}</p><p className="text-slate-400 text-[10px] mt-0.5">أيام مخصومة</p></div>
                      </div>
                    </div>
                    {/* Performance department bars */}
                    <div className="space-y-2.5">
                      {perf.departments.slice(0, 8).map((dept, idx) => (
                        <motion.div key={dept.departmentName} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: idx * 0.03 }}
                          className="p-3 rounded-xl bg-slate-700/10 border border-transparent hover:border-slate-600/10 transition-all">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-white text-xs font-semibold flex-1 min-w-0">{dept.departmentName}</span>
                            <span className="text-red-400 text-[10px] font-mono shrink-0 mr-3 font-semibold">{dept.totalDeductionAmount.toFixed(0)} ج.م</span>
                          </div>
                          <MiniBar value={dept.totalDeductionAmount} max={Math.max(...perf.departments.map(d => d.totalDeductionAmount), 1)} color="bg-gradient-to-l from-red-500 to-rose-500" />
                        </motion.div>
                      ))}
                  </div>
                  </div>
                </SectionCard>
              )}
            </DashboardGrid>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   HELPER: Quick Link Card
   ═══════════════════════════════════════════════════════════ */

const QuickLink = memo(function QuickLink({ icon, label, sub, color, onClick }: { icon: React.ReactNode; label: string; sub: string; color: string; onClick: () => void }) {
  return (
    <motion.button whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.96 }} onClick={onClick}
      className={`p-4 rounded-xl bg-gradient-to-br ${color} border border-slate-700/15 hover:border-slate-600/25 transition-all duration-200 text-right group`}>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-slate-300 group-hover:text-white transition-colors">{icon}</span>
        <span className="text-white text-xs font-semibold">{label}</span>
      </div>
      <p className="text-slate-500 text-[10px] group-hover:text-slate-400 transition-colors">{sub}</p>
    </motion.button>
  );
});

/* ═══════════════════════════════════════════════════════════
   HELPER: Status Row
   ═══════════════════════════════════════════════════════════ */

const StatusRow = memo(function StatusRow({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-700/10 border border-slate-700/10">
      <div className="flex items-center gap-2.5">
        <span className={ok ? 'text-violet-400' : 'text-slate-500'}>{icon}</span>
        <span className="text-slate-400 text-[11px]">{label}</span>
      </div>
      <span className={`text-[11px] font-medium ${ok ? 'text-violet-400' : 'text-slate-500'}`}>{value}</span>
    </div>
  );
});
