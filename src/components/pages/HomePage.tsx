'use client';

// ══════════════════════════════════════════════════════════════
//  HomePage — Operational Command Center (§2) + §3 drag & drop
//
//  DESIGN CONTRACT: the home page answers, within seconds:
//    "ماذا يحدث؟ / ماذا يحتاج انتباهي؟ / ماذا يجب أن أفعل؟"
//  Structure:
//    • Compact command header (clock · refresh · edit-mode toggle)
//    • Operational Snapshot — one CompactMetricCard row (§8)
//    • Quick Actions — permission-filtered create actions
//    • Customizable widget grid (§3): real HTML5 drag & drop with
//      a clear drop target, in-place EDIT MODE ([إلغاء]/[حفظ]),
//      per-widget hide/show, order + visibility persisted through
//      the existing user-preferences record (dashboard.widgetOrder /
//      dashboard.hiddenWidgets) via resolveWidgetLayout — permission
//      always wins over personalization.
//  The former 4 statistics tabs were folded into actionable widgets
//  (their data lives on: travel/quality/performance widgets).
// ══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore, type HeaderContextualAction } from '@/lib/store';
import { usePageIdentity, usePageHeaderActions } from '@/hooks/use-page-header';
import { useHomeStats, useUpdateRequest, useEmployees } from '@/hooks/use-queries';
import { HomeStatDetailDialog, type HomeStatDetailKind } from '@/components/shared/HomeStatDetailDialog';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { CompactMetricCard } from '@/components/shared/CompactMetricCard';
import { HomeQuickActionHost, type HomeQuickActionId } from '@/components/shared/HomeQuickActionHost';
import { toast } from 'sonner';
import { isUrgent, getRequestTypeLabel, getRequestTypeColor } from '@/lib/date-utils';
import {
  Clock, FileText, Plane, AlertTriangle, Bell, CheckCircle2,
  UserCheck, UserX,
  BarChart3,
  Timer, DollarSign, CalendarClock, Flame, RefreshCw, Eye, EyeOff,
  Users, Zap,
  Award, Fingerprint, FileSpreadsheet,
  ExternalLink, ClipboardList, Gauge,
  GripVertical, Inbox, Star, Pin as PinIcon, Activity, X, Save,
} from 'lucide-react';
import { AttentionPanel, type AttentionItem } from '@/components/shared/AttentionPanel';
import { playNotificationSound } from '@/lib/sounds';
import { DASHBOARD_WIDGETS } from '@/config/dashboard-widgets';
import { resolveWidgetLayout } from '@/lib/personalization';
import {
  useUserPreferences,
  useSaveUserPreferences,
} from '@/hooks/use-user-preferences';
import type { ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════
   TYPES (data contracts — unchanged from /api/home/stats)
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

interface DeptTodayStat { name: string; employeeCount: number; presentToday: number; lateToday: number; absentToday: number; }
interface RequestTypeSummary { type: string; label: string; pending: number; approved: number; rejected: number; }
interface TodayFollowUpItem { id: string; employeeId: string; employeeName: string; employeeDepartment: string; responsiblePersonName: string; responsiblePersonId: string; followUpType: string; priorityLevel: string; status: string; nextFollowUpDate: string; }
interface FollowUpsSummary { totalActive: number; totalOverdue: number; totalCompleted: number; todaysScheduled: number; }

interface MonthlyPerformance {
  monthLabel: string; monthKey: string; totalDelays: number;
  totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number;
  totalPresent: number; totalAbsent: number; totalWorkingDays: number;
  departments: { departmentName: string; employeeCount: number; totalDelays: number; totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number; presentDays: number; absentDays: number; employees: unknown[] }[];
}
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
  todaysFollowUps: TodayFollowUpItem[];
  followUpsSummary: FollowUpsSummary;
}

const emptyPerf: MonthlyPerformance = {
  monthLabel: '', monthKey: '', totalDelays: 0, totalDelayMinutes: 0,
  totalDeductionAmount: 0, totalDeductionDays: 0, totalPresent: 0, totalAbsent: 0,
  totalWorkingDays: 22, departments: [],
};

/* ═══════════════════════════════════════════════════════════
   HOOKS & HELPERS
   ═══════════════════════════════════════════════════════════ */

function useLiveClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function useLiveDate() {
  const [date, setDate] = useState('');
  useEffect(() => {
    const tick = () => {
      const n = new Date();
      const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      setDate(`${days[n.getDay()]} ${n.getDate()} ${months[n.getMonth()]} ${n.getFullYear()}`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  return date;
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString('ar-EG');
}

/** Pure array move — §3 drag & drop reordering. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/* ═══════════════════════════════════════════════════════════
   MICRO COMPONENTS
   ═══════════════════════════════════════════════════════════ */

const ProgressBar = ({ value, max, colorClass, label }: { value: number; max: number; colorClass: string; label?: string }) => {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="space-y-1.5">
      {label && <div className="flex items-center justify-between text-[11px]"><span className="text-slate-400">{label}</span><span className="text-slate-200 font-mono font-medium">{Math.round(pct)}%</span></div>}
      <div className="h-2 rounded-full bg-slate-700/40 overflow-hidden">
        <div className={`h-full rounded-full ${colorClass} transition-all duration-1000 ease-out`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

const Pill = ({ icon, label, value, color, bg }: { icon?: React.ReactNode; label: string; value: string | number; color: string; bg: string }) => (
  <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border ${bg} text-[11px]`}>
    {icon && <span className={color}>{icon}</span>}
    <span className="text-slate-400">{label}:</span>
    <span className={`font-bold ${color}`}>{value}</span>
  </div>
);

const MiniBar = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const w = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-700/40 overflow-hidden w-full">
      <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${w}%` }} />
    </div>
  );
};

const EmptyState = ({ icon, message, color = 'text-slate-600' }: { icon: React.ReactNode; message: string; color?: string }) => (
  <div className="flex flex-col items-center justify-center py-10">
    <div className={`mb-3 ${color}`}>{icon}</div>
    <p className="text-slate-400 text-sm">{message}</p>
  </div>
);

const NavBtn = ({ onClick, label, icon, color }: { onClick: () => void; label: string; icon?: React.ReactNode; color?: string }) => (
  <button onClick={onClick}
    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-medium border border-slate-700/30 bg-slate-700/15 hover:bg-slate-700/30 transition-all duration-150 ${color || 'text-slate-300'}`}>
    {icon}{label}
  </button>
);

const QuickLink = ({ icon, label, sub, color, onClick }: { icon: React.ReactNode; label: string; sub: string; color: string; onClick: () => void }) => (
  <button onClick={onClick} className={`flex items-center gap-2.5 p-3 rounded-xl bg-gradient-to-br ${color} border border-slate-700/20 hover:border-brand-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 text-right`}>
    <span className="text-slate-300">{icon}</span>
    <span className="min-w-0">
      <span className="block text-xs font-semibold text-white truncate">{label}</span>
      <span className="block text-[10px] text-slate-500 truncate">{sub}</span>
    </span>
  </button>
);

const StatusRow = ({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) => (
  <div className="flex items-center justify-between gap-2 text-[11px]">
    <span className="flex items-center gap-1.5 text-slate-500">{icon}{label}</span>
    <span className={`flex items-center gap-1.5 font-medium ${ok ? 'text-emerald-400' : 'text-slate-500'}`}>
      <span className={`size-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-slate-600'}`} />
      {value}
    </span>
  </div>
);

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { canViewPage: hookCanViewPage, canEditPage, canDoAction } = usePermissions('home');
  const navigateTo = useAppStore((s) => s.navigateTo);
  const canViewPage = useCallback((pid: string) => pid === 'home' || hookCanViewPage(pid), [hookCanViewPage]);

  // ── Data ──
  const { data: rawStats, isLoading: loading, refetch, isFetching: refreshing } = useHomeStats();
  const updateRequestMutation = useUpdateRequest();
  // §22 — the scope-filtered employee list powering the in-place
  // "إجمالي الموظفين" detail surface.
  const { data: employeesData } = useEmployees();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // §22 — which summary-card detail surface is open (in-place).
  const [statDetail, setStatDetail] = useState<HomeStatDetailKind | null>(null);
  const soundRef = useRef(false);
  const clock = useLiveClock();
  const todayDate = useLiveDate();

  // ── Recent activity feed (latest notifications) ──
  // ROOT CAUSE FIX: /api/notifications returns an envelope
  //   { data, total, limit, offset }
  // (see src/app/api/notifications/route.ts). The old code treated
  // the body as a flat array and crashed with
  // `recentNotifications?.map is not a function`. We unwrap `data` here
  // so every downstream consumer can keep using a plain array.
  // §NOTIFICATIONS-V2: this feed is the signed-in user's OWN recent
  // notifications — always fetched (the API visibility rule already
  // scopes rows to the viewer; it never depended on the removed
  // Notification Center page permission).
  const { data: recentNotifications } = useQuery({
    queryKey: ['home-recent-activity'],
    queryFn: () =>
      fetch('/api/notifications?limit=8', {
        headers: { Authorization: `Bearer ${localStorage.getItem('erp_access_token')}` },
      }).then(async (r) => {
        if (!r.ok) return [];
        const body = await r.json();
        return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
      }),
    staleTime: 60_000,
  });

  const stats = useMemo(() => {
    if (!rawStats) return null;
    return {
      ...rawStats,
      lastMonthPerformance: rawStats.lastMonthPerformance || emptyPerf,
      currentMonthPerformance: rawStats.currentMonthPerformance || emptyPerf,
    } as HomeStats;
  }, [rawStats]);

  useEffect(() => {
    if (stats && !soundRef.current) {
      soundRef.current = true;
      if (stats.pendingRequests > 0) playNotificationSound('request');
      if (stats.upcomingTravel.some((t) => isUrgent(t.departureDate))) {
        setTimeout(() => playNotificationSound('travel'), 800);
      }
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

  // ── Personal layout (Milestone 10) + §3 EDIT MODE ──
  const { data: userPreferences } = useUserPreferences();
  const savePrefs = useSaveUserPreferences();

  const permittedWidgets = useMemo(
    () => DASHBOARD_WIDGETS.filter((w) => canViewPage(w.permissionKey)),
    [canViewPage],
  );
  const widgetLayout = useMemo(
    () => resolveWidgetLayout(DASHBOARD_WIDGETS, userPreferences, (w) => canViewPage(w.permissionKey)),
    [userPreferences, canViewPage],
  );

  const [editMode, setEditMode] = useState(false);
  // §5/§6 — selected Quick Action surfaces an inline form host instead
  // of navigating to a different page. `null` = no action active.
  const [activeQuickAction, setActiveQuickAction] = useState<HomeQuickActionId | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);

  const enterEditMode = useCallback(() => {
    const hiddenSet = new Set(userPreferences?.dashboard?.hiddenWidgets ?? []);
    // Full draft order: visible widgets in current layout order, then
    // hidden widgets in registry order — re-showing keeps context.
    const visibleIds = widgetLayout.map((w) => w.id);
    const hiddenIds = permittedWidgets.filter((w) => hiddenSet.has(w.id)).map((w) => w.id);
    setDraftOrder([...visibleIds, ...hiddenIds]);
    setDraftHidden(hiddenSet);
    setDragId(null);
    setOverId(null);
    setEditMode(true);
  }, [userPreferences, widgetLayout, permittedWidgets]);

  const exitEditMode = useCallback(() => {
    setEditMode(false);
    setDraftOrder([]);
    setDraftHidden(new Set());
    setDragId(null);
    setOverId(null);
  }, []);

  const saveLayout = useCallback(async () => {
    setSavingLayout(true);
    try {
      await savePrefs.mutateAsync({
        dashboard: { widgetOrder: draftOrder, hiddenWidgets: [...draftHidden] },
      });
      toast.success('تم حفظ تخطيط لوحة القيادة');
      exitEditMode();
    } catch {
      toast.error('تعذر حفظ التخطيط');
    } finally {
      setSavingLayout(false);
    }
  }, [savePrefs, draftOrder, draftHidden, exitEditMode]);

  // §3 drop: dropping ON a target card moves the dragged widget to the
  // target's position (grid reordering semantics — no layout jumping,
  // no duplicates; the live ring + chip shows the destination first).
  const handleDropOn = useCallback((targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    setDraftOrder((prev) => {
      const from = prev.indexOf(dragId);
      const to = prev.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      return moveItem(prev, from, to);
    });
    setDragId(null);
    setOverId(null);
  }, [dragId]);

  const handleDragEnd = useCallback(() => { setDragId(null); setOverId(null); }, []);

  const toggleDraftHidden = useCallback((id: string) => {
    setDraftHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // ═══ §HEADER-V3 — the page feeds the global Header ═══
  // Identity (title + the live date/time line + icon) and contextual
  // actions (quick-create menu; customize/refresh as compact header
  // icons; cancel/save while editing). Same handlers, permissions and
  // confirmations the page used to render inline — the action surface
  // moved, the behavior did not change.
  usePageIdentity({
    title: 'مركز القيادة',
    description: (
      <>
        {todayDate} · <span className="font-mono tabular-nums" dir="ltr">{clock}</span>
      </>
    ),
    icon: <Gauge className="size-4 text-brand-400" />,
  });

  const headerActions = useMemo<HeaderContextualAction[]>(() => {
    const actions: HeaderContextualAction[] = [];
    // Quick-create actions (permission-filtered — §2.1): collapsed into
    // the header's compact quick-actions menu.
    if (canDoAction('employees', 'create')) actions.push({ id: 'qa-employees', label: 'إضافة موظف', icon: <Users className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('employees'), active: activeQuickAction === 'employees' });
    if (canDoAction('observations', 'create')) actions.push({ id: 'qa-observations', label: 'ملاحظة جودة', icon: <Award className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('observations'), active: activeQuickAction === 'observations' });
    if (canDoAction('capa', 'create')) actions.push({ id: 'qa-capa', label: 'إنشاء CAPA', icon: <ClipboardList className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('capa'), active: activeQuickAction === 'capa' });
    if (canDoAction('complaints', 'create')) actions.push({ id: 'qa-complaints', label: 'إضافة شكوى', icon: <AlertTriangle className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('complaints'), active: activeQuickAction === 'complaints' });
    if (canDoAction('followUps', 'create')) actions.push({ id: 'qa-followUps', label: 'متابعة جديدة', icon: <ClipboardList className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('followUps'), active: activeQuickAction === 'followUps' });
    if (canDoAction('requests', 'create')) actions.push({ id: 'qa-requests', label: 'طلب جديد', icon: <FileText className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('requests'), active: activeQuickAction === 'requests' });

    // Utility actions as compact header icons (§8) — never large page
    // toolbar buttons. While editing, the draft controls replace them.
    if (editMode) {
      actions.push({ id: 'cancel-edit', label: 'إلغاء', icon: <X className="size-4" />, display: 'icon', onClick: exitEditMode });
      actions.push({ id: 'save-layout', label: 'حفظ', icon: <Save className="size-4" />, display: 'icon', onClick: () => void saveLayout(), disabled: savingLayout });
    } else {
      actions.push({ id: 'customize', label: 'تخصيص', icon: <GripVertical className="size-4" />, display: 'icon', onClick: enterEditMode });
      actions.push({ id: 'refresh', label: 'تحديث', icon: <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />, display: 'icon', onClick: () => void refetch(), active: refreshing });
    }
    return actions;
  }, [canDoAction, activeQuickAction, editMode, exitEditMode, saveLayout, savingLayout, enterEditMode, refreshing, refetch]);
  usePageHeaderActions(headerActions);

  // When a quick action fires from the HEADER menu, bring its inline
  // form into view — deterministic scroll on state change (no timers).
  // scroll-margin keeps it clear of the sticky header.
  const quickActionHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeQuickAction) {
      quickActionHostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeQuickAction]);


  // ── Derived snapshot numbers ──
  const perf = stats?.currentMonthPerformance ?? emptyPerf;
  const lastPerf = stats?.lastMonthPerformance ?? emptyPerf;
  const delayChange = lastPerf.totalDelays > 0 ? Math.round((perf.totalDelays - lastPerf.totalDelays) / lastPerf.totalDelays * 100) : 0;
  const dedChange = lastPerf.totalDeductionAmount > 0 ? Math.round((perf.totalDeductionAmount - lastPerf.totalDeductionAmount) / lastPerf.totalDeductionAmount * 100) : 0;

  // ── Loading skeleton ──
  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-20 w-full rounded-2xl bg-slate-800/60" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-16 rounded-xl bg-slate-800/40" />)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">{Array.from({length:6}).map((_,i)=><Skeleton key={i} className="h-[300px] rounded-2xl bg-slate-800/40" />)}</div>
      </div>
    );
  }

  if (!stats) return (
    <div><h1 className="text-2xl font-bold text-white">مركز القيادة</h1>
      <Card className="border-slate-700/50 bg-slate-800/50"><CardContent className="py-16"><EmptyState icon={<BarChart3 className="size-12" />} message="لا توجد بيانات" /></CardContent></Card>
    </div>
  );

  /* ── Attention rows (§2.2/§2.3 — "ما يحتاج انتباهي الآن") ──
     §10 GLOBAL ALERT CONTRACT: these rows render through the SAME
     unified AttentionPanel used by Travel / Risk / CAPA / Follow-Ups —
     collapsed by default, severity badges, expand/collapse, click →
     navigate. Severity mapping: red/rose=critical, orange=urgent,
     amber=warning, violet/cyan=info. */
  const urgentTravels = stats.upcomingTravel.filter((t) => isUrgent(t.departureDate)).slice(0, 3);
  const attentionItems: { key: string; severity: 'critical' | 'urgent' | 'warning' | 'info'; text: string; detail?: string; action: () => void }[] = [];
  if (stats.pendingRequests > 0) attentionItems.push({
    key: 'requests', severity: 'warning',
    text: `${stats.pendingRequests} طلب بانتظار الموافقة`,
    detail: stats.pendingRequestsDetails[0] ? `آخرها: ${stats.pendingRequestsDetails[0].employeeName}` : undefined,
    // §17 EXACT DEEP-LINKING — the destination shows EXACTLY these N
    // pending requests (status filter seeded from the metric).
    action: () => navigateTo('requests', undefined, { status: 'pending' }),
  });
  if (stats.followUpsSummary.totalOverdue > 0) attentionItems.push({
    key: 'overdueFollowUps', severity: 'critical',
    text: `${stats.followUpsSummary.totalOverdue} متابعة متأخرة عن موعدها`,
    // §17 — shows EXACTLY the overdue records the metric counted
    // (same canonical isOverdueFollowUp definition on both sides).
    action: () => navigateTo('followUps', undefined, { overdue: '1' }),
  });
  urgentTravels.forEach((t) => attentionItems.push({
    key: `travel-${t.id}`, severity: 'critical',
    text: `رحلة عاجلة: ${t.employeeName} → ${t.destination}`,
    detail: `المغادرة ${t.departureDate}`,
    action: () => navigateTo('travel'),
  }));
  if (stats.lateCount > 0) attentionItems.push({
    key: 'late', severity: 'urgent',
    text: `${stats.lateCount} موظف متأخر اليوم`,
    detail: stats.lateEmployees[0] ? `${stats.lateEmployees[0].employeeName} (${stats.lateEmployees[0].minutesLate} د)` : undefined,
    // §17 — shows exactly today's LATE records.
    action: () => navigateTo('attendance', undefined, { status: 'late' }),
  });
  if (stats.qualitySummary.totalCases > 0) attentionItems.push({
    key: 'quality', severity: 'info',
    text: `${stats.qualitySummary.totalCases} حالة جودة هذا الشهر`,
    detail: stats.qualitySummary.totalAmount > 0 ? `خصومات ${stats.qualitySummary.totalAmount.toFixed(0)} ج.م` : undefined,
    // §17 — the card counts THIS month; the destination month-filters
    // to exactly that period.
    action: () => navigateTo('quality', undefined, { month: new Date().toISOString().slice(0, 7) }),
  });

  /* ═══ WIDGETS (§3 — each renders inside the draggable grid) ═══ */
  const widgetBodies: Record<string, ReactNode> = {
    // §10 unified alert contract — the SAME AttentionPanel used on
    // Travel/Risk/CAPA/Follow-Ups, collapsed by default, severity
    // counts in the header, glowing accent when critical items exist.
    attentionRequired: (
      <AttentionPanel
        title="يحتاج تدخلك"
        icon={<Zap className="size-4" />}
        subtitle="الطلبات والمتابعات والتنبيهات العاجلة"
        persistKey="dashboardAttention"
        items={attentionItems.map((item): AttentionItem => ({
          id: item.key,
          severity: item.severity,
          primary: item.text,
          secondary: item.detail,
          onClick: item.action,
        }))}
        emptyState={{
          icon: <CheckCircle2 className="size-7 text-emerald-500/50 mb-2" />,
          title: 'لا توجد حالات تحتاج تدخلك الآن — ممتاز!',
          description: 'الطلبات والمتابعات المتأخرة والتنبيهات العاجلة تظهر هنا فور ورودها.',
        }}
      />
    ),

    pendingRequests: (
      <DashboardCard title="الطلبات المعلقة" icon={<FileText className="size-4" />} iconBg="bg-amber-500/10" iconColor="text-amber-400" borderClr="border-amber-500/20"
        size="medium"
        badge={stats.pendingRequestsDetails.length || undefined}
        onOpenFull={() => navigateTo('requests', undefined, { status: 'pending' })}
        empty={stats.pendingRequestsDetails.length === 0}
        emptyIcon={<CheckCircle2 className="size-10" />}
        emptyMessage="لا توجد طلبات معلقة - كل شيء على ما يرام!">
        <div className="space-y-2.5">
          {stats.pendingRequestsDetails.map((req) => (
            <div key={req.id} className="p-3 rounded-xl border border-slate-700/20 bg-slate-700/10 hover:bg-slate-700/20 transition-all duration-200">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white text-sm font-semibold">{req.employeeName}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold shrink-0 whitespace-nowrap ${getRequestTypeColor(req.type)}`}>{getRequestTypeLabel(req.type)}</span>
                  </div>
                  <p className="text-slate-500 text-[10px] mt-1">{req.date}</p>
                  <p className="text-slate-300 text-xs mt-1.5 line-clamp-2">{req.reason}</p>
                </div>
              </div>
              {canEditPage('requests') && (
                <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-slate-700/15">
                  <Button size="sm" className="bg-emerald-600/70 text-white text-[10px] gap-1.5 px-3 h-8 rounded-xl"
                    disabled={actionLoading === req.id}
                    onClick={(e) => { e.stopPropagation(); void handleRequestAction(req.id, 'approved'); }}>
                    {actionLoading === req.id ? 'جاري...' : 'موافقة'}
                  </Button>
                  <Button size="sm" variant="outline" className="border-red-500/15 text-red-400 hover:bg-red-500/10 text-[10px] gap-1.5 px-3 h-8 rounded-xl"
                    disabled={actionLoading === req.id}
                    onClick={(e) => { e.stopPropagation(); void handleRequestAction(req.id, 'rejected'); }}>
                    {actionLoading === req.id ? 'جاري...' : 'رفض'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </DashboardCard>
    ),

    attendanceToday: (
      <DashboardCard title="الحضور اليوم" icon={<Clock className="size-4" />} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" borderClr="border-cyan-500/20"
        onOpenFull={() => navigateTo('attendance')} size="medium">
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill icon={<UserCheck className="size-3.5" />} label="حاضر" value={stats.presentCount} color="text-brand-400" bg="bg-emerald-500/8 border-brand-500/30" />
          <Pill icon={<AlertTriangle className="size-3.5" />} label="متأخر" value={stats.lateCount} color="text-amber-400" bg="bg-amber-500/8 border-amber-500/12" />
          <Pill icon={<UserX className="size-3.5" />} label="غائب" value={stats.absentCount} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
          <Pill icon={<Activity className="size-3.5" />} label="النسبة" value={`${stats.attendanceRate}%`} color="text-cyan-400" bg="bg-cyan-500/8 border-cyan-500/12" />
        </div>
        {stats.totalEmployees > 0 && <ProgressBar value={stats.presentCount} max={stats.totalEmployees} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" label="نسبة الحضور الإجمالية" />}
        {stats.lateEmployees.length > 0 ? (
          <div className="mt-4">
            <p className="text-slate-500 text-[10px] font-semibold mb-2.5 flex items-center gap-1.5"><AlertTriangle className="size-3" /> المتأخرون:</p>
            <div className="space-y-2">
              {stats.lateEmployees.map((late) => (
                <div key={late.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0"><Clock className="size-3 text-amber-400" /></div>
                    <span className="text-white text-xs font-medium truncate">{late.employeeName}</span>
                  </div>
                  <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/12 text-[10px] shrink-0 rounded-lg px-2">{late.minutesLate} د</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : <EmptyState icon={<CheckCircle2 className="size-8" />} message="لا يوجد متأخرون - ممتاز!" />}
      </DashboardCard>
    ),

    todaysFollowUps: (
      <DashboardCard title="متابعات مجدولة اليوم" icon={<ClipboardList className="size-4" />} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" borderClr="border-cyan-500/20"
        actions={<NavBtn onClick={() => navigateTo('followUps', undefined, { dueToday: '1' })} label="عرض المتابعات" icon={<ExternalLink className="size-3" />} color="text-cyan-400" />}
        size="medium"
        badge={stats.todaysFollowUps.length || undefined}
        empty={stats.todaysFollowUps.length === 0}
        emptyIcon={<ClipboardList className="size-10" />}
        emptyMessage="لا توجد متابعات مجدولة اليوم">
        <div className="space-y-2">
          {stats.todaysFollowUps.map((fu) => {
            const typeLabels: Record<string, string> = { quality: 'جودة', behavior: 'سلوك', attendance: 'حضور', productivity: 'إنتاجية', training: 'تدريب', customerHandling: 'التعامل مع العملاء' };
            const priorityColors: Record<string, string> = { high: 'text-red-400 bg-red-500/10', medium: 'text-amber-400 bg-amber-500/10', low: 'text-brand-400 bg-brand-500/10' };
            return (
              <div key={fu.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-cyan-500/15 bg-cyan-500/5 hover:bg-cyan-500/10 transition-colors">
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
                  <p className="text-slate-500 text-[10px] mt-0.5">المسؤول: {fu.responsiblePersonName}</p>
                </div>
              </div>
            );
          })}
        </div>
      </DashboardCard>
    ),

    travelAlerts: (
      <DashboardCard title="تنبيهات السفر" icon={<Plane className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/20"
        actions={<NavBtn onClick={() => navigateTo('travel')} label="صفحة السفر" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
        size="medium"
        badge={stats.upcomingTravel.length || undefined}
        empty={stats.upcomingTravel.length === 0}
        emptyIcon={<Plane className="size-10" />}
        emptyMessage="لا توجد رحلات قادمة">
        <div className="space-y-2">
          {stats.upcomingTravel.slice(0, 8).map((t) => {
            const urgent = isUrgent(t.departureDate);
            return (
              <div key={t.id} className={`p-3 rounded-xl border transition-all ${urgent ? 'border-rose-500/25 bg-rose-500/5' : 'border-slate-700/20 bg-slate-700/10'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-xs font-semibold truncate">{t.employeeName}</span>
                  {urgent && <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20 text-[9px] rounded-lg px-1.5 shrink-0">عاجلة</Badge>}
                </div>
                <p className="text-slate-400 text-[11px] mt-1 truncate">{t.destination}</p>
                <p className="text-slate-600 text-[10px] mt-0.5">المغادرة: {t.departureDate}</p>
              </div>
            );
          })}
        </div>
      </DashboardCard>
    ),

    qualitySnapshot: (
      <DashboardCard title="لمحة الجودة" icon={<Award className="size-4" />} iconBg="bg-orange-500/10" iconColor="text-orange-400" borderClr="border-orange-500/20"
        actions={<NavBtn onClick={() => navigateTo('quality')} label="خصومات الجودة" icon={<ExternalLink className="size-3" />} color="text-orange-400" />}
        size="medium"
        empty={stats.qualitySummary.totalCases === 0}
        emptyIcon={<Award className="size-10" />}
        emptyMessage="لا توجد حالات جودة هذا الشهر">
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill icon={<Award className="size-3.5" />} label="حالات" value={stats.qualitySummary.totalCases} color="text-orange-400" bg="bg-orange-500/8 border-orange-500/12" />
          <Pill icon={<DollarSign className="size-3.5" />} label="خصومات" value={`${stats.qualitySummary.totalAmount.toFixed(0)} ج.م`} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
          <Pill icon={<CalendarClock className="size-3.5" />} label="أيام" value={stats.qualitySummary.totalDays.toFixed(1)} color="text-brand-400" bg="bg-brand-500/8 border-brand-500/12" />
        </div>
        {Object.entries(stats.qualitySummary.byType).length > 0 && (
          <div className="space-y-2.5">
            <p className="text-slate-500 text-[10px] font-semibold">حسب النوع:</p>
            {Object.entries(stats.qualitySummary.byType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-24 truncate">{type}</span>
                <MiniBar value={count} max={stats.qualitySummary.totalCases} color="bg-gradient-to-l from-orange-500 to-amber-500" />
                <span className="text-[10px] text-slate-300 font-mono w-6 text-left">{count}</span>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>
    ),

    requestTypeAnalytics: (
      <DashboardCard title="تحليل الطلبات حسب النوع" icon={<BarChart3 className="size-4" />} iconBg="bg-brand-500/10" iconColor="text-brand-400" borderClr="border-brand-500/20"
        actions={<NavBtn onClick={() => navigateTo('requests')} label="التفاصيل" icon={<ExternalLink className="size-3" />} color="text-brand-400" />}
        size="medium"
        empty={stats.requestTypeSummary.length === 0}
        emptyIcon={<BarChart3 className="size-10" />}
        emptyMessage="لا توجد طلبات بعد">
        <div className="space-y-3">
          {stats.requestTypeSummary.map((rt) => {
            const total = rt.pending + rt.approved + rt.rejected;
            const pPct = total > 0 ? (rt.pending / total * 100) : 0;
            const aPct = total > 0 ? (rt.approved / total * 100) : 0;
            const rPct = total > 0 ? (rt.rejected / total * 100) : 0;
            const colors: Record<string, string> = { leave: 'bg-cyan-500', permission: 'bg-brand-500', excuse: 'bg-rose-500', tardiness: 'bg-amber-500', remote: 'bg-emerald-500' };
            return (
              <div key={rt.type} className="p-3 rounded-xl bg-slate-700/10 border border-slate-700/10">
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className={`w-3 h-3 rounded-full shrink-0 ${colors[rt.type] || 'bg-slate-400'}`} />
                    <span className="text-white text-sm font-medium">{rt.label}</span>
                    <span className="px-2 py-0.5 rounded-lg text-[10px] bg-slate-600/20 text-slate-300 font-semibold shrink-0">{total} طلب</span>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 h-3 rounded-full overflow-hidden bg-slate-700/30">
                  {aPct > 0 && <div className="h-full bg-emerald-500" style={{ width: `${aPct}%` }} />}
                  {pPct > 0 && <div className="h-full bg-amber-500" style={{ width: `${pPct}%` }} />}
                  {rPct > 0 && <div className="h-full bg-red-500" style={{ width: `${rPct}%` }} />}
                </div>
                <div className="flex items-center justify-between mt-2 text-[10px] font-medium">
                  <span className="text-brand-400">موافق: {rt.approved}</span>
                  <span className="text-amber-400">معلق: {rt.pending}</span>
                  <span className="text-red-400">مرفوض: {rt.rejected}</span>
                </div>
              </div>
            );
          })}
        </div>
      </DashboardCard>
    ),

    departmentsOverview: (
      <DashboardCard title="أقسام الشركة" icon={<Users className="size-4" />} iconBg="bg-brand-500/10" iconColor="text-brand-400" borderClr="border-brand-500/20"
        actions={<NavBtn onClick={() => navigateTo('employees')} label="عرض الموظفين" icon={<ExternalLink className="size-3" />} color="text-brand-400" />}
        size="medium"
        empty={stats.deptTodayStats.length === 0}
        emptyIcon={<Users className="size-10" />}
        emptyMessage="لا توجد أقسام بعد">
        <div className="space-y-2.5">
          {stats.deptTodayStats.map((dept) => (
            <div key={dept.name} className="p-3 rounded-xl bg-slate-700/10 hover:bg-slate-700/20 transition-all">
              <div className="flex items-center justify-between mb-2 gap-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500/20 to-brand-500/10 flex items-center justify-center shrink-0">
                    <span className="text-white text-[11px] font-bold">{dept.name[0]}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{dept.name}</p>
                    <p className="text-slate-500 text-[10px]">{dept.employeeCount} موظف</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  <span className="px-2 py-1 rounded-lg text-[10px] bg-emerald-500/10 text-emerald-400 font-semibold">{dept.presentToday} حاضر</span>
                  <span className="px-2 py-1 rounded-lg text-[10px] bg-amber-500/10 text-amber-400 font-semibold">{dept.lateToday} متأخر</span>
                  <span className="px-2 py-1 rounded-lg text-[10px] bg-red-500/10 text-red-400 font-semibold">{dept.absentToday} غائب</span>
                </div>
              </div>
              {dept.employeeCount > 0 && <ProgressBar value={dept.presentToday} max={dept.employeeCount} colorClass="bg-gradient-to-l from-emerald-500 to-cyan-500" />}
            </div>
          ))}
        </div>
      </DashboardCard>
    ),

    quickAccess: (() => {
      const favorites = userPreferences?.favorites ?? [];
      const pins = userPreferences?.pins ?? [];
      const shortcuts = [...pins, ...favorites].slice(0, 6);
      return (
        <DashboardCard title="مختصراتي" icon={<Zap className="size-4" />} iconBg="bg-brand-500/10" iconColor="text-brand-400" borderClr="border-brand-500/20" size="medium">
          {/* §2.6 Personal shortcuts — the user's own 📌 pins + ⭐ favorites */}
          {shortcuts.length > 0 && (
            <div className="mb-4">
              <p className="text-slate-500 text-[10px] font-semibold mb-2 flex items-center gap-1.5"><PinIcon className="size-3 text-cyan-400" /> المثبتة والمفضلة</p>
              <div className="flex flex-wrap gap-1.5">
                {shortcuts.map((entry) => (
                  <button key={entry.id}
                    onClick={() => navigateTo(entry.route, entry.targetType === 'record' ? entry.targetId ?? undefined : undefined, entry.navigationContext ?? {})}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border border-slate-700/40 bg-slate-700/15 hover:bg-slate-700/30 hover:text-white text-slate-300 transition-all">
                    {entry.targetType === 'record' ? <Star className="size-3 text-amber-400" /> : <PinIcon className="size-3 text-cyan-400" />}
                    <span className="truncate max-w-32">{entry.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {canViewPage('employees') && <QuickLink icon={<Users className="size-4" />} label="الموظفين" sub={`${stats.totalEmployees} موظف`} color="from-brand-500/10 to-brand-600/5" onClick={() => navigateTo('employees')} />}
            {canViewPage('biometric') && <QuickLink icon={<Fingerprint className="size-4" />} label="البصمة" sub={`${stats.biometricRecordCount.toLocaleString()} سجل`} color="from-brand-500/10 to-fuchsia-600/5" onClick={() => navigateTo('biometric')} />}
            {canViewPage('attendance') && <QuickLink icon={<Clock className="size-4" />} label="الحضور" sub={`${stats.attendanceRate}% حضور`} color="from-cyan-500/10 to-teal-600/5" onClick={() => navigateTo('attendance')} />}
            {canViewPage('requests') && <QuickLink icon={<FileText className="size-4" />} label="الطلبات" sub={`${stats.pendingRequests} معلق`} color="from-amber-500/10 to-orange-600/5" onClick={() => navigateTo('requests')} />}
            {canViewPage('rules') && <QuickLink icon={<Timer className="size-4" />} label="قواعد الخصم" sub={`${stats.rulesSummary.length} قاعدة`} color="from-rose-500/10 to-pink-600/5" onClick={() => navigateTo('rules')} />}
            {canViewPage('quality') && <QuickLink icon={<Award className="size-4" />} label="الجودة" sub={`${stats.qualitySummary.totalCases} حالة`} color="from-orange-500/10 to-amber-600/5" onClick={() => navigateTo('quality')} />}
            {canViewPage('travel') && <QuickLink icon={<Plane className="size-4" />} label="السفر" sub={`${stats.activeTravel} نشط`} color="from-rose-500/10 to-pink-600/5" onClick={() => navigateTo('travel')} />}
            {canViewPage('reports') && <QuickLink icon={<FileSpreadsheet className="size-4" />} label="التقارير" sub="تصدير Excel" color="from-emerald-500/10 to-green-600/5" onClick={() => navigateTo('reports')} />}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-700/15">
            <p className="text-slate-500 text-[10px] font-semibold mb-2.5 flex items-center gap-1.5"><Activity className="size-3" /> حالة النظام</p>
            <div className="space-y-2">
              <StatusRow icon={<Fingerprint className="size-3.5" />} label="آخر مزامنة بصمة" value={stats.biometricLastSync ? new Date(stats.biometricLastSync).toLocaleDateString('ar-EG') : 'لم تتم بعد'} ok={!!stats.biometricLastSync} />
              <StatusRow icon={<Users className="size-3.5" />} label="إجمالي سجلات البصمة" value={`${stats.biometricRecordCount.toLocaleString()} سجل`} ok={stats.biometricRecordCount > 0} />
            </div>
          </div>
        </DashboardCard>
      );
    })(),

    recentActivity: (
      <DashboardCard title="النشاط الأخير" icon={<Activity className="size-4" />} iconBg="bg-emerald-500/10" iconColor="text-emerald-400" borderClr="border-emerald-500/20"
        actions={<NavBtn onClick={() => navigateTo('notifications')} label="كل الإشعارات" icon={<ExternalLink className="size-3" />} color="text-emerald-400" />}
        size="medium"
        empty={!recentNotifications || (recentNotifications as unknown[]).length === 0}
        emptyIcon={<Inbox className="size-10" />}
        emptyMessage="لا يوجد نشاط حديث">
        <div className="space-y-1.5">
          {(recentNotifications as { id: string; title: string; description?: string; status?: string; createdAt?: string }[] | undefined)?.map((n) => (
            <button key={n.id} onClick={() => navigateTo('notifications')}
              className="w-full flex items-start gap-2.5 p-2.5 rounded-lg hover:bg-slate-700/20 transition-colors text-right">
              <span className={`mt-1.5 size-1.5 rounded-full shrink-0 ${n.status === 'unread' ? 'bg-brand-400' : 'bg-slate-600'}`} />
              <span className="flex-1 min-w-0">
                <span className="block text-xs text-slate-200 font-medium truncate">{n.title}</span>
                {n.description && <span className="block text-[10px] text-slate-500 truncate mt-0.5">{n.description}</span>}
              </span>
              <span className="text-[10px] text-slate-600 shrink-0 mt-0.5">{relativeTime(n.createdAt)}</span>
            </button>
          ))}
        </div>
      </DashboardCard>
    ),

    // ── PHASE 9 — OPTIONAL widgets (NOT shown by default). Each
    //     restores one of the four legacy tabs so valuable operational
    //     information is never silently lost. Users opt in via
    //     "تخصيص" → enable. ────────────────────────────────────────
    performanceDetail: (
      <DashboardCard title="تفاصيل الأداء والتأخيرات" icon={<BarChart3 className="size-4" />} iconBg="bg-brand-500/10" iconColor="text-brand-400" borderClr="border-brand-500/20"
        actions={<NavBtn onClick={() => navigateTo('reports')} label="تقارير الأداء" icon={<ExternalLink className="size-3" />} color="text-brand-400" />}
        size="medium"
        empty={perf.departments.length === 0}
        emptyIcon={<BarChart3 className="size-10" />}
        emptyMessage="لا توجد بيانات أداء لهذا الشهر">
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill icon={<Flame className="size-3.5" />} label="تأخيرات" value={perf.totalDelays} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
          <Pill icon={<Clock className="size-3.5" />} label="دقائق" value={perf.totalDelayMinutes} color="text-amber-400" bg="bg-amber-500/8 border-amber-500/12" />
          <Pill icon={<DollarSign className="size-3.5" />} label="خصومات" value={`${perf.totalDeductionAmount.toFixed(0)} ج`} color="text-brand-400" bg="bg-brand-500/8 border-brand-500/12" />
          <Pill icon={<CalendarClock className="size-3.5" />} label="أيام" value={perf.totalDeductionDays.toFixed(1)} color="text-cyan-400" bg="bg-cyan-500/8 border-cyan-500/12" />
        </div>
        {perf.departments.length > 0 && (
          <div className="space-y-2">
            <p className="text-slate-500 text-[10px] font-semibold mb-2">حسب القسم:</p>
            {perf.departments.slice(0, 6).map((d: any) => (
              <div key={d.departmentName} className="p-2.5 rounded-lg bg-slate-700/10">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-white text-[11px] font-medium truncate">{d.departmentName}</span>
                  <span className="text-[10px] text-slate-400 tabular-nums">{d.totalDelays} تأخير</span>
                </div>
                <MiniBar value={d.totalDelays} max={perf.totalDelays || 1} color="bg-gradient-to-l from-red-500 to-amber-500" />
              </div>
            ))}
            {stats?.topOffenders && stats.topOffenders.length > 0 && (
              <div className="pt-2 border-t border-slate-700/30">
                <p className="text-slate-500 text-[10px] font-semibold mb-2">أعلى المخالفين:</p>
                {stats.topOffenders.slice(0, 4).map((o) => (
                  <div key={o.employeeId} className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/30 mb-1">
                    <span className="text-slate-300 text-[11px] truncate">{o.employeeName}</span>
                    <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[9px]">{o.delayCount}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DashboardCard>
    ),

    qualityDeductionsDetail: (
      <DashboardCard title="تفاصيل خصومات الجودة" icon={<Award className="size-4" />} iconBg="bg-orange-500/10" iconColor="text-orange-400" borderClr="border-orange-500/20"
        actions={<NavBtn onClick={() => navigateTo('quality')} label="صفحة الجودة" icon={<ExternalLink className="size-3" />} color="text-orange-400" />}
        size="medium"
        empty={stats?.qualitySummary.totalCases === 0}
        emptyIcon={<Award className="size-10" />}
        emptyMessage="لا توجد خصومات جودة هذا الشهر">
        <div className="flex flex-wrap gap-2 mb-4">
          <Pill icon={<Award className="size-3.5" />} label="حالات" value={stats?.qualitySummary.totalCases ?? 0} color="text-orange-400" bg="bg-orange-500/8 border-orange-500/12" />
          <Pill icon={<DollarSign className="size-3.5" />} label="مبلغ" value={`${(stats?.qualitySummary.totalAmount ?? 0).toFixed(0)} ج`} color="text-red-400" bg="bg-red-500/8 border-red-500/12" />
          <Pill icon={<CalendarClock className="size-3.5" />} label="أيام" value={(stats?.qualitySummary.totalDays ?? 0).toFixed(1)} color="text-brand-400" bg="bg-brand-500/8 border-brand-500/12" />
        </div>
        {stats?.qualitySummary && Object.entries(stats.qualitySummary.byType).length > 0 && (
          <div className="space-y-2.5">
            <p className="text-slate-500 text-[10px] font-semibold">حسب النوع:</p>
            {Object.entries(stats.qualitySummary.byType).map(([type, count]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 w-24 truncate">{type}</span>
                <MiniBar value={count as number} max={stats.qualitySummary.totalCases} color="bg-gradient-to-l from-orange-500 to-amber-500" />
                <span className="text-[10px] text-slate-300 font-mono w-6 text-left">{count}</span>
              </div>
            ))}
          </div>
        )}
      </DashboardCard>
    ),

    travelItineraryDetail: (
      <DashboardCard title="تفاصيل جدول السفر" icon={<Plane className="size-4" />} iconBg="bg-rose-500/10" iconColor="text-rose-400" borderClr="border-rose-500/20"
        actions={<NavBtn onClick={() => navigateTo('travel')} label="صفحة السفر" icon={<ExternalLink className="size-3" />} color="text-rose-400" />}
        size="medium"
        empty={stats?.upcomingTravel.length === 0}
        emptyIcon={<Plane className="size-10" />}
        emptyMessage="لا توجد رحلات قادمة">
        <div className="space-y-2">
          {stats?.upcomingTravel.slice(0, 10).map((t) => {
            const urgent = isUrgent(t.departureDate);
            return (
              <div key={t.id} className={`p-2.5 rounded-lg border transition-all ${urgent ? 'border-rose-500/25 bg-rose-500/5' : 'border-slate-700/20 bg-slate-700/10'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white text-[11px] font-semibold truncate">{t.employeeName}</span>
                  {urgent && <Badge className="bg-rose-500/15 text-rose-400 border-rose-500/20 text-[9px] rounded-lg px-1.5 shrink-0">عاجلة</Badge>}
                </div>
                <p className="text-slate-400 text-[10px] mt-1 truncate">🌍 {t.destination}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-slate-600 text-[10px]">المغادرة: {t.departureDate}</span>
                  {t.returnDate && <span className="text-slate-600 text-[10px]">العودة: {t.returnDate}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </DashboardCard>
    ),
  };

  /* ═══ RENDER: grid order (edit draft vs resolved layout) ═══ */
  const gridWidgetIds = editMode
    ? draftOrder.filter((id) => !draftHidden.has(id) && widgetBodies[id])
    : widgetLayout.map((w) => w.id).filter((id) => widgetBodies[id]);
  const hiddenDraftWidgets = editMode
    ? draftOrder.filter((id) => draftHidden.has(id) && widgetBodies[id])
    : [];

  return (
    <div className="space-y-5 pb-8">

      {/* ═══ §HEADER-V3 — page identity + contextual actions live in the
          global Header now (title/date, quick actions, تخصيص/تحديث).
          The page keeps its in-place edit-mode banner and surfaces. ═══ */}

      {/* ═══ EDIT MODE banner (§3) ═══ */}
      {editMode && (
        <div className="flex items-center gap-2 rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-2.5 text-xs text-brand-300">
          <GripVertical className="size-4 shrink-0" />
          وضع التخصيص: اسحب البطاقات لإعادة ترتيبها، وأخفِ ما لا تحتاجه — اضغط «حفظ» لتثبيت التخطيط.
        </div>
      )}

      {/* ═══ OPERATIONAL SNAPSHOT — one compact metric row (§8/§22):
          each card opens the EXACT records it represents in place. ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <CompactMetricCard label="إجمالي الموظفين" value={stats.totalEmployees} hint={`${stats.departmentList.length} قسم`} icon={<Users className="size-4" />} tone="violet" onClick={() => canViewPage('employees') || employeesData ? setStatDetail('employees') : undefined} />
        <CompactMetricCard label="نسبة الحضور" value={`${stats.attendanceRate}%`} hint={`${stats.presentCount} حاضر اليوم`} icon={<UserCheck className="size-4" />} tone={stats.attendanceRate >= 80 ? 'positive' : stats.attendanceRate >= 50 ? 'warning' : 'danger'} onClick={() => setStatDetail('attendance')} />
        <CompactMetricCard label="متأخرو اليوم" value={stats.lateCount} hint={`${stats.absentCount} غائب`} icon={<Clock className="size-4" />} tone={stats.lateCount > 0 ? 'warning' : 'positive'} onClick={() => setStatDetail('late')} />
        <CompactMetricCard label="طلبات معلقة" value={stats.pendingRequests} hint="بانتظار الموافقة" icon={<Bell className="size-4" />} tone={stats.pendingRequests > 5 ? 'danger' : 'default'} onClick={() => setStatDetail('pending-requests')} />
        <CompactMetricCard label="تأخيرات الشهر" value={perf.totalDelays} hint={`${perf.totalDelayMinutes} دقيقة`} icon={<Flame className="size-4" />} tone={delayChange > 0 ? 'danger' : 'default'} trend={{ direction: delayChange > 0 ? 'up' : delayChange < 0 ? 'down' : 'neutral', label: `${delayChange === 0 ? '—' : `${Math.abs(delayChange)}%`}` }} />
        <CompactMetricCard label="خصومات الشهر" value={perf.totalDeductionAmount.toFixed(0)} hint={`${perf.totalDeductionDays.toFixed(1)} يوم`} icon={<DollarSign className="size-4" />} tone={dedChange > 0 ? 'danger' : 'default'} trend={{ direction: dedChange > 0 ? 'up' : dedChange < 0 ? 'down' : 'neutral', label: `${dedChange === 0 ? '—' : `${Math.abs(dedChange)}%`}` }} />
      </div>

      {/* §22 — in-place metric detail surfaces (exact represented records) */}
      <HomeStatDetailDialog
        kind={statDetail}
        stats={stats}
        employees={(employeesData ?? []) as Array<{ id: string; name: string; department?: string | null; position?: string | null }>}
        onRequestAction={(id, action) => handleRequestAction(id, action)}
        actionLoadingId={actionLoading}
        onClose={() => setStatDetail(null)}
      />

      {/* §HEADER-V3 — the quick-create actions moved into the Header's
          compact quick-actions menu. The inline action surface stays
          HERE (same handlers, same query invalidations): activating a
          menu action scrolls it into view. §5/§6 — CAPA truly inline;
          others navigate with intent and reuse the destination's
          existing create dialog. Mounted only while a quick action is
          active so the page stays compact when idle. */}
      <div ref={quickActionHostRef} style={{ scrollMarginTop: '56px' }}>
        {activeQuickAction && (
          <HomeQuickActionHost
            activeAction={activeQuickAction}
            onClose={() => setActiveQuickAction(null)}
          />
        )}
      </div>

      {/* ═══ WIDGET GRID — §3 draggable, ordered by personal layout ═══ */}
      <div
        className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
        onDragOver={(e) => { if (editMode && dragId) e.preventDefault(); }}
      >
        {gridWidgetIds.map((widgetId) => {
          const isDragging = dragId === widgetId;
          const isOverTarget = overId === widgetId && dragId !== null && dragId !== widgetId;
          return (
            <div
              key={widgetId}
              draggable={editMode}
              onDragStart={(e) => {
                if (!editMode) return;
                setDragId(widgetId);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', widgetId); } catch { /* optional */ }
              }}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => { if (editMode && dragId && dragId !== widgetId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOverId(widgetId); } }}
              onDrop={(e) => { e.preventDefault(); handleDropOn(widgetId); }}
              className={`relative h-full ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
            >
              {/* §3 Drop indicator — the destination card gets a live
                  violet ring + placement chip BEFORE the drop happens. */}
              {isOverTarget && (
                <div className="absolute -top-2 right-3 z-20 flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-600 text-[9px] font-bold text-white shadow-lg pointer-events-none">
                  سيتم النقل هنا
                </div>
              )}
              {editMode && (
                <div className={`absolute inset-0 rounded-2xl pointer-events-none z-10 transition-all ${isDragging ? 'border-2 border-dashed border-brand-400 bg-brand-500/5' : isOverTarget ? 'ring-2 ring-brand-500 ring-offset-2 ring-offset-slate-950' : ''}`} />
              )}
              {editMode && (
                <div className="absolute top-1.5 left-1.5 z-20 flex items-center gap-1 pointer-events-none">
                  <span className="flex items-center justify-center size-7 rounded-lg bg-slate-900/90 border border-brand-500/40 text-brand-400">
                    <GripVertical className="size-3.5" />
                  </span>
                </div>
              )}
              {editMode && (
                <button
                  type="button"
                  onClick={() => toggleDraftHidden(widgetId)}
                  aria-label="إخفاء البطاقة"
                  title="إخفاء البطاقة"
                  className="absolute top-1.5 left-10 z-20 flex items-center justify-center size-7 rounded-lg bg-slate-900/90 border border-slate-600/50 text-slate-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
                >
                  <EyeOff className="size-3.5" />
                </button>
              )}
              {widgetBodies[widgetId]}
            </div>
          );
        })}
      </div>

      {/* ═══ HIDDEN WIDGETS TRAY (§3 — edit mode only) ═══ */}
      {editMode && (
        <div className="rounded-2xl border border-dashed border-slate-700/60 bg-slate-800/20 p-4">
          <p className="text-[10px] font-bold text-slate-500 mb-2.5 flex items-center gap-1.5">
            <EyeOff className="size-3" /> بطاقات مخفية ({hiddenDraftWidgets.length}) — اضغط لإظهارها
          </p>
          {hiddenDraftWidgets.length === 0 ? (
            <p className="text-[11px] text-slate-600">كل البطاقات المعروضة حالياً.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hiddenDraftWidgets.map((id) => {
                const cfg = DASHBOARD_WIDGETS.find((w) => w.id === id);
                return (
                  <button key={id} onClick={() => toggleDraftHidden(id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-slate-700/50 bg-slate-800/50 text-slate-400 hover:text-white hover:border-emerald-500/40 transition-all">
                    <Eye className="size-3 text-emerald-400" />
                    {cfg?.title ?? id}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ EMPTY FALLBACK — all widgets hidden ═══ */}
      {gridWidgetIds.length === 0 && !editMode && (
        <Card className="border-slate-700/50 bg-slate-800/30">
          <CardContent className="py-14">
            <EmptyState icon={<Inbox className="size-12" />} message="جميع البطاقات مخفية — فعّل وضع «تخصيص» لإظهار ما تحتاجه." />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
