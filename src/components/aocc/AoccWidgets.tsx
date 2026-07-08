'use client';

import { memo, useState, useEffect } from 'react';
import { DashboardCard, DashboardGrid } from '@/components/dashboard/DashboardCard';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import EmployeeLink from '@/components/shared/EmployeeLink';
import { getPriorityVisual, getPriorityLabel, countByPriority } from '@/lib/aocc/priority-engine';
import type {
  PriorityLevel,
  PriorityVisual,
  ActionItem,
  EmployeeCorrelation,
  DepartmentHealth,
  OperationalRecommendation,
  ActivityFeedEntry,
  ExecutiveIntelligence,
  TrendDirection,
  OperationalStatus,
} from '@/lib/aocc/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
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
  TrendingDown,
  ChevronLeft,
  Award,
  Bell,
  RefreshCw,
  Wifi,
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
  FileText,
  BrainCircuit,
  HeartPulse,
  Target,
  Lightbulb,
  ExternalLink,
  Inbox,
  Flame,
  TrendingUp as TrendUp,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════
   PROPS INTERFACES — consumed by the upgraded widgets
   ═══════════════════════════════════════════════════════════════ */

export interface AoccMissionHeaderProps {
  unreadCount: number;
  lastSync: string | null;
  onRefresh: () => void;
  criticalCount: number;
  highCount: number;
}

export interface AoccOperationalOverviewProps {
  kpis: {
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
  };
  /** Priority counts for visual emphasis */
  priorityCounts: Record<PriorityLevel, number>;
}

export interface AoccActionQueueProps {
  items: ActionItem[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}

export interface AoccDepartmentHealthProps {
  departments: DepartmentHealth[];
  loading: boolean;
  error: boolean;
}

export interface AoccEmployeeWatchlistProps {
  employees: EmployeeCorrelation[];
  loading: boolean;
  error: boolean;
}

export interface AoccActivityFeedProps {
  entries: ActivityFeedEntry[];
  loading: boolean;
}

export interface AoccIntelligenceCenterProps {
  recommendations: OperationalRecommendation[];
  loading: boolean;
}

export interface AoccQuickActionsProps {
  actions: Array<{
    id: string;
    label: string;
    icon: React.ReactNode;
    targetPage: string;
    colorClass: string;
    urgentCount?: number;
  }>;
}

export interface AoccSystemStatusProps {
  data: {
    biometricLastSync: string | null;
    biometricRecordCount: number;
    onlineUsers: Array<{
      userId: string;
      userName: string;
      lastActivity: string;
      currentPage: string;
      status: 'active' | 'idle' | 'away';
      durationLabel: string;
    }> | null;
    unreadBreakdown: { critical: number; high: number; medium: number; low: number };
    lastDataUpdate: string | null;
  };
  loading: boolean;
}

export interface AoccExecutiveSummaryProps {
  data: ExecutiveIntelligence;
  loading: boolean;
}

/* ═══════════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════════ */

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
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-500' : 'bg-red-500';
  return <span className={cn('inline-block w-2 h-2 rounded-full', color)} />;
}

function TrendIcon({ trend, className }: { trend: TrendDirection; className?: string }) {
  if (trend === 'improving') return <ArrowUpRight className={cn('w-3 h-3 text-emerald-400', className)} />;
  if (trend === 'declining') return <ArrowDownRight className={cn('w-3 h-3 text-red-400', className)} />;
  return <Activity className={cn('w-3 h-3 text-slate-400', className)} />;
}

function PriorityBadge({ level }: { level: PriorityLevel }) {
  const visual = getPriorityVisual(level);
  return (
    <Badge className={cn('text-[10px] px-2 py-0.5 border shrink-0', visual.badge)}>
      {visual.label}
    </Badge>
  );
}

/** Operational status badge for employees */
function OperationalStatusBadge({ status }: { status: OperationalStatus }) {
  const config: Record<OperationalStatus, { label: string; className: string }> = {
    critical: { label: 'حرج', className: 'bg-red-500/20 text-red-400 border-red-500/30' },
    at_risk: { label: 'تحت المراقبة', className: 'bg-amber-500/20 text-amber-400 border-amber-500/30' },
    monitoring: { label: 'متابعة', className: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
    healthy: { label: 'سليم', className: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' },
  };
  const c = config[status] || config.healthy;
  return <Badge className={cn('text-[9px] px-1.5 py-0 border', c.className)}>{c.label}</Badge>;
}

/** Empty state component for "no actions" */
function NoActionsEmpty({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4">
      <div className="mb-3 text-emerald-400/40">
        <CheckCircle2 className="size-12" />
      </div>
      <p className="text-slate-300 text-sm font-medium">
        {message || 'لا توجد إجراءات تشغيلية تتطلب اهتمامك حالياً'}
      </p>
      <p className="text-slate-500 text-xs mt-1">النظام تحت السيطرة</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   WIDGET 1: AoccMissionHeader — with operational pulse
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
  criticalCount,
  highCount,
}: AoccMissionHeaderProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const hasCritical = criticalCount > 0;

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 p-4 md:p-5 bg-slate-800/60 backdrop-blur-md rounded-2xl border transition-all',
        hasCritical
          ? 'border-red-500/40 shadow-[0_0_16px_rgba(239,68,68,0.15)]'
          : 'border-slate-700/50'
      )}
    >
      {/* ── Left: Title + Status ── */}
      <div className="flex items-center gap-3">
        <div className={cn('p-2.5 rounded-xl shadow-sm', hasCritical ? 'bg-red-500/15' : 'bg-sky-500/15')}>
          <Monitor className={cn('w-6 h-6', hasCritical ? 'text-red-400' : 'text-sky-400')} />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">مركز العمليات</h1>
          <p className="text-xs text-slate-400 mt-0.5">لوحة التحكم التنفيذية — ARM ERP</p>
        </div>

        {/* Operational pulse indicator */}
        {hasCritical ? (
          <div className="flex items-center gap-1.5 mr-3 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/20">
            <Flame className="w-3.5 h-3.5 text-red-400 animate-pulse" />
            <span className="text-[10px] text-red-400 font-medium">{criticalCount} حرج · {highCount} عالي</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mr-3">
            <Wifi className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] text-emerald-400 font-medium">النظام تحت السيطرة</span>
          </div>
        )}
      </div>

      {/* ── Center: Clock + Date ── */}
      <LiveClock />

      {/* ── Right: Actions ── */}
      <div className="flex items-center gap-2">
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
        <button
          onClick={onRefresh}
          className="p-2 rounded-xl bg-slate-700/40 hover:bg-slate-700/60 transition-colors"
          title="تحديث البيانات"
        >
          <RefreshCw className="w-4 h-4 text-slate-300" />
        </button>
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
   WIDGET 2: AoccOperationalOverview — KPI tiles with priority visuals
   ═══════════════════════════════════════════════════════════════ */

interface KPITileConfig {
  key: string;
  label: string;
  value: number;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  targetPage: string;
  permission: string;
  /** Priority level if this KPI has critical items */
  priorityLevel?: PriorityLevel;
  badge?: string;
}

export const AoccOperationalOverview = memo(function AoccOperationalOverview({
  kpis,
  priorityCounts,
}: AoccOperationalOverviewProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

  const tiles: KPITileConfig[] = [
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
      priorityLevel: kpis.lateCount > 5 ? 'high' : undefined,
      badge: kpis.lateCount > 5 ? 'تحذير' : undefined,
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
      priorityLevel: kpis.absentCount > 3 ? 'high' : undefined,
    },
    {
      key: 'openCapa',
      label: 'كابا مفتوحة',
      value: kpis.openCAPACount,
      icon: <ClipboardCheck className="w-4 h-4" />,
      iconBg: 'bg-purple-500/15',
      iconColor: 'text-purple-400',
      targetPage: 'capa',
      permission: 'capa',
      priorityLevel: kpis.criticalCAPACount > 0 ? 'critical' : undefined,
      badge: kpis.criticalCAPACount > 0 ? `${kpis.criticalCAPACount} حرج` : undefined,
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
      priorityLevel: kpis.criticalComplaintsCount > 0 ? 'critical' : undefined,
      badge: kpis.criticalComplaintsCount > 0 ? `${kpis.criticalComplaintsCount} حرج` : undefined,
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
      priorityLevel: kpis.overdueFollowUpsCount > 0 ? 'high' : undefined,
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
      priorityLevel: kpis.pendingRequestsCount > 5 ? 'medium' : undefined,
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
      priorityLevel: kpis.riskCount > 0 ? 'high' : undefined,
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
      priorityLevel: kpis.qualityViolationsToday > 0 ? 'medium' : undefined,
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

  const visibleTiles = tiles.filter((t) => canViewPage(t.permission));
  const hasActions = priorityCounts.critical > 0 || priorityCounts.high > 0;

  return (
    <DashboardCard
      title="المؤشرات التشغيلية"
      icon={<BarChart3 className="w-4 h-4" />}
      iconBg="bg-sky-500/15"
      iconColor="text-sky-400"
      borderClr="border-slate-700/50"
      size="large"
      scrollable={false}
      badge={visibleTiles.length}
      actions={
        hasActions ? (
          <div className="flex items-center gap-1">
            {priorityCounts.critical > 0 && (
              <Badge className="text-[9px] px-1.5 py-0 bg-red-500/20 text-red-400 border-red-500/30">
                {priorityCounts.critical} حرج
              </Badge>
            )}
            {priorityCounts.high > 0 && (
              <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
                {priorityCounts.high} عالي
              </Badge>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 p-1">
        {visibleTiles.map((tile) => {
          const visual = tile.priorityLevel ? getPriorityVisual(tile.priorityLevel) : null;
          return (
            <button
              key={tile.key}
              onClick={() => navigateTo(tile.targetPage)}
              className={cn(
                'group flex flex-col items-start gap-2 p-3 rounded-xl border transition-all text-right',
                visual
                  ? cn(visual.bgTint, visual.border, visual.glow)
                  : 'bg-slate-700/30 hover:bg-slate-700/50 border-slate-600/20 hover:border-slate-500/30'
              )}
            >
              <div className="flex items-center justify-between w-full">
                <div className={cn('p-1.5 rounded-lg', tile.iconBg)}>
                  <span className={tile.iconColor}>{tile.icon}</span>
                </div>
                {tile.badge && (
                  <Badge className={cn('text-[9px] px-1.5 py-0', visual?.badge || 'bg-slate-600/20 text-slate-300')}>
                    {tile.badge}
                  </Badge>
                )}
              </div>
              <p className="text-2xl font-bold text-white">{tile.value}</p>
              <p className="text-[11px] text-slate-400 leading-tight">{tile.label}</p>
              <ChevronLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 self-end transition-colors" />
            </button>
          );
        })}
      </div>
      {!hasActions && (
        <div className="mt-2 text-center">
          <span className="text-[11px] text-emerald-400/70">✓ لا توجد إجراءات تتطلب اهتمامك</span>
        </div>
      )}
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 3: AoccActionQueue — unified priority-sorted with visuals
   ═══════════════════════════════════════════════════════════════ */

const MODULE_ICON: Record<string, React.ReactNode> = {
  capa: <ClipboardCheck className="w-3.5 h-3.5" />,
  complaints: <AlertCircle className="w-3.5 h-3.5" />,
  followUps: <Clock className="w-3.5 h-3.5" />,
  travel: <Plane className="w-3.5 h-3.5" />,
  requests: <Hourglass className="w-3.5 h-3.5" />,
  riskCenter: <ShieldAlert className="w-3.5 h-3.5" />,
  notifications: <Bell className="w-3.5 h-3.5" />,
  attendance: <Users className="w-3.5 h-3.5" />,
  quality: <Award className="w-3.5 h-3.5" />,
  hrDeductions: <FileWarning className="w-3.5 h-3.5" />,
};

export const AoccActionQueue = memo(function AoccActionQueue({
  items,
  loading,
  error,
  onRetry,
}: AoccActionQueueProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

  // Permission filter
  const visibleItems = items.filter((item) => canViewPage(item.sourceModule));
  const displayItems = visibleItems.slice(0, 50);
  const counts = countByPriority(visibleItems);

  const handleOpen = (item: ActionItem) => {
    navigateTo(item.targetPage, item.sourceRecordId);
  };

  return (
    <DashboardCard
      title="طابور الإجراءات"
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
      actions={
        <div className="flex items-center gap-1">
          {counts.critical > 0 && (
            <Badge className="text-[9px] px-1.5 py-0 bg-red-500/20 text-red-400 border-red-500/30">{counts.critical} حرج</Badge>
          )}
          {counts.high > 0 && (
            <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">{counts.high} عالي</Badge>
          )}
        </div>
      }
      empty={visibleItems.length === 0 && !loading}
      emptyMessage="لا توجد إجراءات تشغيلية تتطلب اهتمامك حالياً"
      emptyDescription="النظام تحت السيطرة"
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
    >
      <div className="space-y-2 p-1">
        {displayItems.map((item) => {
          const visual = getPriorityVisual(item.priority);
          return (
            <div
              key={item.id}
              className={cn(
                'group flex items-center gap-3 p-3 rounded-xl border transition-all',
                visual.bgTint,
                visual.border,
                visual.glow,
                'hover:scale-[1.01]'
              )}
            >
              {/* Module icon */}
              <div className={cn('p-1.5 rounded-lg bg-slate-700/40 shrink-0', visual.iconColor)}>
                {MODULE_ICON[item.sourceModule] || <AlertCircle className="w-3.5 h-3.5" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-slate-200 truncate font-medium">{item.title}</span>
                  <PriorityBadge level={item.priority} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-slate-400 truncate">{item.reason}</span>
                  {item.employeeName && (
                    <span className="text-[10px] text-slate-500 shrink-0 hidden sm:block">— {item.employeeName}</span>
                  )}
                </div>
                {item.suggestedAction && (
                  <div className="flex items-center gap-1 mt-1">
                    <Lightbulb className="w-3 h-3 text-amber-400/60 shrink-0" />
                    <span className="text-[10px] text-amber-400/80">{item.suggestedAction}</span>
                  </div>
                )}
              </div>

              {/* Due date + Open button */}
              <div className="flex flex-col items-end gap-1.5 shrink-0">
                {item.dueDate && (
                  <span className="text-[10px] text-slate-500" dir="ltr">
                    {new Date(item.dueDate).toLocaleDateString('ar-SA', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                <button
                  onClick={() => handleOpen(item)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-700/50 hover:bg-slate-600/60 text-[10px] text-slate-300 hover:text-white transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  <span>فتح</span>
                </button>
              </div>
            </div>
          );
        })}
        {visibleItems.length > 50 && (
          <div className="text-center py-2">
            <button
              onClick={() => navigateTo('notifications')}
              className="text-[11px] text-sky-400 hover:text-sky-300"
            >
              +{visibleItems.length - 50} إجراءات أخرى — عرض الكل
            </button>
          </div>
        )}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 4: AoccDepartmentHealth — multi-factor health engine
   ═══════════════════════════════════════════════════════════════ */

export const AoccDepartmentHealth = memo(function AoccDepartmentHealth({
  departments,
  loading,
  error,
}: AoccDepartmentHealthProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="صحة الأقسام"
      icon={<HeartPulse className="w-4 h-4" />}
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
          const healthColor = dept.healthScore >= 80 ? 'text-emerald-400' : dept.healthScore >= 60 ? 'text-amber-400' : 'text-red-400';
          const borderColor = dept.healthScore >= 80 ? 'border-emerald-500/20' : dept.healthScore >= 60 ? 'border-amber-500/20' : 'border-red-500/30';
          const hasCritical = dept.criticalCount > 0;

          return (
            <button
              key={dept.name}
              onClick={() => navigateTo('attendance')}
              className={cn(
                'group p-3 rounded-xl border transition-all text-right',
                borderColor,
                hasCritical ? 'bg-red-500/5' : 'bg-slate-700/30 hover:bg-slate-700/50'
              )}
            >
              {/* Header: name + health score */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-200">{dept.name}</span>
                <div className="flex items-center gap-1.5">
                  <TrendIcon trend={dept.trend} />
                  <HealthDot score={dept.healthScore} />
                  <span className={cn('text-sm font-bold tabular-nums', healthColor)}>{dept.healthScore}%</span>
                </div>
              </div>

              {/* Multi-factor stats */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                  <span className="text-[10px] text-slate-400">{dept.present}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5 text-amber-500" />
                  <span className="text-[10px] text-slate-400">{dept.late}</span>
                </div>
                <div className="flex items-center gap-1">
                  <XCircle className="w-2.5 h-2.5 text-red-500" />
                  <span className="text-[10px] text-slate-400">{dept.absent}</span>
                </div>
                {dept.capaCount > 0 && (
                  <div className="flex items-center gap-1">
                    <ClipboardCheck className="w-2.5 h-2.5 text-purple-400" />
                    <span className="text-[10px] text-slate-400">{dept.capaCount}</span>
                  </div>
                )}
                {dept.riskCount > 0 && (
                  <div className="flex items-center gap-1">
                    <ShieldAlert className="w-2.5 h-2.5 text-amber-400" />
                    <span className="text-[10px] text-slate-400">{dept.riskCount}</span>
                  </div>
                )}
                {dept.openActions > 0 && (
                  <div className="flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5 text-red-400" />
                    <span className="text-[10px] text-slate-400">{dept.openActions}</span>
                  </div>
                )}
              </div>

              {/* Warnings */}
              {dept.warnings.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  {dept.warnings.slice(0, 2).map((w, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80">
                      {w}
                    </span>
                  ))}
                </div>
              )}

              {/* Recommended action */}
              {dept.recommendedAction && (
                <div className="flex items-center gap-1 mt-1 pt-1 border-t border-slate-700/30">
                  <Lightbulb className="w-3 h-3 text-amber-400/60 shrink-0" />
                  <span className="text-[10px] text-slate-400">{dept.recommendedAction}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 5: AoccEmployeeWatchlist — cross-module correlation
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

  return (
    <DashboardCard
      title="قائمة المتابعة الذكية"
      icon={<Eye className="w-4 h-4" />}
      iconBg="bg-amber-500/15"
      iconColor="text-amber-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      error={error}
      errorMessage="فشل تحميل قائمة المتابعة"
      badge={employees.length}
      empty={employees.length === 0 && !loading}
      emptyMessage="لا يوجد موظفين بمخاطر عالية"
      emptyDescription="جميع الموظفين ضمن المستويات المقبولة"
      emptyIcon={<ShieldCheck className="w-10 text-emerald-400/40" />}
      onOpenFull={() => useAppStore.getState().navigateTo('riskCenter')}
    >
      <div className="space-y-2 p-1">
        {employees.map((emp) => {
          const riskStyle = RISK_LEVEL_STYLES[emp.riskLevel] || RISK_LEVEL_STYLES.medium;
          const hasCritical = emp.operationalStatus === 'critical';
          return (
            <div
              key={emp.employeeId}
              className={cn(
                'p-3 rounded-xl border transition-colors',
                hasCritical ? 'bg-red-500/5 border-red-500/20' : 'bg-slate-700/30 border-slate-600/15 hover:border-slate-500/20'
              )}
            >
              {/* Header: Employee + risk badge + operational status */}
              <div className="flex items-center justify-between mb-2">
                <EmployeeLink
                  employeeId={emp.employeeId}
                  name={emp.employeeName}
                  department={emp.department}
                  compact
                />
                <div className="flex items-center gap-2">
                  <OperationalStatusBadge status={emp.operationalStatus} />
                  <Badge className={cn('text-[10px] px-2 py-0.5 border', riskStyle.bg, riskStyle.text, 'border-current/20')}>
                    {riskStyle.label}
                  </Badge>
                  <span className={cn('text-sm font-bold tabular-nums', riskStyle.text)}>
                    {emp.riskScore}
                  </span>
                </div>
              </div>

              {/* Cross-module correlation stats */}
              <div className="flex items-center gap-3 mb-2 flex-wrap">
                <span className="text-[10px] text-slate-500">{emp.department} — {emp.position}</span>
                <div className="flex items-center gap-1">
                  <TrendIcon trend={emp.trend} />
                  <span className="text-[10px] text-slate-500">
                    {emp.trend === 'improving' ? 'تحسن' : emp.trend === 'declining' ? 'تدهور' : 'مستقر'}
                  </span>
                </div>
              </div>

              {/* Module impact grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-amber-400/60" />
                  <span className="text-[10px] text-slate-400">حضور: {emp.attendanceIssues}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ClipboardCheck className="w-3 h-3 text-purple-400/60" />
                  <span className="text-[10px] text-slate-400">كابا: {emp.capaCount}{emp.overdueCapaCount > 0 ? ` (${emp.overdueCapaCount} متأخرة)` : ''}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertCircle className="w-3 h-3 text-orange-400/60" />
                  <span className="text-[10px] text-slate-400">شكاوى: {emp.complaints}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-red-400/60" />
                  <span className="text-[10px] text-slate-400">إجراءات: {emp.openActions}</span>
                </div>
              </div>

              {/* Top recommendation */}
              {emp.topRecommendation && (
                <div className="flex items-start gap-1.5 pt-1.5 border-t border-slate-700/30">
                  <Lightbulb className="w-3 h-3 text-amber-400/60 mt-0.5 shrink-0" />
                  <span className="text-[11px] text-slate-400">{emp.topRecommendation}</span>
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
   WIDGET 6: AoccActivityFeed — realtime operational feed
   ═══════════════════════════════════════════════════════════════ */

const FEED_ICON_MAP: Record<string, React.ReactNode> = {
  clock: <Clock className="w-3.5 h-3.5" />,
  fingerprint: <Fingerprint className="w-3.5 h-3.5" />,
  shield: <ShieldCheck className="w-3.5 h-3.5" />,
  alert: <AlertCircle className="w-3.5 h-3.5" />,
  award: <Award className="w-3.5 h-3.5" />,
  banknote: <FileWarning className="w-3.5 h-3.5" />,
  plane: <Plane className="w-3.5 h-3.5" />,
  clipboard: <ClipboardCheck className="w-3.5 h-3.5" />,
  bell: <Bell className="w-3.5 h-3.5" />,
  'shield-alert': <ShieldAlert className="w-3.5 h-3.5" />,
  file: <FileText className="w-3.5 h-3.5" />,
  zap: <Zap className="w-3.5 h-3.5" />,
};

export const AoccActivityFeed = memo(function AoccActivityFeed({
  entries,
  loading,
}: AoccActivityFeedProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="التغذية التشغيلية المباشرة"
      icon={<Activity className="w-4 h-4" />}
      iconBg="bg-violet-500/15"
      iconColor="text-violet-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      badge={entries.length}
      actions={
        <div className="flex items-center gap-1">
          <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span className="text-[9px] text-emerald-400">مباشر</span>
        </div>
      }
      empty={entries.length === 0 && !loading}
      emptyMessage="لا يوجد نشاط حالياً"
      emptyDescription="ستظهر الأحداث هنا فور حدوثها"
    >
      <div className="relative p-1">
        {entries.length > 0 && (
          <div className="absolute right-4 top-3 bottom-3 w-px bg-slate-700/50" />
        )}
        <div className="space-y-2.5">
          {entries.map((entry) => {
            const visual = getPriorityVisual(entry.priority);
            return (
              <button
                key={entry.id}
                onClick={() => navigateTo(entry.targetPage, entry.sourceRecordId)}
                className="group w-full flex items-start gap-3 text-right"
              >
                <div className={cn('relative z-10 p-1.5 rounded-lg bg-slate-800 shrink-0 border border-slate-700/50', entry.colorClass)}>
                  {FEED_ICON_MAP[entry.iconType] || <Bell className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-slate-200 truncate">{entry.title}</span>
                    <span className={cn('text-[10px] shrink-0', visual.accent)} dir="ltr">{entry.timeLabel}</span>
                  </div>
                  {entry.description && (
                    <p className="text-[10px] text-slate-500 truncate mt-0.5">{entry.description}</p>
                  )}
                  {entry.employeeName && (
                    <span className="text-[9px] text-slate-600">{entry.employeeName}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 7: AoccIntelligenceCenter — cross-module recommendations
   ═══════════════════════════════════════════════════════════════ */

const REC_CATEGORY_ICON: Record<string, React.ReactNode> = {
  investigation: <Eye className="w-3.5 h-3.5" />,
  assignment: <Users className="w-3.5 h-3.5" />,
  escalation: <ShieldAlert className="w-3.5 h-3.5" />,
  coaching: <Lightbulb className="w-3.5 h-3.5" />,
  review: <ClipboardCheck className="w-3.5 h-3.5" />,
  correlation: <BrainCircuit className="w-3.5 h-3.5" />,
  sla: <Clock className="w-3.5 h-3.5" />,
};

export const AoccIntelligenceCenter = memo(function AoccIntelligenceCenter({
  recommendations,
  loading,
}: AoccIntelligenceCenterProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="مركز الذكاء التشغيلي"
      icon={<BrainCircuit className="w-4 h-4" />}
      iconBg="bg-cyan-500/15"
      iconColor="text-cyan-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      badge={recommendations.length}
      empty={recommendations.length === 0 && !loading}
      emptyMessage="لا توجد توصيات ذكية حالياً"
      emptyDescription="النظام سيقترح إجراءات عند اكتشاف أنماط"
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
    >
      <div className="space-y-2 p-1">
        {recommendations.map((rec) => {
          const visual = getPriorityVisual(rec.priority);
          return (
            <div
              key={rec.id}
              className={cn(
                'group p-3 rounded-xl border transition-all',
                visual.bgTint,
                visual.border
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn('p-1.5 rounded-lg bg-slate-700/40 shrink-0 mt-0.5', visual.iconColor)}>
                  {REC_CATEGORY_ICON[rec.category] || <Lightbulb className="w-3.5 h-3.5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <PriorityBadge level={rec.priority} />
                    <span className="text-sm text-slate-200">{rec.reason}</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1">{rec.evidence}</p>
                  {rec.affectedEmployeeName && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">الموظف:</span>
                      <span className="text-[10px] text-slate-300">{rec.affectedEmployeeName}</span>
                      {rec.affectedDepartment && (
                        <span className="text-[10px] text-slate-600">— {rec.affectedDepartment}</span>
                      )}
                    </div>
                  )}
                  {rec.affectedDepartment && !rec.affectedEmployeeName && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-500">القسم:</span>
                      <span className="text-[10px] text-slate-300">{rec.affectedDepartment}</span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => navigateTo(rec.targetPage, rec.linkedRecordIds[0])}
                  className={cn(
                    'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors shrink-0',
                    visual.badge,
                    'border hover:opacity-80'
                  )}
                >
                  {rec.actionLabel}
                  <ChevronLeft className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   WIDGET 8: AoccQuickActions — with urgent badges
   ═══════════════════════════════════════════════════════════════ */

export const AoccQuickActions = memo(function AoccQuickActions({ actions }: AoccQuickActionsProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage } = usePermissions();

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
            className="group relative flex flex-col items-center gap-2 p-3 rounded-xl bg-slate-700/30 hover:bg-slate-700/50 border border-slate-600/15 hover:border-slate-500/30 transition-all"
          >
            {action.urgentCount && action.urgentCount > 0 ? (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-[16px] flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-1">
                {action.urgentCount}
              </span>
            ) : null}
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
   WIDGET 9: AoccSystemStatus — with data freshness
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
        {/* Data freshness */}
        {data.lastDataUpdate && (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-emerald-500/15">
                <RefreshCw className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-slate-200">آخر تحديث للبيانات</p>
                <p className="text-[10px] text-slate-500">تحديث تلقائي كل 30 ثانية</p>
              </div>
            </div>
            <span className="text-[11px] text-slate-400">{formatRelativeTime(data.lastDataUpdate)}</span>
          </div>
        )}

        {/* Biometric sync */}
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
                <XCircle className="w-3 h-3 text-red-400" />
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

        {/* Biometric records */}
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
   WIDGET 10: AoccExecutiveSummary — intelligence-driven
   ═══════════════════════════════════════════════════════════════ */

function TrendIndicator({ value, label, invertColor }: { value: number; label: string; invertColor?: boolean }) {
  const isPositive = value >= 0;
  // For delays/deductions, increase is bad → red; for attendance, increase is good → green
  const isGood = invertColor ? !isPositive : isPositive;
  return (
    <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
      {isPositive ? (
        <ArrowUpRight className={cn('w-4 h-4 shrink-0', isGood ? 'text-emerald-400' : 'text-red-400')} />
      ) : (
        <ArrowDownRight className={cn('w-4 h-4 shrink-0', isGood ? 'text-emerald-400' : 'text-red-400')} />
      )}
      <div className="flex-1">
        <p className="text-[10px] text-slate-500">{label}</p>
        <p className={cn('text-sm font-semibold tabular-nums', isGood ? 'text-emerald-400' : 'text-red-400')}>
          {isPositive ? '+' : ''}{value}%
        </p>
      </div>
    </div>
  );
}

export const AoccExecutiveSummary = memo(function AoccExecutiveSummary({
  data,
  loading,
}: AoccExecutiveSummaryProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  return (
    <DashboardCard
      title="الملخص التنفيذي"
      icon={<Target className="w-4 h-4" />}
      iconBg="bg-indigo-500/15"
      iconColor="text-indigo-400"
      borderClr="border-slate-700/50"
      size="large"
      loading={loading}
      footer={
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            مقارنة: {data.lastMonth} ← {data.currentMonth}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">الاتجاه:</span>
            <TrendIcon trend={data.trends.direction} />
            <span className={cn(
              'text-[10px] font-medium',
              data.trends.direction === 'improving' ? 'text-emerald-400' :
              data.trends.direction === 'declining' ? 'text-red-400' : 'text-slate-400'
            )}>
              {data.trends.direction === 'improving' ? 'تحسن' : data.trends.direction === 'declining' ? 'تدهور' : 'مستقر'}
            </span>
          </div>
        </div>
      }
    >
      <div className="space-y-4 p-1">
        {/* ── What happened today? ── */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">أحداث اليوم</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
              <Activity className="w-4 h-4 text-sky-400 shrink-0" />
              <div>
                <p className="text-[9px] text-slate-500">أحداث</p>
                <p className="text-sm font-semibold text-slate-200">{data.todayActionsCount}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-[9px] text-slate-500">محلولة</p>
                <p className="text-sm font-semibold text-slate-200">{data.todayResolvedCount}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-700/30 border border-slate-600/15">
              <Flame className="w-4 h-4 text-red-400 shrink-0" />
              <div>
                <p className="text-[9px] text-slate-500">حرجة</p>
                <p className="text-sm font-semibold text-slate-200">{data.todayEscalatedCount}</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Top 5 priorities ── */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">أولويات تتطلب اهتمام تنفيذي</p>
          <div className="space-y-1.5">
            {data.topPriorities.length === 0 ? (
              <div className="text-center py-3">
                <span className="text-[11px] text-emerald-400/70">✓ لا توجد أولويات حرجة</span>
              </div>
            ) : (
              data.topPriorities.map((item, idx) => {
                const visual = getPriorityVisual(item.priority);
                return (
                  <button
                    key={item.id}
                    onClick={() => navigateTo(item.targetPage, item.sourceRecordId)}
                    className={cn(
                      'w-full flex items-center gap-2 p-2 rounded-lg border transition-colors text-right',
                      visual.bgTint,
                      visual.border
                    )}
                  >
                    <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{idx + 1}.</span>
                    <span className="text-[11px] text-slate-200 truncate flex-1">{item.title}</span>
                    <PriorityBadge level={item.priority} />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── KPI trends ── */}
        <div className="space-y-2">
          <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">تغيرات الشهر</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <TrendIndicator value={data.trends.delaysChange} label="التأخيرات" invertColor />
            <TrendIndicator value={data.trends.attendanceRateChange} label="نسبة الحضور" />
            <TrendIndicator value={data.trends.deductionsChange} label="الخصومات" invertColor />
          </div>
        </div>

        {/* ── Worst department + escalation candidates ── */}
        <div className="space-y-2">
          {data.worstDepartment && (
            <button
              onClick={() => navigateTo('attendance')}
              className="w-full flex items-center gap-2 p-2.5 rounded-xl bg-red-500/5 border border-red-500/20 text-right"
            >
              <TrendingDown className="w-4 h-4 text-red-400 shrink-0" />
              <div className="flex-1">
                <p className="text-[10px] text-slate-500">القسم الأكثر تدهوراً</p>
                <p className="text-sm text-slate-200">{data.worstDepartment.name} — {data.worstDepartment.healthScore}%</p>
              </div>
              <ChevronLeft className="w-3 h-3 text-slate-500" />
            </button>
          )}
          {data.escalationCandidates.length > 0 && (
            <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20">
              <p className="text-[10px] text-slate-500 mb-1.5">يحتاج تصعيد:</p>
              <div className="space-y-1">
                {data.escalationCandidates.map((emp) => (
                  <button
                    key={emp.employeeId}
                    onClick={() => useAppStore.getState().openEmployee360(emp.employeeId)}
                    className="w-full flex items-center justify-between text-right"
                  >
                    <span className="text-[11px] text-slate-300">{emp.employeeName}</span>
                    <span className="text-[10px] text-amber-400">{emp.openActions} إجراءات</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </DashboardCard>
  );
});

/* ═══════════════════════════════════════════════════════════════
   RE-EXPORT DashboardGrid for convenience
   ═══════════════════════════════════════════════════════════════ */
export { DashboardGrid };
