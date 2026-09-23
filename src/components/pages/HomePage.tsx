'use client';

// ══════════════════════════════════════════════════════════════
//  HomePage — §Home-CC OPERATIONAL WORKSPACE
//
//  NOT a card dashboard. The page is ONE continuous operational
//  surface — sections, rows, a work queue, a timeline, a matrix and
//  a stream, separated by typography and hairlines (no bordered
//  containers as the primary structure):
//
//    1. WORK QUEUE          — the AttentionPanel in its queue variant:
//                             WHAT · WHO/WHY · URGENCY · [inline action]
//    2. TODAY               — one quiet summary strip of clickable
//                             operational indicators (not cards)
//    3. OPERATIONAL TIMELINE— a rail of real events with their
//                             canonical date dimensions
//    4. TEAM STATUS         — an operational matrix (one surface,
//                             one row per authorized department)
//    5. PERFORMANCE         — a compact analytical signal line over
//                             the canonical KPI engine output
//    6. RECENT ACTIVITY     — the user's own notification stream
//    7. SHORTCUTS / STATUS  — pins, favorites, system status line
//
//  §5 DATE SEMANTICS — each number counts its OWN canonical date:
//    Closed Deals → closedAt (CLOSED) · Travel → departureDate
//    (TRAVEL) · Quality → the deduction month · Performance → the
//    canonical KPI engine (never recomputed here, never AI).
//  §9/§10 — Metric → Insight Details → View Records → navigateTo
//  (existing engine) → Qnalys Global Highlight on the exact record.
//  §12 — authorization stays server-side (scope + page permissions).
//  §13 — NO new polling/loops; the existing queries only.
//  §17 — personalization persists through the SAME widgetOrder /
//         hiddenWidgets keys — but it personalizes SECTIONS of one
//         workspace, never a grid of cards.
// ══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore, type HeaderContextualAction } from '@/lib/store';
import { usePageIdentity, usePageHeaderActions } from '@/hooks/use-page-header';
import { useHomeStats, useUpdateRequest } from '@/hooks/use-queries';
import { apiFetch } from '@/lib/query-provider';
import { HomeInsightDetailsDialog, type HomeMetricInsight } from '@/components/shared/HomeInsightDetailsDialog';
import { HomeQuickActionHost } from '@/components/shared/HomeQuickActionHost';
import { AttentionPanel, type AttentionItem } from '@/components/shared/AttentionPanel';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { isUrgent, getRequestTypeLabel } from '@/lib/date-utils';
import {
  Clock, FileText, Plane, AlertTriangle, CheckCircle2,
  RefreshCw, Eye, EyeOff,
  Users, Zap,
  Award, Fingerprint,
  ExternalLink, ClipboardList, Gauge,
  GripVertical, Inbox, Star, Pin as PinIcon, X, Save,
  History, Database,
} from 'lucide-react';
import { playNotificationSound } from '@/lib/sounds';
import { DASHBOARD_WIDGETS } from '@/config/dashboard-widgets';
import { resolveWidgetLayout } from '@/lib/personalization';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDate, formatInteger, formatMonthKey, formatTime, displayLocale } from '@/lib/i18n/format';
import type { Locale } from '@/lib/i18n/dictionary';
import {
  useUserPreferences,
  useSaveUserPreferences,
} from '@/hooks/use-user-preferences';
import type { ReactNode } from 'react';

/* ═══════════════════════════════════════════════════════════
   TYPES (data contracts — /api/home/stats)
   ═══════════════════════════════════════════════════════════ */

interface PendingRequestDetail {
  id: string; employeeId: string; type: string; date: string;
  reason: string; status: string; employeeName: string;
  employeeDepartment: string; createdAt: string;
}

interface TravelAlertItem {
  id: string; employeeId: string; employeeName: string;
  employeeDepartment: string; destination: string; departureDate: string;
  returnDate: string | null; notes: string | null; status: string;
}

interface DeptTodayStat { name: string; employeeCount: number; presentToday: number; lateToday: number; absentToday: number; }
interface RequestTypeSummary { type: string; label: string; pending: number; approved: number; rejected: number; }
interface TodayFollowUpItem { id: string; employeeId: string; employeeName: string; employeeDepartment: string; responsiblePersonName: string; responsiblePersonId: string; followUpType: string; priorityLevel: string; status: string; nextFollowUpDate: string; }
interface FollowUpsSummary { totalActive: number; totalOverdue: number; totalCompleted: number; todaysScheduled: number; }
/** §Home-CC WORK QUEUE — per-item overdue follow-up (derived server-side). */
interface OverdueFollowUpItem { id: string; employeeId: string; employeeName: string; employeeDepartment: string; followUpType: string; priorityLevel: string; responsiblePersonName: string; nextFollowUpDate: string; daysOverdue: number; }

interface MonthlyPerformance {
  monthLabel: string; monthKey: string; totalDelays: number;
  totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number;
  totalPresent: number; totalAbsent: number; totalWorkingDays: number;
  departments: { departmentName: string; employeeCount: number; totalDelays: number; totalDelayMinutes: number; totalDeductionAmount: number; totalDeductionDays: number; presentDays: number; absentDays: number; employees: unknown[] }[];
}
interface TopOffender { employeeId: string; employeeName: string; department: string; delayCount: number; totalDelayMinutes: number; deductionAmount: number; }
interface RuleSummary { key: string; label: string; amount: number; unit: string; }

/** §Home-CC — CLOSED-dimension closed-deal summary (deal-dates.ts). */
interface ClosedDealSummary {
  closedThisMonth: number;
  closedUnknown: number;
  totalValue: number;
  monthKey: string;
  lastUpdated: string | null;
}

/** §Home-CC §6 — a REAL operational event (server-composed). */
interface TimelineEvent {
  id: string;
  type: 'deal_completed' | 'quality_observation' | 'followup_completed' | 'approval' | 'complaint' | 'capa_update' | 'travel_milestone';
  title: string;
  description?: string;
  entityType: 'travelDeal' | 'qualityDeduction' | 'followUp' | 'request' | 'complaint' | 'capaCase';
  entityId: string;
  employeeId?: string;
  employeeName?: string;
  department?: string;
  date: string;
  dateDimension?: 'CREATED' | 'CLOSED' | 'TRAVEL';
  createdAt: string;
}

/** §Home-CC §7 — one authorized department's pulse (server-computed). */
interface DepartmentPulse {
  name: string;
  employeeCount: number;
  attendanceRate: number;
  openFollowUps: number;
  qualityCasesThisMonth: number;
  pendingApprovals: number;
  activeTravel: number;
  trend: -1 | 0 | 1;
  lastActivity: string | null;
}

/** §Home-CC §8 — deterministic performance aggregates. */
interface PerformancePulseData {
  currentScore: number | null;
  targetScore: number | null;
  progress: number | null;
  trend: Array<{ monthKey: string; score: number }>;
  completedWork: number;
  followUpCompletionRate: number;
  qualityDeductionsPerEmployee: number;
  lastCalculated: string | null;
}

interface MetricFreshness {
  dataFetchedAt: string;
  metricTimestamps: Record<string, string | null>;
}

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
  // §Home-CC
  overdueFollowUpItems?: OverdueFollowUpItem[];
  closedDealSummary?: ClosedDealSummary;
  recentTimeline?: TimelineEvent[];
  departmentPulse?: DepartmentPulse[];
  performancePulse?: PerformancePulseData;
  freshness?: MetricFreshness;
}

const emptyPerf: MonthlyPerformance = {
  monthLabel: '', monthKey: '', totalDelays: 0, totalDelayMinutes: 0,
  totalDeductionAmount: 0, totalDeductionDays: 0, totalPresent: 0, totalAbsent: 0,
  totalWorkingDays: 22, departments: [],
};

/* ═══════════════════════════════════════════════════════════
   HELPERS
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

function relativeTime(iso: string | null | undefined, locale?: Locale): string {
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
  return formatDate(iso, locale ?? displayLocale());
}

/** DD/MM/YYYY → canonical YYYY-MM month key (§5 date semantics). */
function dmyToMonthKey(dmy: string): string | null {
  const p = dmy.split('/');
  if (p.length !== 3) return null;
  return `${p[2]}-${p[1].padStart(2, '0')}`;
}

/** Pure array move — section reordering in edit mode. */
function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/* ═══════════════════════════════════════════════════════════
   WORKSPACE PRIMITIVES — sections/rows, never cards
   ═══════════════════════════════════════════════════════════ */

/**
 * WorkspaceSection — the ONLY structural primitive on Home. A
 * typographic header (small-caps label + optional count) over
 * borderless content. Grouping comes from spacing, the hairline
 * under the header, and the label itself — never a box.
 * In edit mode the header carries the grip + hide controls.
 */
function WorkspaceSection({
  label, count, editMode, hidden, onToggleHidden, children,
}: {
  label: string;
  count?: string | number;
  editMode?: boolean;
  hidden?: boolean;
  onToggleHidden?: () => void;
  children?: ReactNode;
}) {
  return (
    <section aria-label={label} className="relative">
      <div className="flex items-center gap-2.5 border-b border-slate-500/10 pb-1.5 min-w-0">
        {editMode && (
          <span className="flex items-center justify-center size-6 rounded-md bg-brand-500/10 border border-brand-500/25 text-brand-400 shrink-0" aria-hidden="true">
            <GripVertical className="size-3.5" />
          </span>
        )}
        <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-text-muted truncate">{label}</h2>
        {count !== undefined && count !== 0 && (
          <span className="text-[10px] font-semibold text-text-muted tabular-nums shrink-0">{count}</span>
        )}
        <span className="flex-1 min-w-4" />
        {editMode && onToggleHidden && (
          <button
            type="button"
            onClick={onToggleHidden}
            aria-label={hidden ? 'إظهار القسم' : 'إخفاء القسم'}
            title={hidden ? 'إظهار القسم' : 'إخفاء القسم'}
            className={`p-1 rounded-md transition-colors shrink-0 ${hidden ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-text-muted hover:text-red-400 hover:bg-red-500/10'}`}
          >
            {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          </button>
        )}
      </div>
      {hidden ? null : children}
    </section>
  );
}

/**
 * TodayStat — one clickable indicator in the TODAY summary strip:
 * a quiet value+label text pair. The Insight Details surface opens
 * on click; nothing here is a card.
 */
function TodayStat({ value, label, tone = 'default', onClick }: {
  value: string;
  label: string;
  tone?: 'default' | 'danger' | 'warning' | 'positive';
  onClick?: () => void;
}) {
  const toneCls = tone === 'danger' ? 'text-red-400'
    : tone === 'warning' ? 'text-amber-400'
    : tone === 'positive' ? 'text-emerald-400'
    : 'text-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-baseline gap-1.5 rounded-md px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <span className={`text-lg font-bold tabular-nums leading-none ${toneCls}`}>{value}</span>
      <span className="text-[11px] text-text-muted group-hover:text-brand-400 transition-colors">{label}</span>
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ═══════════════════════════════════════════════════════════ */

export default function HomePage() {
  const { canViewPage: hookCanViewPage, canEditPage, canDoAction } = usePermissions('home');
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { locale, t } = useLanguage();
  const canViewPage = useCallback((pid: string) => pid === 'home' || hookCanViewPage(pid), [hookCanViewPage]);
  /** Bilingual sentence helper (ar source / en) — no runtime-DOM dependency. */
  const L = useCallback((ar: string, en: string) => (locale === 'ar' ? ar : en), [locale]);

  // ── Data ──
  const { data: rawStats, isLoading: loading, refetch, isFetching: refreshing, dataUpdatedAt } = useHomeStats();
  const updateRequestMutation = useUpdateRequest();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [insight, setInsight] = useState<HomeMetricInsight | null>(null);
  const soundRef = useRef(false);
  const clock = useLiveClock();
  const todayDate = useLiveDate();

  // Canonical reporting month (§5 — the KPI/reporting period).
  const currentMonthKey = useMemo(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  // §Home-CC §8 — the CANONICAL Quality-KPI level from the KPI
  // engine's own management summary. Fetched only for viewers the
  // API would authorize (kpiReports view); one read, 5-min stale.
  const canViewKpi = canViewPage('kpiReports');
  const { data: kpiSummary, isLoading: kpiLoading, isError: kpiError } = useQuery({
    queryKey: ['home-kpi-summary', currentMonthKey],
    queryFn: () => apiFetch<any>(`/api/kpi-reports/summary?month=${currentMonthKey}`),
    enabled: canViewKpi,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // ── Recent activity stream (the user's OWN notifications) ──
  // /api/notifications returns an envelope { data, … } — unwrap once.
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
      if (stats.upcomingTravel.some((tr) => isUrgent(tr.departureDate))) {
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

  // ── Personalization (§17) — SAME keys, SECTION granularity ──
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
  const [activeQuickAction, setActiveQuickAction] = useState<string | null>(null);
  const [draftOrder, setDraftOrder] = useState<string[]>([]);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [savingLayout, setSavingLayout] = useState(false);

  const enterEditMode = useCallback(() => {
    const hiddenSet = new Set(userPreferences?.dashboard?.hiddenWidgets ?? []);
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

  // ═══ §HEADER-V3 — page identity + contextual actions ═══
  usePageIdentity({
    title: t('home.title'),
    description: (
      <>
        {todayDate} · <span className="font-mono tabular-nums" dir="ltr">{clock}</span>
        {dataUpdatedAt ? (
          <> · <span className="inline-flex items-center gap-1 text-slate-500">
            <Database className="size-3" />
            {t('home.lastUpdated')} <span className="font-mono tabular-nums" dir="ltr">{formatTime(new Date(dataUpdatedAt))}</span>
          </span></>
        ) : null}
      </>
    ),
    icon: <Gauge className="size-4 text-brand-400" />,
  });

  const headerActions = useMemo<HeaderContextualAction[]>(() => {
    const actions: HeaderContextualAction[] = [];
    if (canDoAction('employees', 'create')) actions.push({ id: 'qa-employees', label: 'إضافة موظف', icon: <Users className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('employees'), active: activeQuickAction === 'employees' });
    if (canDoAction('observations', 'create')) actions.push({ id: 'qa-observations', label: 'ملاحظة جودة', icon: <Award className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('observations'), active: activeQuickAction === 'observations' });
    if (canDoAction('capa', 'create')) actions.push({ id: 'qa-capa', label: 'إنشاء CAPA', icon: <ClipboardList className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('capa'), active: activeQuickAction === 'capa' });
    if (canDoAction('complaints', 'create')) actions.push({ id: 'qa-complaints', label: 'إضافة شكوى', icon: <AlertTriangle className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('complaints'), active: activeQuickAction === 'complaints' });
    if (canDoAction('followUps', 'create')) actions.push({ id: 'qa-followUps', label: 'متابعة جديدة', icon: <ClipboardList className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('followUps'), active: activeQuickAction === 'followUps' });
    if (canDoAction('requests', 'create')) actions.push({ id: 'qa-requests', label: 'طلب جديد', icon: <FileText className="size-3.5" />, display: 'menu', onClick: () => setActiveQuickAction('requests'), active: activeQuickAction === 'requests' });

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

  const quickActionHostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeQuickAction) {
      quickActionHostRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeQuickAction]);

  // ── Derived ──
  const closedDeals = stats?.closedDealSummary;
  const deptPulse = stats?.departmentPulse;
  const timeline = stats?.recentTimeline ?? [];
  const metricFreshness = stats?.freshness?.metricTimestamps ?? {};

  // Stable section-id → config lookup (registry titles, edit tray).
  const widgetIdToConfig = useMemo(
    () => new Map(DASHBOARD_WIDGETS.map((w) => [w.id, w])),
    [],
  );

  /* Timeline navigation — exact records via the Qnalys highlight.
     (Hook-safe: defined before any early return.) */
  const navigateTimelineEvent = useCallback((ev: TimelineEvent) => {
    switch (ev.entityType) {
      case 'travelDeal':
        navigateTo('travel', ev.entityId);
        break;
      case 'qualityDeduction': {
        const mk = dmyToMonthKey(ev.date);
        navigateTo('quality', ev.entityId, mk ? { month: mk } : undefined);
        break;
      }
      case 'followUp':
        navigateTo('followUps', ev.entityId);
        break;
      case 'request':
        navigateTo('requests', ev.entityId);
        break;
      case 'complaint':
        navigateTo('complaints', ev.entityId);
        break;
      case 'capaCase':
        // CAPA page has no record-level highlight targets yet —
        // page-level navigation (never a highlight that cannot resolve).
        navigateTo('capa');
        break;
    }
  }, [navigateTo]);

  // ── Loading skeleton — the same quiet vertical structure ──
  if (loading) {
    return (
      <div className="space-y-8">
        <div className="space-y-2"><Skeleton className="h-4 w-44" /><Skeleton className="h-20 w-full rounded-lg" /></div>
        <div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-9 w-full rounded-lg" /></div>
        <div className="space-y-2"><Skeleton className="h-4 w-36" /><Skeleton className="h-44 w-full rounded-lg" /></div>
        <div className="space-y-2"><Skeleton className="h-4 w-28" /><Skeleton className="h-32 w-full rounded-lg" /></div>
      </div>
    );
  }

  if (!stats) return (
    <div>
      <h1 className="text-2xl font-bold text-foreground">{t('home.title')}</h1>
      <div className="flex flex-col items-center justify-center py-16 text-text-muted">
        <Inbox className="size-10 mb-3" />
        <p className="text-sm">{t('state.empty')}</p>
      </div>
    </div>
  );

  /* ═══ WORK QUEUE (§3/§4) — per-record operational rows ═══
     Each row answers WHAT / WHO / WHY / URGENCY / NEXT ACTION.
     Decisions happen inline (overflow on request rows); the row
     click navigates to the EXACT record via the Qnalys highlight. */
  const urgentTravels = stats.upcomingTravel.filter((tr) => isUrgent(tr.departureDate));
  const FUTYPE_LABELS: Record<string, string> = { quality: 'جودة', behavior: 'سلوك', attendance: 'حضور', productivity: 'إنتاجية', training: 'تدريب', customerHandling: 'التعامل مع العملاء' };
  const queueItems: AttentionItem[] = [];

  // 1) Overdue follow-ups — per record, most urgent first.
  for (const f of stats.overdueFollowUpItems ?? []) {
    queueItems.push({
      id: `q-fu-${f.id}`,
      severity: 'critical',
      primary: L(`متابعة متأخرة — ${FUTYPE_LABELS[f.followUpType] || f.followUpType}`, `Overdue follow-up — ${f.followUpType}`),
      secondary: `${f.employeeName}${f.employeeDepartment ? ` · ${f.employeeDepartment}` : ''}${f.responsiblePersonName ? ` — ${L('مسؤول', 'owner')}: ${f.responsiblePersonName}` : ''}`,
      trailing: L(`${f.daysOverdue} ${f.daysOverdue === 1 ? 'يوم' : 'أيام'} تأخير`, `${f.daysOverdue}d overdue`),
      actionLabel: t('action.followUp'),
      onClick: () => navigateTo('followUps', f.id),
    });
  }

  // 2) Urgent travels — per record (TRAVEL date ≤ 72h).
  urgentTravels.slice(0, 3).forEach((tr) => {
    queueItems.push({
      id: `q-travel-${tr.id}`,
      severity: 'critical',
      primary: L(`رحلة عاجلة — ${tr.destination}`, `Urgent trip — ${tr.destination}`),
      secondary: `${tr.employeeName}${tr.employeeDepartment ? ` · ${tr.employeeDepartment}` : ''}`,
      trailing: L(`المغادرة ${tr.departureDate}`, `departs ${tr.departureDate}`),
      actionLabel: t('action.open'),
      onClick: () => navigateTo('travel', tr.id),
    });
  });

  // 3) Late employees — per record.
  stats.lateEmployees.slice(0, 3).forEach((late) => {
    queueItems.push({
      id: `q-late-${late.id}`,
      severity: 'urgent',
      primary: L(`تأخير حضور — ${late.minutesLate} دقيقة`, `Late arrival — ${late.minutesLate} min`),
      secondary: `${late.employeeName}${late.department ? ` · ${late.department}` : ''}${late.checkIn ? ` — ${L('دخول', 'in')} ${late.checkIn}` : ''}`,
      actionLabel: t('action.open'),
      onClick: () => navigateTo('attendance', undefined, { status: 'late' }),
    });
  });

  // 4) Pending requests — per record with INLINE decisions (⋮).
  const canDecideRequests = canEditPage('requests');
  stats.pendingRequestsDetails.slice(0, 4).forEach((req) => {
    queueItems.push({
      id: `q-req-${req.id}`,
      severity: 'warning',
      primary: L(`${getRequestTypeLabel(req.type)} — بانتظار الموافقة`, `${req.type} — awaiting approval`),
      secondary: `${req.employeeName}${req.employeeDepartment ? ` · ${req.employeeDepartment}` : ''}${req.reason ? ` — ${req.reason}` : ''}`,
      trailing: req.createdAt ? relativeTime(req.createdAt, locale) : undefined,
      actionLabel: t('action.review'),
      onClick: () => navigateTo('requests', req.id, { status: 'pending' }),
      overflowItems: canDecideRequests ? [
        {
          key: `approve-${req.id}`,
          label: actionLoading === req.id ? '...' : L('موافقة', 'Approve'),
          onSelect: () => void handleRequestAction(req.id, 'approved'),
        },
        {
          key: `reject-${req.id}`,
          label: actionLoading === req.id ? '...' : L('رفض', 'Reject'),
          destructive: true,
          onSelect: () => void handleRequestAction(req.id, 'rejected'),
        },
      ] : undefined,
    });
  });
  if (stats.pendingRequests > 4) {
    queueItems.push({
      id: 'q-req-more',
      severity: 'warning',
      primary: L(`${stats.pendingRequests} طلبات بانتظار الموافقة`, `${stats.pendingRequests} requests awaiting approval`),
      secondary: L('القرارات على بقية الطلبات من صفحة الطلبات.', 'Decide the rest on the Requests page.'),
      actionLabel: t('action.review'),
      onClick: () => navigateTo('requests', undefined, { status: 'pending' }),
    });
  }

  // 5) Due-today follow-ups — per record.
  stats.todaysFollowUps.slice(0, 3).forEach((fu) => {
    queueItems.push({
      id: `q-todayfu-${fu.id}`,
      severity: 'warning',
      primary: L(`متابعة مستحقة اليوم — ${FUTYPE_LABELS[fu.followUpType] || fu.followUpType}`, `Follow-up due today — ${fu.followUpType}`),
      secondary: `${fu.employeeName}${fu.employeeDepartment ? ` · ${fu.employeeDepartment}` : ''}${fu.responsiblePersonName ? ` — ${L('مسؤول', 'owner')}: ${fu.responsiblePersonName}` : ''}`,
      actionLabel: t('action.followUp'),
      onClick: () => navigateTo('followUps', fu.id, { dueToday: '1' }),
    });
  });

  // 6) Quality month — one aggregate row (per-record quality events
  //    live in the timeline below).
  if (stats.qualitySummary.totalCases > 0) {
    queueItems.push({
      id: 'q-quality',
      severity: 'info',
      primary: L(`${stats.qualitySummary.totalCases} حالات جودة هذا الشهر`, `${stats.qualitySummary.totalCases} quality cases this month`),
      secondary: stats.qualitySummary.totalAmount > 0 ? L(`خصومات ${stats.qualitySummary.totalAmount.toFixed(0)} ج.م`, `${stats.qualitySummary.totalAmount.toFixed(0)} EGP in deductions`) : undefined,
      actionLabel: t('action.review'),
      onClick: () => navigateTo('quality', undefined, { month: currentMonthKey }),
    });
  }

  /* ═══ TODAY STRIP (§5) — one quiet line of clickable indicators.
     Every value keeps its own business definition (Insight Details)
     and its own canonical date semantics. ═══ */
  const openInsightFor = {
    attendance: () => setInsight({
      key: 'attendance-rate',
      label: t('home.attendanceRate'),
      value: `${stats.attendanceRate}%`,
      period: todayDate,
      scope: L('الموظفون ضمن نطاق صلاحياتك', 'Employees within your authorized scope'),
      businessRule: L(
        'الحاضرون اليوم ÷ إجمالي القوة العاملة المرخصة — صفر يعني لا حركة حضور اليوم، وليس أداءً.',
        'Present today ÷ total authorized workforce — zero means no attendance recorded today, not performance.'),
      source: L('attendance — سجلات اليوم (حاضر/متأخر/غائب)', 'attendance — today\'s records (present/late/absent)'),
      freshness: metricFreshness.attendance ?? null,
      breakdown: [
        { label: L('حاضر', 'Present'), value: formatInteger(stats.presentCount, locale) },
        { label: L('متأخر', 'Late'), value: formatInteger(stats.lateCount, locale) },
        { label: L('غائب', 'Absent'), value: formatInteger(stats.absentCount, locale) },
      ],
      navigateTo: { page: 'attendance' },
    }),
    late: () => setInsight({
      key: 'late-today',
      label: t('home.lateToday'),
      value: formatInteger(stats.lateCount, locale),
      period: todayDate,
      scope: L('سجلات الحضور ضمن نطاق صلاحياتك', 'Attendance records within your authorized scope'),
      businessRule: L(
        'سجلات حالة «متأخر» لتاريخ اليوم — سجل واحد لكل تأخير.',
        'Attendance records with status "late" for today — one record per late arrival.'),
      source: L('attendance — status=late + تاريخ اليوم', 'attendance — status "late" + today\'s date'),
      freshness: metricFreshness.attendance ?? null,
      breakdown: stats.lateEmployees.slice(0, 4).map((l) => ({ label: l.employeeName, value: `${l.minutesLate} ${L('د', 'min')}` })),
      navigateTo: { page: 'attendance', params: { status: 'late' } },
    }),
    pendingApprovals: () => setInsight({
      key: 'pending-approvals',
      label: t('home.pendingApprovals'),
      value: formatInteger(stats.pendingRequests, locale),
      period: todayDate,
      scope: L('كل الطلبات ضمن نطاق صلاحياتك', 'All requests within your authorized scope'),
      businessRule: L(
        'عدد الطلبات بحالة «بانتظار الموافقة» — لا تُحسب الطلبات المعتمدة أو المرفوضة.',
        'Requests whose status is "pending" — approved and rejected requests are never counted.'),
      source: L('requests — حالة pending', 'requests table — status "pending"'),
      freshness: metricFreshness.requests ?? null,
      breakdown: stats.requestTypeSummary.filter((rt) => rt.pending > 0).map((rt) => ({ label: rt.label, value: rt.pending })),
      navigateTo: { page: 'requests', params: { status: 'pending' } },
    }),
    overdueFollowUps: () => setInsight({
      key: 'overdue-follow-ups',
      label: t('home.overdueFollowUps'),
      value: formatInteger(stats.followUpsSummary.totalOverdue, locale),
      period: todayDate,
      scope: L('المتابعات ضمن نطاق صلاحياتك', 'Follow-ups within your authorized scope'),
      businessRule: L(
        'متابعة نشطة تجاوزت تاريخ متابعتها التالي (التعريف القانوني الموحّد isOverdueFollowUp) — العدد نفسه الذي تعرضه صفحة المتابعات.',
        'An active follow-up past its next follow-up date (the canonical isOverdueFollowUp predicate) — the same number the Follow-ups page shows.'),
      source: L('followUps — nextFollowUpDate < اليوم', 'followUps table — nextFollowUpDate < today'),
      freshness: metricFreshness.followUps ?? null,
      breakdown: (stats.overdueFollowUpItems ?? []).slice(0, 4).map((f) => ({ label: f.employeeName, value: L(`${f.daysOverdue} يوم`, `${f.daysOverdue}d`) })),
      navigateTo: { page: 'followUps', params: { overdue: '1' } },
    }),
    todaysFollowUps: () => setInsight({
      key: 'todays-follow-ups',
      label: t('home.todaysFollowUpsLabel'),
      value: formatInteger(stats.followUpsSummary.todaysScheduled, locale),
      period: todayDate,
      scope: L('المتابعات ضمن نطاق صلاحياتك', 'Follow-ups within your authorized scope'),
      businessRule: L(
        'متابعات نشطة موعدها التالي = تاريخ اليوم — بغضّ النظر عن الأولوية.',
        'Active follow-ups whose next date is today — regardless of priority.'),
      source: L('followUps — nextFollowUpDate = اليوم', 'followUps table — nextFollowUpDate = today'),
      freshness: metricFreshness.followUps ?? null,
      breakdown: stats.todaysFollowUps.slice(0, 4).map((f) => ({ label: f.employeeName, value: FUTYPE_LABELS[f.followUpType] || f.followUpType })),
      navigateTo: { page: 'followUps', params: { dueToday: '1' } },
    }),
    urgentTravel: () => setInsight({
      key: 'urgent-travel',
      label: t('home.upcomingTravel'),
      value: formatInteger(urgentTravels.length, locale),
      period: L('الـ72 ساعة القادمة', 'The next 72 hours'),
      scope: L('الرحلات ضمن نطاق صلاحياتك', 'Trips within your authorized scope'),
      businessRule: L(
        'رحلات نشطة تغادر خلال أقل من 3 أيام — محسوبة بتاريخ المغادرة (تاريخ السفر)، لا بتاريخ إنشاء الصفقة.',
        'Active trips departing in less than 3 days — counted by departure date (the TRAVEL date), never by record creation.'),
      source: L('travelDeals — departureDate + status نشط', 'travelDeals — departureDate + active status'),
      freshness: metricFreshness.travel ?? null,
      breakdown: urgentTravels.slice(0, 4).map((tr) => ({ label: `${tr.employeeName} → ${tr.destination}`, value: tr.departureDate })),
      navigateTo: { page: 'travel' },
    }),
    closedDeals: () => setInsight({
      key: 'closed-deals',
      label: t('home.closedDeals'),
      value: formatInteger(closedDeals?.closedThisMonth ?? 0, locale),
      period: formatMonthKey(closedDeals?.monthKey ?? currentMonthKey, locale),
      scope: L('الصفقات المكتملة ضمن نطاق صلاحياتك', 'Completed deals within your authorized scope'),
      businessRule: L(
        'الصفقات المكتملة التي سُجّل إغلاقها (closedAt) خلال هذا الشهر — تاريخ الإغلاق هو المرجع، وليس تاريخ السفر ولا تاريخ الإنشاء.',
        'Completed deals whose closure (closedAt) falls in this month — the CLOSED date is the reference, not the travel or creation date.'),
      source: L('travelDeals — status=completed + closedAt', 'travelDeals — status "completed" + closedAt'),
      freshness: closedDeals?.lastUpdated ?? null,
      breakdown: (closedDeals?.closedUnknown ?? 0) > 0
        ? [{ label: t('home.closedUnknown'), value: formatInteger(closedDeals!.closedUnknown, locale) }]
        : undefined,
      navigateTo: { page: 'travel', params: { month: closedDeals?.monthKey ?? currentMonthKey } },
    }),
    qualityCases: () => setInsight({
      key: 'quality-cases',
      label: t('home.qualityCases'),
      value: formatInteger(stats.qualitySummary.totalCases, locale),
      period: formatMonthKey(currentMonthKey, locale),
      scope: L('الخصومات المعتمدة ضمن نطاق صلاحياتك', 'Effective deductions within your authorized scope'),
      businessRule: L(
        'خصومات الجودة المعتمدة (الفعلية) لهذا الشهر — الخصومات المعلقة أو المرفوضة لا تُحسب أبداً.',
        'Effective (approved) quality deductions this month — pending or rejected deductions are never counted.'),
      source: L('qualityDeductions — month الحالي + اعتماد فعّال', 'qualityDeductions — current month + effective approval'),
      freshness: metricFreshness.quality ?? null,
      breakdown: Object.entries(stats.qualitySummary.byType).map(([label, value]) => ({ label, value })),
      navigateTo: { page: 'quality', params: { month: currentMonthKey } },
    }),
  };

  const todayStrip = (
    <WorkspaceSection label={`${t('home.today')} · ${todayDate}`}>
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3 py-3.5">
        <TodayStat value={`${stats.attendanceRate}%`} label={L('حضور', 'attendance')} tone={stats.attendanceRate >= 80 ? 'positive' : stats.attendanceRate >= 50 ? 'warning' : 'danger'} onClick={openInsightFor.attendance} />
        <TodayStat value={formatInteger(stats.lateCount, locale)} label={L('متأخرون', 'late')} tone={stats.lateCount > 0 ? 'warning' : 'positive'} onClick={openInsightFor.late} />
        <TodayStat value={formatInteger(stats.absentCount, locale)} label={L('غياب', 'absent')} tone={stats.absentCount > 0 ? 'warning' : 'positive'} onClick={openInsightFor.attendance} />
        <TodayStat value={formatInteger(stats.pendingRequests, locale)} label={L('قرارات معلقة', 'pending decisions')} tone={stats.pendingRequests > 0 ? 'warning' : 'positive'} onClick={openInsightFor.pendingApprovals} />
        <TodayStat value={formatInteger(stats.followUpsSummary.totalOverdue, locale)} label={L('متابعات متأخرة', 'overdue follow-ups')} tone={stats.followUpsSummary.totalOverdue > 0 ? 'danger' : 'positive'} onClick={openInsightFor.overdueFollowUps} />
        <TodayStat value={formatInteger(stats.followUpsSummary.todaysScheduled, locale)} label={L('متابعات اليوم', 'due today')} tone={stats.followUpsSummary.todaysScheduled > 0 ? 'warning' : 'default'} onClick={openInsightFor.todaysFollowUps} />
        <TodayStat value={formatInteger(urgentTravels.length, locale)} label={L('مغادرات 72س', 'departures 72h')} tone={urgentTravels.length > 0 ? 'warning' : 'default'} onClick={openInsightFor.urgentTravel} />
        <TodayStat value={formatInteger(closedDeals?.closedThisMonth ?? 0, locale)} label={t('home.closedDeals')} tone="positive" onClick={openInsightFor.closedDeals} />
        <TodayStat value={formatInteger(stats.qualitySummary.totalCases, locale)} label={L('حالات جودة', 'quality cases')} tone={stats.qualitySummary.totalCases > 0 ? 'warning' : 'positive'} onClick={openInsightFor.qualityCases} />
      </div>
    </WorkspaceSection>
  );

  /* ═══ SECTIONS — each widget id renders as a workspace section.
     Cards appear nowhere; content is rows, rails, bars and text. ═══ */
  const sections: Record<string, ReactNode> = {
    attentionRequired: (
      <AttentionPanel
        variant="queue"
        title={t('home.needsAttention')}
        icon={<Zap className="size-3.5" />}
        subtitle={L('طابور العمل — ما يحتاج قرارك الآن', 'The work queue — what needs your decision now')}
        persistKey="dashboardAttention"
        maxRows={8}
        items={queueItems}
        emptyState={{
          icon: <CheckCircle2 className="size-4 text-emerald-500/60" />,
          title: L('لا شيء يحتاج قرارك الآن — الطابور فارغ.', 'Nothing needs your decision — the queue is clear.'),
          description: L('الطلبات والمتابعات المتأخرة والتنبيهات العاجلة تظهر هنا فور ورودها.', 'Requests, overdue follow-ups and urgent alerts appear here the moment they arrive.'),
        }}
      />
    ),

    // §Home-CC §6 — the operational flow: real events on a rail,
    // canonical date dimensions, exact-record navigation.
    operationalTimeline: (
      <div className="ms-[3px] border-s border-slate-500/15 ps-4 mt-3">
        {timeline.length === 0 ? (
          <p className="py-4 text-xs text-text-muted flex items-center gap-2">
            <History className="size-4" />
            {L('لا يوجد نشاط تشغيلي حديث ضمن نطاقك.', 'No recent operational activity within your scope.')}
          </p>
        ) : (
          <ol>
            {timeline.slice(0, 10).map((ev) => (
              <li key={ev.id} className="relative">
                {/* the event dot sits ON the rail (container: border-s + ps-4) */}
                <span aria-hidden="true" className="absolute top-[21px] -start-[21px] size-2 rounded-full border-2 border-background bg-slate-500" />
                <TimelineRow event={ev} onClick={() => navigateTimelineEvent(ev)} locale={locale} />
              </li>
            ))}
          </ol>
        )}
      </div>
    ),

    // §Home-CC §7 — TEAM STATUS matrix: ONE surface, one row per
    // authorized department (server-computed over the caller's scope).
    departmentsOverview: (
      <div className="mt-1">
        <div className="hidden sm:grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_repeat(4,minmax(0,0.55fr))_auto] gap-x-4 py-1.5 -mx-2 px-2 text-[9px] font-semibold uppercase tracking-wider text-text-muted">
          <span>{t('home.department')}</span>
          <span>{t('home.matrix.activity')}</span>
          <span className="text-center">{t('home.qualityCases')}</span>
          <span className="text-center">{t('home.openFollowUps')}</span>
          <span className="text-center">{t('home.activeTravel')}</span>
          <span className="text-center">{t('home.matrix.attention')}</span>
          <span aria-hidden="true" />
        </div>
        {deptPulse && deptPulse.length > 0 ? (
          <div className="divide-y divide-slate-500/8">
            {deptPulse.map((dept) => (
              <MatrixRow key={dept.name} dept={dept} locale={locale} onClick={() => navigateTo('employees', undefined, { department: dept.name })} />
            ))}
          </div>
        ) : (
          <p className="py-4 text-xs text-text-muted">{L('لا توجد أقسام ضمن نطاقك بعد.', 'No departments within your scope yet.')}</p>
        )}
      </div>
    ),

    // §Home-CC §8 — PERFORMANCE signal line: the canonical KPI level
    // + deterministic completion aggregates. No targets, no AI.
    performancePulse: (() => {
      const pp = stats.performancePulse;
      const kpiDenied = !canViewKpi || kpiError;
      return (
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3 py-3.5">
          {kpiLoading ? (
            <Skeleton className="h-9 w-20" />
          ) : (
            <div>
              {kpiDenied ? (
                <>
                  <span className="block text-xl font-bold text-text-muted leading-none">—</span>
                  <span className="block text-[10px] text-text-muted mt-1">{t('home.kpiScore')} · {t('home.unavailable')}</span>
                </>
              ) : kpiSummary?.qualityAverages?.avgRawScore != null ? (
                <>
                  <span className="block text-2xl font-bold tabular-nums text-foreground leading-none">{formatInteger(Math.round(kpiSummary.qualityAverages.avgRawScore), locale)}</span>
                  <span className="block text-[10px] text-text-muted mt-1">{t('home.kpiScore')}</span>
                </>
              ) : (
                <>
                  <span className="block text-xl font-bold text-text-muted leading-none">—</span>
                  <span className="block text-[10px] text-text-muted mt-1">{t('home.kpiScore')} · {t('home.noData')}</span>
                </>
              )}
            </div>
          )}
          <TodayStat value={`${formatInteger(pp?.followUpCompletionRate ?? 0, locale)}%`} label={t('home.followUpCompletion')} onClick={() => navigateTo('followUps')} />
          <TodayStat value={formatInteger(pp?.completedWork ?? stats.completedTravelCount, locale)} label={t('home.completedWork')} onClick={() => navigateTo('travel', undefined, { month: currentMonthKey })} />
          <TodayStat value={(pp?.qualityDeductionsPerEmployee ?? 0).toFixed(2)} label={t('home.qualityPerEmployee')} onClick={() => navigateTo('quality', undefined, { month: currentMonthKey })} />
          {kpiSummary?.valueBasis && !kpiDenied && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-md border border-slate-500/20 text-text-muted">
              {kpiSummary.valueBasis === 'FINALIZED' ? L('شهر مقفل', 'FINALIZED') : 'MTD'}
            </span>
          )}
          {canViewKpi && (
            <button type="button" onClick={() => navigateTo('kpiReports', undefined, { month: currentMonthKey })}
              className="text-[11px] font-semibold text-brand-400 hover:text-brand-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-md px-1">
              {t('home.viewKpiReports')} ←
            </button>
          )}
        </div>
      );
    })(),

    // §Home-CC §9 — RECENT ACTIVITY stream.
    recentActivity: (() => {
      const items = (recentNotifications as { id: string; title: string; description?: string; status?: string; createdAt?: string }[] | undefined) ?? [];
      return (
        <div className="py-1">
          {items.length === 0 ? (
            <p className="py-4 text-xs text-text-muted flex items-center gap-2">
              <Inbox className="size-4" />
              {L('لا يوجد نشاط حديث.', 'No recent activity.')}
            </p>
          ) : (
            <div className="divide-y divide-slate-500/8">
              {items.map((n) => (
                <StreamRow key={n.id} title={n.title} description={n.description} unread={n.status === 'unread'} time={relativeTime(n.createdAt, locale)} onClick={() => navigateTo('notifications')} />
              ))}
            </div>
          )}
        </div>
      );
    })(),

    // Upcoming DEPARTURES — quiet rows over the TRAVEL date.
    travelAlerts: (
      <div className="py-1">
        {stats.upcomingTravel.length === 0 ? (
          <p className="py-4 text-xs text-text-muted flex items-center gap-2">
            <Plane className="size-4" />
            {L('لا توجد رحلات قادمة.', 'No upcoming trips.')}
          </p>
        ) : (
          <div className="divide-y divide-slate-500/8">
            {stats.upcomingTravel.slice(0, 6).map((tr) => {
              const urgent = isUrgent(tr.departureDate);
              return (
                <button key={tr.id} type="button" onClick={() => navigateTo('travel', tr.id)}
                  className="group w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40">
                  {urgent && <span className="size-2 rounded-full bg-rose-500 shrink-0" aria-label={L('عاجلة', 'urgent')} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-foreground truncate">
                      {tr.employeeName} <span className="text-text-muted font-normal">→ {tr.destination}</span>
                    </span>
                    {tr.employeeDepartment && <span className="block text-[10px] text-text-muted">{tr.employeeDepartment}</span>}
                  </span>
                  <span className="text-[10px] text-text-muted tabular-nums shrink-0">{tr.departureDate}</span>
                  <ExternalLink className="size-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    ),

    // §17 preserved — pins/favorites shortcuts + system status line.
    quickAccess: (() => {
      const favorites = userPreferences?.favorites ?? [];
      const pins = userPreferences?.pins ?? [];
      const shortcuts = [...pins, ...favorites].slice(0, 8);
      return (
        <div className="py-3 space-y-3">
          {shortcuts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {shortcuts.map((entry) => (
                <button key={entry.id}
                  onClick={() => navigateTo(entry.route, entry.targetType === 'record' ? entry.targetId ?? undefined : undefined, entry.navigationContext ?? {})}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-500/20 bg-slate-500/5 hover:bg-surface-hover/70 text-text-secondary transition-all">
                  {entry.targetType === 'record' ? <Star className="size-3 text-amber-400" /> : <PinIcon className="size-3 text-cyan-400" />}
                  <span className="truncate max-w-36">{entry.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[10px] text-text-muted">
            <span className="flex items-center gap-1.5">
              <Fingerprint className="size-3.5" />
              {L('آخر مزامنة بصمة:', 'Last biometric sync:')}
              <span className={stats.biometricLastSync ? 'text-emerald-400' : ''}>
                {stats.biometricLastSync ? formatDate(stats.biometricLastSync, locale) : L('لم تتم بعد', 'not yet')}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-3.5" />
              {L('سجلات البصمة:', 'Biometric records:')}
              <span className="tabular-nums">{formatInteger(stats.biometricRecordCount, locale)}</span>
            </span>
            {canViewPage('employees') && (
              <button type="button" onClick={() => navigateTo('employees')} className="text-brand-400 hover:text-brand-300 transition-colors">
                {L('الموظفون', 'Employees')} ←
              </button>
            )}
            {canViewPage('reports') && (
              <button type="button" onClick={() => navigateTo('reports')} className="text-brand-400 hover:text-brand-300 transition-colors">
                {L('التقارير', 'Reports')} ←
              </button>
            )}
          </div>
        </div>
      );
    })(),

    /* ── OPTIONAL sections (opt-in via تخصيص) — the legacy widget
          content, restyled as quiet rows without card shells. ── */
    pendingRequests: (
      <div className="py-1 divide-y divide-slate-500/8">
        {stats.pendingRequestsDetails.length === 0 ? (
          <p className="py-4 text-xs text-text-muted flex items-center gap-2"><CheckCircle2 className="size-4 text-emerald-500/60" /> {L('لا توجد طلبات معلقة.', 'No pending requests.')}</p>
        ) : stats.pendingRequestsDetails.map((req) => (
          <div key={req.id} className="flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg hover:bg-surface-hover/70 transition-colors">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground truncate">{req.employeeName} — {getRequestTypeLabel(req.type)}</span>
              {req.reason && <span className="block text-[10px] text-text-muted truncate mt-0.5">{req.reason}</span>}
            </span>
            {canEditPage('requests') && (
              <span className="flex items-center gap-1.5 shrink-0">
                <button type="button" disabled={actionLoading === req.id} onClick={() => void handleRequestAction(req.id, 'approved')}
                  className="px-2 py-1 rounded-md text-[10px] font-semibold text-emerald-400 hover:bg-emerald-500/10 transition-colors disabled:opacity-50">
                  {L('موافقة', 'Approve')}
                </button>
                <button type="button" disabled={actionLoading === req.id} onClick={() => void handleRequestAction(req.id, 'rejected')}
                  className="px-2 py-1 rounded-md text-[10px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  {L('رفض', 'Reject')}
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    ),

    todaysFollowUps: (
      <div className="py-1 divide-y divide-slate-500/8">
        {stats.todaysFollowUps.length === 0 ? (
          <p className="py-4 text-xs text-text-muted flex items-center gap-2"><ClipboardList className="size-4" /> {L('لا توجد متابعات مجدولة اليوم.', 'No follow-ups due today.')}</p>
        ) : stats.todaysFollowUps.map((fu) => (
          <button key={fu.id} type="button" onClick={() => navigateTo('followUps', fu.id, { dueToday: '1' })}
            className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground truncate">{fu.employeeName} — {FUTYPE_LABELS[fu.followUpType] || fu.followUpType}</span>
              <span className="block text-[10px] text-text-muted">{fu.responsiblePersonName ? `${L('مسؤول', 'owner')}: ${fu.responsiblePersonName}` : ''}</span>
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-md shrink-0 ${fu.priorityLevel === 'high' ? 'text-red-400 bg-red-500/10' : fu.priorityLevel === 'medium' ? 'text-amber-400 bg-amber-500/10' : 'text-text-muted bg-slate-500/10'}`}>
              {fu.priorityLevel === 'high' ? L('عالي', 'high') : fu.priorityLevel === 'medium' ? L('متوسط', 'med') : L('منخفض', 'low')}
            </span>
          </button>
        ))}
      </div>
    ),

    attendanceToday: (
      <div className="py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <TodayStat value={formatInteger(stats.presentCount, locale)} label={L('حاضر', 'present')} tone="positive" onClick={() => navigateTo('attendance')} />
          <TodayStat value={formatInteger(stats.lateCount, locale)} label={L('متأخر', 'late')} tone={stats.lateCount > 0 ? 'warning' : 'positive'} onClick={openInsightFor.late} />
          <TodayStat value={formatInteger(stats.absentCount, locale)} label={L('غائب', 'absent')} tone={stats.absentCount > 0 ? 'warning' : 'positive'} onClick={() => navigateTo('attendance')} />
          <TodayStat value={`${stats.attendanceRate}%`} label={L('النسبة', 'rate')} onClick={openInsightFor.attendance} />
        </div>
        {stats.lateEmployees.length > 0 && (
          <div className="divide-y divide-slate-500/8">
            {stats.lateEmployees.map((late) => (
              <button key={late.id} type="button" onClick={() => navigateTo('attendance', undefined, { status: 'late' })}
                className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors">
                <Clock className="size-3.5 text-amber-400 shrink-0" aria-hidden="true" />
                <span className="text-xs text-foreground truncate flex-1">{late.employeeName}{late.department ? ` · ${late.department}` : ''}</span>
                <span className="text-[10px] text-amber-400 tabular-nums shrink-0">{late.minutesLate} {L('د', 'min')}{late.checkIn ? ` · ${late.checkIn}` : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    ),

    qualitySnapshot: (
      <div className="py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <TodayStat value={formatInteger(stats.qualitySummary.totalCases, locale)} label={L('حالات', 'cases')} onClick={openInsightFor.qualityCases} />
          <TodayStat value={stats.qualitySummary.totalAmount.toFixed(0)} label={L('ج.م خصومات', 'EGP deducted')} onClick={openInsightFor.qualityCases} />
          <TodayStat value={stats.qualitySummary.totalDays.toFixed(1)} label={L('أيام', 'days')} onClick={openInsightFor.qualityCases} />
        </div>
        {Object.entries(stats.qualitySummary.byType).map(([type, count]) => (
          <div key={type} className="flex items-center gap-3 text-[11px]">
            <span className="text-text-secondary w-32 truncate">{type}</span>
            <span className="h-1 rounded-full bg-slate-500/15 flex-1 max-w-40 overflow-hidden">
              <span className="block h-full rounded-full bg-orange-500/70" style={{ width: `${stats.qualitySummary.totalCases > 0 ? (count / stats.qualitySummary.totalCases) * 100 : 0}%` }} />
            </span>
            <span className="tabular-nums text-text-muted w-6 text-end">{count}</span>
          </div>
        ))}
      </div>
    ),

    requestTypeAnalytics: (
      <div className="py-1 divide-y divide-slate-500/8">
        {stats.requestTypeSummary.length === 0 ? (
          <p className="py-4 text-xs text-text-muted">{L('لا توجد طلبات بعد.', 'No requests yet.')}</p>
        ) : stats.requestTypeSummary.map((rt) => {
          const total = rt.pending + rt.approved + rt.rejected;
          return (
            <button key={rt.type} type="button" onClick={() => navigateTo('requests')}
              className="w-full py-2.5 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors">
              <span className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-foreground">{rt.label}</span>
                <span className="text-[10px] text-text-muted tabular-nums">{formatInteger(total, locale)} {L('طلب', 'requests')}</span>
              </span>
              <span className="flex items-center gap-0.5 h-1.5 rounded-full overflow-hidden bg-slate-500/10 mt-1.5">
                {total > 0 && (
                  <>
                    <span className="h-full bg-emerald-500" style={{ width: `${(rt.approved / total) * 100}%` }} />
                    <span className="h-full bg-amber-500" style={{ width: `${(rt.pending / total) * 100}%` }} />
                    <span className="h-full bg-red-500" style={{ width: `${(rt.rejected / total) * 100}%` }} />
                  </>
                )}
              </span>
              <span className="flex items-center gap-4 mt-1 text-[10px] tabular-nums">
                <span className="text-emerald-400">{L('معتمد', 'approved')} {rt.approved}</span>
                <span className="text-amber-400">{L('معلق', 'pending')} {rt.pending}</span>
                <span className="text-red-400">{L('مرفوض', 'rejected')} {rt.rejected}</span>
              </span>
            </button>
          );
        })}
      </div>
    ),

    performanceDetail: (() => {
      const perf = stats.currentMonthPerformance ?? emptyPerf;
      return (
        <div className="py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <TodayStat value={formatInteger(perf.totalDelays, locale)} label={L('تأخيرات الشهر', 'delays this month')} onClick={() => navigateTo('reports')} />
            <TodayStat value={formatInteger(perf.totalDelayMinutes, locale)} label={L('دقائق', 'minutes')} onClick={() => navigateTo('reports')} />
            <TodayStat value={perf.totalDeductionAmount.toFixed(0)} label={L('ج.م خصومات', 'EGP deducted')} onClick={() => navigateTo('reports')} />
          </div>
          {perf.departments.slice(0, 6).map((d) => (
            <div key={d.departmentName} className="flex items-center gap-3 text-[11px]">
              <span className="text-text-secondary w-32 truncate">{d.departmentName}</span>
              <span className="h-1 rounded-full bg-slate-500/15 flex-1 max-w-40 overflow-hidden">
                <span className="block h-full rounded-full bg-red-500/70" style={{ width: `${perf.totalDelays > 0 ? (d.totalDelays / perf.totalDelays) * 100 : 0}%` }} />
              </span>
              <span className="tabular-nums text-text-muted w-8 text-end">{d.totalDelays}</span>
            </div>
          ))}
        </div>
      );
    })(),

    qualityDeductionsDetail: (
      <div className="py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <TodayStat value={formatInteger(stats.qualitySummary.totalCases, locale)} label={L('حالات', 'cases')} onClick={openInsightFor.qualityCases} />
          <TodayStat value={stats.qualitySummary.totalAmount.toFixed(0)} label={L('ج.م', 'EGP')} onClick={openInsightFor.qualityCases} />
          <TodayStat value={stats.qualitySummary.totalDays.toFixed(1)} label={L('أيام', 'days')} onClick={openInsightFor.qualityCases} />
        </div>
        {Object.entries(stats.qualitySummary.byType).map(([type, count]) => (
          <div key={type} className="flex items-center gap-3 text-[11px]">
            <span className="text-text-secondary w-32 truncate">{type}</span>
            <span className="h-1 rounded-full bg-slate-500/15 flex-1 max-w-40 overflow-hidden">
              <span className="block h-full rounded-full bg-orange-500/70" style={{ width: `${stats.qualitySummary.totalCases > 0 ? (count / stats.qualitySummary.totalCases) * 100 : 0}%` }} />
            </span>
            <span className="tabular-nums text-text-muted w-6 text-end">{count}</span>
          </div>
        ))}
      </div>
    ),

    travelItineraryDetail: (
      <div className="py-1 divide-y divide-slate-500/8">
        {stats.upcomingTravel.slice(0, 10).map((tr) => (
          <button key={tr.id} type="button" onClick={() => navigateTo('travel', tr.id)}
            className="w-full flex items-center gap-3 py-2 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors">
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-semibold text-foreground truncate">{tr.employeeName} → {tr.destination}</span>
              <span className="block text-[10px] text-text-muted">{tr.departureDate}{tr.returnDate ? ` — ${L('العودة', 'return')} ${tr.returnDate}` : ''}</span>
            </span>
            {isUrgent(tr.departureDate) && <span className="size-2 rounded-full bg-rose-500 shrink-0" aria-label={L('عاجلة', 'urgent')} />}
          </button>
        ))}
      </div>
    ),
  };

  /* ═══ RENDER — ONE workspace: ordered sections (personalizable),
     TODAY strip fixed directly after the work queue. ═══ */
  const orderedIds = editMode
    ? draftOrder.filter((id) => sections[id])
    : widgetLayout.map((w) => w.id).filter((id) => sections[id]);
  const hiddenDraftWidgets = editMode
    ? draftOrder.filter((id) => draftHidden.has(id) && sections[id])
    : [];
  // In edit mode hidden sections keep rendering (header-only) so they
  // can be re-shown in place; outside edit mode they disappear.
  const visibleIds = editMode
    ? orderedIds
    : orderedIds.filter((id) => !(userPreferences?.dashboard?.hiddenWidgets ?? []).includes(id));
  const attentionVisible = visibleIds.includes('attentionRequired');

  return (
    <div className="pb-10">

      {/* ── EDIT MODE banner (§17 — sections, not cards) ── */}
      {editMode && (
        <div className="flex items-center gap-2 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3.5 py-2 mb-6 text-xs text-brand-300">
          <GripVertical className="size-3.5 shrink-0" />
          {L('وضع التخصيص: اسحب الأقسام لإعادة ترتيبها، وأخفِ ما لا تحتاجه — ثم «حفظ».', 'Customize: drag sections to reorder, hide what you do not need — then Save.')}
        </div>
      )}

      {/* quick-create inline form host (existing behavior) */}
      <div ref={quickActionHostRef} style={{ scrollMarginTop: '56px' }}>
        {activeQuickAction && (
          <HomeQuickActionHost
            activeAction={activeQuickAction as never}
            onClose={() => setActiveQuickAction(null)}
          />
        )}
      </div>

      <div
        className="space-y-7"
        onDragOver={(e) => { if (editMode && dragId) e.preventDefault(); }}
      >
        {/* attention hidden → TODAY strip leads the page */}
        {!attentionVisible && !editMode && todayStrip}

        {visibleIds.map((widgetId) => {
          const isDragging = dragId === widgetId;
          const isOverTarget = overId === widgetId && dragId !== null && dragId !== widgetId;
          const cfg = widgetIdToConfig.get(widgetId);
          const isHiddenDraft = editMode && draftHidden.has(widgetId);
          return (
            <Fragment key={widgetId}>
              <div
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
                className={`relative ${editMode ? 'cursor-grab active:cursor-grabbing' : ''}`}
              >
                {/* drop indicator — a hairline insertion bar, not a ring */}
                {isOverTarget && (
                  <div aria-hidden="true" className="absolute -top-4 inset-x-2 h-0.5 rounded-full bg-brand-500" />
                )}
                {isDragging && <div aria-hidden="true" className="absolute inset-0 rounded-lg border border-dashed border-brand-500/40 bg-brand-500/5 pointer-events-none" />}

                {widgetId === 'attentionRequired' ? (
                  /* the queue renders its own header (severity roll-up) */
                  sections[widgetId]
                ) : (
                  <WorkspaceSection
                    label={cfg?.title ?? widgetId}
                    editMode={editMode}
                    hidden={isHiddenDraft}
                    onToggleHidden={() => toggleDraftHidden(widgetId)}
                  >
                    {sections[widgetId]}
                  </WorkspaceSection>
                )}
              </div>

              {/* TODAY strip lives directly after the work queue */}
              {widgetId === 'attentionRequired' && todayStrip}
            </Fragment>
          );
        })}

        {/* all sections hidden */}
        {visibleIds.length === 0 && !editMode && (
          <div className="flex flex-col items-center py-14 text-text-muted">
            <Inbox className="size-10 mb-3" />
            <p className="text-sm">{L('جميع الأقسام مخفية — فعّل «تخصيص» لإظهار ما تحتاجه.', 'All sections are hidden — enable Customize to show what you need.')}</p>
          </div>
        )}
      </div>

      {/* hidden tray (edit mode) — compact re-show affordance */}
      {editMode && hiddenDraftWidgets.length > 0 && (
        <div className="mt-8">
          <WorkspaceSection label={`${L('أقسام مخفية', 'Hidden sections')} (${hiddenDraftWidgets.length})`}>
            <div className="flex flex-wrap gap-2 py-2">
              {hiddenDraftWidgets.map((id) => (
                <button key={id} type="button" onClick={() => toggleDraftHidden(id)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-slate-500/20 text-text-muted hover:text-foreground hover:border-emerald-500/40 transition-all">
                  <Eye className="size-3 text-emerald-400" />
                  {widgetIdToConfig.get(id)?.title ?? id}
                </button>
              ))}
            </div>
          </WorkspaceSection>
        </div>
      )}

      {/* §9 — the intermediate Insight Details surface:
          Metric → Insight Details → View Records → exact destination
          (navParams filter) → Qnalys global highlight on the record. */}
      <HomeInsightDetailsDialog insight={insight} onClose={() => setInsight(null)} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   TimelineRow — one real operational event on the rail (defined
   after the page for readability; hoisted at module scope).
   Time first, then WHAT, then WHO — scannable without opening
   anything. The dot sits on the section's inline-start rail.
   ═══════════════════════════════════════════════════════════ */

function TimelineRow({ event, onClick, locale }: {
  event: TimelineEvent;
  onClick: () => void;
  locale: Locale;
}) {
  const isToday = (() => {
    const d = new Date(event.createdAt);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
  })();
  const when = isToday ? formatTime(new Date(event.createdAt)) : formatDate(event.createdAt, locale);
  const dimLabel = event.dateDimension === 'TRAVEL' ? 'تاريخ السفر'
    : event.dateDimension === 'CLOSED' ? 'تاريخ الإغلاق'
    : event.dateDimension === 'CREATED' ? 'تاريخ الإنشاء'
    : null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-baseline gap-3 py-2 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <span className="text-[10px] font-mono tabular-nums text-text-muted shrink-0 w-10" dir="ltr">{when}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-semibold text-foreground">{event.title}</span>
          {event.employeeName && <span className="text-[11px] text-text-secondary">{event.employeeName}</span>}
          {event.department && <span className="text-[10px] text-text-muted">· {event.department}</span>}
        </span>
        {event.description && (
          <span className="block text-[10px] text-text-muted truncate mt-0.5">{event.description}</span>
        )}
      </span>
      {dimLabel && (
        <span className="text-[9px] text-text-muted shrink-0 hidden md:inline">{dimLabel}</span>
      )}
      <ExternalLink className="size-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" aria-hidden="true" />
    </button>
  );
}

/**
 * MatrixRow — one authorized department in the TEAM STATUS matrix.
 * Row = the navigation target (employees?department=…); the mini bar
 * is the only graphic. Columns collapse responsively (name + activity
 * + attention on mobile).
 */
function MatrixRow({ dept, onClick, locale }: {
  dept: DepartmentPulse;
  onClick: () => void;
  locale: Locale;
}) {
  const trendCls = dept.trend === 1 ? 'text-emerald-400' : dept.trend === -1 ? 'text-red-400' : 'text-text-muted';
  const trendGlyph = dept.trend === 1 ? '↑' : dept.trend === -1 ? '↓' : '—';
  const toneCls = dept.attendanceRate >= 80 ? 'bg-emerald-500/80' : dept.attendanceRate >= 50 ? 'bg-amber-500/80' : 'bg-red-500/80';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full grid grid-cols-[minmax(0,1.4fr)_auto] sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_repeat(4,minmax(0,0.55fr))_auto] items-center gap-x-4 gap-y-1 py-2.5 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      {/* name + roster */}
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-foreground truncate">{dept.name}</span>
        <span className="block text-[10px] text-text-muted">{formatInteger(dept.employeeCount, locale)} موظفين</span>
      </span>

      {/* activity bar (sm+) */}
      <span className="hidden sm:flex items-center gap-2 min-w-0">
        <span className="h-1 rounded-full bg-slate-500/15 flex-1 max-w-28 overflow-hidden">
          <span className={`block h-full rounded-full ${toneCls}`} style={{ width: `${dept.attendanceRate}%` }} />
        </span>
        <span className="text-[11px] font-semibold tabular-nums text-text-secondary w-9 text-end">{dept.attendanceRate}%</span>
      </span>

      {/* numeric columns */}
      <span className="hidden sm:block text-[11px] tabular-nums text-center">
        <span className={dept.qualityCasesThisMonth > 0 ? 'text-amber-400 font-semibold' : 'text-text-muted'}>{dept.qualityCasesThisMonth}</span>
      </span>
      <span className="hidden sm:block text-[11px] tabular-nums text-center">
        <span className={dept.openFollowUps > 0 ? 'text-brand-400 font-semibold' : 'text-text-muted'}>{dept.openFollowUps}</span>
      </span>
      <span className="hidden sm:block text-[11px] tabular-nums text-center">
        <span className={dept.activeTravel > 0 ? 'text-cyan-400 font-semibold' : 'text-text-muted'}>{dept.activeTravel}</span>
      </span>
      <span className="text-[11px] tabular-nums text-center sm:text-left">
        <span className={dept.pendingApprovals > 0 ? 'text-red-400 font-semibold' : 'text-text-muted'}>{dept.pendingApprovals}</span>
      </span>

      {/* trend */}
      <span className={`text-xs tabular-nums shrink-0 ${trendCls}`} aria-label={dept.trend === 1 ? 'صاعد' : dept.trend === -1 ? 'هابط' : 'مستقر'}>
        {trendGlyph}
      </span>
    </button>
  );
}

/**
 * StreamRow — one notification in the RECENT ACTIVITY stream.
 */
function StreamRow({ title, description, unread, time, onClick }: {
  title: string;
  description?: string;
  unread: boolean;
  time: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full flex items-start gap-2.5 py-1.5 -mx-2 px-2 rounded-lg text-start hover:bg-surface-hover/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <span className={`mt-1.5 size-1.5 rounded-full shrink-0 ${unread ? 'bg-brand-400' : 'bg-slate-600'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-foreground font-medium truncate">{title}</span>
        {description && <span className="block text-[10px] text-text-muted truncate mt-0.5">{description}</span>}
      </span>
      <span className="text-[10px] text-text-muted shrink-0 mt-0.5 tabular-nums">{time}</span>
    </button>
  );
}
