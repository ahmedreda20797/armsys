'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
import { useLanguage } from '@/lib/i18n/language-context';
import { formatDateTime as localeDateTime, displayLocale, formatMonthKey, formatInteger } from '@/lib/i18n/format';
import { T } from '@/lib/i18n/T';
import { translateUIText } from '@/lib/i18n/ui-text';
import type { Locale } from '@/lib/i18n/dictionary';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  CalendarClock, Lock, Unlock, FileSpreadsheet, Clock, CheckCircle2,
  AlertTriangle, Eye, History, Users,
} from 'lucide-react';
import { PageIdentity } from '@/components/shared/PageIdentity';
import { ScoreBadge, KpiSchemeSummaryCard } from '@/components/shared/kpi';
import {
  useMonthSnapshots, useMonthSnapshot, useCloseMonth, useReopenMonth,
} from '@/hooks/use-kpi-queries';
import type { MonthSnapshot, EmployeeScoreEntry } from '@/types/quality-kpi';
import type { EmployeeKpiResult, KpiScheme } from '@/lib/kpi-framework';

// ─── Helpers ──────────────────────────────────────────────────
function formatDateTime(iso: string | null, locale: Locale = displayLocale()): string {
  if (!iso) return '—';
  try {
    return localeDateTime(iso, locale, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface SnapshotSummary {
  id: string;
  monthKey: string;
  status: 'open' | 'closed';
  closedAt: string | null;
  closedByName: string | null;
  reopenCount: number;
  generatedAt: string;
  employeeCount: number;
  departmentCount: number;
  approvalStats: { total: number; pending: number; approved: number; rejected: number };
}

// ─── Month card ───────────────────────────────────────────────
function MonthCard({
  snap, onPreview, onClose, onReopen, canApprove,
}: {
  snap: SnapshotSummary;
  onPreview: () => void;
  onClose: () => void;
  onReopen: () => void;
  canApprove: boolean;
}) {
  const { locale } = useLanguage();
  const isClosed = snap.status === 'closed';
  const pendingCount = snap.approvalStats?.pending ?? 0;
  const closeBlocked = pendingCount > 0;

  return (
    <Card className="bg-slate-800/30 border-slate-700/40">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className={`size-10 rounded-lg flex items-center justify-center shrink-0 ${
              isClosed ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700/40 text-slate-400'
            }`}>
              {isClosed ? <Lock className="size-5" /> : <Unlock className="size-5" />}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-100">{formatMonthKey(snap.monthKey, locale)}</p>
              <p className="text-xs text-slate-400">
                {formatInteger(snap.employeeCount, locale)} <T>موظف</T> · {formatInteger(snap.departmentCount, locale)} <T>قسم</T>
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={isClosed
              ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
              : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}
          >
            <T>{isClosed ? 'مغلق' : 'مفتوح'}</T>
          </Badge>
        </div>

        {/* Approval summary */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-emerald-400 font-bold tabular-nums">{formatInteger(snap.approvalStats?.approved ?? 0, locale)}</p>
            <p className="text-slate-500"><T>معتمد</T></p>
          </div>
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-amber-400 font-bold tabular-nums">{formatInteger(pendingCount, locale)}</p>
            <p className="text-slate-500"><T>معلق</T></p>
          </div>
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-rose-400 font-bold tabular-nums">{formatInteger(snap.approvalStats?.rejected ?? 0, locale)}</p>
            <p className="text-slate-500"><T>مرفوض</T></p>
          </div>
        </div>

        {isClosed && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <Clock className="size-3" />
            <T>أُغلق بواسطة </T>{snap.closedByName ?? '—'} · {formatDateTime(snap.closedAt, locale)}
          </p>
        )}
        {snap.reopenCount > 0 && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <History className="size-3" />
            <T>أُعيد فتحه </T>{formatInteger(snap.reopenCount, locale)} <T>مرة</T>
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onPreview}>
            <Eye className="size-3.5" />
            <T>معاينة</T>
          </Button>
          {isClosed ? (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onReopen}
              disabled={!canApprove}
            >
              <Unlock className="size-3.5" />
              <T>إعادة فتح</T>
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onClose}
              disabled={closeBlocked || !canApprove}
              title={closeBlocked ? translateUIText('يوجد ملاحظات معلقة — راجعها قبل الإغلاق', locale) : undefined}
            >
              <Lock className="size-3.5" />
              <T>إغلاق الشهر</T>
            </Button>
          )}
        </div>
        {!isClosed && pendingCount > 0 && (
          <p className="text-[11px] text-amber-400 flex items-center gap-1">
            <AlertTriangle className="size-3" />
            {formatInteger(pendingCount, locale)} <T>ملاحظة معلقة — الإغلاق غير مفعّل حتى المراجعة</T>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Preview dialog ───────────────────────────────────────────
function SnapshotPreviewDialog({
  monthKey, open, onOpenChange,
}: {
  monthKey: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { locale } = useLanguage();
  const { data, isLoading } = useMonthSnapshot(open ? monthKey : null);
  const snapshot = (data ?? null) as MonthSnapshot | null;

  const rankedEmployees = useMemo(() => {
    if (!snapshot?.employeeScores) return [];
    return Object.values(snapshot.employeeScores)
      .sort((a, b) => a.rank - b.rank);
  }, [snapshot]);

  // KPI Framework (Phase 1): when the snapshot carries frozen framework
  // results, project the FIRST frozen result into a display scheme so
  // the dialog shows exactly the scheme/version/weights that were
  // frozen — never the current live scheme.
  const frozenKpiDisplay = useMemo(() => {
    const first: EmployeeKpiResult | null = snapshot?.kpiResults
      ? Object.values(snapshot.kpiResults)[0] ?? null
      : null;
    if (!first) return null;
    const displayScheme: KpiScheme = {
      id: first.schemeId,
      schemaVersion: 1,
      name: first.schemeName,
      description: null,
      status: 'ACTIVE',
      version: first.schemeVersion,
      effectiveFrom: '',
      effectiveTo: null,
      isDefault: false,
      applicableDepartments: null,
      components: first.components.map((c) => ({
        componentId: c.componentId,
        name: c.name,
        weight: c.weight,
        owner: c.owner,
        calculationType: 'none' as const,
        status: 'ACTIVE' as const,
        configuration: null,
      })),
      previousSchemeId: null,
      createdBy: null,
      createdAt: '',
      updatedAt: '',
    };
    return { scheme: displayScheme, result: first };
  }, [snapshot]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-blue-400" />
            {monthKey ? (<><T>معاينة لقطة </T>{formatMonthKey(monthKey, locale)}</>) : <T>معاينة اللقطة</T>}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <T>البيانات المعروضة </T>
            {snapshot?.status === 'closed' ? <T>ثابتة (مجمدة)</T> : <T>مباشرة من الملاحظات الحالية</T>}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : snapshot ? (
          <div className="space-y-3">
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-slate-300 font-bold tabular-nums">{formatInteger(rankedEmployees.length, locale)}</p>
                <p className="text-slate-500"><T>موظف</T></p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-slate-300 font-bold tabular-nums">{formatInteger(Object.keys(snapshot.departmentScores || {}).length, locale)}</p>
                <p className="text-slate-500"><T>قسم</T></p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-emerald-400 font-bold tabular-nums">{formatInteger(snapshot.approvalStats?.approved ?? 0, locale)}</p>
                <p className="text-slate-500"><T>معتمد</T></p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-amber-400 font-bold tabular-nums">{formatInteger(snapshot.approvalStats?.pending ?? 0, locale)}</p>
                <p className="text-slate-500"><T>معلق</T></p>
              </div>
            </div>

            {/* KPI Framework (Phase 1): frozen scheme results (when present) */}
            {frozenKpiDisplay && (
              <KpiSchemeSummaryCard
                scheme={frozenKpiDisplay.scheme}
                result={frozenKpiDisplay.result}
              />
            )}

            {/* Frozen employees list */}
            <ScrollArea className="h-[50vh] rounded-md border border-slate-700/40">
              <div className="divide-y divide-slate-800/60">
                {rankedEmployees.map((entry: EmployeeScoreEntry) => (
                  <div key={entry.employeeSnapshot.employeeId} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-6 text-center text-xs font-bold text-slate-500 tabular-nums shrink-0">
                      {formatInteger(entry.rank, locale)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-100 truncate">
                        {entry.employeeSnapshot.employeeName}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {entry.employeeSnapshot.departmentName}
                        {entry.employeeSnapshot.position ? ` · ${entry.employeeSnapshot.position}` : ''}
                      </p>
                    </div>
                    <div className="text-left text-xs text-slate-400 shrink-0">
                      <span className="text-rose-400">−{formatInteger(entry.deductionPoints, locale)}</span>
                      {entry.bonusPoints > 0 && <span className="text-emerald-400 mr-2">+{formatInteger(entry.bonusPoints, locale)}</span>}
                    </div>
                    <ScoreBadge score={entry.score} />
                  </div>
                ))}
                {rankedEmployees.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <Users className="size-8 mb-2 opacity-50" />
                    <p className="text-sm"><T>لا يوجد موظفون في هذا الشهر</T></p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {snapshot.status === 'closed' && (
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/30 rounded-md p-2">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                <span>
                  <T>لقطة مجمدة بتاريخ </T>{formatDateTime(snapshot.closedAt, locale)}<T> — الإعدادات المستخدمة: حد أقصى للمكافأة </T>{formatInteger(snapshot.settingsSnapshot?.maximumBonus ?? 0, locale)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-slate-400 py-8"><T>لا توجد بيانات</T></p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Reopen dialog ────────────────────────────────────────────
function ReopenDialog({
  open, onOpenChange, monthKey, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  monthKey: string | null;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { locale } = useLanguage();

  async function handleConfirm() {
    if (!reason.trim()) {
      toast.error(translateUIText('يرجى ذكر سبب إعادة الفتح', locale));
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
      setReason('');
    } catch (e) {
      toast.error(translateUIText('فشل إعادة الفتح', locale), { description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setReason(''); }}>
      <DialogContent className="max-w-md bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <Unlock className="size-5 text-amber-400" />
            <T>إعادة فتح شهر </T>{monthKey ? formatMonthKey(monthKey, locale) : ''}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            <T>إعادة الفتح تجعل بيانات الشهر قابلة للتعديل مرة أخرى. تظل اللقطة المجمدة محفوظة ولا تُحذف.</T>
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label><T>سبب إعادة الفتح</T> <span className="text-rose-400">*</span></Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={translateUIText('مثال: تصحيح ملاحظة مفقودة...', locale)}
            rows={3}
            className="bg-slate-800/50 border-slate-700"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}><T>إلغاء</T></Button>
          <Button onClick={handleConfirm} disabled={busy || !reason.trim()} className="gap-2">
            <T>{busy ? 'جارٍ...' : 'تأكيد إعادة الفتح'}</T>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function MonthClosePage() {
  const { canView, canApprove } = usePermissions('monthClose');
  const { locale } = useLanguage();
  const { data, isLoading, refetch, isFetching } = useMonthSnapshots();
  const closeMut = useCloseMonth();
  const reopenMut = useReopenMonth();

  const [previewMonth, setPreviewMonth] = useState<string | null>(null);
  const [closeMonth, setCloseMonth] = useState<string | null>(null);
  const [reopenMonth, setReopenMonth] = useState<string | null>(null);

  const snapshots = (Array.isArray(data) ? data : []) as SnapshotSummary[];

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p><T>ليس لديك صلاحية للوصول إلى هذه الصفحة</T></p>
      </div>
    );
  }

  async function handleClose(monthKey: string) {
    try {
      await closeMut.mutateAsync(monthKey);
      toast.success(`${translateUIText('تم إغلاق', locale)} ${formatMonthKey(monthKey, locale)}`);
      setCloseMonth(null);
    } catch (e) {
      toast.error(translateUIText('فشل إغلاق الشهر', locale), { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function handleReopen(monthKey: string, reason: string) {
    await reopenMut.mutateAsync({ monthKey, reason });
    toast.success(`${translateUIText('تمت إعادة فتح', locale)} ${formatMonthKey(monthKey, locale)}`);
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      {/* §7 — unified page identity */}
      <PageIdentity
        pageId="monthClose"
        icon={<CalendarClock className="size-5" />}
        iconClassName="bg-blue-500/15 border-blue-500/30 text-blue-400"
        title={translateUIText('إغلاق وإعادة فتح الأشهر', locale)}
        description={translateUIText('إغلاق الشهر ينتج لقطة نهائية مجمدة — المصدر الرسمي للتقارير الشهرية', locale)}
        actions={
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <Clock className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
            <T>تحديث</T>
          </Button>
        }
      />

      {/* Info banner */}
      <div className="flex items-start gap-2 text-xs text-slate-400 bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
        <AlertTriangle className="size-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          <T>إغلاق الشهر يجمد بيانات الموظفين (الاسم، القسم، المنصب، المدير) كما هي وقت الإغلاق. أي تغيير لاحق على ملف الموظف لا يؤثر على الأشهر المغلقة. إعادة الفتح يحافظ على اللقطة المجمدة.</T>
        </p>
      </div>

      {/* Grid of months */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : snapshots.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {snapshots.map((snap) => (
              <motion.div
                key={snap.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <MonthCard
                  snap={snap}
                  canApprove={canApprove}
                  onPreview={() => setPreviewMonth(snap.monthKey)}
                  onClose={() => setCloseMonth(snap.monthKey)}
                  onReopen={() => setReopenMonth(snap.monthKey)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <CalendarClock className="size-12 mb-3 opacity-50" />
          <p className="text-sm"><T>لا توجد أشهر بعد. تظهر الأشهر تلقائياً عند إنشاء أول ملاحظة جودة.</T></p>
        </div>
      )}

      {/* Close confirmation */}
      <Dialog open={!!closeMonth} onOpenChange={(v) => !v && setCloseMonth(null)}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-slate-100 flex items-center gap-2">
              <Lock className="size-5 text-blue-400" />
              <T>تأكيد إغلاق </T>{closeMonth ? formatMonthKey(closeMonth, locale) : ''}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              <T>سيتم احتساب درجات جميع الموظفين وتجميد بياناتهم. يمكن إعادة الفتح لاحقاً مع ذكر السبب.</T>
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCloseMonth(null)}><T>إلغاء</T></Button>
            <Button
              onClick={() => closeMonth && handleClose(closeMonth)}
              disabled={closeMut.isPending}
              className="gap-2"
            >
              <Lock className="size-4" />
              <T>{closeMut.isPending ? 'جارٍ الإغلاق...' : 'تأكيد الإغلاق'}</T>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Preview dialog */}
      <SnapshotPreviewDialog
        monthKey={previewMonth}
        open={!!previewMonth}
        onOpenChange={(v) => !v && setPreviewMonth(null)}
      />

      {/* Reopen dialog */}
      <ReopenDialog
        open={!!reopenMonth}
        onOpenChange={(v) => !v && setReopenMonth(null)}
        monthKey={reopenMonth}
        onConfirm={(reason) => reopenMonth ? handleReopen(reopenMonth, reason) : Promise.resolve()}
      />
    </div>
  );
}
