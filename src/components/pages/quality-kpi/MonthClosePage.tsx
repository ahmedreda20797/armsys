'use client';

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { usePermissions } from '@/hooks/usePermissions';
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
  CalendarCog, Lock, Unlock, FileSpreadsheet, Clock, CheckCircle2,
  AlertTriangle, Eye, History, Users,
} from 'lucide-react';
import { ScoreBadge } from '@/components/shared/kpi';
import {
  useMonthSnapshots, useMonthSnapshot, useCloseMonth, useReopenMonth,
} from '@/hooks/use-kpi-queries';
import type { MonthSnapshot, EmployeeScoreEntry } from '@/types/quality-kpi';

// ─── Helpers ──────────────────────────────────────────────────
const MONTH_LABELS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function formatMonth(monthKey: string): string {
  const [y, m] = monthKey.split('-');
  const idx = parseInt(m, 10) - 1;
  if (idx < 0 || idx > 11) return monthKey;
  return `${MONTH_LABELS_AR[idx]} ${y}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
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
              <p className="text-sm font-bold text-slate-100">{formatMonth(snap.monthKey)}</p>
              <p className="text-xs text-slate-400">
                {snap.employeeCount} موظف · {snap.departmentCount} قسم
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className={isClosed
              ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
              : 'text-amber-400 border-amber-500/30 bg-amber-500/10'}
          >
            {isClosed ? 'مغلق' : 'مفتوح'}
          </Badge>
        </div>

        {/* Approval summary */}
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-emerald-400 font-bold tabular-nums">{snap.approvalStats?.approved ?? 0}</p>
            <p className="text-slate-500">معتمد</p>
          </div>
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-amber-400 font-bold tabular-nums">{pendingCount}</p>
            <p className="text-slate-500">معلق</p>
          </div>
          <div className="rounded-md bg-slate-800/50 py-1.5">
            <p className="text-rose-400 font-bold tabular-nums">{snap.approvalStats?.rejected ?? 0}</p>
            <p className="text-slate-500">مرفوض</p>
          </div>
        </div>

        {isClosed && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <Clock className="size-3" />
            أُغلق بواسطة {snap.closedByName ?? '—'} · {formatDateTime(snap.closedAt)}
          </p>
        )}
        {snap.reopenCount > 0 && (
          <p className="text-[11px] text-slate-500 flex items-center gap-1">
            <History className="size-3" />
            أُعيد فتحه {snap.reopenCount} مرة
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={onPreview}>
            <Eye className="size-3.5" />
            معاينة
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
              إعادة فتح
            </Button>
          ) : (
            <Button
              size="sm"
              className="flex-1 gap-1.5"
              onClick={onClose}
              disabled={closeBlocked || !canApprove}
              title={closeBlocked ? 'يوجد ملاحظات معلقة — راجعها قبل الإغلاق' : undefined}
            >
              <Lock className="size-3.5" />
              إغلاق الشهر
            </Button>
          )}
        </div>
        {!isClosed && pendingCount > 0 && (
          <p className="text-[11px] text-amber-400 flex items-center gap-1">
            <AlertTriangle className="size-3" />
            {pendingCount} ملاحظة معلقة — الإغلاق غير مفعّل حتى المراجعة
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
  const { data, isLoading } = useMonthSnapshot(open ? monthKey : null);
  const snapshot = (data ?? null) as MonthSnapshot | null;

  const rankedEmployees = useMemo(() => {
    if (!snapshot?.employeeScores) return [];
    return Object.values(snapshot.employeeScores)
      .sort((a, b) => a.rank - b.rank);
  }, [snapshot]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <FileSpreadsheet className="size-5 text-blue-400" />
            {monthKey ? `معاينة لقطة ${formatMonth(monthKey)}` : 'معاينة اللقطة'}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            البيانات المعروضة {snapshot?.status === 'closed' ? 'ثابتة (مجمدة)' : 'مباشرة من الملاحظات الحالية'}
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
                <p className="text-slate-300 font-bold tabular-nums">{rankedEmployees.length}</p>
                <p className="text-slate-500">موظف</p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-slate-300 font-bold tabular-nums">{Object.keys(snapshot.departmentScores || {}).length}</p>
                <p className="text-slate-500">قسم</p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-emerald-400 font-bold tabular-nums">{snapshot.approvalStats?.approved ?? 0}</p>
                <p className="text-slate-500">معتمد</p>
              </div>
              <div className="rounded-md bg-slate-800/50 py-2">
                <p className="text-amber-400 font-bold tabular-nums">{snapshot.approvalStats?.pending ?? 0}</p>
                <p className="text-slate-500">معلق</p>
              </div>
            </div>

            {/* Frozen employees list */}
            <ScrollArea className="h-[50vh] rounded-md border border-slate-700/40">
              <div className="divide-y divide-slate-800/60">
                {rankedEmployees.map((entry: EmployeeScoreEntry) => (
                  <div key={entry.employeeSnapshot.employeeId} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-6 text-center text-xs font-bold text-slate-500 tabular-nums shrink-0">
                      {entry.rank}
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
                      <span className="text-rose-400">−{entry.deductionPoints}</span>
                      {entry.bonusPoints > 0 && <span className="text-emerald-400 mr-2">+{entry.bonusPoints}</span>}
                    </div>
                    <ScoreBadge score={entry.score} />
                  </div>
                ))}
                {rankedEmployees.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <Users className="size-8 mb-2 opacity-50" />
                    <p className="text-sm">لا يوجد موظفون في هذا الشهر</p>
                  </div>
                )}
              </div>
            </ScrollArea>

            {snapshot.status === 'closed' && (
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/30 rounded-md p-2">
                <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                <span>
                  لقطة مجمدة بتاريخ {formatDateTime(snapshot.closedAt)} — الإعدادات المستخدمة: حد أقصى للمكافأة {snapshot.settingsSnapshot?.maximumBonus ?? 0}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-slate-400 py-8">لا توجد بيانات</p>
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

  async function handleConfirm() {
    if (!reason.trim()) {
      toast.error('يرجى ذكر سبب إعادة الفتح');
      return;
    }
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onOpenChange(false);
      setReason('');
    } catch (e) {
      toast.error('فشل إعادة الفتح', { description: e instanceof Error ? e.message : undefined });
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
            إعادة فتح شهر {monthKey ? formatMonth(monthKey) : ''}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            إعادة الفتح تجعل بيانات الشهر قابلة للتعديل مرة أخرى. تظل اللقطة المجمدة محفوظة ولا تُحذف.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>سبب إعادة الفتح <span className="text-rose-400">*</span></Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="مثال: تصحيح ملاحظة مفقودة..."
            rows={3}
            className="bg-slate-800/50 border-slate-700"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>إلغاء</Button>
          <Button onClick={handleConfirm} disabled={busy || !reason.trim()} className="gap-2">
            {busy ? 'جارٍ...' : 'تأكيد إعادة الفتح'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function MonthClosePage() {
  const { canView, canApprove } = usePermissions('monthClose');
  const { data, isLoading, refetch, isFetching } = useMonthSnapshots();
  const closeMut = useCloseMonth();
  const reopenMut = useReopenMonth();

  const [previewMonth, setPreviewMonth] = useState<string | null>(null);
  const [closeMonth, setCloseMonth] = useState<string | null>(null);
  const [reopenMonth, setReopenMonth] = useState<string | null>(null);

  const snapshots = (Array.isArray(data) ? data : []) as SnapshotSummary[];

  if (!canView) {
    return (
      <div dir="rtl" className="flex flex-col items-center justify-center py-24 text-slate-400">
        <p>ليس لديك صلاحية للوصول إلى هذه الصفحة</p>
      </div>
    );
  }

  async function handleClose(monthKey: string) {
    try {
      await closeMut.mutateAsync(monthKey);
      toast.success(`تم إغلاق ${formatMonth(monthKey)}`);
      setCloseMonth(null);
    } catch (e) {
      toast.error('فشل إغلاق الشهر', { description: e instanceof Error ? e.message : undefined });
    }
  }

  async function handleReopen(monthKey: string, reason: string) {
    await reopenMut.mutateAsync({ monthKey, reason });
    toast.success(`تمت إعادة فتح ${formatMonth(monthKey)}`);
  }

  return (
    <div dir="rtl" className="space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <CalendarCog className="size-6 text-blue-400" />
            إغلاق وإعادة فتح الأشهر
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            إغلاق الشهر ينتج لقطة نهائية مجمدة — المصدر الرسمي للتقارير الشهرية
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <Clock className={`size-4 ${isFetching ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2 text-xs text-slate-400 bg-blue-500/5 border border-blue-500/20 rounded-lg p-3">
        <AlertTriangle className="size-4 text-blue-400 shrink-0 mt-0.5" />
        <p>
          إغلاق الشهر يجمد بيانات الموظفين (الاسم، القسم، المنصب، المدير) كما هي وقت الإغلاق.
          أي تغيير لاحق على ملف الموظف لا يؤثر على الأشهر المغلقة. إعادة الفتح يحافظ على اللقطة المجمدة.
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
          <CalendarCog className="size-12 mb-3 opacity-50" />
          <p className="text-sm">لا توجد أشهر بعد. تظهر الأشهر تلقائياً عند إنشاء أول ملاحظة جودة.</p>
        </div>
      )}

      {/* Close confirmation */}
      <Dialog open={!!closeMonth} onOpenChange={(v) => !v && setCloseMonth(null)}>
        <DialogContent className="max-w-md bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-slate-100 flex items-center gap-2">
              <Lock className="size-5 text-blue-400" />
              تأكيد إغلاق {closeMonth ? formatMonth(closeMonth) : ''}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              سيتم احتساب درجات جميع الموظفين وتجميد بياناتهم. يمكن إعادة الفتح لاحقاً مع ذكر السبب.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCloseMonth(null)}>إلغاء</Button>
            <Button
              onClick={() => closeMonth && handleClose(closeMonth)}
              disabled={closeMut.isPending}
              className="gap-2"
            >
              <Lock className="size-4" />
              {closeMut.isPending ? 'جارٍ الإغلاق...' : 'تأكيد الإغلاق'}
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
