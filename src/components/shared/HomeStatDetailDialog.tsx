'use client';

// ═══════════════════════════════════════════════════════════════
//  HomeStatDetailDialog — §22 the in-place metric detail surface.
//
//  Clicking a Home summary card opens the EXACT records the number
//  represents — no navigation, no generic page of unrelated rows:
//    employees        → the (scope-filtered) employee list
//    attendance       → today's attendance breakdown (present/absent)
//    late             → today's late employees (name, check-in, minutes)
//    pending-requests → the pending requests with in-place decisions
//
//  Deep navigation to the owning page remains available as a secondary
//  action inside the dialog.
// ═══════════════════════════════════════════════════════════════

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, ChevronLeft, Clock, Loader2, UserRound, Users, XCircle,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/api-fetch';
import { toast } from 'sonner';

export type HomeStatDetailKind = 'employees' | 'attendance' | 'late' | 'pending-requests';

export interface HomeStatDetailStats {
  totalEmployees: number;
  presentCount: number;
  absentCount: number;
  lateCount: number;
  attendanceRate: number;
  departmentList: { name: string; count: number }[];
  lateEmployees: { id: string; employeeName: string; department: string; checkIn: string | null; minutesLate: number }[];
  pendingRequestsDetails: Array<{
    id: string; employeeId: string; employeeName?: string | null;
    employeeDepartment?: string | null; type: string; date: string;
    reason?: string | null; status: string;
  }>;
}

interface HomeStatDetailDialogProps {
  kind: HomeStatDetailKind | null;
  stats: HomeStatDetailStats;
  /** employees/records list passed by the page (scope-filtered API). */
  employees: Array<{ id: string; name: string; department?: string | null; position?: string | null }>;
  /** In-place request decision handler (the page's existing mutation). */
  onRequestAction?: (requestId: string, action: 'approved' | 'rejected') => void;
  /** Ids with an in-flight decision (button spinner state). */
  actionLoadingId?: string | null;
  onClose: () => void;
}

const KIND_META: Record<HomeStatDetailKind, { title: string }> = {
  employees: { title: 'الموظفون' },
  attendance: { title: 'حضور اليوم' },
  late: { title: 'متأخرو اليوم' },
  'pending-requests': { title: 'الطلبات المعلقة' },
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  leave: 'إجازة', excuse: 'استئذان', mission: 'مهمة عمل',
  remote: 'عمل عن بعد', salary_advance: 'سلفة', other: 'أخرى',
};

export function HomeStatDetailDialog({
  kind, stats, employees, onRequestAction, actionLoadingId, onClose,
}: HomeStatDetailDialogProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const { canViewPage, canDoAction } = usePermissions();
  const qc = useQueryClient();

  const canApprove = canDoAction('requests', 'approve');

  const deepLink = async (page: string) => {
    onClose();
    navigateTo(page);
  };

  const decide = async (id: string, action: 'approved' | 'rejected') => {
    if (onRequestAction) {
      onRequestAction(id, action);
      return;
    }
    // Standalone fallback (same endpoint + keys the Requests page uses).
    try {
      const res = await authFetch(`/api/requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: action }),
      });
      if (res.ok) {
        toast.success(action === 'approved' ? 'تمت الموافقة' : 'تم الرفض');
        await qc.invalidateQueries({ queryKey: ['home-stats'] });
        await qc.invalidateQueries({ queryKey: ['homeStats'] });
        await qc.invalidateQueries({ queryKey: ['requests'] });
      } else {
        toast.error('تعذر تنفيذ القرار');
      }
    } catch {
      toast.error('تعذر الاتصال بالخادم');
    }
  };

  const body = useMemo(() => {
    if (!kind) return null;
    switch (kind) {
      case 'employees': {
        return (
          <div className="space-y-1.5">
            {employees.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">لا يوجد موظفون ضمن نطاقك الحالي.</p>
            ) : employees.map((emp) => (
              <div key={emp.id} className="flex items-center gap-2 rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2">
                <span className="flex items-center justify-center size-6 rounded-full bg-slate-700/70 text-[10px] font-bold text-slate-200 shrink-0">
                  {emp.name?.charAt(0) ?? '؟'}
                </span>
                <span className="text-xs font-semibold text-slate-100 truncate flex-1 min-w-0">{emp.name}</span>
                <span className="text-[10px] text-slate-500 truncate shrink-0">
                  {[emp.position, emp.department].filter(Boolean).join(' · ') || '—'}
                </span>
              </div>
            ))}
            {canViewPage('employees') && (
              <DeepLink label="صفحة الموظفين" onClick={() => void deepLink('employees')} />
            )}
          </div>
        );
      }

      case 'attendance': {
        const presentPct = stats.totalEmployees > 0
          ? Math.round((stats.presentCount / stats.totalEmployees) * 100)
          : 0;
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Metric label="حاضر" value={stats.presentCount} tone="text-emerald-400" />
              <Metric label="متأخر" value={stats.lateCount} tone="text-amber-400" />
              <Metric label="غائب" value={stats.absentCount} tone="text-red-400" />
            </div>
            <div>
              <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-l from-emerald-500 to-cyan-500 transition-all"
                  style={{ width: `${presentPct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500 mt-1 text-center">
                {stats.presentCount}/{stats.totalEmployees} — {stats.attendanceRate}% نسبة الحضور
              </p>
            </div>
            {stats.lateEmployees.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-slate-500">متأخرو اليوم</p>
                {stats.lateEmployees.slice(0, 8).map((late) => (
                  <div key={late.id} className="flex items-center gap-2 text-[11px] text-slate-300 bg-slate-800/40 rounded-lg px-2.5 py-1.5 border border-slate-700/30">
                    <Clock className="size-3 text-amber-400 shrink-0" />
                    <span className="truncate flex-1">{late.employeeName}</span>
                    <span className="text-amber-300/80 shrink-0">{late.minutesLate} د</span>
                  </div>
                ))}
              </div>
            )}
            {canViewPage('attendance') && (
              <DeepLink label="صفحة الحضور" onClick={() => void deepLink('attendance')} />
            )}
          </div>
        );
      }

      case 'late': {
        return (
          <div className="space-y-1.5">
            {stats.lateEmployees.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="size-8 text-emerald-500/60 mb-2" />
                <p className="text-xs text-slate-400">لا يوجد متأخرون اليوم — التزام كامل حتى الآن.</p>
              </div>
            ) : stats.lateEmployees.map((late) => (
              <div key={late.id} className="flex items-center gap-2 rounded-lg bg-slate-800/40 border border-amber-500/20 px-3 py-2">
                <UserRound className="size-3.5 text-slate-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-100 truncate flex-1 min-w-0">{late.employeeName}</span>
                <span className="text-[10px] text-slate-500 truncate shrink-0">{late.department || '—'}</span>
                <span className="text-[10px] text-amber-300/90 shrink-0 tabular-nums">
                  {late.checkIn || '—'} · {late.minutesLate} د
                </span>
              </div>
            ))}
            {canViewPage('attendance') && (
              <DeepLink label="صفحة الحضور" onClick={() => void deepLink('attendance')} />
            )}
          </div>
        );
      }

      case 'pending-requests': {
        const rows = stats.pendingRequestsDetails ?? [];
        return (
          <div className="space-y-1.5">
            {rows.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center">
                <CheckCircle2 className="size-8 text-emerald-500/60 mb-2" />
                <p className="text-xs text-slate-400">لا توجد طلبات معلقة — كل الطلبات تمت مراجعتها.</p>
              </div>
            ) : rows.map((req) => (
              <div key={req.id} className="rounded-lg bg-slate-800/40 border border-slate-700/40 px-3 py-2 space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-100 truncate min-w-0 flex-1">
                    {req.employeeName || 'موظف'}
                    {req.employeeDepartment ? <span className="text-[10px] font-normal text-slate-500"> · {req.employeeDepartment}</span> : null}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-300 font-bold shrink-0">
                    {REQUEST_TYPE_LABELS[req.type] ?? req.type}
                  </span>
                  <span className="text-[10px] text-slate-500 shrink-0 tabular-nums">{req.date}</span>
                </div>
                {req.reason && <p className="text-[10px] text-slate-500 line-clamp-2">{req.reason}</p>}
                {canApprove && onRequestAction && (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm" className="h-6 px-2.5 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                      disabled={actionLoadingId === req.id}
                      onClick={() => void decide(req.id, 'approved')}
                    >
                      {actionLoadingId === req.id ? <Loader2 className="size-2.5 animate-spin" /> : <CheckCircle2 className="size-2.5" />}
                      اعتماد
                    </Button>
                    <Button
                      size="sm" variant="outline"
                      className="h-6 px-2.5 text-[10px] gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                      disabled={actionLoadingId === req.id}
                      onClick={() => void decide(req.id, 'rejected')}
                    >
                      <XCircle className="size-2.5" /> رفض
                    </Button>
                  </div>
                )}
              </div>
            ))}
            {canViewPage('requests') && (
              <DeepLink label="صفحة الطلبات" onClick={() => void deepLink('requests')} />
            )}
          </div>
        );
      }

      default:
        return null;
    }
  }, [kind, employees, stats, canViewPage, canApprove, actionLoadingId]);

  if (!kind) return null;
  const meta = KIND_META[kind];

  return (
    <Dialog open={!!kind} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700/60 max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <span className="flex items-center justify-center size-8 rounded-xl bg-brand-500/15 border border-brand-500/30">
              <Users className="size-4 text-brand-400" />
            </span>
            {meta.title}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-400">
            السجلات التي يمثلها هذا الرقم — ضمن نطاق صلاحياتك.
          </DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-900/60 border border-slate-700/40 px-2 py-1.5 text-center">
      <p className={cn('text-sm font-bold tabular-nums', tone)}>{value}</p>
      <p className="text-[9px] text-slate-500">{label}</p>
    </div>
  );
}

function DeepLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors w-fit"
    >
      {label}
      <ChevronLeft className="size-2.5" />
    </button>
  );
}
