'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { authFetch } from '@/lib/api-fetch';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  UserCircle,
  ArrowRight,
  Clock,
  FileText,
  Award,
  Banknote,
  ClipboardCheck,
  Plane,
  AlertTriangle,
  ShieldCheck,
  Lightbulb,
  Loader2,
  XCircle,
  BarChart3,
  MessageSquareWarning,
  Eye,
  Calendar,
  TrendingUp,
  CheckCircle,
  XCircle as XCircleIcon,
  AlertCircle,
  Activity,
  ChevronLeft,
  X,
  Phone,
  Building2,
  Briefcase,
  Hash,
  Timer,
  ShieldAlert,
  ExternalLink,
  Plus,
  RotateCcw,
} from 'lucide-react';

// ══════════════════════════════════════════════════════════════
//  Types
// ══════════════════════════════════════════════════════════════
interface Employee360Data {
  employee: {
    id: string;
    name: string;
    code: string | null;
    department: string | null;
    position: string | null;
    shiftStart: string | null;
    shiftEnd: string | null;
    hireDate: string | null;
    mobile: string | null;
    createdById: string | null;
  };
  stats: {
    attendance: { totalPresent: number; totalLate: number; totalAbsent: number; totalExempt: number; totalMinutesLate: number };
    quality: { totalDeductions: number; deductionDays: number; deductionAmount: number };
    hrDeductions: { totalDeductions: number; deductionDays: number; deductionAmount: number };
    requests: { total: number; pending: number; approved: number; rejected: number };
    followUps: { total: number; open: number; critical: number };
    travel: { total: number; active: number; completed: number };
    complaints: { total: number; open: number };
    capa: { total: number; open: number; closed: number; overdue: number; critical: number; reopened: number; effectiveness: number };
  };
  risk: { score: number; level: 'low' | 'medium' | 'high' | 'critical'; breakdown?: Record<string, number> };
  healthScore: number;
  timeline: any[];
  recommendations: string[];
  capaDetails?: any[];
}

type TabId = 'overview' | 'attendance' | 'requests' | 'quality' | 'hr' | 'followups' | 'risk' | 'performance' | 'documents' | 'capa';

// ══════════════════════════════════════════════════════════════
//  Cinematic Animation Variants
// ══════════════════════════════════════════════════════════════
const pageEnterVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07, delayChildren: 0.12 },
  },
} as const;

const slideUpFade = {
  hidden: { opacity: 0, y: 30, filter: 'blur(6px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 200, damping: 24, mass: 0.8 },
  },
} as const;

const scaleIn = {
  hidden: { opacity: 0, scale: 0.85, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 260, damping: 20 },
  },
} as const;

const staggerGrid = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.2 },
  },
} as const;

const gridItem = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring' as const, stiffness: 300, damping: 25 },
  },
} as const;

const tabContentVariants = {
  hidden: { opacity: 0, x: 40, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    x: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 220, damping: 26 },
  },
  exit: {
    opacity: 0,
    x: -40,
    filter: 'blur(4px)',
    transition: { duration: 0.2, ease: 'easeIn' as const },
  },
} as const;

const headerFloat = {
  hidden: { opacity: 0, y: -20, filter: 'blur(8px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 160, damping: 18, mass: 1 },
  },
} as const;

// ══════════════════════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════════════════════
function getRiskColor(level: string) {
  switch (level) {
    case 'low': return 'text-emerald-400';
    case 'medium': return 'text-yellow-400';
    case 'high': return 'text-orange-400';
    case 'critical': return 'text-red-400';
    default: return 'text-slate-400';
  }
}

function getRiskBg(level: string) {
  switch (level) {
    case 'low': return 'bg-emerald-500/8 border-emerald-500/20';
    case 'medium': return 'bg-yellow-500/8 border-yellow-500/20';
    case 'high': return 'bg-orange-500/8 border-orange-500/20';
    case 'critical': return 'bg-red-500/8 border-red-500/20';
    default: return 'bg-slate-500/8 border-slate-500/20';
  }
}

function getRiskGlow(level: string) {
  switch (level) {
    case 'low': return 'shadow-emerald-500/10';
    case 'medium': return 'shadow-yellow-500/10';
    case 'high': return 'shadow-orange-500/10';
    case 'critical': return 'shadow-red-500/10';
    default: return '';
  }
}

function getRiskLabel(level: string) {
  switch (level) {
    case 'low': return 'منخفض';
    case 'medium': return 'متوسط';
    case 'high': return 'مرتفع';
    case 'critical': return 'حرج';
    default: return 'غير محدد';
  }
}

function getHealthColor(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-yellow-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}

function getHealthStroke(score: number) {
  if (score >= 80) return 'stroke-emerald-500';
  if (score >= 60) return 'stroke-yellow-500';
  if (score >= 40) return 'stroke-orange-500';
  return 'stroke-red-500';
}

function getHealthRingColor(score: number) {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#eab308';
  if (score >= 40) return '#f97316';
  return '#ef4444';
}

function getHealthRingBg(score: number) {
  if (score >= 80) return '#10b98120';
  if (score >= 60) return '#eab30820';
  if (score >= 40) return '#f9731620';
  return '#ef444420';
}

function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}د`;
  return m > 0 ? `${h}س ${m}د` : `${h}س`;
}

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'نظرة عامة', icon: <Eye className="size-4" /> },
  { id: 'attendance', label: 'الحضور', icon: <Clock className="size-4" /> },
  { id: 'requests', label: 'الطلبات', icon: <FileText className="size-4" /> },
  { id: 'quality', label: 'الجودة', icon: <Award className="size-4" /> },
  { id: 'hr', label: 'HR', icon: <Banknote className="size-4" /> },
  { id: 'followups', label: 'المتابعة', icon: <ClipboardCheck className="size-4" /> },
  { id: 'capa', label: 'CAPA', icon: <ShieldAlert className="size-4" /> },
  { id: 'risk', label: 'المخاطر', icon: <AlertTriangle className="size-4" /> },
  { id: 'performance', label: 'الأداء', icon: <BarChart3 className="size-4" /> },
  { id: 'documents', label: 'المستندات', icon: <ShieldCheck className="size-4" /> },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
} as const;

// ══════════════════════════════════════════════════════════════
//  Animated Health Score Circle
// ══════════════════════════════════════════════════════════════
function HealthCircle({ score, size = 100, animated = true }: { score: number; size?: number; animated?: boolean }) {
  const radius = size * 0.38;
  const circumference = 2 * Math.PI * radius;
  const [offset, setOffset] = useState(animated ? circumference : circumference - (score / 100) * circumference);

  useEffect(() => {
    if (!animated) return;
    const timer = setTimeout(() => {
      setOffset(circumference - (score / 100) * circumference);
    }, 300);
    return () => clearTimeout(timer);
  }, [score, circumference, animated]);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      {/* Subtle glow behind circle */}
      <div
        className="absolute inset-0 rounded-full blur-xl opacity-30"
        style={{ backgroundColor: getHealthRingColor(score) }}
      />
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" className="stroke-slate-700/30" strokeWidth="7"
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={getHealthRingColor(score)}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.5s cubic-bezier(0.22, 1, 0.36, 1), stroke 0.5s ease' }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <motion.span
          className={`font-bold ${size >= 100 ? 'text-xl' : 'text-sm'} ${getHealthColor(score)}`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5, type: 'spring', stiffness: 300 }}
        >
          {score}
        </motion.span>
        <span className="text-[9px] text-slate-500 mt-0.5">درجة الصحة</span>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Animated Loading Skeleton
// ══════════════════════════════════════════════════════════════
function ProfileSkeleton() {
  return (
    <motion.div
      variants={pageEnterVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={slideUpFade} className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10 rounded-lg bg-slate-800/60" />
          <Skeleton className="h-8 w-48 rounded-lg bg-slate-800/60" />
        </div>
        <Skeleton className="h-10 w-10 rounded-full bg-slate-800/60" />
      </motion.div>
      <Skeleton className="h-48 rounded-2xl bg-slate-800/40" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[90px] rounded-xl bg-slate-800/40" />
        ))}
      </div>
      <Skeleton className="h-12 rounded-xl bg-slate-800/30" />
      <Skeleton className="h-[400px] rounded-2xl bg-slate-800/40" />
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Not Found Component
// ══════════════════════════════════════════════════════════════
function EmployeeNotFound({ onBack }: { onBack: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200 }}
      className="flex flex-col items-center justify-center py-20"
    >
      <motion.div
        initial={{ scale: 0, rotate: -180 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
        className="w-20 h-20 rounded-full bg-slate-800/80 border border-slate-700/50 flex items-center justify-center mb-6"
      >
        <UserCircle className="size-10 text-slate-600" />
      </motion.div>
      <h2 className="text-xl font-bold text-white mb-2">الموظف غير موجود</h2>
      <p className="text-slate-400 mb-6">لم يتم العثور على بيانات الموظف المطلوب</p>
      <Button
        onClick={onBack}
        className="bg-gradient-to-l from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white shadow-lg shadow-emerald-500/20"
      >
        <ArrowRight className="size-4 ml-2" />
        رجوع
      </Button>
    </motion.div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Glass Card Wrapper
// ══════════════════════════════════════════════════════════════
function GlassCard({ children, className = '', glow = '' }: { children: React.ReactNode; className?: string; glow?: string }) {
  return (
    <Card className={`bg-slate-800/40 border border-slate-700/30 backdrop-blur-sm ${glow} ${className}`}>
      <CardContent className="p-4">{children}</CardContent>
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════
//  Main Employee360Page
// ══════════════════════════════════════════════════════════════
export default function Employee360Page({ employeeId: propEmployeeId, onClose }: { employeeId?: string; onClose?: () => void } = {}) {
  const { canView } = usePermissions('employees');
  const storeNavParams = useAppStore((s) => s.navParams);
  const storeGoBack = useAppStore((s) => s.goBack);
  const employeeId = propEmployeeId || storeNavParams.employeeId || '';
  const handleClose = onClose || storeGoBack;
  const [data, setData] = useState<Employee360Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  // ══════════════════════════════════════════════════════════
  //  Fetch employee data
  // ══════════════════════════════════════════════════════════
  const fetchEmployeeData = useCallback(async () => {
    if (!employeeId) {
      handleClose();
      return;
    }

    if (fetchingRef.current) return;
    fetchingRef.current = true;

    setLoading(true);
    setError(null);

    try {
      const res = await authFetch(`/api/employee-360/${employeeId}`);

      if (!mountedRef.current) return;

      if (res.status === 404) {
        setNotFound(true);
        return;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setError(errData?.error || 'فشل في تحميل بيانات الموظف');
        return;
      }

      const json = await res.json();

      if (!mountedRef.current) return;

      setData(json);
    } catch {
      if (mountedRef.current) {
        setError('خطأ في الاتصال بالخادم');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
      fetchingRef.current = false;
    }
  }, [employeeId, handleClose]);

  useEffect(() => {
    mountedRef.current = true;
    fetchEmployeeData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchEmployeeData]);

  // ═══ Permission denied ═══
  if (!canView) {
    return (
      <motion.div
        variants={pageEnterVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center justify-center py-20"
      >
        <motion.div variants={scaleIn} className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-6">
          <XCircle className="size-8 text-red-400" />
        </motion.div>
        <motion.h2 variants={slideUpFade} className="text-xl font-bold text-white mb-2">ليس لديك صلاحية</motion.h2>
        <motion.p variants={slideUpFade} className="text-slate-400 mb-6">لا تملك صلاحية عرض ملف الموظف</motion.p>
        <motion.div variants={slideUpFade}>
          <Button
            onClick={handleClose}
            className="bg-gradient-to-l from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white shadow-lg shadow-emerald-500/20"
          >
            <ArrowRight className="size-4 ml-2" />
            رجوع
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  // ═══ Loading state ═══
  if (loading) {
    return <ProfileSkeleton />;
  }

  // ═══ Not found ═══
  if (notFound) {
    return <EmployeeNotFound onBack={handleClose} />;
  }

  // ═══ Error state ═══
  if (error || !data) {
    return (
      <motion.div
        variants={pageEnterVariants}
        initial="hidden"
        animate="visible"
        className="flex flex-col items-center justify-center py-20"
      >
        <motion.div variants={scaleIn} className="w-16 h-16 rounded-full bg-orange-500/10 border border-orange-500/20 flex items-center justify-center mb-6">
          <AlertCircle className="size-8 text-orange-400" />
        </motion.div>
        <motion.h2 variants={slideUpFade} className="text-xl font-bold text-white mb-2">خطأ</motion.h2>
        <motion.p variants={slideUpFade} className="text-slate-400 mb-6">{error || 'لا توجد بيانات'}</motion.p>
        <motion.div variants={slideUpFade} className="flex gap-3">
          <Button
            onClick={fetchEmployeeData}
            className="bg-gradient-to-l from-emerald-600 to-cyan-600 hover:from-emerald-700 hover:to-cyan-700 text-white shadow-lg shadow-emerald-500/20"
          >
            <Loader2 className="size-4 ml-1" />
            إعادة المحاولة
          </Button>
          <Button onClick={handleClose} variant="outline" className="border-slate-700/50 text-slate-300 hover:bg-slate-800">
            <ArrowRight className="size-4 ml-2" />
            رجوع
          </Button>
        </motion.div>
      </motion.div>
    );
  }

  const { employee, stats, risk, healthScore, timeline, recommendations } = data;

  // ═══ Filtered timeline by tab ═══
  const getFilteredTimeline = (tabId: TabId) => {
    switch (tabId) {
      case 'attendance': return timeline.filter((t) => t.type === 'attendance');
      case 'requests': return timeline.filter((t) => t.type === 'request');
      case 'quality': return timeline.filter((t) => t.type === 'quality');
      case 'hr': return timeline.filter((t) => t.type === 'hrDeduction');
      case 'followups': return timeline.filter((t) => t.type === 'followUp');
      case 'capa': return timeline.filter((t) => t.type === 'capa');
      case 'documents': return [];
      default: return timeline;
    }
  };

  // ═══ Tab content renderers ═══
  const renderOverviewTab = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
      {/* Quick stats grid */}
      <motion.div variants={staggerGrid} initial="hidden" animate="visible" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { label: 'حضور', value: stats.attendance.totalPresent, suffix: 'يوم', icon: <CheckCircle className="size-5 text-emerald-400" />, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
          { label: 'تأخير', value: stats.attendance.totalLate, suffix: `(${formatMinutes(stats.attendance.totalMinutesLate)})`, icon: <Clock className="size-5 text-yellow-400" />, bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
          { label: 'غياب', value: stats.attendance.totalAbsent, suffix: 'يوم', icon: <XCircleIcon className="size-5 text-red-400" />, bg: 'bg-red-500/10', border: 'border-red-500/20' },
          { label: 'خصم جودة', value: stats.quality.deductionDays, suffix: 'يوم', icon: <Award className="size-5 text-orange-400" />, bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
          { label: 'متابعات مفتوحة', value: stats.followUps.open, suffix: '', icon: <ClipboardCheck className="size-5 text-purple-400" />, bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
          { label: 'CAPA مفتوحة', value: stats.capa.open, suffix: '', icon: <ShieldAlert className="size-5 text-cyan-400" />, bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
        ].map((stat, i) => (
          <motion.div key={i} variants={gridItem}>
            <GlassCard className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl ${stat.bg} border ${stat.border} flex items-center justify-center`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-slate-400 text-xs">{stat.label}</p>
                <p className="text-white font-bold text-sm">
                  {stat.value}
                  {stat.suffix && <span className="text-xs text-slate-500 mr-1">{stat.suffix}</span>}
                </p>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <motion.div variants={slideUpFade}>
          <Card className={`border ${getRiskBg(risk.level)} ${getRiskGlow(risk.level)} shadow-lg`}>
            <CardContent className="p-5">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
                  <Lightbulb className="size-4 text-yellow-400" />
                </div>
                توصيات ذكية
              </h3>
              <ul className="space-y-2.5">
                {recommendations.map((rec, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + i * 0.08, type: 'spring', stiffness: 200 }}
                    className="text-slate-300 text-sm flex items-start gap-2.5"
                  >
                    <ChevronLeft className="size-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                    {rec}
                  </motion.li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* Recent Timeline */}
      <motion.div variants={slideUpFade}>
        <GlassCard className="p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Activity className="size-4 text-emerald-400" />
            </div>
            آخر الأنشطة
          </h3>
          <div className="space-y-3">
            {timeline.slice(0, 10).map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.04, type: 'spring', stiffness: 200 }}
                className="flex items-start gap-3 text-sm"
              >
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                  item.type === 'attendance' ? (item.status === 'present' ? 'bg-emerald-400' : item.status === 'late' ? 'bg-yellow-400' : 'bg-red-400') :
                  item.type === 'quality' ? 'bg-orange-400' :
                  item.type === 'followUp' ? 'bg-purple-400' :
                  item.type === 'request' ? 'bg-blue-400' :
                  item.type === 'complaint' ? 'bg-red-400' :
                  item.type === 'capa' ? 'bg-cyan-400' :
                  'bg-slate-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-medium">{item.title}</p>
                  <p className="text-slate-400 text-xs truncate">{item.description}</p>
                </div>
                <span className="text-slate-500 text-xs flex-shrink-0" dir="ltr">{item.date}</span>
              </motion.div>
            ))}
            {timeline.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-6">لا توجد أنشطة مسجلة هذا الشهر</p>
            )}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );

  const renderRiskTab = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
      {/* Risk Score Card */}
      <motion.div variants={scaleIn}>
        <Card className={`border ${getRiskBg(risk.level)} ${getRiskGlow(risk.level)} shadow-xl`}>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row items-center gap-6">
              <HealthCircle score={healthScore} size={130} animated={true} />
              <div className="flex-1 text-center sm:text-right">
                <h3 className="text-white text-lg font-bold">تقييم المخاطر</h3>
                <div className="flex items-center justify-center sm:justify-start gap-2 mt-2">
                  <motion.span
                    className={`text-3xl font-bold ${getRiskColor(risk.level)}`}
                    initial={{ opacity: 0, scale: 0.5 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.6, type: 'spring', stiffness: 300 }}
                  >
                    {risk.score}
                  </motion.span>
                  <span className={`text-sm ${getRiskColor(risk.level)}`}>({getRiskLabel(risk.level)})</span>
                </div>
                <div className="mt-3 space-y-1.5 text-sm text-slate-400">
                  <p>الحضور: {stats.attendance.totalAbsent > 4 ? `+${Math.min((stats.attendance.totalAbsent - 4) * 3, 20)} نقطة` : '0 نقطة'}</p>
                  <p>الجودة: {stats.quality.deductionDays > 0 ? `+${Math.min(stats.quality.deductionDays * 5, 25)} نقطة` : '0 نقطة'}</p>
                  <p>المتابعات المفتوحة: {stats.followUps.open > 0 ? `+${Math.min(stats.followUps.open * 3, 15)} نقطة` : '0 نقطة'}</p>
                  <p>الحالات الحرجة: {stats.followUps.critical > 0 ? `+${Math.min(stats.followUps.critical * 10, 30)} نقطة` : '0 نقطة'}</p>
                  <p>الشكاوى: {stats.complaints.open > 0 ? `+${Math.min(stats.complaints.open * 5, 20)} نقطة` : '0 نقطة'}</p>
                  {risk.breakdown && (
                    <>
                      <p className="text-cyan-400/70 mt-2">CAPA مفتوحة: {risk.breakdown.openCapa > 0 ? `+${risk.breakdown.openCapa} نقطة` : '0 نقطة'}</p>
                      <p className="text-cyan-400/70">CAPA متأخرة: {risk.breakdown.overdueCapa > 0 ? `+${risk.breakdown.overdueCapa} نقطة` : '0 نقطة'}</p>
                      <p className="text-cyan-400/70">CAPA حرجة: {risk.breakdown.criticalCapa > 0 ? `+${risk.breakdown.criticalCapa} نقطة` : '0 نقطة'}</p>
                      <p className="text-cyan-400/70">CAPA معاد فتحها: {risk.breakdown.reopenedCapa > 0 ? `+${risk.breakdown.reopenedCapa} نقطة` : '0 نقطة'}</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Risk Level Legend */}
      <motion.div variants={staggerGrid} initial="hidden" animate="visible">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([
            { level: 'low', label: 'منخفض', range: '0-10' },
            { level: 'medium', label: 'متوسط', range: '11-25' },
            { level: 'high', label: 'مرتفع', range: '26-50' },
            { level: 'critical', label: 'حرج', range: '51+' },
          ] as const).map((item) => (
            <motion.div key={item.level} variants={gridItem}>
              <Card className={`border ${item.level === risk.level ? getRiskBg(item.level) : 'border-slate-700/30 bg-slate-800/30'} transition-all`}>
                <CardContent className="p-3 text-center">
                  <p className={`font-bold ${getRiskColor(item.level)}`}>{item.label}</p>
                  <p className="text-slate-500 text-xs" dir="ltr">{item.range}</p>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );

  const renderPerformanceTab = () => {
    const totalDays = stats.attendance.totalPresent + stats.attendance.totalLate + stats.attendance.totalAbsent + stats.attendance.totalExempt;
    const attendanceRate = totalDays > 0 ? Math.round((stats.attendance.totalPresent / totalDays) * 100) : 0;
    const requestApprovalRate = stats.requests.total > 0 ? Math.round((stats.requests.approved / stats.requests.total) * 100) : 0;

    return (
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
        <motion.div variants={slideUpFade}>
          <GlassCard className="p-6">
            <h3 className="text-white font-semibold mb-5 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <TrendingUp className="size-4 text-emerald-400" />
              </div>
              مؤشرات الأداء
            </h3>
            <div className="space-y-5">
              {[
                { label: 'نسبة الالتزام بالحضور', value: attendanceRate, color: 'bg-emerald-500', textColor: getHealthColor(attendanceRate) },
                { label: 'نسبة قبول الطلبات', value: requestApprovalRate, color: 'bg-blue-500', textColor: getHealthColor(requestApprovalRate) },
                { label: 'درجة الصحة العامة', value: healthScore, color: healthScore >= 80 ? 'bg-emerald-500' : healthScore >= 60 ? 'bg-yellow-500' : healthScore >= 40 ? 'bg-orange-500' : 'bg-red-500', textColor: getHealthColor(healthScore) },
              ].map((bar, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                >
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-slate-400">{bar.label}</span>
                    <span className={`font-semibold ${bar.textColor}`}>{bar.value}%</span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-700/50 overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${bar.color}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(bar.value, 100)}%` }}
                      transition={{ delay: 0.4 + i * 0.1, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* Summary Card */}
        <motion.div variants={slideUpFade}>
          <GlassCard className="p-5">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <BarChart3 className="size-4 text-emerald-400" />
              </div>
              ملخص الأداء الشهري
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                { label: 'إجمالي أيام العمل', value: `${totalDays}`, color: '' },
                { label: 'إجمالي الخصومات', value: `${(stats.quality.deductionDays + stats.hrDeductions.deductionDays).toFixed(1)} يوم`, color: '' },
                { label: 'الرحلات النشطة', value: `${stats.travel.active}`, color: '' },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  variants={gridItem}
                  className="bg-slate-700/20 border border-slate-700/20 rounded-xl p-3.5 text-center"
                >
                  <p className="text-slate-400 text-xs mb-1">{item.label}</p>
                  <p className="text-white font-bold text-lg">{item.value}</p>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    );
  };

  const renderTimelineContent = (tabId: TabId) => {
    const items = getFilteredTimeline(tabId);
    const tabLabel = tabId === 'overview' ? 'الأنشطة' : tabs.find(t => t.id === tabId)?.label || 'الأنشطة';

    return (
      <motion.div variants={staggerGrid} initial="hidden" animate="visible" className="space-y-3">
        {items.length === 0 ? (
          <GlassCard className="flex flex-col items-center justify-center py-16">
            <motion.div
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200 }}
            >
              <Calendar className="size-10 text-slate-600 mb-3" />
            </motion.div>
            <p className="text-slate-400">لا توجد {tabLabel} مسجلة هذا الشهر</p>
          </GlassCard>
        ) : (
          items.map((item, i) => (
            <motion.div key={i} variants={gridItem}
              className="flex items-start gap-3 p-3.5 rounded-xl bg-slate-800/40 border border-slate-700/20 hover:bg-slate-800/60 hover:border-slate-700/40 transition-all duration-200"
            >
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                item.type === 'attendance' ? (item.status === 'present' ? 'bg-emerald-500/10 border-emerald-500/20' : item.status === 'late' ? 'bg-yellow-500/10 border-yellow-500/20' : 'bg-red-500/10 border-red-500/20') :
                item.type === 'quality' ? 'bg-orange-500/10 border-orange-500/20' :
                item.type === 'followUp' ? 'bg-purple-500/10 border-purple-500/20' :
                item.type === 'request' ? 'bg-blue-500/10 border-blue-500/20' :
                item.type === 'complaint' ? 'bg-red-500/10 border-red-500/20' :
                item.type === 'hrDeduction' ? 'bg-pink-500/10 border-pink-500/20' :
                item.type === 'travel' ? 'bg-cyan-500/10 border-cyan-500/20' :
                item.type === 'capa' ? 'bg-cyan-500/10 border-cyan-500/20' :
                'bg-slate-500/10 border-slate-500/20'
              }`}>
                {item.type === 'attendance' && <Clock className={`size-4 ${item.status === 'present' ? 'text-emerald-400' : item.status === 'late' ? 'text-yellow-400' : 'text-red-400'}`} />}
                {item.type === 'quality' && <Award className="size-4 text-orange-400" />}
                {item.type === 'followUp' && <ClipboardCheck className="size-4 text-purple-400" />}
                {item.type === 'request' && <FileText className="size-4 text-blue-400" />}
                {item.type === 'complaint' && <MessageSquareWarning className="size-4 text-red-400" />}
                {item.type === 'hrDeduction' && <Banknote className="size-4 text-pink-400" />}
                {item.type === 'travel' && <Plane className="size-4 text-cyan-400" />}
                {item.type === 'capa' && <ShieldAlert className="size-4 text-cyan-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">{item.title}</p>
                {item.description && <p className="text-slate-400 text-xs mt-0.5 truncate">{item.description}</p>}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-slate-500 text-xs" dir="ltr">{item.date}</span>
                {item.status && (
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-md ${
                    item.status === 'present' || item.status === 'approved' || item.status === 'completed' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' :
                    item.status === 'late' || item.status === 'pending' || item.status === 'open' || item.status === 'under_review' ? 'border-yellow-500/50 text-yellow-400 bg-yellow-500/5' :
                    item.status === 'absent' || item.status === 'rejected' ? 'border-red-500/50 text-red-400 bg-red-500/5' :
                    'border-slate-500/50 text-slate-400'
                  }`}>
                    {item.status === 'present' ? 'حاضر' :
                     item.status === 'late' ? 'متأخر' :
                     item.status === 'absent' ? 'غائب' :
                     item.status === 'approved' ? 'مقبول' :
                     item.status === 'rejected' ? 'مرفوض' :
                     item.status === 'pending' ? 'معلق' :
                     item.status === 'open' ? 'مفتوح' :
                     item.status === 'completed' ? 'مكتمل' :
                     item.status === 'deduction' ? 'خصم' :
                     item.status}
                  </Badge>
                )}
              </div>
            </motion.div>
          ))
        )}
      </motion.div>
    );
  };

  const renderCapaTab = () => (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-5">
      {/* CAPA Stats Grid */}
      <motion.div variants={staggerGrid} initial="hidden" animate="visible" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'مفتوحة', value: stats.capa.open, icon: <AlertTriangle className="size-4 text-yellow-400" />, bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
          { label: 'مغلقة', value: stats.capa.closed, icon: <CheckCircle className="size-4 text-emerald-400" />, bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
          { label: 'متأخرة', value: stats.capa.overdue, icon: <Clock className="size-4 text-red-400" />, bg: 'bg-red-500/10', border: 'border-red-500/20' },
          { label: 'حرجة', value: stats.capa.critical, icon: <AlertCircle className="size-4 text-orange-400" />, bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
          { label: 'معاد فتحها', value: stats.capa.reopened, icon: <RotateCcw className="size-4 text-purple-400" />, bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
          { label: 'فعّالة', value: stats.capa.effectiveness, icon: <ShieldCheck className="size-4 text-cyan-400" />, bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
        ].map((stat, i) => (
          <motion.div key={i} variants={gridItem}>
            <GlassCard className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg ${stat.bg} border ${stat.border} flex items-center justify-center`}>
                {stat.icon}
              </div>
              <div>
                <p className="text-slate-400 text-xs">{stat.label}</p>
                <p className="text-white font-bold text-sm">{stat.value}</p>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>

      {/* CAPA Effectiveness */}
      {stats.capa.closed > 0 && (
        <motion.div variants={slideUpFade}>
          <GlassCard className="p-5">
            <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <TrendingUp className="size-4 text-cyan-400" />
              </div>
              فعالية CAPA
            </h3>
            <div className="h-3 rounded-full bg-slate-700/50 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-cyan-500"
                initial={{ width: 0 }}
                animate={{ width: `${stats.capa.closed > 0 ? (stats.capa.effectiveness / stats.capa.closed) * 100 : 0}%` }}
                transition={{ delay: 0.4, duration: 1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
            <p className="text-slate-400 text-xs mt-2">
              {stats.capa.effectiveness} من {stats.capa.closed} حالة مغلقة فعّالة ({stats.capa.closed > 0 ? Math.round((stats.capa.effectiveness / stats.capa.closed) * 100) : 0}%)
            </p>
          </GlassCard>
        </motion.div>
      )}

      {/* CAPA Timeline Events */}
      <motion.div variants={slideUpFade}>
        <GlassCard className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Activity className="size-4 text-cyan-400" />
              </div>
              سجل CAPA
            </h3>
            <Button
              size="sm"
              className="bg-gradient-to-l from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white text-xs shadow-lg shadow-cyan-500/20"
              onClick={() => useAppStore.getState().navigateTo('capa', undefined, { employeeId: employee.id })}
            >
              <ExternalLink className="size-3.5 ml-1" />
              فتح صفحة CAPA
            </Button>
          </div>
          <div className="space-y-3">
            {getFilteredTimeline('capa').length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10">
                <ShieldAlert className="size-8 text-slate-600 mb-2" />
                <p className="text-slate-400 text-sm">لا توجد حالات CAPA مسجلة</p>
              </div>
            ) : (
              getFilteredTimeline('capa').slice(0, 20).map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.04, type: 'spring', stiffness: 200 }}
                  className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/20 hover:bg-slate-800/60 hover:border-cyan-500/20 transition-all duration-200"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                    item.status === 'created' ? 'bg-cyan-500/10 border-cyan-500/20' :
                    item.status === 'closed' || item.status === 'verified' ? 'bg-emerald-500/10 border-emerald-500/20' :
                    item.status === 'reopened' ? 'bg-purple-500/10 border-purple-500/20' :
                    'bg-slate-500/10 border-slate-500/20'
                  }`}>
                    <ShieldAlert className={`size-4 ${
                      item.status === 'created' ? 'text-cyan-400' :
                      item.status === 'closed' || item.status === 'verified' ? 'text-emerald-400' :
                      item.status === 'reopened' ? 'text-purple-400' :
                      'text-slate-400'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{item.title}</p>
                    {item.description && <p className="text-slate-400 text-xs mt-0.5 truncate">{item.description}</p>}
                    {item.user && <p className="text-slate-500 text-xs mt-0.5">{item.user}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className="text-slate-500 text-xs" dir="ltr">{item.date}</span>
                    {item.priority && (
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 rounded-md ${
                        item.priority === 'critical' ? 'border-red-500/30 text-red-400 bg-red-500/5' :
                        item.priority === 'high' ? 'border-orange-500/30 text-orange-400 bg-orange-500/5' :
                        item.priority === 'medium' ? 'border-yellow-500/30 text-yellow-400 bg-yellow-500/5' :
                        'border-slate-500/30 text-slate-400'
                      }`}>{item.priority}</Badge>
                    )}
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </GlassCard>
      </motion.div>
    </motion.div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return renderOverviewTab();
      case 'capa': return renderCapaTab();
      case 'risk': return renderRiskTab();
      case 'performance': return renderPerformanceTab();
      case 'attendance':
      case 'requests':
      case 'quality':
      case 'hr':
      case 'followups':
        return renderTimelineContent(activeTab);
      case 'documents':
        return (
          <motion.div variants={scaleIn} initial="hidden" animate="visible">
            <GlassCard className="flex flex-col items-center justify-center py-16">
              <motion.div
                initial={{ scale: 0, rotate: -90 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
              >
                <ShieldCheck className="size-10 text-slate-600 mb-3" />
              </motion.div>
              <p className="text-slate-400">قريباً - سيتم إضافة المستندات</p>
            </GlassCard>
          </motion.div>
        );
      default: return renderOverviewTab();
    }
  };

  return (
    <motion.div
      variants={pageEnterVariants}
      initial="hidden"
      animate="visible"
      dir="rtl"
      className="space-y-5"
    >
      {/* ═══ Floating Header with Close Button ═══ */}
      <motion.div
        variants={headerFloat}
        className="sticky top-0 z-10 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-3 bg-gradient-to-b from-slate-900 via-slate-900/95 to-transparent backdrop-blur-sm"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <UserCircle className="size-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">ملف الموظف 360°</h1>
              <p className="text-slate-500 text-xs">عرض شامل لجميع بيانات الموظف</p>
            </div>
          </div>
          <motion.button
            onClick={handleClose}
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            className="w-9 h-9 rounded-xl bg-slate-800/80 border border-slate-700/50 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/80 hover:border-slate-600/50 transition-colors duration-200"
          >
            <X className="size-4" />
          </motion.button>
        </div>
      </motion.div>

      {/* ═══ Employee Hero Card ═══ */}
      <motion.div variants={scaleIn}>
        <Card className={`border ${getRiskBg(risk.level)} ${getRiskGlow(risk.level)} shadow-xl overflow-hidden`}>
          <CardContent className="p-6">
            {/* Decorative gradient bar */}
            <div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-l from-emerald-500/60 via-cyan-500/40 to-transparent" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              {/* Animated Avatar */}
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.15 }}
                className="relative"
              >
                <div className="w-18 h-18 rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center text-white text-3xl font-bold shadow-xl shadow-emerald-500/20 p-[18px]">
                  {employee.name.charAt(0)}
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-slate-900 flex items-center justify-center">
                  <CheckCircle className="size-2.5 text-white" />
                </div>
              </motion.div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25, type: 'spring', stiffness: 200 }}
                  className="flex items-center gap-3 flex-wrap"
                >
                  <h2 className="text-xl font-bold text-white">{employee.name}</h2>
                  <Badge className={`border ${getRiskBg(risk.level)} ${getRiskColor(risk.level)} text-xs rounded-lg`}>
                    <AlertTriangle className="size-3 ml-1" />
                    مخاطر: {risk.score} ({getRiskLabel(risk.level)})
                  </Badge>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35, type: 'spring', stiffness: 200 }}
                  className="flex flex-wrap gap-x-5 gap-y-2 mt-3"
                >
                  {employee.code && (
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <Hash className="size-3.5 text-slate-500" />
                      <span className="text-white font-mono" dir="ltr">{employee.code}</span>
                    </span>
                  )}
                  {employee.department && (
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <Building2 className="size-3.5 text-slate-500" />
                      <span className="text-white">{employee.department}</span>
                    </span>
                  )}
                  {employee.position && (
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <Briefcase className="size-3.5 text-slate-500" />
                      <span className="text-white">{employee.position}</span>
                    </span>
                  )}
                  {employee.mobile && (
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <Phone className="size-3.5 text-slate-500" />
                      <span className="text-white" dir="ltr">{employee.mobile}</span>
                    </span>
                  )}
                  {employee.shiftStart && employee.shiftEnd && (
                    <span className="flex items-center gap-1.5 text-sm text-slate-400">
                      <Timer className="size-3.5 text-slate-500" />
                      <span className="text-white" dir="ltr">{employee.shiftStart} - {employee.shiftEnd}</span>
                    </span>
                  )}
                </motion.div>
              </div>

              {/* Health Score */}
              <motion.div
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.4, type: 'spring', stiffness: 200 }}
                className="flex-shrink-0"
              >
                <HealthCircle score={healthScore} />
              </motion.div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ═══ Summary Stats Cards ═══ */}
      <motion.div
        variants={staggerGrid}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5"
      >
        {[
          { label: 'الحضور', value: stats.attendance.totalPresent, icon: <CheckCircle className="size-3.5 text-emerald-400" />, bg: 'bg-emerald-500/10', border: 'border-emerald-500/15' },
          { label: 'التأخير', value: stats.attendance.totalLate, icon: <Clock className="size-3.5 text-yellow-400" />, bg: 'bg-yellow-500/10', border: 'border-yellow-500/15' },
          { label: 'الغياب', value: stats.attendance.totalAbsent, icon: <XCircleIcon className="size-3.5 text-red-400" />, bg: 'bg-red-500/10', border: 'border-red-500/15' },
          { label: 'الطلبات', value: stats.requests.pending, icon: <FileText className="size-3.5 text-blue-400" />, bg: 'bg-blue-500/10', border: 'border-blue-500/15' },
          { label: 'خصم الجودة', value: stats.quality.deductionDays, icon: <Award className="size-3.5 text-orange-400" />, bg: 'bg-orange-500/10', border: 'border-orange-500/15', suffix: 'يوم' },
          { label: 'خصم HR', value: stats.hrDeductions.deductionDays, icon: <Banknote className="size-3.5 text-pink-400" />, bg: 'bg-pink-500/10', border: 'border-pink-500/15', suffix: 'يوم' },
          { label: 'المتابعات', value: stats.followUps.open, icon: <ClipboardCheck className="size-3.5 text-purple-400" />, bg: 'bg-purple-500/10', border: 'border-purple-500/15' },
          { label: 'الشكاوى', value: stats.complaints.open, icon: <MessageSquareWarning className="size-3.5 text-red-400" />, bg: 'bg-red-500/10', border: 'border-red-500/15' },
          { label: 'CAPA مفتوحة', value: stats.capa.open, icon: <ShieldAlert className="size-3.5 text-cyan-400" />, bg: 'bg-cyan-500/10', border: 'border-cyan-500/15' },
        ].map((stat, i) => (
          <motion.div key={i} variants={gridItem}>
            <div className={`rounded-xl ${stat.bg} border ${stat.border} p-3 text-center transition-all hover:scale-105 cursor-default`}>
              <div className="flex justify-center mb-1.5">{stat.icon}</div>
              <motion.p
                className="text-lg font-bold text-white"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 + i * 0.05, type: 'spring', stiffness: 300 }}
              >
                {stat.value}{stat.suffix ? ` ${stat.suffix}` : ''}
              </motion.p>
              <p className="text-slate-500 text-[10px] mt-0.5">{stat.label}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* ═══ Tabs Navigation ═══ */}
      <motion.div
        variants={slideUpFade}
        className="border-b border-slate-700/50"
      >
        <div className="flex gap-0.5 overflow-x-auto pb-px scrollbar-hide">
          {tabs.map((tab, i) => (
            <motion.button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm whitespace-nowrap transition-all duration-200 ${
                activeTab === tab.id
                  ? 'text-emerald-400'
                  : 'text-slate-400 hover:text-slate-300'
              }`}
            >
              {activeTab === tab.id && (
                <motion.div
                  layoutId="active-tab-indicator"
                  className="absolute bottom-0 right-0 left-0 h-0.5 bg-gradient-to-l from-emerald-500 to-cyan-500 rounded-full"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
              {tab.icon}
              {tab.label}
            </motion.button>
          ))}
        </div>
      </motion.div>

      {/* ═══ Tab Content with Cinematic Transition ═══ */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          variants={tabContentVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {renderTabContent()}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
