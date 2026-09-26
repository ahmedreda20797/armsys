'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AttentionPanel, type AttentionSeverity } from '@/components/shared/AttentionPanel';
import { CAPAInlineForm } from '@/components/shared/inline-forms';
import { useEmployees, useRiskCenterMonth, useDashboardUsers } from '@/hooks/use-queries';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle, ShieldCheck, ShieldAlert, AlertCircle, ShieldX,
  Clock, Users, TrendingUp, TrendingDown, Minus, ChevronLeft,
  ChevronRight, X, Search, Activity, Eye, FileWarning,
  UserCheck, Award, Zap, BarChart3, Target, FilePlus, FileText,
  Loader2,
} from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api-fetch';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateDomain } from '@/lib/cache/invalidation';
import { DataFreshnessIndicator } from '@/components/shared/DataFreshnessIndicator';
import { useAppStore } from '@/lib/store';
import { useRecordHighlight } from '@/hooks/use-record-highlight';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { useLanguage } from '@/lib/i18n/language-context';
import type { Locale } from '@/lib/i18n/dictionary';
import { formatInteger, formatMonthKey } from '@/lib/i18n/format';

/** Last 12 month keys, newest first (§14 month selector options). */
function buildMonthOptions(): string[] {
  const now = new Date();
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// ═══════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════

interface EmployeeRisk {
  employeeId: string;
  employeeName: string;
  department: string;
  position: string;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  // Canonical breakdown shape — one { count, points } entry per factor.
  breakdown: Record<string, { count: number; points: number }>;
  openCases: number;
  lastActivity: string;
  trend: 'increasing' | 'stable' | 'improving';
  recommendations: string[];
  capaIds: string[];
}

interface SummaryStats {
  totalEmployees: number;
  lowRiskCount: number;
  mediumRiskCount: number;
  highRiskCount: number;
  criticalRiskCount: number;
  openCasesTotal: number;
  immediateActionCount: number;
}

// ═══════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
} as const;

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' as const } },
} as const;

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════

// §I18N-BOUNDARY — risk levels are SYSTEM ENUM CODES; their labels are
// claimed UI as [ar, en] pairs picked by the active locale at render.
function getRiskLevelConfig(level: string, locale?: Locale) {
  const labels: Record<string, [string, string]> = {
    low: ['منخفض', 'Low'],
    medium: ['متوسط', 'Medium'],
    high: ['مرتفع', 'High'],
    critical: ['حرج', 'Critical'],
  };
  const pair = labels[level] ?? labels.low;
  const label = locale === 'en' ? pair[1] : pair[0];
  const map: Record<string, { label: string; color: string; bg: string; border: string; dot: string }> = {
    low: { label, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/25', dot: 'bg-green-400' },
    medium: { label, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/25', dot: 'bg-yellow-400' },
    high: { label, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/25', dot: 'bg-orange-400' },
    critical: { label, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/25', dot: 'bg-red-500' },
  };
  return map[level] || map.low;
}

// ── §6 Risk Summary Panel helpers ──
// Arabic labels for the canonical breakdown factor keys (riskMetrics) —
// app-owned system vocabulary, claimed via the renderer (not user data).
const RISK_FACTOR_LABELS: Record<string, string> = {
  delay: 'تأخيرات',
  absence: 'غيابات',
  quality: 'مشاكل جودة',
  hr: 'خصومات موارد بشرية',
  openFollowUp: 'متابعات مفتوحة',
  highPriorityFollowUp: 'متابعات عالية الأولوية',
  criticalFollowUp: 'متابعات حرجة',
  complaint: 'شكاوى عملاء',
  repeatedIssue: 'مشاكل متكررة',
  openCapa: 'كابا مفتوحة',
  overdueCapa: 'كابا متأخرة',
  criticalCapa: 'كابا حرجة',
  reopenedCapa: 'كابا معاد فتحها',
};

/** Total risk signals across all factors for one employee. */
function riskCountOf(emp: EmployeeRisk): number {
  return Object.values(emp.breakdown ?? {}).reduce((sum, b) => sum + (b?.count ?? 0), 0);
}

/** The two heaviest factors (by points) as a short Arabic reason. */
function topReasonOf(emp: EmployeeRisk): string {
  const entries = Object.entries(emp.breakdown ?? {})
    .filter(([, b]) => (b?.count ?? 0) > 0)
    .sort((a, b) => (b[1]?.points ?? 0) - (a[1]?.points ?? 0));
  const labels = entries.slice(0, 2).map(([key]) => RISK_FACTOR_LABELS[key] ?? key);
  if (labels.length === 0) return '—';
  return labels.join(' · ');
}

function getTrendIcon(trend: string) {
  switch (trend) {
    case 'increasing': return <TrendingUp className="size-3.5 text-red-400" />;
    case 'improving': return <TrendingDown className="size-3.5 text-green-400" />;
    default: return <Minus className="size-3.5 text-slate-500" />;
  }
}

// §I18N-BOUNDARY — trend captions are system status words: [ar, en] pairs.
function getTrendLabel(trend: string, locale?: Locale) {
  switch (trend) {
    case 'increasing': return locale === 'en' ? 'Rising' : 'تصاعدي';
    case 'improving': return locale === 'en' ? 'Improving' : 'تحسن';
    default: return locale === 'en' ? 'Stable' : 'مستقر';
  }
}

// ═══════════════════════════════════════════════════
//  COMPONENT
// ═══════════════════════════════════════════════════

export default function RiskCenterPage() {
  const { canView } = usePermissions('riskCenter');
  const { locale } = useLanguage();

  // ═══ DEEP-LINK CONTEXT (§NOTIFICATIONS-DEEPLINK) — a risk
  //  notification ("تنبيه مخاطر — N حالات للموظف") lands here with
  //  employeeId + month + level: the destination opens on that period,
  //  scoped to that employee, with the row highlighted and the details
  //  (the relevant risk records) opened. Canonical channel only:
  //  navigateTo(page, highlightId, navParams).
  //
  //  Consumed BOTH at mount (first render seed) and REACTIVELY: a
  //  deep-link into the ALREADY-MOUNTED page (risk notification →
  //  riskCenter while riskCenter is open) does not remount, so the
  //  store subscription below re-applies every navParams change.
  const navParams = useAppStore.getState().navParams;
  const navEmployeeId = typeof navParams?.employeeId === 'string' && navParams.employeeId ? navParams.employeeId : null;
  const navMonth = typeof navParams?.month === 'string' && /^\d{4}-\d{2}$/.test(navParams.month) ? navParams.month : null;
  const navLevel = typeof navParams?.level === 'string' && ['low', 'medium', 'high', 'critical'].includes(navParams.level) ? navParams.level : null;
  const deepLinkEmployeeName = typeof navParams?.employeeName === 'string' ? navParams.employeeName : null;
  // Identity of the CURRENT deep-link intent (new navigation → new
  // object → new signature → the effect re-applies it).
  const deepLinkSignature = useAppStore(
    (s) => `${s.navParams?.employeeId ?? ''}|${s.navParams?.month ?? ''}|${s.navParams?.level ?? ''}`,
  );

  // ═══ PAGE STATE — period selection. The Risk Center opens on the
  //  CURRENT MONTH (traceable, month-attributed factors); the user may
  //  explicitly pick another month or 'كل الفترات' (all-time rolling
  //  view); historical analysis remains available either way. A
  //  deep-link month (risk notification) wins for that mount.
  const [month, setMonth] = useState<string>(() => {
    if (navMonth) return navMonth;
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // ═══ DATA STATE (cache-backed, §4) — the month is part of the cache
  //  key (§16): August and September never collide, and switching the
  //  period selects the matching snapshot (fetching only if absent).
  const queryClient = useQueryClient();
  const riskQuery = useRiskCenterMonth(month, canView);
  const employees = (riskQuery.data?.employees ?? []) as EmployeeRisk[];
  const summary = (riskQuery.data?.summary ?? null) as SummaryStats | null;
  const deptAnalysis = (riskQuery.data?.departmentAnalysis ?? {}) as Record<string, any>;
  const basis: 'rolling' | 'month' = riskQuery.data?.basis === 'month' ? 'month' : 'rolling';
  const basisLabel = riskQuery.data?.basisLabel || translateUIText('الفترة المحددة', locale);
  // Full skeleton only without a snapshot (§11); revalidation is subtle.
  const loading = canView && riskQuery.isLoading;
  const revalidating = canView && riskQuery.isFetching && !loading;
  // Blocking error only without a snapshot (§33).
  const error = canView && riskQuery.isError && !riskQuery.data
    ? translateUIText('تعذر تحميل بيانات المخاطر', locale)
    : null;
  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState(navLevel ?? 'all');
  // §7.1 DEEP-LINK SCOPE — a department deep link (Operations Center
  // risk detail) seeds the department filter so the destination shows
  // the SAME scope the manager was inspecting. navParams is read once
  // at mount (a nav params change always remounts via PageRouter).
  const [deptFilter, setDeptFilter] = useState(
    () => useAppStore.getState().navParams?.department || 'all',
  );
  // §NOTIFICATIONS-DEEPLINK — employee focus: the notification's
  // subject employee scopes the table (exposing the relevant risk
  // records) and auto-opens the details dialog once the data lands.
  const [employeeFocus, setEmployeeFocus] = useState<string | null>(navEmployeeId);
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeRisk | null>(null);
  // §VIEWPORT-MODAL — the details view is now a Radix Dialog, which
  // owns ESC + click-outside + backdrop closing itself; no manual
  // key listener is needed (the old fixed drawer required one).
  // §6 "عرض الكل" dialog for the risk summary panel
  const [viewAllRiskyOpen, setViewAllRiskyOpen] = useState(false);
  // §8 — inline CAPA create (mounted over the same context as the
  // selected employee, no page nav). We prefill the dialog with the
  // employee's risk context so the operator doesn't re-enter them.
  const [capaCreateOpen, setCapaCreateOpen] = useState(false);
  const { data: employeesData } = useEmployees(canView);
  // NOTE: not named `employees` because the page derives the
  // risk-data list (EmployeeRisk[]) from the cache-backed risk query.
  const employeesList = (employeesData ?? []) as { id: string; name: string; department?: string | null }[];
  const usersListQuery = useDashboardUsers('basic', canView);
  const usersList = (usersListQuery.data ?? []) as { id: string; name: string; email?: string; role?: string }[];
  const [compareRows, setCompareRows] = useState<Record<string, number> | null>(null);
  const [compareLabel, setCompareLabel] = useState<string | null>(null);
  const [compareState, setCompareState] = useState<'idle' | 'loading' | 'ready' | 'insufficient'>('idle');
  // A period switch invalidates the previous month comparison — deltas
  // from another period must never leak into the new view. Uses the
  // compiler-endorsed "adjust state during render" guard (a month
  // change is a one-shot reaction, not an external-system sync).
  const [compareMonth, setCompareMonth] = useState(month);
  if (month !== compareMonth) {
    setCompareMonth(month);
    setCompareRows(null);
    setCompareState('idle');
    setCompareLabel(null);
  }

  // ═══ Manual refresh / mutation revalidation (§26) — the visible
  //  snapshot stays on screen while the fresh data arrives.
  const refreshData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['riskCenter'] });
  }, [queryClient]);

  const previousMonthKeyOf = (key: string): string => {
    const [y, m] = key.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  };

  // §14 month comparison: same month-attributed computation on the
  // previous month; deltas are shown ONLY where source data exists —
  // otherwise the UI says explicitly that the comparison cannot be
  // calculated (no fabricated history).
  async function loadComparison() {
    if (!month) return;
    setCompareState('loading');
    try {
      const prev = previousMonthKeyOf(month);
      const res = await authFetch(`/api/risk-center?month=${prev}`);
      if (!res.ok) {
        setCompareState('insufficient');
        setCompareLabel(null);
        return;
      }
      const data = await res.json();
      const rows: Record<string, number> = {};
      let anyData = false;
      for (const emp of (data.employees || []) as EmployeeRisk[]) {
        const hadFactors = Object.values(emp.breakdown || {}).some((f: any) => (f?.count ?? 0) > 0);
        if (hadFactors) anyData = true;
        rows[emp.employeeId] = emp.riskScore;
      }
      if (!anyData) {
        setCompareState('insufficient');
        setCompareRows(null);
        setCompareLabel(null);
        return;
      }
      setCompareRows(rows);
      setCompareLabel(prev);
      setCompareState('ready');
    } catch {
      setCompareState('insufficient');
    }
  }

  const deltaFor = (employeeId: string, currentScore: number): { delta: number; comparable: boolean } => {
    if (compareState !== 'ready' || !compareRows) return { delta: 0, comparable: false };
    if (!(employeeId in compareRows)) return { delta: 0, comparable: false };
    const hasFactorsNow = employees.some(
      (e) => e.employeeId === employeeId &&
        Object.values(e.breakdown || {}).some((f: any) => (f?.count ?? 0) > 0),
    );
    const hadFactorsPrev = (compareRows[employeeId] ?? 0) > 0;
    // Both months genuinely zero for this employee → "no data" in both;
    // a 0-vs-0 delta would fabricate meaning where nothing happened.
    if (!hasFactorsNow && !hadFactorsPrev) return { delta: 0, comparable: false };
    return { delta: currentScore - (compareRows[employeeId] ?? 0), comparable: true };
  };

  // ── Department list for filters ──
  const departmentList = useMemo(() => {
    return Object.keys(deptAnalysis).sort((a, b) => a.localeCompare(b, 'ar'));
  }, [deptAnalysis]);

  // ── Filtered data ──
  const filtered = useMemo(() => {
    return employees.filter(emp => {
      // §NOTIFICATIONS-DEEPLINK — employee focus first (the notification
      // subject): the destination exposes THAT employee's risk state.
      if (employeeFocus && emp.employeeId !== employeeFocus) return false;
      if (levelFilter !== 'all' && emp.riskLevel !== levelFilter) return false;
      if (deptFilter !== 'all' && emp.department !== deptFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return emp.employeeName.toLowerCase().includes(s) || emp.department.toLowerCase().includes(s);
      }
      return true;
    });
  }, [employees, levelFilter, deptFilter, search, employeeFocus]);

  // §NOTIFICATIONS-DEEPLINK — the canonical record-highlight receiver:
  // the notification's sourceRecordId (the employee id) resolves against
  // the table rows' [data-record-id] — scroll + pulse, same visual
  // language as every other page (§QNALYS-HIGHLIGHT).
  useRecordHighlight({ ready: !loading });

  // §NOTIFICATIONS-DEEPLINK — reactive deep-link params (a deep link
  // into the ALREADY-MOUNTED page does not remount, so the params are
  // subscribed, not just read once at mount).
  const navEmployeeIdParam = useAppStore((s) =>
    typeof s.navParams?.employeeId === 'string' && s.navParams.employeeId ? s.navParams.employeeId : null);
  const navMonthParam = useAppStore((s) =>
    typeof s.navParams?.month === 'string' && /^\d{4}-\d{2}$/.test(s.navParams.month) ? s.navParams.month : null);
  const navLevelParam = useAppStore((s) =>
    typeof s.navParams?.level === 'string' && ['low', 'medium', 'high', 'critical'].includes(s.navParams.level)
      ? s.navParams.level
      : null);

  // Apply a NEW deep-link intent with the compiler-endorsed "adjust
  // state during render" pattern (same as the month-compare reset
  // above): a signature change is a one-shot reaction, applied exactly
  // once per intent. The mount-time initializers already consumed the
  // first intent, so `appliedIntent` starts at the current signature.
  const [appliedIntent, setAppliedIntent] = useState(deepLinkSignature);
  if (deepLinkSignature !== appliedIntent) {
    setAppliedIntent(deepLinkSignature);
    setEmployeeFocus(navEmployeeIdParam);
    if (navMonthParam) setMonth(navMonthParam);
    if (navLevelParam) setLevelFilter(navLevelParam);
  }

  // Auto-open the details dialog for the deep-linked employee once
  // their risk row exists — the details ARE the relevant risk records
  // (breakdown factors, open cases, CAPA actions). One-shot PER
  // deep-link intent; closing the dialog manually never fights back.
  const [dialogOpenedForIntent, setDialogOpenedForIntent] = useState<string | null>(null);
  if (employeeFocus && dialogOpenedForIntent !== deepLinkSignature && !loading && employees.length > 0) {
    const emp = employees.find((e) => e.employeeId === employeeFocus);
    if (emp) {
      setDialogOpenedForIntent(deepLinkSignature);
      setSelectedEmployee(emp);
    }
  }

  // ── Top risky employees (need action) — DATA INTEGRITY: the alert
  // panel uses the SERVER's own risk level (RISK_LEVEL_BANDS.high = 26),
  // so its count always matches the "يحتاج تدخل فوري" summary stat and
  // the underlying records. The old hardcoded `>= 21` filter diverged
  // from the API and could show a different number. ──
  const topRisky = useMemo(
    () => employees
      .filter(e => e.riskLevel === 'high' || e.riskLevel === 'critical')
      .sort((a, b) => b.riskScore - a.riskScore),
    [employees],
  );

  // ── Department table ──
  const deptTable = useMemo(() => {
    return Object.entries(deptAnalysis)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }, [deptAnalysis]);

  const hasFilters = search || levelFilter !== 'all' || deptFilter !== 'all' || !!employeeFocus;

  // ── Permission guard ──
  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="size-16 rounded-full bg-slate-800 flex items-center justify-center mb-4">
          <ShieldAlert className="size-8 text-slate-500" />
        </div>
        <p className="text-slate-400 text-sm font-medium"><T>غير مصرح بالوصول</T></p>
        <p className="text-slate-600 text-xs mt-1"><T>ليس لديك صلاحية لعرض مركز المخاطر</T></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══ §7 unified page identity ═══ */}
      <PageIdentity
        pageId="riskCenter"
        icon={<ShieldAlert className="size-5" />}
        iconClassName="bg-red-500/15 border border-red-500/30 text-red-400"
        description={
          <>
            <T>نظام الإنذار المبكر — مَن يحتاج تدخل اليوم؟</T>
            {/* §14: which attribution produced these numbers — visible. */}
            <span className="block text-slate-600 text-[10px] mt-0.5">{basisLabel}</span>
          </>
        }
        actions={
          <>
            {/* §14 month selector — CURRENT MONTH is the default; 'all
                periods' (rolling all-time) is an explicit opt-in */}
            <Select
              value={month || 'rolling'}
              onValueChange={(v) => { setMonth(v === 'rolling' ? '' : v); }}
            >
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-44 h-9 text-sm">
                <SelectValue placeholder={translateUIText('الشهر الحالي', locale)} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rolling" className="text-white"><T>كل الفترات (إجمالي السجل)</T></SelectItem>
                {buildMonthOptions().map((m) => (
                  <SelectItem key={m} value={m} className="text-white">{formatMonthKey(m, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {month && compareState !== 'loading' && (
              <Button variant="outline" size="sm" onClick={() => void loadComparison()} className="border-slate-700/70 text-slate-300 hover:bg-slate-800 h-9">
                <BarChart3 className="size-3.5 ml-1" />
                <T>مقارنة بالشهر السابق</T>
              </Button>
            )}
            {compareState === 'loading' && <Loader2 className="size-4 animate-spin text-slate-400" />}
            <Button variant="ghost" size="sm" onClick={() => void refreshData()} className="text-slate-400 hover:text-white">
              <Activity className="size-4 ml-1" />
              <T>تحديث</T>
            </Button>
          </>
        }
      />

      {/* §14 explicit comparison-impossible notice (never fake history) */}
      {month && compareState === 'insufficient' && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 flex items-center gap-2">
          <AlertCircle className="size-3.5 shrink-0" />
          <T>لا يمكن حساب المقارنة مع الشهر السابق — لا توجد بيانات مخاطر مسجلة فيه ضمن صلاحياتك.</T>
        </div>
      )}

      {/* ═══ Summary Stats ═══ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <div className="rounded-lg border border-slate-700/25 bg-slate-800/40 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>إجمالي الموظفين</T></p>
          <p className="text-white font-bold text-lg leading-tight">{formatInteger(summary?.totalEmployees || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-green-500/25 bg-green-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>مخاطر منخفضة</T></p>
          <p className="text-green-400 font-bold text-lg leading-tight">{formatInteger(summary?.lowRiskCount || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>مخاطر متوسطة</T></p>
          <p className="text-yellow-400 font-bold text-lg leading-tight">{formatInteger(summary?.mediumRiskCount || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-orange-500/25 bg-orange-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>مخاطر مرتفعة</T></p>
          <p className="text-orange-400 font-bold text-lg leading-tight">{formatInteger(summary?.highRiskCount || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-red-500/25 bg-red-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>حرج</T></p>
          <p className="text-red-400 font-bold text-lg leading-tight">{formatInteger(summary?.criticalRiskCount || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-blue-500/25 bg-blue-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>حالات مفتوحة</T></p>
          <p className="text-blue-400 font-bold text-lg leading-tight">{formatInteger(summary?.openCasesTotal || 0, locale)}</p>
        </div>
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/8 px-3.5 py-2.5">
          <p className="text-slate-500 text-[11px] mb-0.5"><T>يحتاج تدخل فوري</T></p>
          <p className="text-rose-400 font-bold text-lg leading-tight">{formatInteger(summary?.immediateActionCount || 0, locale)}</p>
        </div>
      </motion.div>

      {/* §6/§8 Risk Summary Panel — flows through the unified AttentionPanel.
              Every at-risk employee gets a compact row; +3 overflow is gone
              because the panel's collapse hides the body but never the count. */}
      <AnimatePresence>
        {topRisky.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <AttentionPanel
              title={translateUIText('موظفون يحتاجون تدخل', locale)}
              icon={<Zap className="size-3.5 text-red-400" />}
              subtitle={`${formatInteger(topRisky.length, locale)} ${translateUIText('موظف فوق عتبة المخاطر العالية', locale)}`}
              persistKey="riskAttention"
              items={topRisky.map((emp) => {
                const rl = getRiskLevelConfig(emp.riskLevel, locale);
                const severity: AttentionSeverity =
                  emp.riskLevel === 'critical' ? 'critical' :
                  emp.riskLevel === 'high' ? 'urgent' :
                  emp.riskLevel === 'medium' ? 'warning' : 'info';
                return {
                  id: emp.employeeId,
                  severity,
                  primary: emp.employeeName,
                  secondary: `${emp.department} · ${rl.label}`,
                  trailing: (
                    <span className="flex items-center gap-1.5">
                      {getTrendIcon(emp.trend)}
                      <span className="font-bold tabular-nums">{formatInteger(riskCountOf(emp), locale)} <T>مخاطر</T></span>
                    </span>
                  ),
                  onClick: () => setSelectedEmployee(emp),
                  overflowItems: [
                    { key: 'view', label: translateUIText('عرض التفاصيل', locale), icon: <Eye className="size-3.5" />, onSelect: () => setSelectedEmployee(emp) },
                    { key: 'employee360', label: translateUIText('فتح ملف الموظف', locale), icon: <UserCheck className="size-3.5" />, separatorBefore: true, onSelect: () => useAppStore.getState().openEmployee360(emp.employeeId) },
                  ],
                };
              })}
              emptyState={{
                icon: <ShieldCheck className="size-7 text-emerald-500/50 mb-2" />,
                title: translateUIText('لا يوجد موظفون فوق عتبة المخاطر العالية', locale),
                description: translateUIText('كل الموظفين تحت عتبة التنبيه.', locale),
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* §6 dialog REMOVED — the unified AttentionPanel replaces the
          standalone "عرض الكل" dialog (expand the panel to see every
          at-risk employee; rows are already paginated by maxRows). */}

      {/* ═══ Filters ═══ */}
      <Card className="border-slate-700/40 bg-slate-800/30">
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500" />
              <Input placeholder={translateUIText('بحث بالاسم أو القسم...', locale)} value={search} onChange={e => setSearch(e.target.value)} className="bg-slate-800/70 border-slate-700/70 text-white pr-9 placeholder:text-slate-500 h-9 text-sm" />
              {search && (
                <button onClick={() => setSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"><X className="size-3.5" /></button>
              )}
            </div>
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <ShieldAlert className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder={translateUIText('مستوى المخاطر', locale)} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white"><T>الكل</T></SelectItem>
                <SelectItem value="low" className="text-white"><T>منخفض</T></SelectItem>
                <SelectItem value="medium" className="text-white"><T>متوسط</T></SelectItem>
                <SelectItem value="high" className="text-white"><T>مرتفع</T></SelectItem>
                <SelectItem value="critical" className="text-white"><T>حرج</T></SelectItem>
              </SelectContent>
            </Select>
            <Select value={deptFilter} onValueChange={setDeptFilter}>
              <SelectTrigger className="bg-slate-800/70 border-slate-700/70 text-white w-36 h-9 text-sm">
                <Users className="size-3.5 ml-1.5 text-slate-500" />
                <SelectValue placeholder={translateUIText('القسم', locale)} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white"><T>كل الأقسام</T></SelectItem>
                {departmentList.map(d => (
                  <SelectItem key={d} value={d} className="text-white">{d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setLevelFilter('all'); setDeptFilter('all'); setEmployeeFocus(null); }} className="text-slate-400 hover:text-white h-9 px-3">
                <X className="size-3.5 ml-1" /> <T>مسح</T>
              </Button>
            )}
          </div>
          {/* §NOTIFICATIONS-DEEPLINK — the active employee focus is a
              visible, removable scope chip (never a hidden filter). */}
          {employeeFocus && (
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-brand-500/30 bg-brand-500/10 text-brand-300 text-[11px] font-medium">
                <UserCheck className="size-3.5" />
                {translateUIText('مركّز على:', locale)} {deepLinkEmployeeName || employeeFocus}
                <button
                  type="button"
                  aria-label={translateUIText('إزالة التركيز', locale)}
                  onClick={() => setEmployeeFocus(null)}
                  className="hover:text-white"
                >
                  <X className="size-3" />
                </button>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ═══ Loading ═══ */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 rounded-lg bg-slate-800/50" />)}
        </div>
      ) : error ? (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="flex flex-col items-center justify-center py-14">
            <div className="size-12 rounded-full bg-rose-500/10 flex items-center justify-center mb-3">
              <AlertCircle className="size-6 text-rose-400" />
            </div>
            <p className="text-rose-300 text-sm font-medium">{error}</p>
            <p className="text-slate-600 text-xs mt-1"><T>تعذّر الاتصال بقاعدة البيانات</T></p>
            <Button variant="outline" size="sm" className="mt-4" onClick={() => void refreshData()}>
              <T>إعادة المحاولة</T>
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        employeeFocus ? (
          /* §NOTIFICATIONS-DEEPLINK — honest empty state: the focused
              employee has no risk row in THIS period's snapshot. Never a
              generic "no risks" that contradicts the notification. */
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="flex flex-col items-center justify-center py-14">
              <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                <UserCheck className="size-6 text-brand-400/60" />
              </div>
              <p className="text-slate-400 text-sm font-medium">
                <T>لا توجد مخاطر مسجلة لهذا الموظف في الفترة المحددة</T>
              </p>
              <p className="text-slate-600 text-xs mt-1">{deepLinkEmployeeName || employeeFocus} — {basisLabel}</p>
              <Button variant="outline" size="sm" className="mt-4 border-slate-700/70 text-slate-300 hover:bg-slate-800" onClick={() => setEmployeeFocus(null)}>
                <T>عرض كل الموظفين</T>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-slate-700/40 bg-slate-800/30">
            <CardContent className="flex flex-col items-center justify-center py-14">
              <div className="size-12 rounded-full bg-slate-800 flex items-center justify-center mb-3">
                <ShieldCheck className="size-6 text-emerald-500/60" />
              </div>
              <p className="text-slate-400 text-sm font-medium"><T>لا توجد مخاطر حالياً</T></p>
              <p className="text-slate-600 text-xs mt-1"><T>جميع الموظفين في المستوى الطبيعي — الفترة: </T>{basisLabel}</p>
            </CardContent>
          </Card>
        )
      ) : (
        /* ═══ Employees Risk Table ═══ */
        <motion.div variants={containerVariants} initial="hidden" animate="visible">
          <Card className="border-slate-700/40 bg-slate-800/30 overflow-hidden">
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/40 bg-slate-800/50">
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap"><T>الموظف</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap"><T>القسم</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap"><T>المركز</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>نقاط المخاطر</T></th>
                      {compareState === 'ready' && compareLabel && (
                        <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center">
                          <T>تغيّر (</T>{formatMonthKey(compareLabel, locale)}<T>)</T>
                        </th>
                      )}
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap"><T>مستوى المخاطر</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>حالات مفتوحة</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>جودة</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>موارد بشرية</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>غياب</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>تأخير</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap"><T>الاتجاه</T></th>
                      <th className="text-right text-slate-400 text-[11px] font-medium px-3 py-2.5 whitespace-nowrap text-center"><T>تفاصيل</T></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((emp) => {
                      const rl = getRiskLevelConfig(emp.riskLevel, locale);
                      const cmp = compareState === 'ready' ? deltaFor(emp.employeeId, emp.riskScore) : { delta: 0, comparable: false };
                      return (
                        <motion.tr
                          key={emp.employeeId}
                          variants={itemVariants}
                          // §QNALYS-HIGHLIGHT — canonical record identity on
                          // the row; the notification deep-link highlight
                          // resolves and pulses this exact row.
                          data-record-id={emp.employeeId}
                          className={`border-b border-slate-700/20 hover:bg-slate-800/50 transition-colors cursor-pointer ${emp.riskLevel === 'critical' ? 'bg-red-500/3' : ''}`}
                          onClick={() => setSelectedEmployee(emp)}
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <div className={`size-7 rounded-full flex items-center justify-center flex-shrink-0 ${rl.bg} border ${rl.border}`}>
                                <span className={`text-[10px] font-bold ${rl.color}`}>{emp.employeeName.charAt(0)}</span>
                              </div>
                              <span className="text-white text-xs font-medium">{emp.employeeName}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{emp.department || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-slate-500 text-xs">{emp.position || '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <span className={`font-bold text-sm ${rl.color}`}>{formatInteger(emp.riskScore, locale)}</span>
                          </td>
                          {compareState === 'ready' && compareLabel && (
                            <td className="px-3 py-2.5 whitespace-nowrap text-center">
                              {cmp.comparable ? (
                                <span className={`text-xs font-bold flex items-center justify-center gap-1 ${cmp.delta > 0 ? 'text-red-400' : cmp.delta < 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                                  {cmp.delta > 0 ? <TrendingUp className="size-3" /> : cmp.delta < 0 ? <TrendingDown className="size-3" /> : <Minus className="size-3" />}
                                  {cmp.delta > 0 ? `+${formatInteger(cmp.delta, locale)}` : formatInteger(cmp.delta, locale)}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-600"><T>— لا بيانات كافية</T></span>
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${rl.bg} ${rl.color} ${rl.border}`}>
                              <div className={`w-1.5 h-1.5 rounded-full ${rl.dot}`} />
                              {rl.label}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <Badge variant="outline" className={`text-[10px] ${emp.openCases > 0 ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' : 'bg-slate-700/50 text-slate-500 border-slate-600/50'}`}>
                              {formatInteger(emp.openCases, locale)}
                            </Badge>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.quality?.count ? formatInteger(emp.breakdown.quality.count, locale) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.hr?.count ? formatInteger(emp.breakdown.hr.count, locale) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.absence?.count ? formatInteger(emp.breakdown.absence.count, locale) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs">{emp.breakdown.delay?.count ? formatInteger(emp.breakdown.delay.count, locale) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {getTrendIcon(emp.trend)}
                              <span className="text-[10px] text-slate-500">{getTrendLabel(emp.trend, locale)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-center">
                            <button className="p-1.5 rounded-md text-slate-500 hover:text-cyan-400 hover:bg-cyan-500/10 transition-colors">
                              <Eye className="size-3.5" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* §7 — Employee Details MODAL — §VIEWPORT-MODAL (Requirement 5):
          the details view is now a Radix Dialog rendered through a
          PORTAL to <body>, so it is always positioned relative to the
          VIEWPORT — regardless of where the user has scrolled. The old
          position:fixed floating card silently broke: the page-
          transition wrapper in AppLayout keeps a filter/transform,
          which makes it the containing block for fixed descendants and
          anchored the card to the DOCUMENT (mid-page), forcing the
          user to scroll to it. The Dialog also gives the standard
          modal behavior used across the system: dimmed backdrop,
          click-outside closes, ESC closes, and the ✕ sits on the far
          side from the title. The card keeps its own scrollbar
          (max-h 85vh): long data scrolls INSIDE the card. Same modal
          system as the Daily Follow-up details dialog — one UI
          pattern, fully separate business logic. */}
      <Dialog open={!!selectedEmployee} onOpenChange={(open) => { if (!open) { setSelectedEmployee(null); setCapaCreateOpen(false); } }}>
        <DialogContent
          aria-describedby={undefined}
         
          className="backdrop-blur-xl bg-slate-900 border-slate-700/60 shadow-2xl shadow-black/60 w-[min(28rem,calc(100vw-1.5rem))] max-h-[85vh] p-0 gap-0 flex flex-col overflow-hidden"
        >
          <DialogHeader className="px-5 py-3.5 border-b border-slate-700/50 bg-slate-900 shrink-0 space-y-0">
            <DialogTitle className="text-white text-lg font-bold"><T>تفاصيل المخاطر</T></DialogTitle>
          </DialogHeader>
          {/* Card body — INTERNAL scrollbar: data longer than the card
              scrolls here without ever leaving the viewport. Keyed by
              employee → switching rows resets the scroll position.
              Guarded: Radix keeps content mounted briefly while the
              closing animation plays, after selectedEmployee cleared. */}
          {selectedEmployee && (
          <div key={selectedEmployee.employeeId} className="overflow-y-auto arm-scroll p-5 space-y-4">

                {/* Employee Info */}
                <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-800/60 border border-slate-700/30">
                  <div className={`size-14 rounded-xl flex items-center justify-center border ${getRiskLevelConfig(selectedEmployee.riskLevel).bg} ${getRiskLevelConfig(selectedEmployee.riskLevel).border}`}>
                    <span className={`text-xl font-bold ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>
                      {selectedEmployee.employeeName.charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white text-base font-semibold">{selectedEmployee.employeeName}</p>
                    <p className="text-slate-500 text-xs">{selectedEmployee.department} · {selectedEmployee.position}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${getRiskLevelConfig(selectedEmployee.riskLevel, locale).bg} ${getRiskLevelConfig(selectedEmployee.riskLevel, locale).color} ${getRiskLevelConfig(selectedEmployee.riskLevel, locale).border}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${getRiskLevelConfig(selectedEmployee.riskLevel, locale).dot}`} />
                        {getRiskLevelConfig(selectedEmployee.riskLevel, locale).label}
                      </div>
                      <div className="flex items-center gap-1">
                        {getTrendIcon(selectedEmployee.trend)}
                        <span className="text-[10px] text-slate-500">{getTrendLabel(selectedEmployee.trend, locale)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Risk Score */}
                <Card className={`border ${getRiskLevelConfig(selectedEmployee.riskLevel).border} ${getRiskLevelConfig(selectedEmployee.riskLevel).bg}`}>
                  <CardContent className="p-4 text-center">
                    <p className="text-slate-500 text-xs mb-1"><T>نقاط المخاطر</T></p>
                    <p className={`text-4xl font-bold ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>{formatInteger(selectedEmployee.riskScore, locale)}</p>
                    <p className={`text-xs mt-1 ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>
                      <T>{selectedEmployee.riskScore >= 51 ? 'خطر حرج — تصعيد فوري' : selectedEmployee.riskScore >= 26 ? 'مرتفع — يتطلب تدخل عاجل' : selectedEmployee.riskScore >= 11 ? 'متوسط — يحتاج متابعة' : 'منخفض — مراقبة عادية'}</T>
                    </p>
                  </CardContent>
                </Card>

                {/* Risk Breakdown */}
                <Card className="border-slate-700/40 bg-slate-800/30">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <Target className="size-4 text-cyan-400" />
                      <T>تحليل أسباب المخاطر</T>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <div className="space-y-2">
                      {[
                        { label: 'تأخير حضور', key: 'delay', icon: Clock, color: 'text-cyan-400' },
                        { label: 'غياب', key: 'absence', icon: AlertCircle, color: 'text-red-400' },
                        { label: 'مخالفات جودة', key: 'quality', icon: Award, color: 'text-amber-400' },
                        { label: 'مخالفات موارد بشرية', key: 'hr', icon: UserCheck, color: 'text-brand-400' },
                        { label: 'حالات متابعة مفتوحة', key: 'openFollowUp', icon: Activity, color: 'text-blue-400' },
                        { label: 'متابعة أولوية عالية', key: 'highPriorityFollowUp', icon: AlertTriangle, color: 'text-orange-400' },
                        { label: 'متابعة حرجة', key: 'criticalFollowUp', icon: ShieldX, color: 'text-red-500' },
                        { label: 'شكاوى عملاء', key: 'complaint', icon: FileWarning, color: 'text-rose-400' },
                        { label: 'مشكلة متكررة', key: 'repeatedIssue', icon: FileWarning, color: 'text-yellow-400' },
                        { label: 'حالات كابا مفتوحة', key: 'openCapa', icon: FileText, color: 'text-teal-400' },
                        { label: 'حالات كابا متأخرة', key: 'overdueCapa', icon: AlertCircle, color: 'text-red-400' },
                        { label: 'حالات كابا حرجة', key: 'criticalCapa', icon: ShieldX, color: 'text-red-500' },
                        { label: 'حالات كابا معاد فتحها', key: 'reopenedCapa', icon: ShieldAlert, color: 'text-orange-500' },
                      ].map((item) => {
                        const factor = selectedEmployee.breakdown[item.key] || { count: 0, points: 0 };
                        if (factor.count === 0) return null;
                        return (
                          <div key={item.key} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-slate-800/50">
                            <div className="flex items-center gap-2">
                              <item.icon className={`size-3.5 ${item.color}`} />
                              <span className="text-slate-300 text-xs"><T>{item.label}</T></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-slate-500 text-[10px]">×{formatInteger(factor.count, locale)}</span>
                              <Badge variant="outline" className={`text-[10px] bg-slate-700/50 ${item.color} border-slate-600/50`}>
                                +{formatInteger(factor.points, locale)}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-700/30 flex items-center justify-between">
                      <span className="text-slate-400 text-xs font-medium"><T>الإجمالي</T></span>
                      <span className={`font-bold text-sm ${getRiskLevelConfig(selectedEmployee.riskLevel).color}`}>{formatInteger(selectedEmployee.riskScore, locale)} <T>نقطة</T></span>
                    </div>
                  </CardContent>
                </Card>

                {/* Recommendations */}
                {selectedEmployee.recommendations.length > 0 && (
                  <Card className="border-amber-500/25 bg-amber-500/5">
                    <CardHeader className="pb-2 pt-3 px-4">
                      <CardTitle className="text-white text-sm flex items-center gap-2">
                        <Zap className="size-4 text-amber-400" />
                        <T>التوصيات</T>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-4 pb-3">
                      <div className="space-y-2">
                        {selectedEmployee.recommendations.map((rec, i) => (
                          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                            <div className="size-5 rounded-full bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                              <Target className="size-3 text-amber-400" />
                            </div>
                            <p className="text-amber-200/80 text-xs leading-relaxed">{rec}</p>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* §8 — CAPA actions inside the panel: "Create CAPA" opens
                    the canonical dialog INLINE (no page nav), "View CAPA"
                    navigates filtered to the employee. */}
                <Card className="border-teal-500/25 bg-teal-500/5">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <CardTitle className="text-white text-sm flex items-center gap-2">
                      <FileText className="size-4 text-teal-400" />
                      <T>إجراءات كابا</T>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-3 flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 min-w-[140px] text-xs bg-teal-500/10 border-teal-500/30 text-teal-300 hover:bg-teal-500/20 hover:text-teal-200"
                      onClick={() => setCapaCreateOpen(true)}
                    >
                      <FilePlus className="size-3.5 ml-1" />
                      <T>إنشاء كابا جديد</T>
                    </Button>
                    {selectedEmployee.capaIds && selectedEmployee.capaIds.length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 min-w-[140px] text-xs bg-teal-500/10 border-teal-500/30 text-teal-300 hover:bg-teal-500/20 hover:text-teal-200"
                        onClick={() => useAppStore.getState().navigateTo('capa', undefined, { employeeId: selectedEmployee.employeeId })}
                      >
                        <Eye className="size-3.5 ml-1" />
                        <T>عرض الحالات (</T>{formatInteger(selectedEmployee.capaIds.length, locale)}<T>)</T>
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Last Activity */}
                {selectedEmployee.lastActivity && (
                  <div className="text-center text-slate-500 text-[10px]">
                    <T>آخر نشاط: </T>{selectedEmployee.lastActivity}
                  </div>
                )}

                {/* ═══ §12 INLINE CAPA FORM — opens INSIDE the risk panel
                    (same shared CAPAInlineForm as everywhere else, no
                    dialog, no navigation). The panel scrolls to fit. ═══ */}
                <AnimatePresence>
                  {capaCreateOpen && selectedEmployee && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
                      className="rounded-2xl border border-brand-500/30 bg-slate-900/80 backdrop-blur-md shadow-2xl shadow-brand-900/20 overflow-hidden"
                    >
                      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-700/50">
                        <p className="text-xs font-bold text-slate-200 flex items-center gap-2">
                          <FilePlus className="size-3.5 text-brand-400" />
                          <T>إنشاء CAPA — </T>{selectedEmployee.employeeName}
                        </p>
                        <button onClick={() => setCapaCreateOpen(false)} className="p-1.5 rounded-md text-slate-500 hover:text-white hover:bg-slate-800 transition-colors">
                          <X className="size-3.5" />
                        </button>
                      </div>
                      <div className="p-4">
                        <CAPAInlineForm
                          onClose={() => setCapaCreateOpen(false)}
                          onCreated={() => {
                            setCapaCreateOpen(false);
                            // The new CAPA is a risk factor for this
                            // employee — refresh the risk snapshot and
                            // the CAPA surfaces (§19/§44).
                            void invalidateDomain(queryClient, 'capaCases');
                            void refreshData();
                          }}
                          employees={employeesList as never}
                          systemUsers={usersList}
                          defaultValues={{
                            title: `${selectedEmployee.employeeName} — خطة تصحيحية`,
                            department: selectedEmployee.department || '',
                            priority: selectedEmployee.riskLevel === 'critical' ? 'critical' : 'high',
                            employeeId: selectedEmployee.employeeId,
                            problemDescription: selectedEmployee.recommendations[0] || '',
                            source: 'risk_center',
                          }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
          </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ═══ Department Risk Analysis ═══ */}
      {deptTable.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-2 mb-3">
            <BarChart3 className="size-5 text-slate-400" />
            <h2 className="text-white text-sm font-semibold"><T>تحليل مخاطر الأقسام</T></h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {deptTable.map(dept => {
              const avgLevel = dept.avgScore >= 51 ? 'critical' : dept.avgScore >= 26 ? 'high' : dept.avgScore >= 11 ? 'medium' : 'low';
              const dl = getRiskLevelConfig(avgLevel, locale);
              return (
                <Card key={dept.name} className={`border ${dl.border} ${dl.bg}`}>
                  <CardContent className="p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-white text-sm font-medium">{dept.name}</h3>
                      <Badge variant="outline" className={`text-[10px] ${dl.color} ${dl.border}`}>
                        <T>متوسط: </T>{formatInteger(dept.avgScore, locale)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                      <div className="flex justify-between text-slate-400">
                        <span><T>موظفين:</T></span>
                        <span className="text-white">{formatInteger(dept.count, locale)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span><T>حالات مفتوحة:</T></span>
                        <span className="text-blue-400">{formatInteger(dept.openCases, locale)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span><T>مخالفات جودة:</T></span>
                        <span className="text-amber-400">{formatInteger(dept.qualityViolations, locale)}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span><T>مشاكل حضور:</T></span>
                        <span className="text-red-400">{formatInteger(dept.attendanceIssues, locale)}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* §12 — the legacy CAPAQuickCreate dialog was replaced by the
          shared inline CAPAInlineForm INSIDE the risk side panel (see
          the panel above): no modal, no navigation, one form system. */}
    </div>
  );
}

//  RiskDetailCard — REMOVED in this pass. The Risk Center side
//  panel is intentionally kept as a fixed slide-in (no full
//  inline-expansion refactor) to avoid a 200-line JSX rewrite in a
//  single edit pass. The §8 CAPA-inline change still ships: the
//  panel's "إنشاء كابا جديد" button opens the canonical dialog
//  inline (see the inline <CAPAQuickCreate/> mount at the page
//  bottom). Inline expansion is a §4 follow-up once the test grid
//  for the panel is in place.