'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/lib/i18n/language-context';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import { formatDateTime, formatInteger, formatNumber, formatPercentage, formatMonthKey } from '@/lib/i18n/format';
import { generateMonthOptions } from '@/lib/date-utils';
import { createId } from '@paralleldrive/cuid2';
import {
  clearReportSnapshot,
  loadReportSnapshot,
  saveReportSnapshot,
  type ReportSnapshot,
} from '@/lib/report-state/report-snapshot';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmployeeLink } from '@/components/shared/EmployeeLink';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { authFetch } from '@/lib/api-fetch';
import {
  BarChart3,
  Download,
  Play,
  AlertCircle,
  TrendingUp,
  Clock,
  Wallet,
  ArrowUpDown,
  ShieldCheck,
  Users,
  CalendarCheck,
  FileWarning,
  Award,
  Target,
  UserCircle,
  Filter,
  RotateCcw,
  Phone,
  Briefcase,
  FileText,
  Loader2,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  X,
  Ban,
  CheckCircle2,
  UserCheck,
  Search,
  Printer,
} from 'lucide-react';
import { openPrintReport } from '@/components/print/print-report-store';
import { tableToPrintModel } from '@/components/print/print-adapters';
import { PageIdentity } from '@/components/shared/PageIdentity';

/* ════════════════════════════════════════════════════════════════
   Types
   ════════════════════════════════════════════════════════════════ */
interface ReportRow {
  employeeId: string;
  employeeName: string;
  department: string;
  position?: string | null;
  totalPresent: number;
  totalLate: number;
  totalAbsent: number;
  totalExempt: number;
  totalMinutesLate: number;
  totalMinutesLateFormatted: string;
  lateDeductionDays: number;
  absenceDeductionDays: number;
  totalAttendanceDeductionDays: number;
  totalQualityDays: number;
  totalQualityAmount: number;
  totalHrDeductionDays: number;
  totalHrDeductionAmount: number;
  hrDeductionCount: number;
  totalDeductionDays: number;
  attendanceCompliance: number;
  workDays: number;
  effectiveWorkingDays: number;
  unaccountedDays: number;
  qualityCount: number;
  autoExemptDays: number;
  bonusDays: number;
}

interface ReportMeta {
  month: string;
  monthWorkingDays: number;
  totalEmployees: number;
}

interface ReportSummary {
  totalEmployees: number;
  employeesWithData: number;
  totalPresentDays: number;
  totalLateDays: number;
  totalAbsentDays: number;
  totalExemptDays: number;
  totalMinutesLateAll: number;
  totalMinutesLateFormatted: string;
  totalDeductionDaysAll: number;
  totalQualityDaysAll: number;
  totalQualityAmountAll: number;
  totalHrDeductionDaysAll: number;
  totalHrDeductionAmountAll: number;
  avgCompliance: number;
  highComplianceCount: number;
  lowComplianceCount: number;
}

interface EmployeeDetail {
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
  reportSummary: {
    monthWorkingDays: number;
    effectiveWorkingDays: number;
    totalPresent: number;
    totalLate: number;
    totalAbsent: number;
    totalExempt: number;
    totalMinutesLate: number;
    totalMinutesLateFormatted: string;
    lateDeductionDays: number;
    absenceDeductionDays: number;
    totalAttendanceDeductionDays: number;
    totalQualityDays: number;
    totalQualityAmount: number;
    totalHrDeductionDays: number;
    totalHrDeductionAmount: number;
    totalDeductionDays: number;
    attendanceCompliance: number;
    unaccountedDays: number;
    autoExemptDays: number;
    bonusDays: number;
  };
  dailyBreakdown: {
    date: string;
    dayName: string;
    status: 'present' | 'late' | 'absent' | 'exempt' | 'unaccounted';
    biometricCheckIn: string | null;
    biometricCheckOut: string | null;
    attendanceCheckIn: string | null;
    attendanceCheckOut: string | null;
    minutesLate: number;
    requestStatus: string | null;
    requestType: string | null;
    requestReason: string | null;
    absenceDeduction: number;
    lateDeduction: number;
    source: string;
    waived: boolean;
    waivedType: string | null;
    autoFree: boolean;
  }[];
  requests: {
    id: string;
    type: string;
    typeLabel: string;
    date: string;
    reason: string;
    status: string;
    statusLabel: string;
    reviewedAt: string | null;
    createdAt: string;
  }[];
  qualityDeductions: {
    id: string;
    date: string;
    type: string;
    description: string;
    deductionDays: number;
    deductionAmount: number;
    evidence: string | null;
    createdAt: string;
  }[];
}

type SortField = 'employeeName' | 'attendanceCompliance' | 'totalMinutesLate' | 'totalDeductionDays' | 'totalAbsent' | 'totalPresent' | 'totalLate';
type FilterMode = 'all' | 'committed' | 'delayed' | 'absent' | 'quality' | 'problematic';

// ══════════════════════════════════════════════════════════════
//  Report Continuity (Phase 6.3 §13-§20)
//  The generated report is a versioned, user-scoped CLIENT-SIDE
//  snapshot (§15 level B — no new database model, §48). Restoring
//  shows it VERBATIM with an explicit status (§16/§20); regeneration
//  is only ever the explicit Generate action, which replaces the
//  snapshot atomically (§18).
// ══════════════════════════════════════════════════════════════
const REPORT_SNAPSHOT_VERSION = 1;

interface ReportSnapshotData {
  rows: ReportRow[];
  meta: ReportMeta | null;
  summary: ReportSummary | null;
}

/** Static table-header sort button (hoisted out of the component so it is
 *  never re-created during render — keeps identity stable across renders). */
function SortButton({ field, label, activeField, desc, onToggle }: {
  field: SortField;
  label: string;
  activeField: SortField;
  desc: boolean;
  onToggle: (field: SortField) => void;
}) {
  return (
    <button
      onClick={() => onToggle(field)}
      className="flex items-center justify-center gap-1 w-full text-slate-400 text-xs font-bold hover:text-brand-400 transition-colors cursor-pointer whitespace-nowrap"
    >
      <span><T>{label}</T></span>
      <ArrowUpDown className={`size-3 transition-transform ${activeField === field ? (desc ? 'rotate-180' : '') : 'opacity-30'}`} />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════
   Component
   ════════════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const { canView, canEdit, canExport } = usePermissions('reports');
  const { user } = useAuth();
  const { locale } = useLanguage();
  const [month, setMonth] = useState('');
  const [report, setReport] = useState<ReportRow[]>([]);
  const [meta, setMeta] = useState<ReportMeta | null>(null);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [generating, setGenerating] = useState(false);
  const [hasReport, setHasReport] = useState(false);
  // Report Continuity (§20): explicit status of the CURRENT report.
  const [reportStatus, setReportStatus] = useState<'generated' | 'restored' | null>(null);
  const [reportGeneratedAt, setReportGeneratedAt] = useState<string | null>(null);
  const [reportPeriod, setReportPeriod] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('attendanceCompliance');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [empSearch, setEmpSearch] = useState('');
  const months = generateMonthOptions('YYYY-MM');

  // Inline expanded employee detail
  const [expandedEmpId, setExpandedEmpId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<EmployeeDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [waivingDate, setWaivingDate] = useState<string | null>(null);

  // ── Report Continuity restore (§13/§16/§17) ──
  // One-shot: when the authenticated user already generated a report,
  // restore it VERBATIM (report + context together) — never a silent
  // regeneration. Replaces the pre-6.3 unscoped `erp_report_data`
  // session key (which leaked across users and could pair a report
  // with a mismatched month).
  const reportInitRef = useRef(false);
  useEffect(() => {
    if (reportInitRef.current) return;
    if (!user?.id) return; // wait for the authenticated identity (§6)
    reportInitRef.current = true;
    try {
      // Legacy key cleanup — the snapshot layer owns persistence now.
      sessionStorage.removeItem('erp_report_data');
    } catch {
      /* best-effort */
    }
    // Deferred one frame (react-hooks/set-state-in-effect doctrine —
    // same pattern as the deep-link auto-expands): the restore is a
    // one-shot hydration from user-scoped storage, not a render-phase
    // adjustment.
    const restored = loadReportSnapshot<ReportSnapshotData>({
      userId: user.id,
      page: 'reports',
      version: REPORT_SNAPSHOT_VERSION,
    });
    const raf = requestAnimationFrame(() => {
      if (restored) {
        const snap = restored.snapshot;
        setMonth(snap.period);
        setReport(snap.data?.rows ?? []);
        setMeta(snap.data?.meta ?? null);
        setSummary(snap.data?.summary ?? null);
        setHasReport((snap.data?.rows ?? []).length > 0);
        setReportStatus('restored');
        setReportGeneratedAt(snap.generatedAt);
        setReportPeriod(snap.period);
      } else {
        const now = new Date();
        setMonth(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [user?.id]);

  const handleGenerate = async () => {
    if (!month) return;
    setGenerating(true);
    setError(null);
    setHasReport(false);
    setReport([]);
    setMeta(null);
    setSummary(null);
    setExpandedEmpId(null);
    setDetailData(null);
    try {
      const res = await authFetch('/api/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month }),
      });
      if (res.ok) {
        const data = await res.json();
        const rows = data.rows || [];
        const nextMeta = data.meta || null;
        const nextSummary = data.summary || null;
        setReport(rows);
        setMeta(nextMeta);
        setSummary(nextSummary);
        setHasReport(true);
        // Report Continuity (§14/§18): the generation atomically
        // REPLACES the current report snapshot (no other write path
        // exists — a restored snapshot is immutable, §16).
        if (user?.id) {
          const snapshot: ReportSnapshot<ReportSnapshotData> = {
            reportId: createId(),
            reportType: 'monthly-deductions-report',
            subject: null,
            period: month,
            filters: {},
            generatedAt: new Date().toISOString(),
            generatedBy: user.id,
            stateVersion: REPORT_SNAPSHOT_VERSION,
            data: { rows, meta: nextMeta, summary: nextSummary },
          };
          saveReportSnapshot(
            { userId: user.id, page: 'reports', version: REPORT_SNAPSHOT_VERSION },
            snapshot,
          );
          setReportStatus('generated');
          setReportGeneratedAt(snapshot.generatedAt);
          setReportPeriod(month);
        }
      } else {
        const data = await res.json();
        setError(data.error || translateUIText('فشل في إنشاء التقرير', locale));
      }
    } catch {
      setError(translateUIText('خطأ في الاتصال بالخادم', locale));
    } finally {
      setGenerating(false);
    }
  };

  // §PRINT — the monthly report gets the SAME dedicated clean A4
  // document as every other reporting surface (no live-UI printing).
  const handlePrint = () => {
    if (report.length === 0) return;
    const columns = ['الموظف', 'القسم', 'حضور', 'تأخير', 'غياب', 'أيام الخصم', 'خصم الجودة (يوم)', 'خصم الموارد البشرية (يوم)', 'إجمالي أيام الخصم', 'الالتزام %'];
    openPrintReport(tableToPrintModel({
      title: 'تقرير الخصومات والحضور الشهري',
      period: month,
      columns,
      rows: report.map((r) => [
        r.employeeName, r.department,
        r.totalPresent, r.totalLate, r.totalAbsent,
        r.totalAttendanceDeductionDays, r.totalQualityDays, r.totalHrDeductionDays,
        r.totalDeductionDays, `${r.attendanceCompliance}%`,
      ]),
      stats: [
        { label: 'إجمالي الموظفين', value: summary?.totalEmployees ?? report.length },
        { label: 'أيام الخصم الكلية', value: summary?.totalDeductionDaysAll ?? '—' },
        { label: 'أيام الجودة', value: summary?.totalQualityDaysAll ?? '—' },
      ],
      ltrColumns: [2, 3, 4, 5, 6, 7, 8, 9],
    }));
  };

  const handleExport = async () => {
    if (!month || report.length === 0) return;
    try {
      const res = await authFetch('/api/reports/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, data: report, meta, summary, lang: locale }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `تقرير_خصومات_${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch {
      // silent
    }
  };

  // ── Toggle inline employee detail ──
  const handleToggleDetail = useCallback(async (employeeId: string) => {
    // If already expanded, collapse
    if (expandedEmpId === employeeId) {
      setExpandedEmpId(null);
      setDetailData(null);
      setDetailError(null);
      return;
    }
    // Expand and fetch data
    setExpandedEmpId(employeeId);
    setDetailLoading(true);
    setDetailError(null);
    setDetailData(null);
    try {
      const res = await authFetch('/api/reports/employee-detail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, month }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetailData(data);
      } else {
        const data = await res.json();
        setDetailError(data.error || translateUIText('فشل في تحميل بيانات الموظف', locale));
      }
    } catch {
      setDetailError(translateUIText('خطأ في الاتصال بالخادم', locale));
    } finally {
      setDetailLoading(false);
    }
  }, [expandedEmpId, month]);

  // ── Waive/Cancel a deduction for a specific day ──
  const handleWaiveDeduction = useCallback(async (employeeId: string, date: string, deductionType: string, deductionAmount: number) => {
    setWaivingDate(date);
    try {
      const res = await authFetch('/api/reports/waive-deduction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, date, month, deductionType, deductionAmount, reason: 'إلغاء يدوي بواسطة المدير' }),
      });
      if (res.ok) {
        // Re-fetch detail data to reflect changes
        const detailRes = await authFetch('/api/reports/employee-detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId, month }),
        });
        if (detailRes.ok) {
          setDetailData(await detailRes.json());
        }
      }
    } catch {
      // silent
    } finally {
      setWaivingDate(null);
    }
  }, [month]);

  const handleRestoreDeduction = useCallback(async (employeeId: string, date: string) => {
    setWaivingDate(date);
    try {
      const res = await authFetch('/api/reports/waive-deduction', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, date, month }),
      });
      if (res.ok) {
        const detailRes = await authFetch('/api/reports/employee-detail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId, month }),
        });
        if (detailRes.ok) {
          setDetailData(await detailRes.json());
        }
      }
    } catch {
      // silent
    } finally {
      setWaivingDate(null);
    }
  }, [month]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const processed = useMemo(() => {
    let rows = [...report];
    // Employee name search filter
    if (empSearch.trim()) {
      const q = empSearch.trim().toLowerCase();
      rows = rows.filter((r) =>
        r.employeeName.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q)
      );
    }
    switch (filterMode) {
      case 'committed': rows = rows.filter((r) => r.attendanceCompliance >= 90); break;
      case 'delayed': rows = rows.filter((r) => r.totalLate > 0); break;
      case 'absent': rows = rows.filter((r) => r.totalAbsent > 0); break;
      case 'quality': rows = rows.filter((r) => r.totalQualityDays > 0); break;
      case 'problematic': rows = rows.filter((r) => r.attendanceCompliance < 75 || r.totalAbsent > 2 || r.totalDeductionDays > 1); break;
    }
    rows.sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string, 'ar')
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [report, empSearch, filterMode, sortField, sortDir]);

  // ── Color helpers ──
  const getComplianceColor = (val: number) => {
    if (val >= 90) return 'text-brand-400';
    if (val >= 75) return 'text-amber-400';
    if (val >= 50) return 'text-orange-400';
    return 'text-red-400';
  };
  const getComplianceBg = (val: number) => {
    if (val >= 90) return 'bg-emerald-500';
    if (val >= 75) return 'bg-amber-500';
    if (val >= 50) return 'bg-orange-500';
    return 'bg-red-500';
  };
  const getComplianceBadgeBg = (val: number) => {
    if (val >= 90) return 'bg-brand-500/15 border-brand-500/30';
    if (val >= 75) return 'bg-amber-500/15 border-amber-500/25';
    if (val >= 50) return 'bg-orange-500/15 border-orange-500/25';
    return 'bg-red-500/15 border-red-500/25';
  };

  // ── Badge helpers ──
  const getDayStatusBadge = (status: string) => {
    switch (status) {
      case 'present': return <Badge className="bg-brand-500/15 text-brand-400 border-brand-500/30 text-[11px]"><T>حاضر</T></Badge>;
      case 'late': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[11px]"><T>متأخر</T></Badge>;
      case 'absent': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[11px]"><T>غائب</T></Badge>;
      case 'exempt': return <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/20 text-[11px]"><T>معفى</T></Badge>;
      default: return <Badge className="bg-slate-500/15 text-slate-400 border-slate-500/20 text-[11px]"><T>غير مسجل</T></Badge>;
    }
  };
  const getRequestStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-[11px]"><T>مقبول</T></Badge>;
      case 'rejected': return <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[11px]"><T>مرفوض</T></Badge>;
      case 'pending': return <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/20 text-[11px]"><T>معلق</T></Badge>;
      default: return <Badge variant="outline" className="text-[11px]">{status}</Badge>;
    }
  };

  const totalPresent = processed.reduce((s, r) => s + r.totalPresent, 0);
  const totalLate = processed.reduce((s, r) => s + r.totalLate, 0);
  const totalAbsent = processed.reduce((s, r) => s + r.totalAbsent, 0);
  const totalExempt = processed.reduce((s, r) => s + r.totalExempt, 0);
  const totalHrDedDays = processed.reduce((s, r) => s + (r.totalHrDeductionDays || 0), 0);
  const totalQualDays = processed.reduce((s, r) => s + r.totalQualityDays, 0);
  const totalDed = processed.reduce((s, r) => s + r.totalDeductionDays, 0);

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <ShieldCheck className="size-16 text-slate-600 mb-4" />
        <h2 className="text-xl font-semibold text-slate-400"><T>صلاحية غير كافية</T></h2>
        <p className="text-slate-500 mt-2"><T>هذه الصفحة غير متاحة لحسابك</T></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* ═══════════ §7 unified page identity ═══════════ */}
      <PageIdentity
        pageId="reports"
        icon={<BarChart3 className="size-5" />}
        iconClassName="bg-linear-to-br from-brand-500/20 to-brand-500/20 border border-brand-500/30 text-brand-400"
        description={translateUIText('تقرير الخصومات والحضور الشهري', locale)}
      />

      {/* ═══════════ Controls ═══════════ */}
      <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-slate-700/40 bg-slate-800/40 backdrop-blur-sm p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium"><T>الشهر</T></label>
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="bg-slate-900/60 border-slate-700/60 text-white w-full sm:w-44 h-9 text-sm">
                <SelectValue placeholder={translateUIText('اختر شهراً', locale)} />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m} className="text-white">{formatMonthKey(m, locale)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-slate-400 text-xs font-medium flex items-center gap-1"><Filter className="size-3" /><T>تصفية</T></label>
            <Select value={filterMode} onValueChange={(v) => setFilterMode(v as FilterMode)}>
              <SelectTrigger className="bg-slate-900/60 border-slate-700/60 text-white w-full sm:w-48 h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-white"><T>جميع الموظفين</T></SelectItem>
                <SelectItem value="committed" className="text-white"><T>التزام عالي (90%+)</T></SelectItem>
                <SelectItem value="delayed" className="text-white"><T>لديهم تأخير</T></SelectItem>
                <SelectItem value="absent" className="text-white"><T>لديهم غياب</T></SelectItem>
                <SelectItem value="quality" className="text-white"><T>لديهم خصم جودة</T></SelectItem>
                <SelectItem value="problematic" className="text-white"><T>حالات مشكلة</T></SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex-1 max-w-xs">
            <label className="text-slate-400 text-xs font-medium flex items-center gap-1"><Search className="size-3" /><T>بحث بالاسم</T></label>
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder={translateUIText('اسم الموظف أو القسم...', locale)}
                value={empSearch}
                onChange={(e) => setEmpSearch(e.target.value)}
                className="w-full bg-slate-900/60 border border-slate-700/60 text-white rounded-md h-9 px-9 text-sm placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500/50 focus:border-brand-500/50"
              />
              {empSearch && (
                <button onClick={() => setEmpSearch('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X className="size-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="flex gap-2 sm:mr-auto">
            <Button onClick={handleGenerate} disabled={!month || generating} size="sm" className="bg-linear-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white h-9 px-5 shadow-lg shadow-brand-500/20 transition-all">
              {generating ? (
                <span className="flex items-center gap-1.5"><span className="size-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /><T>جاري الإنشاء...</T></span>
              ) : (
                <span className="flex items-center gap-1.5"><Play className="size-3.5" /><T>إنشاء التقرير</T></span>
              )}
            </Button>
            {canExport && (
              <>
                <Button variant="outline" onClick={handlePrint} disabled={report.length === 0} size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700 h-9 px-3">
                  <Printer className="size-3.5 ml-1" /><T>طباعة / PDF</T>
                </Button>
                <Button variant="outline" onClick={handleExport} disabled={report.length === 0} size="sm" className="border-slate-600 text-slate-300 hover:bg-slate-700 h-9 px-3">
                  <Download className="size-3.5 ml-1" /><T>تصدير Excel</T>
                </Button>
              </>
            )}
          </div>
        </div>
        {/* ── Report Continuity status + period visibility (§10/§19/§20) ── */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {month && (
            <Badge variant="outline" className="border-slate-600/50 text-slate-300 gap-1">
              <CalendarDays className="size-3" />
              <T>الفترة المختارة: </T>{formatMonthKey(month, locale)}
            </Badge>
          )}
          {hasReport && reportPeriod && (
            <Badge variant="outline" className="border-brand-500/40 text-brand-300 gap-1">
              <FileText className="size-3" />
              <T>التقرير المعروض: </T>{formatMonthKey(reportPeriod, locale)}
            </Badge>
          )}
          {hasReport && reportStatus === 'restored' && (
            <Badge variant="outline" className="border-sky-500/40 text-sky-300">
              <T>تمت الاستعادة — لم يُعَ احتسابه</T>
            </Badge>
          )}
          {hasReport && reportStatus === 'generated' && (
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              <T>تم التوليد الآن</T>
            </Badge>
          )}
          {hasReport && reportGeneratedAt && (
            <span className="text-slate-500">
              <T>وُلّد في </T>{formatDateTime(reportGeneratedAt, locale, { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          )}
        </div>
        {hasReport && reportPeriod && month && reportPeriod !== month && (
          <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2">
            <AlertCircle className="size-3.5 shrink-0" />
            <span><T>التقرير المعروض من فترة </T>{formatMonthKey(reportPeriod, locale)}<T> — اضغط «إنشاء التقرير» لتوليد فترة </T>{formatMonthKey(month, locale)}<T>.</T></span>
          </div>
        )}
        {error && (
          <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="size-4 shrink-0" />{error}
          </motion.div>
        )}
      </motion.div>

      {/* ═══════════ Loading ═══════════ */}
      {generating && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((i) => (<Skeleton key={i} className="h-20 rounded-xl bg-slate-800/50" />))}
          </div>
          {[1, 2, 3, 4].map((i) => (<Skeleton key={`row-${i}`} className="h-14 rounded-lg bg-slate-800/50" />))}
        </div>
      )}

      {/* ═══════════ Report Content ═══════════ */}
      {hasReport && report.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">

          {/* Month Info Bar */}
          {meta && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
                <CalendarCheck className="size-3.5 text-brand-400" />
                <span className="text-slate-400"><T>أيام العمل:</T></span>
                <span className="text-white font-bold">{formatInteger(meta.monthWorkingDays, locale)}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
                <Users className="size-3.5 text-brand-400" />
                <span className="text-slate-400"><T>إجمالي الموظفين:</T></span>
                <span className="text-white font-bold">{formatInteger(meta.totalEmployees, locale)}</span>
              </div>
              {summary && (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800/60 border border-slate-700/40">
                  <UserCircle className="size-3.5 text-brand-400" />
                  <span className="text-slate-400"><T>موظفين ببيانات:</T></span>
                  <span className="text-white font-bold">{formatInteger(summary.employeesWithData, locale)}</span>
                </div>
              )}
              <Badge variant="outline" className="text-[11px] border-slate-600 text-slate-400 h-6 px-2.5">{formatMonthKey(month, locale)}</Badge>
            </div>
          )}

          {/* Summary Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }} className="rounded-xl border border-brand-500/30 bg-linear-to-br from-emerald-500/10 to-emerald-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><Target className="size-3.5 text-brand-400" /><span className="text-slate-400 text-[10px] font-medium"><T>متوسط الالتزام</T></span></div>
                <p className={`text-2xl font-bold leading-tight ${getComplianceColor(summary.avgCompliance)}`} dir="ltr">{formatPercentage(summary.avgCompliance, { locale })}</p>
                <div className="mt-2 h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                  <motion.div className={`h-full rounded-full ${getComplianceBg(summary.avgCompliance)}`} initial={{ width: 0 }} animate={{ width: `${Math.min(summary.avgCompliance, 100)}%` }} transition={{ duration: 0.8, ease: 'easeOut' }} />
                </div>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }} className="rounded-xl border border-brand-500/30 bg-emerald-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><CalendarCheck className="size-3.5 text-brand-400" /><span className="text-slate-400 text-[10px] font-medium"><T>إجمالي الحضور</T></span></div>
                <p className="text-2xl font-bold text-brand-400 leading-tight" dir="ltr">{formatInteger(summary.totalPresentDays, locale)}</p>
                <p className="text-slate-500 text-[10px] mt-1"><T>يوم حضور</T></p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.10 }} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><Clock className="size-3.5 text-amber-400" /><span className="text-slate-400 text-[10px] font-medium"><T>التأخير</T></span></div>
                <p className="text-2xl font-bold text-amber-400 leading-tight" dir="ltr">{formatInteger(summary.totalLateDays, locale)}</p>
                <p className="text-slate-500 text-[10px] mt-1">{summary.totalMinutesLateFormatted} <T>إجمالي</T></p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.14 }} className="rounded-xl border border-red-500/20 bg-red-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><FileWarning className="size-3.5 text-red-400" /><span className="text-slate-400 text-[10px] font-medium"><T>الغياب</T></span></div>
                <p className="text-2xl font-bold text-red-400 leading-tight" dir="ltr">{formatInteger(summary.totalAbsentDays, locale)}</p>
                <p className="text-slate-500 text-[10px] mt-1"><T>يوم غياب</T></p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }} className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><ShieldCheck className="size-3.5 text-cyan-400" /><span className="text-slate-400 text-[10px] font-medium"><T>إجازات / معفى</T></span></div>
                <p className="text-2xl font-bold text-cyan-400 leading-tight" dir="ltr">{formatInteger(summary.totalExemptDays, locale)}</p>
                <p className="text-slate-500 text-[10px] mt-1"><T>يوم معفى</T></p>
              </motion.div>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.22 }} className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-3.5 py-3">
                <div className="flex items-center gap-1.5 mb-1.5"><Wallet className="size-3.5 text-rose-400" /><span className="text-slate-400 text-[10px] font-medium"><T>إجمالي الخصم</T></span></div>
                <p className="text-2xl font-bold text-rose-400 leading-tight" dir="ltr">{formatNumber(summary.totalDeductionDaysAll, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-slate-500 text-[10px]"><T>يوم</T></span>
                  {summary.totalQualityDaysAll > 0 && <span className="text-orange-400/70 text-[10px]">+{formatNumber(summary.totalQualityDaysAll, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })}<T>ج</T></span>}
                  {summary.totalHrDeductionDaysAll > 0 && <span className="text-pink-400/70 text-[10px]">+{formatNumber(summary.totalHrDeductionDaysAll, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })}HR</span>}
                </div>
              </motion.div>
            </div>
          )}

          {/* Compliance Bar */}
          {summary && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="rounded-xl border border-slate-700/40 bg-slate-800/40 px-4 py-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400 text-xs font-medium"><T>توزيع الالتزام</T></span>
                <div className="flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" /><span className="text-slate-500"><T>ممتاز (90%+): </T>{formatInteger(summary.highComplianceCount, locale)}</span></span>
                  <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-500" /><span className="text-slate-500"><T>ضعيف: </T>{formatInteger(summary.lowComplianceCount, locale)}</span></span>
                </div>
              </div>
              <div className="flex h-2 rounded-full bg-slate-700/40 overflow-hidden gap-0.5">
                {(() => {
                  const total = summary.totalEmployees || 1;
                  const excellent = summary.highComplianceCount;
                  const low = summary.lowComplianceCount;
                  const mid = Math.max(total - excellent - low, 0);
                  return (
                    <>
                      <motion.div className="bg-emerald-500 rounded-l-full" initial={{ width: 0 }} animate={{ width: `${(excellent / total) * 100}%` }} transition={{ duration: 0.6, delay: 0.3 }} />
                      <motion.div className="bg-amber-500" initial={{ width: 0 }} animate={{ width: `${(mid / total) * 100}%` }} transition={{ duration: 0.6, delay: 0.35 }} />
                      <motion.div className="bg-red-500 rounded-r-full" initial={{ width: 0 }} animate={{ width: `${(low / total) * 100}%` }} transition={{ duration: 0.6, delay: 0.4 }} />
                    </>
                  );
                })()}
              </div>
            </motion.div>
          )}

          {/* Filter indicator */}
          {filterMode !== 'all' && (
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline" className="border-brand-500/30 bg-brand-500/10 text-brand-400 h-6 px-2.5">
                <Filter className="size-3 ml-1" />
                {filterMode === 'committed' && <T>التزام عالي</T>}
                {filterMode === 'delayed' && <T>متأخرون</T>}
                {filterMode === 'absent' && <T>لديهم غياب</T>}
                {filterMode === 'quality' && <T>خصم جودة</T>}
                {filterMode === 'problematic' && <T>حالات مشكلة</T>}
              </Badge>
              <span className="text-slate-500"><T>عرض </T><span className="text-white font-bold">{formatInteger(processed.length, locale)}</span> <T>من</T> {formatInteger(report.length, locale)} <T>موظف</T></span>
              <button onClick={() => setFilterMode('all')} className="text-slate-500 hover:text-brand-400 transition-colors flex items-center gap-0.5">
                <RotateCcw className="size-3" /><T>إعادة تعيين</T>
              </button>
            </div>
          )}

          {/* ═══════════ Data Table ═══════════ */}
          <div className="rounded-xl border border-slate-700/40 bg-slate-800/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-700/50 hover:bg-transparent bg-slate-900/60">
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 w-50"><SortButton field="employeeName" label="الموظف" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-20"><T>القسم</T></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-16.25"><SortButton field="totalPresent" label="حضور" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-17.5"><SortButton field="totalLate" label="تأخير" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-16.25"><SortButton field="totalAbsent" label="غياب" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-13.75"><T>معفى</T></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-20"><T>خصم حضور</T></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-20"><T>خصم جودة</T></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-20"><T>خصم HR</T></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-20"><SortButton field="attendanceCompliance" label="الالتزام" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                  <TableHead className="text-slate-400 text-xs font-bold py-3 px-3 text-center w-18.75"><SortButton field="totalDeductionDays" label="الإجمالي" activeField={sortField} desc={sortDir === 'desc'} onToggle={toggleSort} /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processed.map((row, idx) => {
                  const isExpanded = expandedEmpId === row.employeeId;
                  const hasIssues = row.attendanceCompliance < 75 || row.totalAbsent > 2 || row.unaccountedDays > 3;
                  return (
                    <React.Fragment key={row.employeeId}>
                      {/* ── Main Row ── */}
                      <TableRow
                        className={`border-slate-700/20 hover:bg-slate-700/15 transition-colors cursor-pointer ${hasIssues ? 'bg-red-500/3' : ''} ${isExpanded ? 'bg-brand-500/6' : ''}`}
                        onClick={() => handleToggleDetail(row.employeeId)}
                      >
                        <TableCell className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <EmployeeLink employeeId={row.employeeId} name={row.employeeName} />
                            <div className="min-w-0 flex-1">
                              {row.position && <p className="text-slate-500 text-[11px]">{row.position}</p>}
                            </div>
                            <div className="shrink-0 text-slate-600">
                              {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-400 text-xs text-center py-3 px-3">{row.department}</TableCell>
                        <TableCell className="text-center py-3 px-3"><span className="text-brand-400 font-bold text-sm">{formatInteger(row.totalPresent, locale)}</span></TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <div className="flex flex-col items-center leading-tight">
                            <span className={`text-sm font-bold ${row.totalLate > 3 ? 'text-red-400' : row.totalLate > 0 ? 'text-amber-400' : 'text-slate-600'}`}>{formatInteger(row.totalLate, locale)}</span>
                            {row.totalMinutesLate > 0 && <span className="text-[10px] text-slate-500" dir="ltr">{row.totalMinutesLateFormatted}</span>}
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <span className={`text-sm font-bold ${row.totalAbsent > 2 ? 'text-red-400' : row.totalAbsent > 0 ? 'text-amber-400' : 'text-slate-600'}`}>{formatInteger(row.totalAbsent, locale)}</span>
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <span className={`text-sm ${row.totalExempt > 0 ? 'text-cyan-400 font-medium' : 'text-slate-600'}`}>{row.totalExempt > 0 ? formatInteger(row.totalExempt, locale) : '—'}</span>
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <span className={`text-xs font-medium ${row.totalAttendanceDeductionDays > 0 ? 'text-amber-400' : 'text-slate-600'}`} dir="ltr">{row.totalAttendanceDeductionDays > 0 ? formatNumber(row.totalAttendanceDeductionDays, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span>
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          {row.totalQualityDays > 0 ? (
                            <div className="flex flex-col items-center leading-tight">
                              <span className="text-orange-400 font-medium text-xs" dir="ltr">{formatNumber(row.totalQualityDays, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })} <T>يوم</T></span>
                              {row.totalQualityAmount > 0 && <span className="text-[10px] text-slate-500" dir="ltr">{formatNumber(row.totalQualityAmount, { locale })} <T>جنيه</T></span>}
                            </div>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          {(row.totalHrDeductionDays || 0) > 0 || (row.totalHrDeductionAmount || 0) > 0 ? (
                            <div className="flex flex-col items-center leading-tight">
                              {(row.totalHrDeductionDays || 0) > 0 && <span className="text-pink-400 font-medium text-xs" dir="ltr">{formatNumber(row.totalHrDeductionDays, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })} <T>يوم</T></span>}
                              {(row.totalHrDeductionAmount || 0) > 0 && <span className="text-[10px] text-slate-500" dir="ltr">{formatNumber(row.totalHrDeductionAmount, { locale })} <T>جنيه</T></span>}
                            </div>
                          ) : <span className="text-slate-600 text-xs">—</span>}
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-md border ${getComplianceBadgeBg(row.attendanceCompliance)} ${getComplianceColor(row.attendanceCompliance)}`}>{formatPercentage(row.attendanceCompliance, { locale })}</span>
                            <div className="w-14 h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                              <motion.div className={`h-full rounded-full ${getComplianceBg(row.attendanceCompliance)}`} initial={{ width: 0 }} animate={{ width: `${Math.min(row.attendanceCompliance, 100)}%` }} transition={{ duration: 0.5, delay: idx * 0.02 }} />
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-center py-3 px-3">
                          <span className={`text-sm font-bold ${row.totalDeductionDays > 1 ? 'text-rose-400' : row.totalDeductionDays > 0 ? 'text-amber-400' : 'text-slate-600'}`} dir="ltr">{row.totalDeductionDays > 0 ? formatNumber(row.totalDeductionDays, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span>
                        </TableCell>
                      </TableRow>

                      {/* ── Expanded Inline Detail ── */}
                      <AnimatePresence>
                        {isExpanded && (
                          <TableRow className="border-slate-700/30 bg-slate-900/50 hover:bg-transparent">
                            <TableCell colSpan={12} className="p-0">
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.3 }}
                                className="overflow-hidden"
                              >
                                {detailLoading && (
                                  <div className="flex items-center justify-center gap-2 py-10">
                                    <Loader2 className="size-5 text-brand-400 animate-spin" />
                                    <span className="text-slate-400 text-sm"><T>جاري تحميل التفاصيل...</T></span>
                                  </div>
                                )}

                                {detailError && !detailLoading && (
                                  <div className="mx-6 my-4 rounded-lg bg-red-500/10 border border-red-500/20 p-4 flex items-center gap-2">
                                    <AlertCircle className="size-5 text-red-400 shrink-0" />
                                    <p className="text-red-400 text-sm">{detailError}</p>
                                  </div>
                                )}

                                {detailData && !detailLoading && (
                                  <div className="p-6 space-y-6">
                                    {/* Close button */}
                                    <div className="flex justify-end">
                                      <button onClick={(e) => { e.stopPropagation(); handleToggleDetail(row.employeeId); }} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
                                        <X className="size-5" />
                                      </button>
                                    </div>

                                    {/* ── Employee Profile ── */}
                                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-5">
                                      <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                        <Briefcase className="size-4" /><T>بيانات الموظف</T>
                                      </h3>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-4">
                                        <div><p className="text-slate-500 text-xs mb-1"><T>الاسم</T></p><p className="text-white text-sm font-bold">{detailData.employee.name}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>الكود</T></p><p className="text-slate-300 text-sm">{detailData.employee.code || '—'}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>القسم</T></p><p className="text-slate-300 text-sm">{detailData.employee.department || '—'}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>المسمى الوظيفي</T></p><p className="text-slate-300 text-sm">{detailData.employee.position || '—'}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>الوردية</T></p><p className="text-slate-300 text-sm" dir="ltr">{detailData.employee.shiftStart || '—'} {detailData.employee.shiftEnd ? `- ${detailData.employee.shiftEnd}` : ''}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>تاريخ التعيين</T></p><p className="text-slate-300 text-sm" dir="ltr">{detailData.employee.hireDate || '—'}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>رقم الهاتف</T></p><p className="text-slate-300 text-sm flex items-center gap-1" dir="ltr"><Phone className="size-3" />{detailData.employee.mobile || '—'}</p></div>
                                        <div><p className="text-slate-500 text-xs mb-1"><T>نسبة الالتزام</T></p><p className={`text-lg font-bold ${getComplianceColor(detailData.reportSummary.attendanceCompliance)}`} dir="ltr">{formatPercentage(detailData.reportSummary.attendanceCompliance, { locale })}</p></div>
                                      </div>
                                    </div>

                                    {/* ── Monthly Summary Stats ── */}
                                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-5">
                                      <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                        <BarChart3 className="size-4" /><T>ملخص الشهر</T>
                                      </h3>
                                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                                        <StatBox label="أيام العمل" value={formatInteger(detailData.reportSummary.monthWorkingDays, locale)} color="text-slate-300" />
                                        <StatBox label="أيام فعلي" value={formatInteger(detailData.reportSummary.effectiveWorkingDays, locale)} color="text-slate-300" />
                                        <StatBox label="حضور" value={formatInteger(detailData.reportSummary.totalPresent, locale)} color="text-brand-400" />
                                        <StatBox label="تأخير" value={formatInteger(detailData.reportSummary.totalLate, locale)} color="text-amber-400" sub={detailData.reportSummary.totalMinutesLateFormatted} />
                                        <StatBox label="غياب" value={formatInteger(detailData.reportSummary.totalAbsent, locale)} color="text-red-400" />
                                        <StatBox label="معفى" value={formatInteger(detailData.reportSummary.totalExempt, locale)} color="text-cyan-400" />
                                        <StatBox label="أيام إعفاء تلقائي" value={`${formatInteger(detailData.reportSummary.autoExemptDays, locale)}/4`} color="text-blue-400" />
                                        <StatBox label="أيام بونص" value={formatInteger(detailData.reportSummary.bonusDays, locale)} color="text-brand-400" unit="يوم" />
                                        <StatBox label="خصم تأخير" value={formatNumber(detailData.reportSummary.lateDeductionDays, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 })} color="text-amber-400" unit="يوم" />
                                        <StatBox label="خصم غياب" value={formatNumber(detailData.reportSummary.absenceDeductionDays, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 })} color="text-red-400" unit="يوم" />
                                        <StatBox label="خصم جودة" value={formatNumber(detailData.reportSummary.totalQualityDays, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 })} color="text-orange-400" unit="يوم" />
                                        <StatBox label="إجمالي الخصم" value={formatNumber(detailData.reportSummary.totalDeductionDays, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 })} color="text-rose-400" unit="يوم" />
                                        <StatBox label="غير مسجل" value={formatInteger(detailData.reportSummary.unaccountedDays, locale)} color="text-orange-400" />
                                        <StatBox label="التزام" value={formatPercentage(detailData.reportSummary.attendanceCompliance, { locale })} color={getComplianceColor(detailData.reportSummary.attendanceCompliance)} />
                                      </div>
                                    </div>

                                    {/* ── Actual Attendance Summary Card ── */}
                                    <div className="rounded-xl border border-brand-500/30 bg-linear-to-br from-emerald-500/10 to-emerald-500/5 p-5">
                                      <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                        <UserCheck className="size-4" /><T>ملخص الحضور الفعلي</T>
                                      </h3>
                                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                        <div className="rounded-lg bg-slate-900/60 border border-slate-700/30 px-4 py-3 text-center">
                                          <p className="text-slate-500 text-xs mb-1"><T>إجمالي أيام الحضور</T></p>
                                          <p className="text-2xl font-bold text-brand-400" dir="ltr">{formatInteger(detailData.reportSummary.totalPresent + detailData.reportSummary.totalLate, locale)}</p>
                                          <p className="text-slate-600 text-[10px]"><T>من </T>{formatInteger(detailData.reportSummary.monthWorkingDays, locale)} <T>يوم</T></p>
                                        </div>
                                        <div className="rounded-lg bg-slate-900/60 border border-slate-700/30 px-4 py-3 text-center">
                                          <p className="text-slate-500 text-xs mb-1"><T>حضور منتظم</T></p>
                                          <p className="text-2xl font-bold text-brand-400" dir="ltr">{formatInteger(detailData.reportSummary.totalPresent, locale)}</p>
                                          <p className="text-slate-600 text-[10px]"><T>بدون تأخير</T></p>
                                        </div>
                                        <div className="rounded-lg bg-slate-900/60 border border-slate-700/30 px-4 py-3 text-center">
                                          <p className="text-slate-500 text-xs mb-1"><T>حضور بتأخير</T></p>
                                          <p className="text-2xl font-bold text-amber-400" dir="ltr">{formatInteger(detailData.reportSummary.totalLate, locale)}</p>
                                          <p className="text-slate-600 text-[10px]">{detailData.reportSummary.totalMinutesLateFormatted}</p>
                                        </div>
                                        <div className="rounded-lg bg-slate-900/60 border border-slate-700/30 px-4 py-3 text-center">
                                          <p className="text-slate-500 text-xs mb-1"><T>نسبة الحضور الفعلية</T></p>
                                          <p className={`text-2xl font-bold ${getComplianceColor(detailData.reportSummary.attendanceCompliance)}`} dir="ltr">{formatPercentage(detailData.reportSummary.attendanceCompliance, { locale })}</p>
                                          <div className="mt-1.5 h-1.5 rounded-full bg-slate-700/40 overflow-hidden">
                                            <div className={`h-full rounded-full ${getComplianceBg(detailData.reportSummary.attendanceCompliance)}`} style={{ width: `${Math.min(detailData.reportSummary.attendanceCompliance, 100)}%` }} />
                                          </div>
                                        </div>
                                      </div>
                                    </div>

                                    {/* ── Daily Breakdown Table ── */}
                                    <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-5">
                                      <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                        <CalendarDays className="size-4" /><T>التفاصيل اليومية (</T>{formatInteger(detailData.dailyBreakdown.length, locale)}<T> يوم)</T>
                                      </h3>
                                      <div className="overflow-x-auto">
                                        <Table>
                                          <TableHeader>
                                            <TableRow className="border-slate-700/50 hover:bg-transparent bg-slate-900/60">
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3"><T>التاريخ</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3"><T>اليوم</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3"><T>الحالة</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>بصمة دخول</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>بصمة خروج</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>تسجيل حضور</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>تأخير (د)</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>الطلب</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>خصم غياب</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center"><T>خصم تأخير</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3"><T>المصدر</T></TableHead>
                                              <TableHead className="text-slate-400 text-xs font-bold py-2.5 px-3 text-center w-15"><T>إجراء</T></TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {detailData.dailyBreakdown.map((day, dIdx) => (
                                              <TableRow key={dIdx} className={`border-slate-700/20 hover:bg-slate-700/15 ${day.waived ? 'bg-emerald-500/4' : day.status === 'absent' ? 'bg-red-500/3' : day.status === 'exempt' ? 'bg-cyan-500/3' : ''}`}>
                                                <TableCell className="text-slate-300 text-xs py-2 px-3" dir="ltr">{day.date}</TableCell>
                                                <TableCell className="text-slate-400 text-xs py-2 px-3">{day.dayName}</TableCell>
                                                <TableCell className="py-2 px-3">
                                                  <div className="flex items-center gap-1.5">
                                                    {getDayStatusBadge(day.status)}
                                                    {day.autoFree && <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]"><T>إعفاء تلقائي</T></Badge>}
                                                    {day.waived && !day.autoFree && <Badge className="bg-brand-500/10 text-brand-400 border-brand-500/30 text-[10px]"><T>ملغى يدوياً</T></Badge>}
                                                  </div>
                                                </TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs text-slate-400" dir="ltr">{day.biometricCheckIn || '—'}</TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs text-slate-400" dir="ltr">{day.biometricCheckOut || '—'}</TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs text-slate-400" dir="ltr">{day.attendanceCheckIn || '—'}</TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs">
                                                  {day.minutesLate > 0 ? <span className="text-amber-400 font-medium" dir="ltr">{formatInteger(day.minutesLate, locale)}</span> : <span className="text-slate-600">—</span>}
                                                </TableCell>
                                                <TableCell className="text-center py-2 px-3">
                                                  {day.requestStatus ? getRequestStatusBadge(day.requestStatus) : <span className="text-slate-600 text-xs">—</span>}
                                                </TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs">
                                                  {day.absenceDeduction > 0 ? <span className="text-red-400 font-medium" dir="ltr">{formatNumber(day.absenceDeduction, { locale })}</span> : day.waived && day.waivedType === 'absence' ? <span className="text-brand-400 text-[10px]"><T>0 (ملغى)</T></span> : day.autoFree ? <span className="text-blue-400 text-[10px]"><T>0 (إعفاء تلقائي)</T></span> : <span className="text-slate-600">—</span>}
                                                </TableCell>
                                                <TableCell className="text-center py-2 px-3 text-xs">
                                                  {(day.lateDeduction || 0) > 0 && !day.waived ? <span className="text-amber-400 font-medium" dir="ltr">{formatNumber(day.lateDeduction, { locale })}</span> : day.waived && day.waivedType === 'late' ? <span className="text-brand-400 text-[10px]"><T>0 (ملغى)</T></span> : <span className="text-slate-600">—</span>}
                                                </TableCell>
                                                <TableCell className="py-2 px-3 text-xs text-slate-500 max-w-55 truncate">{day.source}</TableCell>
                                                <TableCell className="text-center py-2 px-2">
                                                  {/* Waive absence deduction */}
                                                  {canEdit && day.absenceDeduction > 0 && !day.waived && (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); handleWaiveDeduction(detailData.employee.id, day.date, 'absence', day.absenceDeduction); }}
                                                      disabled={waivingDate === day.date}
                                                      className="p-1 rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
                                                      title={translateUIText('إلغاء خصم الغياب', locale)}
                                                    >
                                                      {waivingDate === day.date ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                                                    </button>
                                                  )}
                                                  {/* Waive late deduction */}
                                                  {canEdit && !day.waived && (day.lateDeduction || 0) > 0 && (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); handleWaiveDeduction(detailData.employee.id, day.date, 'late', day.lateDeduction); }}
                                                      disabled={waivingDate === day.date}
                                                      className="p-1 rounded-md bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 transition-colors disabled:opacity-50 mr-1"
                                                      title={translateUIText('إلغاء خصم التأخير', locale)}
                                                    >
                                                      {waivingDate === day.date ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
                                                    </button>
                                                  )}
                                                  {/* Restore any waived deduction */}
                                                  {canEdit && day.waived && (
                                                    <button
                                                      onClick={(e) => { e.stopPropagation(); handleRestoreDeduction(detailData.employee.id, day.date); }}
                                                      disabled={waivingDate === day.date}
                                                      className="p-1 rounded-md bg-brand-500/10 hover:bg-brand-500/20 text-brand-400 hover:text-brand-300 transition-colors disabled:opacity-50"
                                                      title={translateUIText('استعادة الخصم', locale)}
                                                    >
                                                      <CheckCircle2 className="size-3.5" />
                                                    </button>
                                                  )}
                                                </TableCell>
                                              </TableRow>
                                            ))}
                                          </TableBody>
                                        </Table>
                                      </div>
                                    </div>

                                    {/* ── Requests ── */}
                                    {detailData.requests.length > 0 && (
                                      <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-5">
                                        <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                          <FileText className="size-4" /><T>الطلبات (</T>{formatInteger(detailData.requests.length, locale)}<T>)</T>
                                        </h3>
                                        <div className="space-y-2">
                                          {detailData.requests.map((req) => (
                                            <div key={req.id} className="rounded-lg bg-slate-900/60 border border-slate-700/30 p-4 flex items-center justify-between gap-4">
                                              <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-1.5">
                                                  <Badge className="bg-slate-700/50 text-slate-300 text-xs">{req.typeLabel}</Badge>
                                                  <span className="text-slate-400 text-xs" dir="ltr">{req.date}</span>
                                                </div>
                                                <p className="text-slate-300 text-sm">{req.reason}</p>
                                              </div>
                                              {getRequestStatusBadge(req.status)}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {/* ── Quality Deductions ── */}
                                    {detailData.qualityDeductions.length > 0 && (
                                      <div className="rounded-xl border border-slate-700/40 bg-slate-800/60 p-5">
                                        <h3 className="text-brand-400 text-sm font-bold mb-4 flex items-center gap-2">
                                          <Award className="size-4" /><T>خصومات الجودة (</T>{formatInteger(detailData.qualityDeductions.length, locale)}<T>)</T>
                                        </h3>
                                        <div className="space-y-2">
                                          {detailData.qualityDeductions.map((q) => (
                                            <div key={q.id} className="rounded-lg bg-slate-900/60 border border-slate-700/30 p-4">
                                              <div className="flex items-center justify-between mb-1.5">
                                                <div className="flex items-center gap-2">
                                                  <Badge className="bg-orange-500/15 text-orange-400 border-orange-500/20 text-xs"><T>{q.type}</T></Badge>
                                                  <span className="text-slate-400 text-xs" dir="ltr">{q.date}</span>
                                                </div>
                                                <div className="flex items-center gap-3 text-sm">
                                                  {q.deductionDays > 0 && <span className="text-orange-400" dir="ltr">{formatNumber(q.deductionDays, { locale })} <T>يوم</T></span>}
                                                  {q.deductionAmount > 0 && <span className="text-rose-400" dir="ltr">{formatNumber(q.deductionAmount, { locale })} <T>جنيه</T></span>}
                                                </div>
                                              </div>
                                              {q.description && <p className="text-slate-400 text-sm">{q.description}</p>}
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </motion.div>
                            </TableCell>
                          </TableRow>
                        )}
                      </AnimatePresence>
                    </React.Fragment>
                  );
                })}

                {/* ── Totals Row ── */}
                <TableRow className="border-t-2 border-slate-600/50 bg-slate-900/70 hover:bg-transparent font-bold">
                  <TableCell className="py-3 px-3">
                    <div className="flex items-center gap-1.5">
                      <TrendingUp className="size-3.5 text-brand-400" />
                      <span className="text-brand-400 font-bold text-sm"><T>الإجمالي</T></span>
                      <span className="text-slate-600 text-[10px]">({formatInteger(processed.length, locale)} <T>موظف</T>)</span>
                    </div>
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-center py-3 px-3"><span className="text-brand-400 text-sm font-bold">{formatInteger(totalPresent, locale)}</span></TableCell>
                  <TableCell className="text-center py-3 px-3"><span className="text-amber-400 text-sm font-bold">{formatInteger(totalLate, locale)}</span></TableCell>
                  <TableCell className="text-center py-3 px-3"><span className="text-red-400 text-sm font-bold">{formatInteger(totalAbsent, locale)}</span></TableCell>
                  <TableCell className="text-center py-3 px-3"><span className="text-cyan-400 text-sm">{totalExempt > 0 ? formatInteger(totalExempt, locale) : '—'}</span></TableCell>
                  <TableCell />
                  <TableCell className="text-center py-3 px-3"><span className="text-orange-400 text-sm">{totalQualDays > 0 ? formatNumber(totalQualDays, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</span></TableCell>
                  <TableCell className="text-center py-3 px-3"><span className="text-pink-400 text-sm">{totalHrDedDays > 0 ? formatNumber(totalHrDedDays, { locale, minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</span></TableCell>
                  <TableCell />
                  <TableCell className="text-center py-3 px-3"><span className="text-rose-400 text-sm font-bold" dir="ltr">{totalDed > 0 ? formatNumber(totalDed, { locale, minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</span></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </motion.div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════
   Helper Components
   ════════════════════════════════════════════════════════════════ */
function StatBox({ label, value, color, sub, unit }: { label: string; value: string; color: string; sub?: string; unit?: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 border border-slate-700/30 px-3 py-3 text-center">
      <p className="text-slate-500 text-xs mb-1"><T>{label}</T></p>
      <p className={`font-bold text-base ${color}`} dir="ltr">{value}</p>
      {sub && <p className="text-slate-600 text-[10px]" dir="ltr">{sub}</p>}
      {unit && <p className="text-slate-600 text-[10px]"><T>{unit}</T></p>}
    </div>
  );
}