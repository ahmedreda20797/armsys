'use client';

import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { ApprovalStatus } from '@/types/quality-kpi';

const STATUS_CONFIG: Record<
  ApprovalStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  pending: {
    label: 'بانتظار الاعتماد',
    icon: Clock,
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  approved: {
    label: 'معتمدة',
    icon: CheckCircle2,
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  rejected: {
    label: 'مرفوضة',
    icon: XCircle,
    className: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  },
};

/** Badge displaying an observation's approval status. */
export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`gap-1.5 ${config.className}`}>
      <Icon className="size-3" />
      {config.label}
    </Badge>
  );
}
