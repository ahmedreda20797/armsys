'use client';

import { useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useHomeStats,
  useCAPACases,
  useComplaints,
  useFollowUps,
} from '@/hooks/use-queries';
import { useRiskCenter, useNotificationStats, useOnlineUsers } from '@/hooks/use-aocc';
import { useNotificationContext } from '@/contexts/NotificationContext';
import { usePermissions } from '@/hooks/usePermissions';
import { DashboardGrid } from '@/components/dashboard/DashboardCard';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AoccMissionHeader,
  AoccGlobalHealth,
  AoccCriticalActionQueue,
  AoccDepartmentStatus,
  AoccEmployeeWatchlist,
  AoccTimeline,
  AoccSmartRecommendations,
  AoccQuickActions,
  AoccSystemStatus,
  AoccExecutiveSummary,
} from '@/components/aocc/AoccWidgets';
import type {
  ActionQueueItem,
  TimelineEvent,
  Recommendation,
  QuickAction,
  DepartmentStatItem,
} from '@/components/aocc/AoccWidgets';
import {
  ShieldAlert,
  Clock,
  ClipboardCheck,
  AlertCircle,
  Plane,
  CheckCircle2,
  Fingerprint,
  Plus,
  FileText,
  Bell,
  Zap,
} from 'lucide-react';


/* ═══════════════════════════════════════════════════════════════
   HELPERS — defensive unwrapping of API responses
   ═══════════════════════════════════════════════════════════════ */

function unwrapArray(d: any): any[] {
  if (!d) return [];
  if (Array.isArray(d)) return d;
  if (d.data && Array.isArray(d.data)) return d.data;
  if (d.items && Array.isArray(d.items)) return d.items;
  return [];
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function isToday(dateStr?: string | null): boolean {
  if (!dateStr) return false;
  return dateStr.startsWith(todayStr());
}

function daysUntil(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const target = new Date(dateStr).getTime();
  if (isNaN(target)) return null;
  const now = new Date(todayStr()).getTime();
  return Math.floor((target - now) / (24 * 60 * 60 * 1000));
}

function calcHealthScore(present: number, late: number, absent: number, total: number): number {
  if (total === 0) return 100;
  const score = ((present + late * 0.5) / total) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/* ═══════════════════════════════════════════════════════════════
   FULL-PAGE LOADING SKELETON
   ═══════════════════════════════════════════════════════════════ */

function AoccSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header skeleton */}
      <Skeleton className="h-20 w-full rounded-2xl bg-slate-800/60" />
      {/* KPI grid skeleton */}
      <Skeleton className="h-48 w-full rounded-2xl bg-slate-800/40" />
      {/* Two-column skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-96 rounded-2xl bg-slate-800/40" />
        <Skeleton className="h-96 rounded-2xl bg-slate-800/40" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-80 rounded-2xl bg-slate-800/40" />
        <Skeleton className="h-80 rounded-2xl bg-slate-800/40" />
        <Skeleton className="h-80 rounded-2xl bg-slate-800/40" />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN AOCC LAYOUT COMPONENT
   Owns all data fetching → passes derived data down as props
   ═══════════════════════════════════════════════════════════════ */

export default function AoccLayout() {
  const { canView } = usePermissions('operationsCenter');
  const queryClient = useQueryClient();
  const { unreadCount, notifications } = useNotificationContext();

  // ── Data Queries (all hooks run unconditionally before any early return) ──
  const homeStats = useHomeStats();
  const capaQuery = useCAPACases({ status: 'open', pageSize: 100 });
  const complaintsQuery = useComplaints({ status: 'open', pageSize: 100 });
  const followUpsQuery = useFollowUps({ status: 'open', pageSize: 100 });
  const riskCenterQuery = useRiskCenter();
  const notifStatsQuery = useNotificationStats();
  const onlineUsersQuery = useOnlineUsers(2);

  // ── Refresh handler — invalidate all AOCC queries ──
  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home'] });
    queryClient.invalidateQueries({ queryKey: ['capaCases'] });
    queryClient.invalidateQueries({ queryKey: ['complaints'] });
    queryClient.invalidateQueries({ queryKey: ['followUps'] });
    queryClient.invalidateQueries({ queryKey: ['riskCenter'] });
    queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    queryClient.invalidateQueries({ queryKey: ['activity-logs'] });
  }, [queryClient]);

  // ── Extract raw data (null-safe) ──
  const stats = homeStats.data || {};
  const capaItems = unwrapArray(capaQuery.data);
  const complaintItems = unwrapArray(complaintsQuery.data);
  const followUpItems = unwrapArray(followUpsQuery.data);
  const riskEmployees = riskCenterQuery.data?.employees || [];
  const notifStats = notifStatsQuery.data;
  const onlineUsers = onlineUsersQuery.data;

  // ═══════════════════════════════════════════════════════════════
  //  DERIVED DATA — memoized aggregations
  // ═══════════════════════════════════════════════════════════════

  // ── Global Health KPIs ──
  const globalHealthKPIs = useMemo(() => {
    const todayQuality = (stats.qualitySummary?.totalCases || 0); // fallback — quality today not in home stats
    const criticalCAPA = capaItems.filter((c: any) => c.priority === 'critical').length;
    const criticalComplaints = complaintItems.filter((c: any) => c.severity === 'critical').length;
    const overdueFollowUps = followUpItems.filter((f: any) =>
      f.status === 'overdue' ||
      (f.nextFollowUpDate && new Date(f.nextFollowUpDate) < new Date() && f.status !== 'resolved' && f.status !== 'closed')
    ).length;

    return {
      presentCount: stats.presentCount || 0,
      lateCount: stats.lateCount || 0,
      absentCount: stats.absentCount || 0,
      openCAPACount: capaItems.length,
      criticalCAPACount: criticalCAPA,
      openComplaintsCount: complaintItems.length,
      criticalComplaintsCount: criticalComplaints,
      openFollowUpsCount: followUpItems.length,
      overdueFollowUpsCount: overdueFollowUps,
      pendingRequestsCount: stats.pendingRequests || 0,
      riskCount: riskCenterQuery.data?.summary?.immediateActionCount || 0,
      qualityViolationsToday: todayQuality,
      unreadNotifications: notifStats?.unread ?? unreadCount,
    };
  }, [stats, capaItems, complaintItems, followUpItems, riskCenterQuery.data, notifStats, unreadCount]);

  // ── Critical Action Queue (unified priority queue) ──
  const actionQueueItems = useMemo<ActionQueueItem[]>(() => {
    const items: ActionQueueItem[] = [];

    // Overdue follow-ups
    followUpItems.forEach((f: any) => {
      const isOverdue = f.status === 'overdue' ||
        (f.nextFollowUpDate && new Date(f.nextFollowUpDate) < new Date() && f.status !== 'resolved' && f.status !== 'closed');
      if (isOverdue) {
        items.push({
          id: f.id,
          title: f.subject || f.title || 'متابعة متأخرة',
          type: 'follow-up',
          priority: (f.priorityLevel === 'critical' || f.priorityLevel === 'high') ? f.priorityLevel : 'high',
          dueDate: f.nextFollowUpDate || f.date,
          employeeName: f.employeeName,
          employeeId: f.employeeId,
          status: f.status,
          sourcePage: 'followUps',
        });
      }
    });

    // Critical/high CAPA
    capaItems.forEach((c: any) => {
      if (c.priority === 'critical' || c.priority === 'high') {
        items.push({
          id: c.id,
          title: c.title || 'قضية كابا',
          type: 'capa',
          priority: c.priority,
          dueDate: c.correctiveDueDate || c.createdAt,
          employeeName: c.employeeName,
          employeeId: c.employeeId,
          status: c.status,
          sourcePage: 'capa',
        });
      }
    });

    // Critical complaints
    complaintItems.forEach((c: any) => {
      if (c.severity === 'critical') {
        items.push({
          id: c.id,
          title: c.customerName ? `شكوى: ${c.customerName}` : 'شكوى حرجة',
          type: 'complaint',
          priority: 'critical',
          dueDate: c.createdAt,
          employeeName: c.employeeName,
          employeeId: c.employeeId,
          status: c.status,
          sourcePage: 'complaints',
        });
      }
    });

    // Urgent travel (≤2 days)
    const upcomingTrips = stats.upcomingTravel || [];
    upcomingTrips.forEach((t: any) => {
      const days = daysUntil(t.departureDate);
      if (days !== null && days >= 0 && days <= 2) {
        items.push({
          id: t.id,
          title: `سفر: ${t.destination || 'وجهة غير محددة'}`,
          type: 'travel',
          priority: days <= 1 ? 'critical' : 'high',
          dueDate: t.departureDate,
          employeeName: t.employeeName,
          status: t.status,
          sourcePage: 'travel',
        });
      }
    });

    // Priority sort: critical → high → medium → low
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    items.sort((a, b) => (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4));

    return items;
  }, [followUpItems, capaItems, complaintItems, stats.upcomingTravel]);

  // ── Department Status ──
  const departmentStats = useMemo<DepartmentStatItem[]>(() => {
    const deptToday = stats.deptTodayStats || [];
    return deptToday.map((d: any) => ({
      name: d.name || d.department || 'غير محدد',
      present: d.present || 0,
      late: d.late || 0,
      absent: d.absent || 0,
      total: d.total || (d.present || 0) + (d.late || 0) + (d.absent || 0),
      healthScore: calcHealthScore(d.present || 0, d.late || 0, d.absent || 0, d.total || 1),
    }));
  }, [stats.deptTodayStats]);

  // ── Watchlist employees (high/critical risk) ──
  const watchlistEmployees = useMemo(() => {
    return riskEmployees
      .filter((e) => e.riskLevel === 'high' || e.riskLevel === 'critical')
      .slice(0, 8)
      .map((e) => ({
        employeeId: e.employeeId,
        employeeName: e.employeeName,
        department: e.department,
        position: e.position,
        riskScore: e.riskScore,
        riskLevel: e.riskLevel,
        trend: e.trend,
        openCases: e.openCases,
        recommendations: e.recommendations || [],
      }));
  }, [riskEmployees]);

  // ── Timeline events (today) ──
  const timelineEvents = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    // Follow-ups due today
    (stats.todaysFollowUps || []).forEach((f: any) => {
      events.push({
        id: `fu-${f.id}`,
        title: f.subject || 'متابعة',
        time: f.nextFollowUpDate ? new Date(f.nextFollowUpDate).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '--:--',
        type: 'follow-up',
        status: f.status || 'مجدول',
        icon: <Clock className="w-3.5 h-3.5" />,
        colorClass: 'text-rose-400',
        sourcePage: 'followUps',
        sourceId: f.id,
      });
    });

    // Travel departing today
    (stats.upcomingTravel || []).forEach((t: any) => {
      if (isToday(t.departureDate)) {
        events.push({
          id: `tr-${t.id}`,
          title: `سفر: ${t.destination || ''}`,
          time: new Date(t.departureDate).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
          type: 'travel',
          status: t.status || 'قادم',
          icon: <Plane className="w-3.5 h-3.5" />,
          colorClass: 'text-sky-400',
          sourcePage: 'travel',
          sourceId: t.id,
        });
      }
    });

    // CAPA due today
    capaItems.forEach((c: any) => {
      if (isToday(c.correctiveDueDate) || isToday(c.preventiveDueDate)) {
        events.push({
          id: `ca-${c.id}`,
          title: c.title || 'كابا',
          time: new Date(c.correctiveDueDate || c.preventiveDueDate).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }),
          type: 'capa',
          status: c.status || 'مفتوح',
          icon: <ClipboardCheck className="w-3.5 h-3.5" />,
          colorClass: 'text-purple-400',
          sourcePage: 'capa',
          sourceId: c.id,
        });
      }
    });

    // Sort by time
    events.sort((a, b) => a.time.localeCompare(b.time));
    return events;
  }, [stats.todaysFollowUps, stats.upcomingTravel, capaItems]);

  // ── Smart Recommendations ──
  const recommendations = useMemo<Recommendation[]>(() => {
    const recs: Recommendation[] = [];

    // From risk center
    riskEmployees.forEach((emp) => {
      (emp.recommendations || []).slice(0, 2).forEach((rec, i) => {
        recs.push({
          id: `risk-${emp.employeeId}-${i}`,
          title: `${emp.employeeName}: توصية مخاطر`,
          description: rec,
          category: 'risk',
          severity: emp.riskLevel === 'critical' ? 'critical' : emp.riskLevel === 'high' ? 'high' : 'medium',
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          relatedPage: 'riskCenter',
          relatedId: emp.employeeId,
        });
      });
    });

    // Overdue CAPA pattern
    const overdueCAPA = capaItems.filter((c: any) => c.overdueDays > 0);
    if (overdueCAPA.length > 0) {
      recs.push({
        id: 'capa-overdue-pattern',
        title: `${overdueCAPA.length} قضايا كابا متأخرة`,
        description: `يوجد ${overdueCAPA.length} قضايا كابا متجاوزة موعد الاستحقاق. يُنصح بمراجعتها وتسريع الإجراءات التصحيحية.`,
        category: 'capa',
        severity: overdueCAPA.length > 5 ? 'critical' : 'high',
        relatedPage: 'capa',
      });
    }

    // Complaint pattern (multiple complaints from same area)
    if (complaintItems.length > 5) {
      recs.push({
        id: 'complaint-pattern',
        title: 'نمط شكاوى متكرر',
        description: `يوجد ${complaintItems.length} شكوى مفتوحة. قد يشير ذلك إلى مشكلة منهجية تتطلب مراجعة العمليات.`,
        category: 'pattern',
        severity: 'high',
        relatedPage: 'complaints',
      });
    }

    return recs.sort((a, b) => {
      const order: Record<string, number> = { critical: 0, high: 1, medium: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    }).slice(0, 12);
  }, [riskEmployees, capaItems, complaintItems]);

  // ── Quick Actions ──
  const quickActions = useMemo<QuickAction[]>(() => {
    return [
      { id: 'approve-requests', label: 'اعتماد الطلبات', icon: <CheckCircle2 className="w-5 h-5" />, targetPage: 'requests', colorClass: 'text-sky-400' },
      { id: 'review-capa', label: 'مراجعة كابا', icon: <ClipboardCheck className="w-5 h-5" />, targetPage: 'capa', colorClass: 'text-purple-400' },
      { id: 'sync-biometric', label: 'مزامنة البصمة', icon: <Fingerprint className="w-5 h-5" />, targetPage: 'biometric', colorClass: 'text-violet-400' },
      { id: 'create-followup', label: 'متابعة جديدة', icon: <Plus className="w-5 h-5" />, targetPage: 'followUps', colorClass: 'text-rose-400' },
      { id: 'review-complaints', label: 'مراجعة الشكاوى', icon: <AlertCircle className="w-5 h-5" />, targetPage: 'complaints', colorClass: 'text-orange-400' },
      { id: 'view-reports', label: 'التقارير', icon: <FileText className="w-5 h-5" />, targetPage: 'reports', colorClass: 'text-emerald-400' },
      { id: 'notifications', label: 'الإشعارات', icon: <Bell className="w-5 h-5" />, targetPage: 'notifications', colorClass: 'text-amber-400' },
      { id: 'rules-engine', label: 'الأتمتة', icon: <Zap className="w-5 h-5" />, targetPage: 'rulesEngine', colorClass: 'text-yellow-400' },
    ];
  }, []);

  // ── System Status data ──
  const systemStatusData = useMemo(() => {
    // Calculate notification breakdown from context notifications
    const unread = notifications.filter((n) => n.status === 'unread');
    const breakdown = {
      critical: unread.filter((n) => n.priority === 'critical').length,
      high: unread.filter((n) => n.priority === 'high').length,
      medium: unread.filter((n) => n.priority === 'medium').length,
      low: unread.filter((n) => n.priority === 'low').length,
    };
    return {
      biometricLastSync: stats.biometricLastSync,
      biometricRecordCount: stats.biometricRecordCount || 0,
      onlineUsers: onlineUsers ? onlineUsers.map((u) => ({
        userId: u.userId,
        userName: u.userName,
        lastActivity: u.lastActivity,
        currentPage: u.currentPage,
        status: u.status,
        durationLabel: u.durationLabel,
      })) : null,
      unreadBreakdown: breakdown,
    };
  }, [stats, onlineUsers, notifications]);

  // ── Executive Summary data ──
  const executiveData = useMemo(() => {
    const curr = stats.currentMonthPerformance || {};
    const last = stats.lastMonthPerformance || {};

    const calcChange = (current: number, previous: number): number => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return {
      currentMonth: curr.monthLabel || 'هذا الشهر',
      lastMonth: last.monthLabel || 'الشهر السابق',
      delaysChange: calcChange(curr.totalDelays || 0, last.totalDelays || 0),
      deductionsChange: calcChange(curr.totalDeductionAmount || 0, last.totalDeductionAmount || 0),
      attendanceRateChange: calcChange(curr.totalPresent || 0, last.totalPresent || 0),
      totalPresent: curr.totalPresent || stats.presentCount || 0,
      totalAbsent: curr.totalAbsent || stats.absentCount || 0,
      totalDeductions: curr.totalDeductionAmount || 0,
      openCAPACount: capaItems.length,
      openComplaintsCount: complaintItems.length,
      pendingRequestsCount: stats.pendingRequests || 0,
    };
  }, [stats, capaItems, complaintItems]);

  /* ═══════════════════════════════════════════════════════════════
     EARLY RETURNS — only after all hooks have run
     ═══════════════════════════════════════════════════════════════ */

  // ── Permission guard ──
  if (!canView) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="bg-slate-800/50 border border-slate-700 p-8 text-center rounded-2xl">
          <ShieldAlert className="w-12 h-12 text-slate-500 mx-auto mb-3" />
          <p className="text-slate-400 text-lg">ليس لديك صلاحية الوصول إلى مركز العمليات</p>
        </div>
      </div>
    );
  }

  // ── Global loading — show skeleton while home stats loads ──
  if (homeStats.isLoading) {
    return <AoccSkeleton />;
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER — compose all 10 widgets
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* ── Section 1: Mission Header ── */}
      <AoccMissionHeader
        unreadCount={unreadCount}
        lastSync={stats.biometricLastSync || new Date().toISOString()}
        onRefresh={handleRefresh}
      />

      {/* ── Section 2: Global Health (full width) ── */}
      <AoccGlobalHealth kpis={globalHealthKPIs} />

      {/* ── Section 3 + 4: Critical Queue + Department Status ── */}
      <DashboardGrid columns={2} gap="gap-6">
        <AoccCriticalActionQueue
          items={actionQueueItems}
          loading={followUpsQuery.isLoading || capaQuery.isLoading || complaintsQuery.isLoading}
          error={followUpsQuery.isError || capaQuery.isError || complaintsQuery.isError}
          onRetry={handleRefresh}
        />
        <AoccDepartmentStatus
          departments={departmentStats}
          loading={homeStats.isLoading}
          error={homeStats.isError}
        />
      </DashboardGrid>

      {/* ── Section 5 + 6: Watchlist + Timeline ── */}
      <DashboardGrid columns={2} gap="gap-6">
        <AoccEmployeeWatchlist
          employees={watchlistEmployees}
          loading={riskCenterQuery.isLoading}
          error={riskCenterQuery.isError}
        />
        <AoccTimeline events={timelineEvents} loading={homeStats.isLoading} />
      </DashboardGrid>

      {/* ── Section 7 + 8: Recommendations + Quick Actions ── */}
      <DashboardGrid columns={2} gap="gap-6">
        <AoccSmartRecommendations
          recommendations={recommendations}
          loading={riskCenterQuery.isLoading || capaQuery.isLoading}
        />
        <AoccQuickActions actions={quickActions} />
      </DashboardGrid>

      {/* ── Section 9 + 10: System Status + Executive Summary ── */}
      <DashboardGrid columns={2} gap="gap-6">
        <AoccSystemStatus
          data={systemStatusData}
          loading={homeStats.isLoading || notifStatsQuery.isLoading}
        />
        <AoccExecutiveSummary data={executiveData} loading={homeStats.isLoading} />
      </DashboardGrid>
    </div>
  );
}
