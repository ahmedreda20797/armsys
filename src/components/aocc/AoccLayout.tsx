'use client';

import { useMemo, useCallback, useState } from 'react';
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
  AoccOperationalOverview,
  AoccActionQueue,
  AoccDepartmentHealth,
  AoccEmployeeWatchlist,
  AoccActivityFeed,
  AoccIntelligenceCenter,
  AoccQuickActions,
  AoccSystemStatus,
  AoccExecutiveSummary,
} from '@/components/aocc/AoccWidgets';
import { DecisionCenterLayout } from '@/components/aocc/decisions/DecisionCenterLayout';
import { useDecisions } from '@/hooks/use-decisions';
import {
  collectEvents,
  generateActions,
  correlateAllEmployees,
  analyzeAllDepartments,
  generateRecommendations,
  buildActivityFeed,
  generateExecutiveIntelligence,
} from '@/lib/aocc/event-collector';
import { countByPriority } from '@/lib/aocc/priority-engine';
import type { RawDataBundle, ActivityFeedEntry } from '@/lib/aocc/types';
import { apiFetch } from '@/lib/query-provider';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert,
  CheckCircle2,
  Fingerprint,
  Plus,
  FileText,
  Bell,
  Zap,
  Clock,
  ClipboardCheck,
  AlertCircle,
  BrainCircuit,
  Monitor,
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

/* ═══════════════════════════════════════════════════════════════
   ACTIVITY LOGS HOOK (admin-gated)
   Fetches today's activity logs for the realtime feed.
   Non-admin users will get undefined → feed falls back to notifications.
   ═══════════════════════════════════════════════════════════════ */

function useActivityLogs() {
  const { canViewPage } = usePermissions();
  const today = new Date().toISOString().split('T')[0];

  return useQuery<any[]>({
    queryKey: ['activity-logs', 'today', today],
    queryFn: () => apiFetch<any[]>(`/api/activity-logs?limit=100&dateFrom=${today}`),
    enabled: canViewPage('controlPanel'),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

/* ═══════════════════════════════════════════════════════════════
   FULL-PAGE LOADING SKELETON
   ═══════════════════════════════════════════════════════════════ */

function AoccSkeleton() {
  return (
    <div className="space-y-6 p-4 md:p-6">
      <Skeleton className="h-20 w-full rounded-2xl bg-slate-800/60" />
      <Skeleton className="h-48 w-full rounded-2xl bg-slate-800/40" />
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
   Owns all data fetching → feeds through intelligence engine →
   passes derived operational intelligence to widgets.
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
  const activityLogsQuery = useActivityLogs();

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
  const activityLogs = activityLogsQuery.data;
  const departmentAnalysis = riskCenterQuery.data?.departmentAnalysis;
  const riskSummary = riskCenterQuery.data?.summary;

  // ═══════════════════════════════════════════════════════════════
  //  INTELLIGENCE ENGINE — feed all data through the collector
  // ═══════════════════════════════════════════════════════════════

  // ── Build the raw data bundle ──
  const rawData: RawDataBundle = useMemo(() => ({
    stats,
    capaItems,
    complaintItems,
    followUpItems,
    riskEmployees,
    notifications,
    activityLogs,
    riskSummary,
    departmentAnalysis,
  }), [stats, capaItems, complaintItems, followUpItems, riskEmployees, notifications, activityLogs, riskSummary, departmentAnalysis]);

  // ── PART 1: Collect normalized events ──
  const events = useMemo(() => collectEvents(rawData), [rawData]);

  // ── PART 2+3: Generate scored, sorted action queue ──
  const actions = useMemo(() => generateActions(events), [events]);

  // ── Priority counts for visual indicators ──
  const priorityCounts = useMemo(() => countByPriority(actions), [actions]);

  // ── PART 4: Cross-module employee correlations ──
  const correlations = useMemo(() => correlateAllEmployees(rawData), [rawData]);

  // ── PART 5: Department health analysis ──
  const departments = useMemo(() => analyzeAllDepartments(rawData), [rawData]);

  // ── PART 6: Smart recommendations ──
  const recommendations = useMemo(
    () => generateRecommendations(correlations, actions, rawData),
    [correlations, actions, rawData]
  );

  // ── PART 7: Activity feed ──
  const activityFeed = useMemo<ActivityFeedEntry[]>(
    () => buildActivityFeed(notifications, activityLogs),
    [notifications, activityLogs]
  );

  // ── PART 8: Executive intelligence ──
  const executiveData = useMemo(
    () => generateExecutiveIntelligence(actions, correlations, departments, rawData),
    [actions, correlations, departments, rawData]
  );

  // ── Global Health KPIs (for operational overview) ──
  const globalHealthKPIs = useMemo(() => {
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
      riskCount: riskSummary?.immediateActionCount || 0,
      qualityViolationsToday: stats.qualitySummary?.totalCases || 0,
      unreadNotifications: notifStats?.unread ?? unreadCount,
    };
  }, [stats, capaItems, complaintItems, followUpItems, riskSummary, notifStats, unreadCount]);

  // ── Quick Actions with urgent badges ──
  const quickActions = useMemo(() => {
    const actionCounts: Record<string, number> = {};
    actions.forEach((a) => {
      if (a.priority === 'critical' || a.priority === 'high') {
        actionCounts[a.sourceModule] = (actionCounts[a.sourceModule] || 0) + 1;
      }
    });
    return [
      { id: 'approve-requests', label: 'اعتماد الطلبات', icon: <CheckCircle2 className="w-5 h-5" />, targetPage: 'requests', colorClass: 'text-sky-400', urgentCount: actionCounts['requests'] },
      { id: 'review-capa', label: 'مراجعة كابا', icon: <ClipboardCheck className="w-5 h-5" />, targetPage: 'capa', colorClass: 'text-purple-400', urgentCount: actionCounts['capa'] },
      { id: 'sync-biometric', label: 'مزامنة البصمة', icon: <Fingerprint className="w-5 h-5" />, targetPage: 'biometric', colorClass: 'text-violet-400' },
      { id: 'create-followup', label: 'متابعة جديدة', icon: <Plus className="w-5 h-5" />, targetPage: 'followUps', colorClass: 'text-rose-400', urgentCount: actionCounts['followUps'] },
      { id: 'review-complaints', label: 'مراجعة الشكاوى', icon: <AlertCircle className="w-5 h-5" />, targetPage: 'complaints', colorClass: 'text-orange-400', urgentCount: actionCounts['complaints'] },
      { id: 'view-reports', label: 'التقارير', icon: <FileText className="w-5 h-5" />, targetPage: 'reports', colorClass: 'text-emerald-400' },
      { id: 'notifications', label: 'الإشعارات', icon: <Bell className="w-5 h-5" />, targetPage: 'notifications', colorClass: 'text-amber-400', urgentCount: actionCounts['notifications'] },
      { id: 'rules-engine', label: 'الأتمتة', icon: <Zap className="w-5 h-5" />, targetPage: 'rulesEngine', colorClass: 'text-yellow-400' },
    ];
  }, [actions]);

  // ═══════════════════════════════════════════════════════════════
  //  AOCC V3 — Decision Intelligence Layer
  //  Reuses the already-computed pipeline (actions, correlations,
  //  departments, rawData). No new API calls — pure client-side
  //  derivation via the useDecisions composition hook.
  // ═══════════════════════════════════════════════════════════════

  // ── View tab: "operational" (existing 10 widgets) ↔ "decisions" (V3) ──
  const [activeView, setActiveView] = useState<'operational' | 'decisions'>('operational');

  // ── Decision Intelligence (memoized on pipeline outputs) ──
  const {
    decisions,
    alerts: predictiveAlerts,
    coaching: coachingOpps,
    execPriorities,
    counts: decisionCounts,
  } = useDecisions({ actions, correlations, departments, data: rawData });

  // ── System Status data ──
  const systemStatusData = useMemo(() => {
    const unread = notifications.filter((n) => n.status === 'unread');
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
      unreadBreakdown: {
        critical: unread.filter((n) => n.priority === 'critical').length,
        high: unread.filter((n) => n.priority === 'high').length,
        medium: unread.filter((n) => n.priority === 'medium').length,
        low: unread.filter((n) => n.priority === 'low').length,
      },
      lastDataUpdate: homeStats.dataUpdatedAt ? new Date(homeStats.dataUpdatedAt).toISOString() : null,
    };
  }, [stats, onlineUsers, notifications, homeStats.dataUpdatedAt]);

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
     RENDER
     - Shared: Mission Header + Operational Overview (always visible)
     - Tab toggle: "العرض التشغيلي" (existing 10 widgets)
                   ↔ "ذكاء القرارات" (V3 Decision Intelligence Layer)
     ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="space-y-6 p-4 md:p-6" dir="rtl">
      {/* ── Section 1: Mission Header (with operational pulse) ── */}
      <AoccMissionHeader
        unreadCount={unreadCount}
        lastSync={stats.biometricLastSync || new Date().toISOString()}
        onRefresh={handleRefresh}
        criticalCount={priorityCounts.critical}
        highCount={priorityCounts.high}
      />

      {/* ── Section 2: Operational Overview (KPI tiles with priority visuals) ── */}
      <AoccOperationalOverview kpis={globalHealthKPIs} priorityCounts={priorityCounts} />

      {/* ═══════════════════════════════════════════════════════════════
          AOCC V3 — View Toggle
          Switches between the existing operational widgets and the new
          Decision Intelligence Layer. Existing widgets are untouched.
          ═══════════════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-800/50 border border-slate-700/50 w-fit">
        <button
          onClick={() => setActiveView('operational')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeView === 'operational'
              ? 'bg-slate-700 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          <Monitor className="w-4 h-4" />
          العرض التشغيلي
        </button>
        <button
          onClick={() => setActiveView('decisions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeView === 'decisions'
              ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shadow-sm'
              : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          <BrainCircuit className="w-4 h-4" />
          ذكاء القرارات
          {decisionCounts.total > 0 && (
            <span className={`text-[10px] px-1.5 py-0 rounded-full ${
              activeView === 'decisions'
                ? 'bg-indigo-500/30 text-indigo-300'
                : 'bg-slate-700 text-slate-400'
            }`}>
              {decisionCounts.total}
            </span>
          )}
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          CONDITIONAL RENDERING — two independent view surfaces
          ═══════════════════════════════════════════════════════════════ */}
      {activeView === 'decisions' ? (
        /* ── V3 Decision Intelligence Layer ── */
        <DecisionCenterLayout
          decisions={decisions}
          alerts={predictiveAlerts}
          coaching={coachingOpps}
          execPriorities={execPriorities}
          counts={decisionCounts}
          loading={homeStats.isLoading || riskCenterQuery.isLoading}
          error={homeStats.isError}
          onRetry={handleRefresh}
        />
      ) : (
        /* ── Existing Operational View (untouched) ── */
        <>
          {/* ── Section 3 + 4: Action Queue + Department Health ── */}
          <DashboardGrid columns={2} gap="gap-6">
            <AoccActionQueue
              items={actions}
              loading={followUpsQuery.isLoading || capaQuery.isLoading || complaintsQuery.isLoading}
              error={followUpsQuery.isError || capaQuery.isError || complaintsQuery.isError}
              onRetry={handleRefresh}
            />
            <AoccDepartmentHealth
              departments={departments}
              loading={homeStats.isLoading || riskCenterQuery.isLoading}
              error={homeStats.isError}
            />
          </DashboardGrid>

          {/* ── Section 5 + 6: Smart Watchlist + Activity Feed ── */}
          <DashboardGrid columns={2} gap="gap-6">
            <AoccEmployeeWatchlist
              employees={correlations}
              loading={riskCenterQuery.isLoading}
              error={riskCenterQuery.isError}
            />
            <AoccActivityFeed entries={activityFeed} loading={false} />
          </DashboardGrid>

          {/* ── Section 7 + 8: Intelligence Center + Quick Actions ── */}
          <DashboardGrid columns={2} gap="gap-6">
            <AoccIntelligenceCenter
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
        </>
      )}
    </div>
  );
}
