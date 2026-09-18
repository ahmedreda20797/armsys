'use client';

// ═══════════════════════════════════════════════════════════════
//  DepartmentHealthDialog — §5/§7.1 Operations Center contextual
//  behavior.
//
//  Clicking a department in "صحة الأقسام" (or the executive summary)
//  opens THIS in-place details view. §7.1: the RISK indicator opens an
//  IN-PLACE risk detail — the department's affected/high-risk
//  employees with score, severity, factor reasons, percentage and
//  direct Employee 360 links — so a manager never has to navigate to
//  Risk Center and re-search just to understand the department risk.
//  Deep navigation to Risk Center remains available as a SECONDARY
//  link and preserves the department scope (navParams.department).
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import {
  AlertTriangle, Building2, CheckCircle2, ChevronLeft, ClipboardCheck,
  Clock, FileText, HeartPulse, Lightbulb, MessageSquareWarning, ShieldAlert, XCircle,
  UserRound, TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useAppStore } from '@/lib/store';
import { usePermissions } from '@/hooks/usePermissions';
import { cn } from '@/lib/utils';
import type { DepartmentHealth } from '@/lib/aocc/types';
import type { RiskCenterResponse } from '@/hooks/use-aocc';

interface DepartmentHealthDialogProps {
  department: DepartmentHealth | null;
  /** The ALREADY-LOADED risk-center data (AoccLayout) — powers the
      in-place §7.1 risk detail without a second fetch. */
  riskData?: RiskCenterResponse | null;
  onClose: () => void;
}

interface IndicatorRow {
  key: string;
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'good' | 'warn' | 'bad' | 'info';
  /** Contextual action — only offered when the indicator is non-zero. */
  targetPage?: string;
  navLabel?: string;
  /** §7.1 — opens the in-place detail section instead of navigating. */
  inPlaceDetail?: 'risk';
}

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

const RISK_LEVEL_LABELS: Record<string, { label: string; cls: string }> = {
  low: { label: 'منخفض', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' },
  medium: { label: 'متوسط', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
  high: { label: 'عالي', cls: 'text-orange-400 bg-orange-500/10 border-orange-500/25' },
  critical: { label: 'حرج', cls: 'text-red-400 bg-red-500/10 border-red-500/25' },
};

/** The two heaviest factors (by points) as a short Arabic reason. */
function topFactorsOf(
  breakdown: Record<string, { count?: number; points?: number } | number> | undefined,
): string {
  if (!breakdown) return '—';
  const entries = Object.entries(breakdown)
    .map(([key, v]) => {
      const val = typeof v === 'number' ? { count: v, points: v } : v;
      return { key, count: val?.count ?? 0, points: val?.points ?? 0 };
    })
    .filter((f) => f.count > 0)
    .sort((a, b) => b.points - a.points);
  const labels = entries.slice(0, 2).map((f) => RISK_FACTOR_LABELS[f.key] ?? f.key);
  return labels.length > 0 ? labels.join(' · ') : '—';
}

export function DepartmentHealthDialog({ department, riskData, onClose }: DepartmentHealthDialogProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const { canViewPage } = usePermissions();
  const [showRiskDetail, setShowRiskDetail] = useState(false);

  // Reset the in-place detail when the dialog switches department —
  // compiler-endorsed "adjust state during render" guard (no effect).
  const [lastDeptName, setLastDeptName] = useState(department?.name ?? null);
  if ((department?.name ?? null) !== lastDeptName) {
    setLastDeptName(department?.name ?? null);
    setShowRiskDetail(false);
  }

  const rows: IndicatorRow[] = useMemo(() => {
    if (!department) return [];
    const d = department;
    const list: IndicatorRow[] = [
      {
        key: 'present', label: 'الحضور اليوم', value: d.present, tone: 'good',
        icon: <CheckCircle2 className="size-3.5 text-emerald-400" />,
      },
      {
        key: 'late', label: 'متأخر اليوم', value: d.late, tone: d.late > 0 ? 'warn' : 'good',
        icon: <Clock className="size-3.5 text-amber-400" />,
        targetPage: 'attendance', navLabel: 'عرض الحضور',
      },
      {
        key: 'absent', label: 'غائب اليوم', value: d.absent, tone: d.absent > 0 ? 'bad' : 'good',
        icon: <XCircle className="size-3.5 text-red-400" />,
        targetPage: 'attendance', navLabel: 'عرض الحضور',
      },
      {
        key: 'capa', label: 'حالات كابا مفتوحة', value: d.capaCount, tone: d.capaCount > 0 ? 'warn' : 'good',
        icon: <ClipboardCheck className="size-3.5 text-brand-400" />,
        targetPage: 'capa', navLabel: 'فتح كابا',
      },
      {
        key: 'overdueCapa', label: 'كابا متأخرة', value: d.overdueCapaCount, tone: d.overdueCapaCount > 0 ? 'bad' : 'good',
        icon: <AlertTriangle className="size-3.5 text-red-400" />,
        targetPage: 'capa', navLabel: 'معالجة المتأخرات',
      },
      {
        key: 'complaints', label: 'شكاوى مرتبطة', value: d.complaintCount, tone: d.complaintCount > 0 ? 'warn' : 'good',
        icon: <MessageSquareWarning className="size-3.5 text-rose-400" />,
        targetPage: 'complaints', navLabel: 'عرض الشكاوى',
      },
      {
        key: 'risk', label: 'موظفون بمخاطر عالية', value: d.riskCount, tone: d.riskCount > 0 ? 'warn' : 'good',
        icon: <ShieldAlert className="size-3.5 text-amber-400" />,
        inPlaceDetail: 'risk',
      },
      {
        key: 'requests', label: 'طلبات معلقة', value: d.pendingRequests, tone: d.pendingRequests > 0 ? 'warn' : 'good',
        icon: <FileText className="size-3.5 text-cyan-400" />,
        targetPage: 'requests', navLabel: 'مراجعة الطلبات',
      },
    ];
    return list;
  }, [department]);

  // §7.1 data — department employees from the risk bundle (already in
  // scope, already loaded), sorted worst-first.
  const deptRisk = useMemo(() => {
    if (!department || !riskData) return null;
    const employees = (riskData.employees ?? [])
      .filter((e) => e.department === department.name)
      .sort((a, b) => b.riskScore - a.riskScore);
    const affected = employees.filter((e) => e.riskLevel === 'high' || e.riskLevel === 'critical');
    const analysis = riskData.departmentAnalysis?.[department.name];
    const total = analysis?.count ?? employees.length;
    return {
      employees,
      affected,
      total,
      affectedPct: total > 0 ? Math.round((affected.length / total) * 100) : 0,
      avgScore: analysis?.avgScore ?? (employees.length > 0
        ? Math.round(employees.reduce((s, e) => s + e.riskScore, 0) / employees.length)
        : 0),
    };
  }, [department, riskData]);

  if (!department) return null;
  const d = department;
  const healthColor = d.healthScore >= 80 ? 'text-emerald-400' : d.healthScore >= 60 ? 'text-amber-400' : 'text-red-400';
  const healthBorder = d.healthScore >= 80 ? 'border-emerald-500/30' : d.healthScore >= 60 ? 'border-amber-500/30' : 'border-red-500/30';

  const nav = (page: string) => {
    onClose();
    // Attendance/Deep links carry the department context so the
    // destination page preselects the SAME scope.
    navigateTo(page, undefined, page === 'attendance' || page === 'riskCenter' ? { department: d.name } : undefined);
  };

  const riskDetailVisible = showRiskDetail && d.riskCount > 0;

  return (
    <Dialog open={!!department} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700/60 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5 text-white">
            <span className={cn('flex items-center justify-center size-9 rounded-xl border', healthBorder, 'bg-slate-800')}>
              <Building2 className="size-4 text-slate-300" />
            </span>
            <span className="min-w-0">
              <span className="block truncate">{d.name}</span>
              <span className="text-[11px] font-normal text-slate-400 flex items-center gap-1 mt-0.5">
                <HeartPulse className={cn('size-3', healthColor)} />
                الصحة التشغيلية
              </span>
            </span>
          </DialogTitle>
          <DialogDescription asChild>
            <div className="mt-3 flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/40">
              <div className="text-center shrink-0">
                <p className={cn('text-2xl font-bold tabular-nums', healthColor)}>{d.healthScore}%</p>
                <p className="text-[10px] text-slate-500">مؤشر الصحة</p>
              </div>
              <div className="h-10 w-px bg-slate-700/50" />
              <div className="min-w-0 text-[11px] text-slate-400 space-y-1">
                <p>
                  حضور اليوم: <span className="text-slate-200 tabular-nums">{d.present}/{d.total}</span>
                  {' '}(معدل <span className="tabular-nums">{d.attendanceRate}%</span>)
                </p>
                {d.warnings.length > 0 ? (
                  <p className="text-amber-400/90 flex items-start gap-1">
                    <AlertTriangle className="size-3 shrink-0 mt-0.5" />
                    {d.warnings.join(' · ')}
                  </p>
                ) : (
                  <p className="text-emerald-400/90">لا تحذيرات نشطة — الوضع مستقر</p>
                )}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {/* ── Indicator grid — the department's ACTUAL data ── */}
        <div className="grid grid-cols-2 gap-2">
          {rows.map((row) => {
            const isRiskTrigger = row.inPlaceDetail === 'risk' && row.value > 0;
            return (
              <div
                key={row.key}
                className={cn(
                  'flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border',
                  row.tone === 'good' && 'border-slate-700/40 bg-slate-800/30',
                  row.tone === 'info' && 'border-sky-500/25 bg-sky-500/5',
                  row.tone === 'warn' && 'border-amber-500/25 bg-amber-500/5',
                  row.tone === 'bad' && 'border-red-500/25 bg-red-500/5',
                  isRiskTrigger && 'cursor-pointer hover:bg-amber-500/10 transition-colors',
                )}
                onClick={isRiskTrigger ? () => setShowRiskDetail((v) => !v) : undefined}
                role={isRiskTrigger ? 'button' : undefined}
                aria-expanded={isRiskTrigger ? riskDetailVisible : undefined}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {row.icon}
                  <span className="text-[11px] text-slate-400 truncate">{row.label}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-sm font-bold text-slate-100 tabular-nums">{row.value}</span>
                  {row.value > 0 && row.targetPage && canViewPage(row.targetPage) && row.navLabel && (
                    <button
                      onClick={(e) => { e.stopPropagation(); nav(row.targetPage!); }}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-slate-700/50 hover:bg-slate-600/60 text-[10px] text-slate-300 hover:text-white transition-colors"
                      title={`${row.navLabel} — ${d.name}`}
                    >
                      {row.navLabel}
                      <ChevronLeft className="size-2.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── §7.1 IN-PLACE RISK DETAIL — no navigation needed ── */}
        {riskDetailVisible && deptRisk && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.04] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="flex items-center gap-1.5 text-xs font-bold text-amber-300">
                <ShieldAlert className="size-3.5" />
                تفاصيل المخاطر — {d.name}
              </p>
              {canViewPage('riskCenter') && (
                <button
                  onClick={() => nav('riskCenter')}
                  className="flex items-center gap-0.5 px-2 py-1 rounded-md bg-slate-800/70 hover:bg-slate-700/70 text-[10px] text-slate-300 hover:text-white transition-colors"
                  title="فتح مركز المخاطر مع نفس نطاق القسم"
                >
                  فتح مركز المخاطر
                  <ChevronLeft className="size-2.5" />
                </button>
              )}
            </div>

            {/* Summary line: severity split + percentages */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-2 py-1.5 text-center">
                <p className="text-sm font-bold text-orange-400 tabular-nums">{deptRisk.affected.length}</p>
                <p className="text-[9px] text-slate-500">موظفون عاليو الخطورة</p>
              </div>
              <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-2 py-1.5 text-center">
                <p className="text-sm font-bold text-slate-200 tabular-nums">{deptRisk.affectedPct}%</p>
                <p className="text-[9px] text-slate-500">نسبة المتأثرين</p>
              </div>
              <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-2 py-1.5 text-center">
                <p className="text-sm font-bold text-slate-200 tabular-nums">{deptRisk.avgScore}</p>
                <p className="text-[9px] text-slate-500">متوسط درجة الخطر</p>
              </div>
            </div>

            {/* Affected employees — worst first, in-place Employee 360 */}
            {deptRisk.affected.length === 0 ? (
              <p className="text-[11px] text-slate-500 text-center py-2">
                لا يوجد موظفون بمخاطر عالية في هذا القسم حاليًا.
              </p>
            ) : (
              <div className="space-y-1.5">
                {deptRisk.affected.map((emp) => {
                  const level = RISK_LEVEL_LABELS[emp.riskLevel] ?? RISK_LEVEL_LABELS.medium;
                  return (
                    <button
                      key={emp.employeeId}
                      type="button"
                      onClick={() => {
                        onClose();
                        openEmployee360(emp.employeeId);
                      }}
                      className="w-full text-right rounded-lg bg-slate-900/60 border border-slate-700/40 hover:border-slate-600/60 px-2.5 py-2 transition-colors group"
                      title="فتح ملف الموظف 360"
                    >
                      <div className="flex items-center gap-2">
                        <UserRound className="size-3.5 text-slate-400 shrink-0" />
                        <span className="text-xs font-semibold text-slate-100 truncate flex-1 min-w-0">{emp.employeeName}</span>
                        <span className={cn('shrink-0 px-1.5 py-0.5 rounded-full border text-[9px] font-bold', level.cls)}>
                          {level.label}
                        </span>
                        <span className="shrink-0 text-xs font-bold text-slate-200 tabular-nums">{emp.riskScore}</span>
                        <span className="shrink-0 flex items-center text-slate-500 group-hover:text-slate-300">
                          {emp.trend === 'declining' ? <TrendingDown className="size-3 text-red-400" />
                            : emp.trend === 'improving' ? <TrendingUp className="size-3 text-emerald-400" />
                            : <Minus className="size-3" />}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-500 mt-1 truncate">
                        {topFactorsOf(emp.breakdown as never)}
                        {emp.openCases > 0 ? ` · ${emp.openCases} حالات مفتوحة` : ''}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Recommended action ── */}
        {d.recommendedAction && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-300/90">
            <Lightbulb className="size-3.5 shrink-0 mt-0.5" />
            <span><span className="font-semibold">الإجراء الموصى به: </span>{d.recommendedAction}</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
