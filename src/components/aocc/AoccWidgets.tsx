'use client';

import { memo, useState, useEffect, useCallback } from 'react';
import { DashboardCard, DashboardGrid } from '@/components/dashboard/DashboardCard';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import EmployeeLink from '@/components/shared/EmployeeLink';
import {
  Monitor,
  Clock,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  ClipboardCheck,
  Plane,
  FileWarning,
  Hourglass,
  AlertCircle,
  TrendingUp,
  ChevronLeft,
  Award,
  Bell,
  Search,
  RefreshCw,
  Wifi,
  WifiOff,
  Radio,
  Zap,
  Users,
  Activity,
  Globe,
  Database,
  Fingerprint,
  BarChart3,
  CalendarClock,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  Eye,
  Play,
  Plus,
  Send,
  RotateCw,
  Lightbulb,
  Target,
  BrainCircuit,
  HeartPulse,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   SHARED TYPES — All widget props interfaces
   ═══════════════════════════════════════════════════════════════ */

// ── Mission Header Props ──
export interface AoccMissionHeaderProps {
  unreadCount: number;
  lastSync: string | null;
  onRefresh: () => void;
}

// ── Global Health Props ──
export interface GlobalHealthKPIS {
  presentCount: number;
  lateCount: number;
  absentCount: number;
  openCAPACount: number;
  criticalCAPACount: number;
  openComplaintsCount: number;
  criticalComplaintsCount: number;
  openFollowUpsCount: number;
  overdueFollowUpsCount: number;
  pendingRequestsCount: number;
  riskCount: number;
  qualityViolationsToday: number;
  unreadNotifications: number;
}

export interface AoccGlobalHealthProps {
  kpis: GlobalHealthKPIS;
}

// ── Critical Action Queue Props ──
export interface ActionQueueItem {
  id: string;
  title: string;
  type: 'follow-up' | 'capa' | 'complaint' | 'travel';
  priority: 'critical' | 'high' | 'medium' | 'low';
  dueDate: string | null;
  employeeName?: string;
  employeeId?: string;
  status: string;
  sourcePage: string;
}

export interface AoccCriticalActionQueueProps {
  items: ActionQueueItem[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

// ── Department Status Props ──
export interface DepartmentStatItem {
  name: string;
  present: number;
  late: number;
  absent: number;
  total: number;
  healthScore: number;
}

export interface AoccDepartmentStatusProps {
  departments: DepartmentStatItem[];
  loading: boolean;
  error: boolean;
}

// ── Employee Watchlist Props ──
export interface WatchlistEmployee {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  trend: 'improving' | 'stable' | 'declining';
  openCases: number;
  recommendations: string[];
}

export interface AoccEmployeeWatchlistProps {
  employees: WatchlistEmployee[];
  loading: boolean;
  error: boolean;
}

// ── Timeline Props ──
export interface TimelineEvent {
  id: string;
  title: string;
  time: string;
  type: 'follow-up' | 'travel' | 'capa';
  status: string;
  icon: React.ReactNode;
  colorClass: string;
  sourcePage: string;
  sourceId: string;
}

export interface AoccTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
}

// ── Smart Recommendations Props ──
export interface Recommendation {
  id: string;
  title: string;
  description: string;
  category: 'risk' | 'capa' | 'complaint' | 'pattern';
  severity: 'critical' | 'high' | 'medium';
  employeeId?: string;
  employeeName?: string;
  relatedId?: string;
  relatedPage?: string;
}

export interface AoccSmartRecommendationsProps {
  recommendations: Recommendation[];
  loading: boolean;
}

// ── Quick Actions Props ──
export interface QuickAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  targetPage: string;
  colorClass: string;
}

export interface AoccQuickActionsProps {
  actions: QuickAction[];
}

// ── System Status Props ──
export interface SystemStatusData {
  biometricLastSync: string | null;
  biometricRecordCount: number;
  onlineUsers: Array<{
    userId: string;
    userName: string;
    lastActivity: string;
    currentPage: string;
    status: 'active' | 'idle' | 'away';
    durationLabel: string;
  }> | null; // null = not admin
  unreadBreakdown: { critical: number; high: number; medium: number; low: number };
}

export interface AoccSystemStatusProps {
  data: SystemStatusData;
  loading: boolean;
}

// ── Executive Summary Props ──
export interface ExecutiveData {
  currentMonth: string;
  lastMonth: string;
  delaysChange: number; // percentage change
  deductionsChange: number;
  attendanceRateChange: number;
  totalPresent: number;
  totalAbsent: number;
  totalDeductions: number;
  openCAPACount: number;
  openComplaintsCount: number;
  pendingRequestsCount: number;
}

export interface AoccExecutiveSummaryProps {
  data: ExecutiveData;
  loading: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════════ */

function getPriorityBadge(priority: string) {
  switch (priority) {
    case 'critical':
      return <Badge className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-400 border-red-500/30">حرج</Badge>;
    case 'high':
      return <Badge className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-400 border-amber-500/30">عالي</Badge>;
    case 'medium':
      return <Badge className="text-[10px] px-2 py-0.5 bg-blue-500/20 text-blue-400 border-blue-500/30">متوسط</Badge>;
    default:
      return <Badge className="text-[10px] px-2 py-0.5 bg-slate-600/20 text-slate-400 border-slate-500/30">منخفض</Badge>;
  }
}

function getTrendIcon(trend: string) {
  switch (trend) {
    case 'improving':
      return <ArrowUpRight className="w-3 h-3 text-emerald-400" />;
    case 'declining':
      return <ArrowDownRight className="w-3 h-3 text-red-400" />;
    default:
      return <Activity className="w-3 h-3 text-slate-400" />;
  }
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return `منذ ${diffMin} د`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} س`;
  const diffDay = Math.floor(diffHr / 24);
  return `منذ ${diffDay} ي`;
}

function HealthDot({ score }: { score: number }) {
  const color = score >= 90 ? 'bg-emerald-500' : score >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={cn('inline-block w-2 h-2 rounded-full', color)} />;
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET 1: AoccMissionHeader
   Live clock, date, user, online status, unread badge,
   sync indicator, refresh button
   ═══════════════════════════════════════════════════════════════ */

function LiveClock() {
  const [time, setTime] = useState('--:--');
  const [date, setDate] = useState('');

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      setDate(now.toLocaleDateString('ar-SA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-end">
      <span className="text-lg font-mono font-bold text-white tracking-wider" dir="ltr">{time}</span>
      <span className="text-[11px] text-slate-400">{date}</span>
    </div>
  );
}

export const AoccMissionHeader = memo(function AoccMissionHeader({
  unreadCount,
  lastSync,
  onRefresh,
}: AoccMissionHeaderProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 p-4 md:p-5 bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/50">
      {/* ── Left: Title + Status ── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-sky-500/15 shadow-sm">
          <Monitor className="w-6 h-6 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">مركز العمليات</h1>
          <p className="text-xs text-slate-400 mt-0.5">لوحة التحكم التنفيذية — ARM ERP</p>
        </div>
        {/* Online indicator */}
        <div className="flex items-center gap-1.5 mr-3">
          <Wifi className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-[10px] text-emerald-400 font-medium">متصل</span>
        </div>
      </div>

      {/* ── Center: Clock + Date ── */}
      <LiveClock />

      {/* ── Right: Actions ── */}
      <div className="flex items-center gap-2">
        {/* Notifications button */}
        <button
          onClick={() => navigateTo('notifications')}
          className="relative p-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/60 transition-colors"
          title="مركز الإشعارات"
        >
          <Bell className="w-5 h-5 text-slate-300" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          className="p-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/60 transition-colors"
          title="تحديث البيانات"
        >
          <RefreshCw className="w-4 h-4 text-slate-300" />
        </button>

        {/* Sync indicator */}
        {lastSync && (
          <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>آخر مزامنة: {formatRelativeTime(lastSync)}</span>
          </div>
        )}
      </div>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 2: AoccGlobalHealth
   10-12 clickable KPI tiles → each navigates to filtered source page
   ═══════════════════════════════════════════════════════════════ */

interface KPITile {
  key: string;
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  targetPage: string;
  badge?: string;
  badgeColor?: string;
  permission: string;
}

export const AoccGlobalHealth = memo(function AoccGlobalHealth({ kpis }: AoccGlobalHealthProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

  const tiles: KPITile[] = [
    {
      key: 'present',
      label: 'حاضرون اليوم',
      value: kpis.presentCount,
      icon: <CheckCircle2 className="w-4 h-4" />,
      iconBg: 'bg-emerald-500/15',
      iconColor: 'text-emerald-400',
      targetPage: 'attendance',
      permission: 'attendance',
    },
    {
      key: 'late',
      label: 'متأخرون',
      value: kpis.lateCount,
      icon: <Clock className="w-4 h-4" />,
      iconBg: 'bg-amber-500/15',
      iconColor: 'text-amber-400',
      targetPage: 'attendance',
      permission: 'attendance',
      badge: kpis.lateCount > 0 ? 'تحذير' : undefined,
      badgeColor: 'bg-amber-500/20 text-amber-400',
    },
    {
      key: 'absent',
      label: 'غائبون',
      value: kpis.absentCount,
      icon: <XCircle className="w-4 h-4" />,
      iconBg: 'bg-red-500/15',
      iconColor: 'text-red-400',
      targetPage: 'attendance',
      permission: 'attendance',
    },
    {
      key: 'openCapa',
      label: 'قضايا كابا مفتوحة',
      value: kpis.openCAPACount,
      icon: <ClipboardCheck className="w-4 h-4" />,
      iconBg: 'bg-purple-500/15',
      iconColor: 'text-purple-400',
      targetPage: 'capa',
      permission: 'capa',
      badge: kpis.criticalCAPACount > 0 ? `${kpis.criticalCAPACount} حرج` : undefined,
      badgeColor: 'bg-red-500/20 text-red-400',
    },
    {
      key: 'criticalCapa',
      label: 'كابا حرجة',
      value: kpis.criticalCAPACount,
      icon: <ShieldAlert className="w-4 h-4" />,
      iconBg: 'bg-red-500/15',
      iconColor: 'text-red-400',
      targetPage: 'capa',
      permission: 'capa',
    },
    {
      key: 'complaints',
      label: 'شكاوى مفتوحة',
      value: kpis.openComplaintsCount,
      icon: <AlertCircle className="w-4 h-4" />,
      iconBg: 'bg-orange-500/15',
      iconColor: 'text-orange-400',
      targetPage: 'complaints',
      permission: 'complaints',
      badge: kpis.criticalComplaintsCount > 0 ? `${kpis.criticalComplaintsCount} حرج` : undefined,
      badgeColor: 'bg-red-500/20 text-red-400',
    },
    {
      key: 'overdueFU',
      label: 'متابعات مستحقة',
      value: kpis.overdueFollowUpsCount,
      icon: <AlertTriangle className="w-4 h-4" />,
      iconBg: 'bg-rose-500/15',
      iconColor: 'text-rose-400',
      targetPage: 'followUps',
      permission: 'followUps',
    },
    {
      key: 'pendingRequests',
      label: 'طلبات معلقة',
      value: kpis.pendingRequestsCount,
      icon: <Hourglass className="w-4 h-4" />,
      iconBg: 'bg-sky-500/15',
      iconColor: 'text-sky-400',
      targetPage: 'requests',
      permission: 'requests',
    },
    {
      key: 'risks',
      label: 'مخاطر مفتوحة',
      value: kpis.riskCount,
      icon: <ShieldAlert className="w-4 h-4" />,
      iconBg: 'bg-amber-500/15',
      iconColor: 'text-amber-400',
      targetPage: 'riskCenter',
      permission: 'riskCenter',
    },
    {
      key: 'violations',
      label: 'انتهاكات اليوم',
      value: kpis.qualityViolationsToday,
      icon: <FileWarning className="w-4 h-4" />,
      iconBg: 'bg-orange-500/15',
      iconColor: 'text-orange-400',
      targetPage: 'quality',
      permission: 'quality',
    },
    {
      key: 'notifs',
      label: 'إشعارات غير مقروءة',
      value: kpis.unreadNotifications,
      icon: <Bell className="w-4 h-4" />,
      iconBg: 'bg-violet-500/15',
      iconColor: 'text-violet-400',
      targetPage: 'notifications',
      permission: 'notifications',
    },
  ];

  // Filter by permission
  const visibleTiles = tiles.filter((t) => canViewPage(t.permission));

  return (
    <DashboardCard
      title="المؤشرات العامة"
      icon={<BarChart3 className="w-4 h-4" />}
      iconBg="bg-sky-500/15"
      iconColor="text-sky-400"
      borderClr="border-slate-700/50"
      size="large"
      scrollable={false}
      badge={visibleTiles.length}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-1">
        {visibleTiles.map((tile) => (
          <button
            key={tile.key}
            onClick={() => navigateTo(tile.targetPage)}
            className="group flex flex-col items-start gap-2 p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/20 hover:border-slate-500/30 transition-all text-right"
          >
            <div className="flex items-center justify-between w-full">
              <div className={cn('p-1.5 rounded-lg', tile.iconBg)}>
                <span className={tile.iconColor}>{tile.icon}</span>
              </div>
              {tile.badge && (
                <Badge className={cn('text-[9px] px-1.5 py-0', tile.badgeColor || 'bg-slate-600/20 text-slate-300')}>
                  {tile.badge}
                </Badge>
              )}
            </div>
            <p className="text-2xl font-bold text-white">{tile.value}</p>
            <p className="text-[11px] text-slate-400 leading-tight">{tile.label}</p>
            <ChevronLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 self-end transition-colors" />
          </button>
        ))}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 3: AoccCriticalActionQueue
   Unified priority-sorted queue merging overdue follow-ups +
   critical/high CAPA + critical complaints + urgent travel
   ═══════════════════════════════════════════════════════════════ */

const QUEUE_TYPE_CONFIG: Record<string, { icon: React.ReactNode; colorClass: string; label: string }> = {
  'follow-up': {
    icon: <Clock className="w-3.5 h-3.5" />,
    colorClass: 'text-rose-400',
    label: 'متابعة',
  },
  capa: {
    icon: <ClipboardCheck className="w-3.5 h-3.5" />,
    colorClass: 'text-purple-400',
    label: 'كابا',
  },
  complaint: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    colorClass: 'text-orange-400',
    label: 'شكوى',
  },
  travel: {
    icon: <Plane className="w-3.5 h-3.5" />,
    colorClass: 'text-sky-400',
    label: 'سفر',
  },
};

export const AoccCriticalActionQueue = memo(function AoccCriticalActionQueue({
  items,
  loading,
  error,
  onRetry,
}: AoccCriticalActionQueueProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

  // Permission filter — only show items the user can access
  const visibleItems = items.filter((item) => {
    switch (item.type) {
      case 'follow-up': return canViewPage('followUps');
      case 'capa': return canViewPage('capa');
      case 'complaint': return canViewPage('complaints');
      case 'travel': return canViewPage('travel');
      default: return true;
    }
  });

  // Show up to 50 items (virtualized threshold)
  const displayItems = visibleItems.slice(0, 50);

  const handleItemClick = (item: ActionQueueItem) => {
    navigateTo(item.sourcePage, item.id);
  };

  return (
    <DashboardCard
      title="طوابير الإجراءات الحرجة"
      icon={<Zap className="w-4 h-4" />}
      iconBg="bg-red-500/15"
      iconColor="text-red-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      error={error}
      errorMessage="فشل تحميل طابور الإجراءات"
      onRetry={onRetry}
      badge={visibleItems.length}
      empty={visibleItems.length === 0 && !loading}
      emptyMessage="لا توجد إجراءات حرجة"
      emptyDescription="كل شيء تحت السيطرة"
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
    >
      <div className="space-y-1.5 p-1">
        {displayItems.map((item) => {
          const config = QUEUE_TYPE_CONFIG[item.type] || QUEUE_TYPE_CONFIG['follow-up'];
          return (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              className="w-full group flex items-center gap-3 p-2.5 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/15 hover:border-slate-500/30 transition-all text-right"
            >
              {/* Type icon */}
              <div className={cn('p-1.5 rounded-lg bg-slate-600/30 shrink-0', config.colorClass)}>
                {config.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200 truncate">{item.title}</span>
                  {getPriorityBadge(item.priority)}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn('text-[10px]', config.colorClass)}>{config.label}</span>
                  {item.dueDate && (
                    <span className="text-[10px] text-slate-500">
                      {new Date(item.dueDate).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>

              {/* Employee name */}
              {item.employeeName && (
                <span className="text-[11px] text-slate-500 shrink-0 hidden sm:block max-w-[100px] truncate">
                  {item.employeeName}
                </span>
              )}

              <ChevronLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 transition-colors" />
            </button>
          );
        })}
        {visibleItems.length > 50 && (
          <div className="text-center py-2">
            <span className="text-[11px] text-slate-500">+{visibleItems.length - 50} إجراءات أخرى</span>
          </div>
        )}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 4: AoccDepartmentStatus
   Grid of department cards with present/late/absent + health score
   ═══════════════════════════════════════════════════════════════ */

export const AoccDepartmentStatus = memo(function AoccDepartmentStatus({
  departments,
  loading,
  error,
}: AoccDepartmentStatusProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="حالة الأقسام اليوم"
      icon={<Users className="w-4 h-4" />}
      iconBg="bg-emerald-500/15"
      iconColor="text-emerald-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      error={error}
      errorMessage="فشل تحميل بيانات الأقسام"
      badge={departments.length}
      empty={departments.length === 0 && !loading}
      emptyMessage="لا توجد بيانات أقسام"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-1">
        {departments.map((dept) => {
          const healthColor = dept.healthScore >= 90 ? 'text-emerald-400' : dept.healthScore >= 70 ? 'text-amber-400' : 'text-red-400';
          return (
            <button
              key={dept.name}
              onClick={() => navigateTo('attendance')}
              className="group p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/15 hover:border-slate-500/30 transition-all text-right"
            >
              {/* Department name + health */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-200">{dept.name}</span>
                <div className="flex items-center gap-1.5">
                  <HealthDot score={dept.healthScore} />
                  <span className={cn('text-xs font-semibold', healthColor)}>{dept.healthScore}%</span>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[11px] text-slate-400">{dept.present}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <span className="text-[11px] text-slate-400">{dept.late}</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-[11px] text-slate-400">{dept.absent}</span>
                </div>
                <span className="text-[10px] text-slate-600 mr-auto">إجمالي {dept.total}</span>
              </div>
            </button>
          );
        })}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 5: AoccEmployeeWatchlist
   High/critical risk employees from risk center with score,
   trend, recommendations. Uses EmployeeLink for click-through.
   ═══════════════════════════════════════════════════════════════ */

const RISK_LEVEL_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'حرج' },
  high: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'عالي' },
  medium: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'متوسط' },
  low: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'منخفض' },
};

export const AoccEmployeeWatchlist = memo(function AoccEmployeeWatchlist({
  employees,
  loading,
  error,
}: AoccEmployeeWatchlistProps) {
  const { canViewPage } = usePermissions();

  if (!canViewPage('riskCenter')) return null;

  // Show only high + critical risk employees
  const watchEmployees = employees.filter(
    (e) => e.riskLevel === 'high' || e.riskLevel === 'critical'
  );

  return (
    <DashboardCard
      title="قائمة المتابعة — موظفين بمخاطر"
      icon={<Eye className="w-4 h-4" />}
      iconBg="bg-amber-500/15"
      iconColor="text-amber-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      error={error}
      errorMessage="فشل تحميل قائمة المتابعة"
      badge={watchEmployees.length}
      empty={watchEmployees.length === 0 && !loading}
      emptyMessage="لا يوجد موظفين بمخاطر عالية"
      emptyDescription="جميع الموظفين ضمن المستويات المقبولة"
      emptyIcon={<ShieldCheck className="w-10 text-emerald-400/40" />}
      onOpenFull={() => useAppStore.getState().navigateTo('riskCenter')}
    >
      <div className="space-y-2 p-1">
        {watchEmployees.map((emp) => {
          const riskStyle = RISK_LEVEL_STYLES[emp.riskLevel] || RISK_LEVEL_STYLES.medium;
          return (
            <div
              key={emp.employeeId}
              className="p-3 rounded-xl bg-slate-700/30 border border-slate-600/15 hover:border-slate-500/20 transition-colors"
            >
              {/* Header: Employee name + risk badge + score */}
              <div className="flex items-center justify-between mb-2">
                <EmployeeLink
                  employeeId={emp.employeeId}
                  name={emp.employeeName}
                  department={emp.department}
                  compact
                />
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-[10px] px-2 py-0.5 border', riskStyle.bg, riskStyle.text, 'border-current/20')}>
                    {riskStyle.label}
                  </Badge>
                  <span className={cn('text-sm font-bold tabular-nums', riskStyle.text)}>
                    {emp.riskScore}
                  </span>
                </div>
              </div>

              {/* Meta row */}
              <div className="flex items-center gap-3 mb-2">
                <span className="text-[10px] text-slate-500">{emp.department} — {emp.position}</span>
                <div className="flex items-center gap-1">
                  {getTrendIcon(emp.trend)}
                  <span className="text-[10px] text-slate-500">
                    {emp.trend === 'improving' ? 'تحسن' : emp.trend === 'declining' ? 'تدهور' : 'مستقر'}
                  </span>
                </div>
                <span className="text-[10px] text-slate-500">{emp.openCases} قضايا مفتوحة</span>
              </div>

              {/* Recommendations */}
              {emp.recommendations.length > 0 && (
                <div className="space-y-1">
                  {emp.recommendations.slice(0, 2).map((rec, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[11px]">
                      <Lightbulb className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
                      <span className="text-slate-400">{rec}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 6: AoccTimeline
   Today's scheduled events: follow-ups due today,
   trips departing today, CAPA due today — sorted chronologically
   ═══════════════════════════════════════════════════════════════ */

export const AoccTimeline = memo(function AoccTimeline({
  events,
  loading,
}: AoccTimelineProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="الجدول الزمني — اليوم"
      icon={<CalendarClock className="w-4 h-4" />}
      iconBg="bg-violet-500/15"
      iconColor="text-violet-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      badge={events.length}
      empty={events.length === 0 && !loading}
      emptyMessage="لا يوجد أحداث مجدولة اليوم"
      emptyDescription="يوم هادئ"
    >
      <div className="relative p-1">
        {/* Vertical line */}
        {events.length > 0 && (
          <div className="absolute right-4 top-3 bottom-3 w-px bg-slate-700/50" />
        )}

        <div className="space-y-3">
          {events.map((event) => (
            <button
              key={event.id}
              onClick={() => navigateTo(event.sourcePage, event.sourceId)}
              className="group w-full flex items-start gap-3 text-right"
            >
              {/* Icon node on the timeline */}
              <div className={cn('relative z-10 p-1.5 rounded-lg bg-slate-800 shrink-0 border border-slate-700/50', event.colorClass)}>
                {event.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-200 truncate">{event.title}</span>
                  <span className="text-[10px] text-slate-500 shrink-0 mr-2" dir="ltr">{event.time}</span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge className="text-[9px] px-1.5 py-0 bg-slate-600/20 text-slate-400 border-slate-500/20">
                    {event.status}
                  </Badge>
                </div>
              </div>

              <ChevronLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 mt-1 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 7: AoccSmartRecommendations
   Action cards from risk center recommendations +
   overdue CAPA + complaint patterns
   ═══════════════════════════════════════════════════════════════ */

const REC_CATEGORY_CONFIG: Record<string, { icon: React.ReactNode; colorClass: string; label: string }> = {
  risk: {
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
    colorClass: 'text-amber-400',
    label: 'مخاطر',
  },
  capa: {
    icon: <ClipboardCheck className="w-3.5 h-3.5" />,
    colorClass: 'text-purple-400',
    label: 'كابا',
  },
  complaint: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    colorClass: 'text-orange-400',
    label: 'شكاوى',
  },
  pattern: {
    icon: <BrainCircuit className="w-3.5 h-3.5" />,
    colorClass: 'text-sky-400',
    label: 'نمط',
  },
};

const REC_SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
};

export const AoccSmartRecommendations = memo(function AoccSmartRecommendations({
  recommendations,
  loading,
}: AoccSmartRecommendationsProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="توصيات ذكية"
      icon={<BrainCircuit className="w-4 h-4" />}
      iconBg="bg-cyan-500/15"
      iconColor="text-cyan-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      badge={recommendations.length}
      empty={recommendations.length === 0 && !loading}
      emptyMessage="لا توجد توصيات حالياً"
      emptyDescription="النظام سيقترح إجراءات عند اكتشاف أنماط"
    >
      <div className="space-y-2 p-1">
        {recommendations.slice(0, 10).map((rec) => {
          const catConfig = REC_CATEGORY_CONFIG[rec.category] || REC_CATEGORY_CONFIG.pattern;
          return (
            <button
              key={rec.id}
              onClick={() => {
                if (rec.relatedPage) {
                  navigateTo(rec.relatedPage, rec.relatedId);
                }
              }}
              className="w-full group p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/15 hover:border-slate-500/30 transition-all text-right"
            >
              <div className="flex items-start gap-3">
                {/* Category icon */}
                <div className={cn('p-1.5 rounded-lg bg-slate-600/30 shrink-0 mt-0.5', catConfig.colorClass)}>
                  {catConfig.icon}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm text-slate-200 truncate">{rec.title}</span>
                    <Badge className={cn('text-[9px] px-1.5 py-0 border shrink-0', REC_SEVERITY_BADGE[rec.severity] || REC_SEVERITY_BADGE.medium)}>
                      {rec.severity === 'critical' ? 'حرج' : rec.severity === 'high' ? 'عالي' : 'متوسط'}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{rec.description}</p>
                  {rec.employeeName && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[10px] text-slate-500">الموظف:</span>
                      <span className="text-[10px] text-slate-300">{rec.employeeName}</span>
                    </div>
                  )}
                </div>

                {rec.relatedPage && (
                  <ChevronLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 shrink-0 mt-1 transition-colors" />
                )}
              </div>
            </button>
          );
        })}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 8: AoccQuickActions
   Grid of action buttons → navigateTo target page
   ═══════════════════════════════════════════════════════════════ */

export const AoccQuickActions = memo(function AoccQuickActions({ actions }: AoccQuickActionsProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

  // Filter by permission — derive permission key from targetPage
  const visibleActions = actions.filter((a) => canViewPage(a.targetPage));

  return (
    <DashboardCard
      title="إجراءات سريعة"
      icon={<Play className="w-4 h-4" />}
      iconBg="bg-emerald-500/15"
      iconColor="text-emerald-400"
      borderClr="border-slate-700/50"
      size="medium"
      scrollable={false}
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 p-1">
        {visibleActions.map((action) => (
          <button
            key={action.id}
            onClick={() => navigateTo(action.targetPage)}
            className="group flex flex-col items-center gap-2 p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/15 hover:border-slate-500/30 transition-all"
          >
            <div className={cn('p-2 rounded-xl bg-slate-600/30 group-hover:scale-110 transition-transform', action.colorClass)}>
              {action.icon}
            </div>
            <span className="text-[11px] text-slate-300 leading-tight text-center">{action.label}</span>
          </button>
        ))}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 9: AoccSystemStatus
   Biometric last sync, online users (admin-only),
   DB health, unread notification breakdown
   ═══════════════════════════════════════════════════════════════ */

export const AoccSystemStatus = memo(function AoccSystemStatus({
  data,
  loading,
}: AoccSystemStatusProps) {
  return (
    <DashboardCard
      title="حالة النظام"
      icon={<HeartPulse className="w-4 h-4" />}
      iconBg="bg-emerald-500/15"
      iconColor="text-emerald-400"
      borderClr="border-slate-700/50"
      size="medium"
      loading={loading}
    >
      <div className="space-y-4 p-1">
        {/* Biometric sync status */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-violet-500/15">
              <Fingerprint className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <p className="text-sm text-slate-200">البصمة</p>
              <p className="text-[10px] text-slate-500">آخر مزامنة</p>
            </div>
          </div>
          <div className="text-left">
            {data.biometricLastSync ? (
              <>
                <div className="flex items-center gap-1">
                  <HealthDot score={95} />
                  <span className="text-[11px] text-emerald-400">متصل</span>
                </div>
                <span className="text-[10px] text-slate-500">{formatRelativeTime(data.biometricLastSync)}</span>
              </>
            ) : (
              <div className="flex items-center gap-1">
                <WifiOff className="w-3 h-3 text-red-400" />
                <span className="text-[11px] text-red-400">غير متصل</span>
              </div>
            )}
          </div>
        </div>

        {/* Notification breakdown */}
        <div className="p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="p-1.5 rounded-lg bg-violet-500/15">
              <Bell className="w-4 h-4 text-violet-400" />
            </div>
            <span className="text-sm text-slate-200">الإشعارات غير المقروءة</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span className="text-[10px] text-slate-400">{data.unreadBreakdown.critical} حرج</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              <span className="text-[10px] text-slate-400">{data.unreadBreakdown.high} عالي</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-[10px] text-slate-400">{data.unreadBreakdown.medium} متوسط</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
              <span className="text-[10px] text-slate-400">{data.unreadBreakdown.low} منخفض</span>
            </div>
          </div>
        </div>

        {/* Online users (admin-only) */}
        {data.onlineUsers && (
          <div className="p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
            <div className="flex items-center gap-2.5 mb-2">
              <div className="p-1.5 rounded-lg bg-emerald-500/15">
                <Globe className="w-4 h-4 text-emerald-400" />
              </div>
              <span className="text-sm text-slate-200">المستخدمون النشطون</span>
              <Badge className="text-[9px] px-1.5 py-0 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                {data.onlineUsers.length} متصل
              </Badge>
            </div>
            <div className="space-y-1.5">
              {data.onlineUsers.slice(0, 5).map((u) => (
                <div key={u.userId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      'w-2 h-2 rounded-full',
                      u.status === 'active' ? 'bg-emerald-500' : u.status === 'idle' ? 'bg-amber-500' : 'bg-slate-500'
                    )} />
                    <span className="text-[11px] text-slate-300">{u.userName}</span>
                  </div>
                  <span className="text-[10px] text-slate-500">{u.durationLabel}</span>
                </div>
              ))}
              {data.onlineUsers.length > 5 && (
                <span className="text-[10px] text-slate-500">+{data.onlineUsers.length - 5} آخرين</span>
              )}
            </div>
          </div>
        )}

        {/* Biometric record count */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-sky-500/15">
              <Database className="w-4 h-4 text-sky-400" />
            </div>
            <span className="text-sm text-slate-200">سجلات البصمة</span>
          </div>
          <span className="text-sm font-semibold text-sky-400 tabular-nums">
            {data.biometricRecordCount.toLocaleString('ar-SA')}
          </span>
        </div>
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 10: AoccExecutiveSummary
   Compact trend summary: this month vs last month
   + open items totals requiring attention
   ═══════════════════════════════════════════════════════════════ */

function TrendIndicator({ value, label }: { value: number; label: string }) {
  const isPositive = value >= 0;
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
      {isPositive ? (
        <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
      ) : (
        <ArrowDownRight className="w-4 h-4 text-red-400 shrink-0" />
      )}
      <div className="flex-1">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className={cn('text-sm font-semibold tabular-nums', isPositive ? 'text-emerald-400' : 'text-red-400')}>
          {isPositive ? '+' : ''}{value}%
        </p>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
      <div className="p-1.5 rounded-lg bg-slate-600/30">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className="text-sm font-semibold text-slate-200 tabular-nums">{value}</p>
      </div>
    </div>
  );
}

export const AoccExecutiveSummary = memo(function AoccExecutiveSummary({
  data,
  loading,
}: AoccExecutiveSummaryProps) {
  return (
    <DashboardCard
      title="الملخص التنفيذي"
      icon={<Target className="w-4 h-4" />}
      iconBg="bg-indigo-500/15"
      iconColor="text-indigo-400"
      borderClr="border-slate-700/50"
      size="medium"
      loading={loading}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            مقارنة: {data.lastMonth} ← {data.currentMonth}
          </span>
        </div>
      }
    >
      <div className="space-y-4 p-1">
        {/* Trend indicators: month-over-month */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">التغيرات الشهرية</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <TrendIndicator value={data.delaysChange} label="التأخيرات" />
            <TrendIndicator value={data.attendanceRateChange} label="نسبة الحضور" />
            <TrendIndicator value={data.deductionsChange} label="الخصومات" />
          </div>
        </div>

        {/* Totals requiring attention */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">إجماليات تتطلب اهتمام</p>
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat
              label="حاضرون هذا الشهر"
              value={data.totalPresent.toLocaleString('ar-SA')}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            />
            <SummaryStat
              label="غائبون هذا الشهر"
              value={data.totalAbsent.toLocaleString('ar-SA')}
              icon={<XCircle className="w-4 h-4 text-red-400" />}
            />
            <SummaryStat
              label="كابا مفتوحة"
              value={data.openCAPACount}
              icon={<ClipboardCheck className="w-4 h-4 text-purple-400" />}
            />
            <SummaryStat
              label="شكاوى مفتوحة"
              value={data.openComplaintsCount}
              icon={<AlertCircle className="w-4 h-4 text-orange-400" />}
            />
            <SummaryStat
              label="طلبات معلقة"
              value={data.pendingRequestsCount}
              icon={<Hourglass className="w-4 h-4 text-sky-400" />}
            />
            <SummaryStat
              label="إجمالي الخصومات"
              value={data.totalDeductions.toLocaleString('ar-SA')}
              icon={<TrendingUp className="w-4 h-4 text-rose-400" />}
            />
          </div>
        </div>
      </div>
    </DashboardCard>
  );
});
