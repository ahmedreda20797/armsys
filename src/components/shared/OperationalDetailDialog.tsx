'use client';

// ═══════════════════════════════════════════════════════════════
//  OperationalDetailDialog — §7 the REUSABLE in-place operational
//  action-detail pattern for the Operations Center.
//
//  CARD → compact detail surface → actionable records → action →
//  confirmation → live refresh. Quick actions that can reasonably be
//  completed INSIDE the Operations Center open THIS dialog instead of
//  navigating away; deep navigation remains available as a secondary
//  link inside each renderer.
//
//  Adding a new in-place quick action = one renderer entry in
//  DETAIL_RENDERERS. No per-action one-off implementations.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2, FileText, Loader2, XCircle, ChevronLeft, UserRound, CalendarDays,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/api-fetch';
import { useRequests } from '@/hooks/use-queries';
import { toast } from 'sonner';

export type OperationalDetailKind = 'approve-requests';

interface OperationalDetailDialogProps {
  kind: OperationalDetailKind | null;
  onClose: () => void;
}

const KIND_META: Record<OperationalDetailKind, { title: string; description: string }> = {
  'approve-requests': {
    title: 'اعتماد الطلبات',
    description: 'الطلبات المعلقة بانتظار القرار — اعتماد أو رفض مباشرة من مركز العمليات.',
  },
};

// ────────────────────────────────────────────────────────────────
//  Renderer: اعتماد الطلبات — pending requests with in-place decisions
// ────────────────────────────────────────────────────────────────

interface PendingRequestRow {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  employeeDepartment?: string | null;
  type: string;
  date: string;
  reason: string;
  status: string;
  createdAt: string;
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  leave: 'إجازة',
  excuse: 'استئذان',
  mission: 'مهمة عمل',
  remote: 'عمل عن بعد',
  salary_advance: 'سلفة',
  other: 'أخرى',
};

function ApproveRequestsDetail({ onClose }: { onClose: () => void }) {
  const { data, isLoading } = useRequests();
  const { canDoAction, canViewPage } = usePermissions();
  const navigateTo = useAppStore((s) => s.navigateTo);
  const qc = useQueryClient();
  const canApprove = canDoAction('requests', 'approve');
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PendingRequestRow | null>(null);

  const pending = useMemo(
    () =>
      (Array.isArray(data) ? (data as PendingRequestRow[]) : [])
        .filter((r) => r && r.status === 'pending'),
    [data],
  );

  const decide = async (row: PendingRequestRow, status: 'approved' | 'rejected') => {
    setActingId(row.id);
    try {
      const res = await authFetch(`/api/requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(status === 'approved' ? 'تم اعتماد الطلب' : 'تم رفض الطلب');
        // Live refresh — the hook's query keys, same as the Requests page.
        await qc.invalidateQueries({ queryKey: ['requests'] });
        await qc.invalidateQueries({ queryKey: ['home-stats'] });
        await qc.invalidateQueries({ queryKey: ['homeStats'] });
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error || 'تعذر تنفيذ القرار');
      }
    } catch {
      toast.error('تعذر الاتصال بالخادم');
    } finally {
      setActingId(null);
      setRejecting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 className="size-4 animate-spin" /> جاري تحميل الطلبات...
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <CheckCircle2 className="size-10 text-emerald-500/60 mb-3" />
        <p className="text-slate-300 text-sm font-medium">لا توجد طلبات معلقة</p>
        <p className="text-slate-500 text-xs mt-1">كل الطلبات الممكنة ضمن صلاحياتك تمت مراجعتها</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pending.map((row) => (
        <div
          key={row.id}
          className="rounded-xl border border-slate-700/50 bg-slate-800/40 px-3 py-2.5 space-y-2"
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-100 min-w-0">
              <UserRound className="size-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{row.employeeName || 'موظف'}</span>
              {row.employeeDepartment && (
                <span className="text-[10px] font-normal text-slate-500">· {row.employeeDepartment}</span>
              )}
            </span>
            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-500/10 border border-sky-500/25 text-sky-300 text-[10px] font-bold">
              <FileText className="size-2.5" />
              {REQUEST_TYPE_LABELS[row.type] ?? row.type}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500 flex items-center gap-1 mr-auto">
              <CalendarDays className="size-2.5" />
              {row.date}
            </span>
          </div>
          {row.reason && (
            <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2">{row.reason}</p>
          )}
          <div className="flex items-center gap-1.5">
            {canApprove && (
              <>
                <Button
                  size="sm"
                  className="h-7 px-3 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
                  disabled={actingId === row.id}
                  onClick={() => void decide(row, 'approved')}
                >
                  {actingId === row.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                  اعتماد
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-3 text-[11px] gap-1 border-red-500/30 text-red-400 hover:bg-red-500/10"
                  disabled={actingId === row.id}
                  onClick={() => setRejecting(row)}
                >
                  <XCircle className="size-3" />
                  رفض
                </Button>
              </>
            )}
            {canViewPage('requests') && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  navigateTo('requests');
                }}
                className="flex items-center gap-0.5 px-2 py-1 rounded-md text-[10px] text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors mr-auto"
              >
                صفحة الطلبات
                <ChevronLeft className="size-2.5" />
              </button>
            )}
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={!!rejecting}
        onOpenChange={(open) => { if (!open) setRejecting(null); }}
        title="رفض الطلب"
        description="هل أنت متأكد من رفض هذا الطلب؟ سيتم إبلاغ الموظف بالقرار."
        itemName={rejecting ? `${rejecting.employeeName ?? ''} — ${REQUEST_TYPE_LABELS[rejecting.type] ?? rejecting.type} (${rejecting.date})` : undefined}
        confirmLabel="رفض"
        loading={!!rejecting && actingId === rejecting.id}
        onConfirm={async () => { if (rejecting) await decide(rejecting, 'rejected'); }}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
//  Registry + shell — one dialog instance, renderer per kind
// ────────────────────────────────────────────────────────────────

export function OperationalDetailDialog({ kind, onClose }: OperationalDetailDialogProps) {
  if (!kind) return null;
  const meta = KIND_META[kind];
  return (
    <Dialog open={!!kind} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-slate-900 border-slate-700/60 max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <span className={cn('flex items-center justify-center size-8 rounded-xl bg-sky-500/15 border border-sky-500/30')}>
              <CheckCircle2 className="size-4 text-sky-400" />
            </span>
            {meta.title}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-slate-400">
            {meta.description}
          </DialogDescription>
        </DialogHeader>
        {kind === 'approve-requests' && <ApproveRequestsDetail onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
