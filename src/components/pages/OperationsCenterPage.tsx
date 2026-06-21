'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { apiFetch } from '@/lib/query-provider';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Monitor,
  ClipboardCheck,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  FileWarning,
  Clock,
  CalendarClock,
  Plane,
  AlertCircle,
  Hourglass,
  TrendingUp,
  ChevronLeft,
  Award,
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════
   ANIMATION VARIANTS
   ═══════════════════════════════════════════════════════════ */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
} as const;

/* ═══════════════════════════════════════════════════════════
   SUB-CARD COMPONENT
   ═══════════════════════════════════════════════════════════ */

function StatCard({
  icon,
  iconBg,
  iconColor,
  value,
  label,
  badge,
  badgeColor,
  onClick,
  children,
  delay = 0,
}: {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  value: number | string;
  label: string;
  badge?: string;
  badgeColor?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.div
      variants={itemVariants}
      custom={delay}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Card
        className={`bg-slate-800/60 border-slate-700/50 hover:border-slate-600/60 
          transition-all duration-200 cursor-pointer ${onClick ? 'group' : ''}`}
        onClick={onClick}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between mb-4">
            <div className={`w-11 h-11 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0 ${iconColor}`}>
              {icon}
            </div>
            {badge && (
              <Badge className={`text-[10px] px-2 py-0.5 ${badgeColor || 'bg-slate-700 text-slate-300'}`}>
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-3xl font-bold text-white mb-1">{value}</p>
          <p className="text-sm text-slate-400">{label}</p>
          {children && <div className="mt-3">{children}</div>}
          {onClick && (
            <div className="flex items-center gap-1 mt-3 text-xs text-slate-500 group-hover:text-slate-300 transition-colors">
              <span>عرض التفاصيل</span>
              <ChevronLeft className="w-3 h-3" />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function OperationsCenterPage() {
  const { canView } = usePermissions('operationsCenter');
  const navigateTo = useAppStore((s) => s.navigateTo);

  // ── Queries ──

  // 1. Overdue follow-ups
  const overdueFollowUpsQuery = useQuery({
    queryKey: ['opsCenter', 'followUps', 'overdue'],
    queryFn: () => apiFetch<any>('/api/follow-ups?status=overdue'),
    staleTime: 15_000,
  });

  // 2. All open follow-ups for total
  const openFollowUpsQuery = useQuery({
    queryKey: ['opsCenter', 'followUps', 'open'],
    queryFn: () => apiFetch<any>('/api/follow-ups?status=open'),
    staleTime: 15_000,
  });

  // 3. Critical complaints (for red risks)
  const criticalComplaintsQuery = useQuery({
    queryKey: ['opsCenter', 'complaints', 'critical'],
    queryFn: () => apiFetch<any>('/api/complaints?status=open&severity=critical'),
    staleTime: 15_000,
  });

  // 4. High complaints (for yellow risks)
  const highComplaintsQuery = useQuery({
    queryKey: ['opsCenter', 'complaints', 'high'],
    queryFn: () => apiFetch<any>('/api/complaints?status=open&severity=high'),
    staleTime: 15_000,
  });

  // 5. Overdue follow-ups for red risk count (reuse overdueFollowUpsQuery)

  // 6. Critical CAPA
  const criticalCAPAQuery = useQuery({
    queryKey: ['opsCenter', 'capa', 'critical'],
    queryFn: () => apiFetch<any>('/api/capa-cases?status=open&priority=critical'),
    staleTime: 15_000,
  });

  // 7. High CAPA
  const highCAPAQuery = useQuery({
    queryKey: ['opsCenter', 'capa', 'high'],
    queryFn: () => apiFetch<any>('/api/capa-cases?status=open&priority=high'),
    staleTime: 15_000,
  });

  // 8. All open CAPA
  const openCAPAQuery = useQuery({
    queryKey: ['opsCenter', 'capa', 'open'],
    queryFn: () => apiFetch<any>('/api/capa-cases?status=open'),
    staleTime: 15_000,
  });

  // 9. Quality deductions (today)
  const qualityQuery = useQuery({
    queryKey: ['opsCenter', 'quality'],
    queryFn: () => apiFetch<any[]>('/api/quality'),
    staleTime: 15_000,
  });

  // 10. HR deductions (today)
  const hrDeductionsQuery = useQuery({
    queryKey: ['opsCenter', 'hrDeductions'],
    queryFn: () => apiFetch<any[]>('/api/hr-deductions'),
    staleTime: 15_000,
  });

  // 11. Pending requests
  const pendingRequestsQuery = useQuery({
    queryKey: ['opsCenter', 'requests', 'pending'],
    queryFn: () => apiFetch<any>('/api/requests'),
    staleTime: 15_000,
  });

  // 12. Travel in progress
  const travelQuery = useQuery({
    queryKey: ['opsCenter', 'travel', 'in_progress'],
    queryFn: () => apiFetch<any>('/api/travel?tab=in_progress'),
    staleTime: 15_000,
  });

  const isLoading =
    overdueFollowUpsQuery.isLoading ||
    openFollowUpsQuery.isLoading ||
    criticalComplaintsQuery.isLoading ||
    highComplaintsQuery.isLoading ||
    criticalCAPAQuery.isLoading ||
    highCAPAQuery.isLoading ||
    openCAPAQuery.isLoading ||
    qualityQuery.isLoading ||
    hrDeductionsQuery.isLoading ||
    pendingRequestsQuery.isLoading ||
    travelQuery.isLoading;

  // ── Computed data ──
  const unwrap = (d: any): any[] => {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (d.data && Array.isArray(d.data)) return d.data;
    return [];
  };

  const overdueFollowUps = unwrap(overdueFollowUpsQuery.data);
  const openFollowUps = unwrap(openFollowUpsQuery.data);
  const criticalComplaints = unwrap(criticalComplaintsQuery.data);
  const highComplaints = unwrap(highComplaintsQuery.data);
  const criticalCAPA = unwrap(criticalCAPAQuery.data);
  const highCAPA = unwrap(highCAPAQuery.data);
  const allOpenCAPA = unwrap(openCAPAQuery.data);
  const qualityDeductions = unwrap(qualityQuery.data);
  const hrDeductions = unwrap(hrDeductionsQuery.data);
  const allRequests = unwrap(pendingRequestsQuery.data);
  const travelData = travelQuery.data;
  const travelDeals = Array.isArray(travelData?.data) ? travelData.data : Array.isArray(travelData) ? travelData : [];
  const urgentTrips = travelData?.urgentTrips || [];

  const data = useMemo(() => {

    // 1. Follow-ups requiring attention (overdue count)
    const overdueCount = overdueFollowUps.length;
    const openCount = openFollowUps.length;

    // 2. Open risks
    const redRisks = criticalComplaints.length + overdueFollowUps.length + criticalCAPA.length;
    const yellowRisks = highComplaints.length + highCAPA.length;

    // 3. Open CAPA
    const capaTotal = allOpenCAPA.length;
    const capaCritical = criticalCAPA.length;
    const capaHigh = highCAPA.length;
    const capaMedium = allOpenCAPA.filter(
      (c: any) => c.priority !== 'critical' && c.priority !== 'high'
    ).length;

    // 4. Today's violations
    const today = new Date().toISOString().split('T')[0];
    const todayQuality = qualityDeductions.filter(
      (d: any) => (d.createdAt || d.date || '').startsWith(today)
    ).length;
    const todayHR = hrDeductions.filter(
      (d: any) => (d.createdAt || d.date || '').startsWith(today)
    ).length;
    const todayViolations = todayQuality + todayHR;

    // 5. Pending requests
    const pendingCount = allRequests.filter(
      (r: any) => r.status === 'pending' || r.status === 'معلق'
    ).length;

    // 6. Critical deals
    const criticalDeals = urgentTrips.length > 0 ? urgentTrips : travelDeals.filter(
      (t: any) => t.urgent || t.priority === 'critical' || t.priority === 'عاجل'
    ).length;

    return {
      overdueCount,
      openCount,
      overdueFollowUpItems: overdueFollowUps.slice(0, 5).map((f: any) => ({
        id: f.id,
        title: f.title || f.subject || 'متابعة متأخرة',
        dueDate: f.dueDate || f.createdAt || '',
        employeeName: f.employeeName || f.employee?.name || '',
      })),
      redRisks,
      yellowRisks,
      greenRisks: redRisks === 0 && yellowRisks === 0 ? 1 : 0,
      capaTotal,
      capaCritical,
      capaHigh,
      capaMedium,
      capaItems: allOpenCAPA.slice(0, 4).map((c: any) => ({
        id: c.id,
        title: c.title || c.subject || 'قضية كابا',
        priority: c.priority || 'medium',
        source: c.source || '',
      })),
      todayViolations,
      todayQuality,
      todayHR,
      pendingCount,
      criticalDeals: Array.isArray(criticalDeals) ? criticalDeals.length : criticalDeals,
      inProgressDeals: travelDeals.length,
    };
  }, [
    overdueFollowUps,
    openFollowUps,
    criticalComplaints,
    highComplaints,
    criticalCAPA,
    highCAPA,
    allOpenCAPA,
    qualityDeductions,
    hrDeductions,
    allRequests,
    travelDeals,
    urgentTrips,
  ]);

  // ── Permission guard ──
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Card className="bg-slate-800/50 border-slate-700 p-8 text-center">
          <ShieldAlert className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-400 text-lg">ليس لديك صلاحية الوصول إلى مركز العمليات</p>
        </Card>
      </div>
    );
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'text-red-400';
      case 'high': return 'text-amber-400';
      case 'medium': return 'text-blue-400';
      case 'low': return 'text-violet-400';
      default: return 'text-slate-400';
    }
  };

  const getPriorityLabel = (priority: string) => {
    switch (priority) {
      case 'critical': return 'حرج';
      case 'high': return 'عالي';
      case 'medium': return 'متوسط';
      case 'low': return 'منخفض';
      default: return priority;
    }
  };

  /* ═══════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════ */

  return (
    <motion.div
      className="space-y-6 p-4 md:p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* ── Header ── */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-3 mb-1">
          <Monitor className="w-7 h-7 text-sky-400" />
          <h1 className="text-2xl md:text-3xl font-bold text-white">مركز العمليات</h1>
        </div>
        <p className="text-slate-400 text-sm mr-10">لوحة تحكم المدير التنفيذي</p>
      </motion.div>

      {/* ── Loading state ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="bg-slate-800/60 border-slate-700/50">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between">
                  <Skeleton className="h-11 w-11 rounded-xl bg-slate-700" />
                  <Skeleton className="h-5 w-12 rounded-full bg-slate-700" />
                </div>
                <Skeleton className="h-9 w-16 bg-slate-700" />
                <Skeleton className="h-4 w-32 bg-slate-700" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <>
          {/* ── Stat Cards Grid (2×3) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* 1. Follow-ups requiring attention */}
            <StatCard
              icon={<Clock className="w-5 h-5" />}
              iconBg="bg-red-500/15"
              iconColor="text-red-400"
              value={data.overdueCount}
              label="المتابعات المستحقة"
              badge={data.openCount > 0 ? `${data.openCount} مفتوحة` : undefined}
              badgeColor={data.openCount > 0 ? 'bg-slate-700 text-slate-300' : undefined}
              onClick={() => navigateTo('followUps')}
            >
              {data.overdueFollowUpItems.length > 0 && (
                <ScrollArea className="max-h-28">
                  <div className="space-y-1.5 pr-1">
                    {data.overdueFollowUpItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md bg-slate-700/40 hover:bg-slate-700/60 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                          <span className="text-slate-300 truncate">{item.title}</span>
                        </div>
                        {item.dueDate && (
                          <span className="text-slate-500 flex-shrink-0 mr-2 text-[10px]">
                            {new Date(item.dueDate).toLocaleDateString('ar-SA', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </StatCard>

            {/* 2. Open Risks */}
            <StatCard
              icon={<AlertTriangle className="w-5 h-5" />}
              iconBg="bg-amber-500/15"
              iconColor="text-amber-400"
              value={data.redRisks + data.yellowRisks}
              label="المخاطر المفتوحة"
              badge={data.redRisks > 0 ? 'يوجد حرج' : undefined}
              badgeColor={data.redRisks > 0 ? 'bg-red-500/20 text-red-400 border-red-500/30' : undefined}
              onClick={() => navigateTo('riskCenter')}
            >
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs text-slate-400">{data.redRisks} حرج</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs text-slate-400">{data.yellowRisks} متابعة</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs text-slate-400">{data.greenRisks} طبيعي</span>
                </div>
              </div>
            </StatCard>

            {/* 3. Open CAPA */}
            <StatCard
              icon={<ClipboardCheck className="w-5 h-5" />}
              iconBg="bg-purple-500/15"
              iconColor="text-purple-400"
              value={data.capaTotal}
              label="قضايا كابا مفتوحة"
              badge={data.capaCritical > 0 ? `${data.capaCritical} حرج` : undefined}
              badgeColor={data.capaCritical > 0 ? 'bg-red-500/20 text-red-400 border-red-500/30' : undefined}
              onClick={() => navigateTo('capa')}
            >
              <div className="flex items-center gap-3 mt-1">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-xs text-slate-400">{data.capaCritical} حرج</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs text-slate-400">{data.capaHigh} عالي</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs text-slate-400">{data.capaMedium} متوسط</span>
                </div>
              </div>
              {data.capaItems.length > 0 && (
                <ScrollArea className="max-h-24 mt-2">
                  <div className="space-y-1 pr-1">
                    {data.capaItems.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between text-xs py-1.5 px-2 rounded-md bg-slate-700/40 hover:bg-slate-700/60 transition-colors"
                      >
                        <span className="text-slate-300 truncate">{item.title}</span>
                        <span className={`text-[10px] font-medium flex-shrink-0 mr-2 ${getPriorityColor(item.priority)}`}>
                          {getPriorityLabel(item.priority)}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </StatCard>

            {/* 4. New Violations */}
            <StatCard
              icon={<FileWarning className="w-5 h-5" />}
              iconBg="bg-orange-500/15"
              iconColor="text-orange-400"
              value={data.todayViolations}
              label="انتهاكات جديدة"
              badge="اليوم"
              badgeColor="bg-slate-700 text-slate-300"
              onClick={() => navigateTo('quality')}
            >
              <div className="flex items-center gap-4 mt-1">
                <div className="flex items-center gap-1.5">
                  <Award className="w-3 h-3 text-orange-400" />
                  <span className="text-xs text-slate-400">جودة: {data.todayQuality}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="w-3 h-3 text-orange-400" />
                  <span className="text-xs text-slate-400">موارد بشرية: {data.todayHR}</span>
                </div>
              </div>
            </StatCard>

            {/* 5. Pending Requests */}
            <StatCard
              icon={<Hourglass className="w-5 h-5" />}
              iconBg="bg-sky-500/15"
              iconColor="text-sky-400"
              value={data.pendingCount}
              label="طلبات معلقة"
              badge={data.pendingCount > 0 ? 'تتطلب مراجعة' : undefined}
              badgeColor={data.pendingCount > 0 ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : undefined}
              onClick={() => navigateTo('requests')}
            >
              <div className="flex items-center gap-2 mt-1">
                <CalendarClock className="w-3 h-3 text-slate-500" />
                <span className="text-xs text-slate-400">
                  {data.pendingCount > 0
                    ? 'توجد طلبات بانتظار الموافقة'
                    : 'لا توجد طلبات معلقة'}
                </span>
              </div>
            </StatCard>

            {/* 6. Critical Deals */}
            <StatCard
              icon={<Plane className="w-5 h-5" />}
              iconBg="bg-rose-500/15"
              iconColor="text-rose-400"
              value={data.criticalDeals}
              label="صفقات حرجة"
              badge={data.inProgressDeals > 0 ? `${data.inProgressDeals} قيد التنفيذ` : undefined}
              badgeColor="bg-slate-700 text-slate-300"
              onClick={() => navigateTo('travel')}
            >
              <div className="flex items-center gap-2 mt-1">
                <Plane className="w-3 h-3 text-slate-500" />
                <span className="text-xs text-slate-400">
                  {data.criticalDeals > 0
                    ? 'توجد صفقات تتطلب اهتمام عاجل'
                    : 'لا توجد صفقات حرجة حالياً'}
                </span>
              </div>
            </StatCard>
          </div>
        </>
      )}
    </motion.div>
  );
}

