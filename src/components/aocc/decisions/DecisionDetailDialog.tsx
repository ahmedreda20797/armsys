'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — DecisionDetailDialog
//
//  Full detail dialog for a single decision. Shows everything:
//    - Header: type, priority, score, status, urgency ring
//    - Affected entities (employee, department, modules)
//    - Reason + consequence (the "why" + "so what")
//    - Full evidence list (audit trail)
//    - 9-component score breakdown
//    - All next-best-actions (clickable)
//    - Lifecycle controls (acknowledge, assign, resolve, escalate)
//    - Lifecycle history timeline
//
//  This is the "explain yourself" surface for a decision.
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { useAuth } from '@/contexts/AuthContext';
import { useDecisionStore } from '@/lib/aocc/decision-store';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type { Decision, DecisionStatus } from '@/lib/aocc/decision-types';
import type { NextBestAction } from '@/lib/aocc/decision-types';
import {
  PriorityBadge,
  UrgencyBadge,
  StatusBadge,
  DecisionTypeBadge,
  ModuleBadgeList,
  ModuleBadge,
  UrgencyRing,
  ConfidenceMeter,
  ImpactMeter,
  ScoreBadge,
  ScoreBreakdown,
  EvidenceItem,
  ActionButton,
  DueDateLabel,
  OwnerLabel,
  ResolutionEstimate,
  getDecisionTypeLabel,
  getModuleLabel,
  getStatusLabel,
} from './shared';
import {
  User,
  Building,
  Eye,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  Bell,
  Clock,
  History,
  ChevronLeft,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface DecisionDetailDialogProps {
  /** The decision to display, or null if closed. */
  decision: Decision | null;
  /** Whether the dialog is open. */
  open: boolean;
  /** Close handler. */
  onOpenChange: (open: boolean) => void;
  /** Execute a next-best-action. */
  onAction?: (action: NextBestAction, decision: Decision) => void;
}

// ═══════════════════════════════════════════════════════════════
//  Lifecycle action button config
// ═══════════════════════════════════════════════════════════════

interface LifecycleActionConfig {
  label: string;
  toStatus: DecisionStatus;
  icon: typeof CheckCircle2;
  colorClass: string;
}

const LIFECYCLE_ACTIONS: LifecycleActionConfig[] = [
  { label: 'مراجعة', toStatus: 'acknowledged', icon: Eye, colorClass: 'text-cyan-400' },
  { label: 'تعيين لي', toStatus: 'assigned', icon: User, colorClass: 'text-violet-400' },
  { label: 'بدء المعالجة', toStatus: 'in_progress', icon: CheckCircle2, colorClass: 'text-amber-400' },
  { label: 'حل', toStatus: 'resolved', icon: CheckCircle2, colorClass: 'text-emerald-400' },
  { label: 'تصعيد', toStatus: 'escalated', icon: ArrowUpRight, colorClass: 'text-red-400' },
  { label: 'استبعاد', toStatus: 'dismissed', icon: XCircle, colorClass: 'text-slate-400' },
];

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const DecisionDetailDialog = memo(function DecisionDetailDialog({
  decision,
  open,
  onOpenChange,
  onAction,
}: DecisionDetailDialogProps) {
  const user = useAuth().user;
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);

  // Store actions
  const transitionStatus = useDecisionStore((s) => s.transitionStatus);
  const assign = useDecisionStore((s) => s.assign);
  const states = useDecisionStore((s) => s.states);

  const userName = user?.name || user?.email || 'المستخدم';

  const handleLifecycleAction = useCallback((cfg: LifecycleActionConfig) => {
    if (!decision) return;
    if (cfg.toStatus === 'assigned') {
      assign(decision.id, user?.id || 'me', userName, userName);
    } else {
      transitionStatus(decision.id, cfg.toStatus, userName);
    }
  }, [decision, assign, transitionStatus, user?.id, userName]);

  const handleActionClick = useCallback((action: NextBestAction) => {
    if (!decision) return;

    // Execute navigation/employee actions directly
    if (action.kind === 'navigate' && action.targetPage) {
      navigateTo(action.targetPage, action.targetRecordId || undefined);
    } else if (action.kind === 'employee' && action.targetRecordId) {
      openEmployee360(action.targetRecordId);
    }

    // Notify parent for custom handling (create_capa, create_fu, notify, dialog)
    onAction?.(action, decision);
  }, [decision, navigateTo, openEmployee360, onAction]);

  if (!decision) return null;

  const d = decision;
  const visual = getPriorityVisual(d.priority);
  const stateEntry = states[d.id];
  const status: DecisionStatus = stateEntry?.status ?? 'new';
  const history = stateEntry?.history ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-slate-900 border-slate-700 p-0 max-h-[92vh]">
        {/* ── Header ── */}
        <div className={cn('p-4 border-b border-slate-700/50', visual.bgTint)}>
          <div className="flex items-start gap-3">
            {/* Urgency ring */}
            <UrgencyRing level={d.urgency} size="lg" showLabel />

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <DecisionTypeBadge type={d.type} size="sm" />
                <PriorityBadge level={d.priority} />
                {status !== 'new' && <StatusBadge status={status} />}
              </div>
              <DialogTitle className="text-base font-semibold text-slate-100 leading-snug">
                {d.title}
              </DialogTitle>
              <DialogDescription className="text-[11px] text-slate-400 mt-0.5">
                {getDecisionTypeLabel(d.type)} • معرف: {d.id}
              </DialogDescription>
            </div>

            {/* Overall score */}
            <ScoreBadge score={d.score.overall} size="lg" />
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto px-4 py-3 space-y-4" style={{ maxHeight: 'calc(92vh - 220px)' }}>

          {/* ── Section: Affected Entities ── */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">
              الجهات المتأثرة
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {d.affectedEmployeeName && (
                <button
                  onClick={() => d.affectedEmployeeId && openEmployee360(d.affectedEmployeeId)}
                  className="flex items-center gap-2 p-2 rounded-md bg-slate-800/60 border border-slate-700/50 hover:border-slate-600 transition-colors text-right"
                >
                  <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[9px] text-slate-500">الموظف</div>
                    <div className="text-xs text-slate-200 truncate">{d.affectedEmployeeName}</div>
                  </div>
                </button>
              )}
              {d.affectedDepartment && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-slate-800/60 border border-slate-700/50">
                  <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[9px] text-slate-500">القسم</div>
                    <div className="text-xs text-slate-200 truncate">{d.affectedDepartment}</div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 p-2 rounded-md bg-slate-800/60 border border-slate-700/50">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[9px] text-slate-500">وقت الحل المتوقع</div>
                  <div className="text-xs text-slate-200 truncate">{d.estimatedResolutionTime}</div>
                </div>
              </div>
              <DueDateLabel dueDate={d.dueDate} className="p-2 rounded-md bg-slate-800/60 border border-slate-700/50" />
            </div>

            {/* Owner */}
            <div className="mt-2 flex items-center justify-between p-2 rounded-md bg-slate-800/40 border border-slate-700/40">
              <OwnerLabel owner={d.suggestedOwner} ownerType={d.suggestedOwnerType} />
              <span className="text-[9px] text-slate-500">المالك المقترح</span>
            </div>

            {/* Source modules */}
            {d.affectedModules.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] text-slate-500 mb-1">الوحدات المصدر</div>
                <ModuleBadgeList modules={d.affectedModules} />
              </div>
            )}
          </section>

          <Separator className="bg-slate-700/50" />

          {/* ── Section: Reason + Consequence ── */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">
              لماذا هذا القرار؟
            </h4>
            <div className="p-3 rounded-md bg-slate-800/40 border border-slate-700/40">
              <p className="text-xs text-slate-200 leading-relaxed mb-2">
                {d.explanation.reason}
              </p>
              <div className="flex items-start gap-2 pt-2 border-t border-slate-700/40">
                <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[9px] text-amber-400/70 font-medium mb-0.5">
                    ماذا يحدث إذا لم يتم اتخاذ إجراء؟
                  </div>
                  <p className="text-[11px] text-amber-300/80 leading-relaxed">
                    {d.explanation.consequence}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── Section: Evidence ── */}
          {d.explanation.evidence.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">
                الأدلة ({d.explanation.evidence.length})
              </h4>
              <div className="pr-2 border-r-2 border-slate-700/50 space-y-0.5">
                {d.explanation.evidence.map((ev, i) => (
                  <EvidenceItem key={i} evidence={ev} />
                ))}
              </div>
            </section>
          )}

          <Separator className="bg-slate-700/50" />

          {/* ── Section: Metrics ── */}
          <section>
            <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">
              المؤشرات
            </h4>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-500">الثقة</span>
                <ConfidenceMeter score={d.score.confidence} showLabel />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-500">الإلحاح</span>
                <UrgencyBadge level={d.urgency} />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-slate-500">التأثير</span>
                <ImpactMeter impact={d.businessImpact} />
              </div>
            </div>

            {/* Score breakdown */}
            <ScoreBreakdown score={d.score} />
          </section>

          <Separator className="bg-slate-700/50" />

          {/* ── Section: Next Best Actions ── */}
          {d.actions.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2">
                الإجراءات الموصى بها ({d.actions.length})
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {d.actions.map((action) => (
                  <ActionButton
                    key={action.id}
                    action={action}
                    onClick={() => handleActionClick(action)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Section: Lifecycle History ── */}
          {history.length > 0 && (
            <section>
              <h4 className="text-[10px] uppercase tracking-wide text-slate-500 font-medium mb-2 flex items-center gap-1">
                <History className="w-3 h-3" />
                سجل دورة الحياة
              </h4>
              <div className="space-y-1.5">
                {history.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px]">
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge className="text-[8px] px-1 py-0 bg-slate-700/50 text-slate-400 border-slate-600/30">
                        {getStatusLabel(t.from)}
                      </Badge>
                      <ChevronLeft className="w-2.5 h-2.5 text-slate-600" />
                      <Badge className="text-[8px] px-1 py-0 bg-slate-700/50 text-slate-300 border-slate-600/30">
                        {getStatusLabel(t.to)}
                      </Badge>
                    </div>
                    <span className="text-slate-500 truncate flex-1">
                      {t.note || ''}
                    </span>
                    <span className="text-slate-600 shrink-0">
                      {new Date(t.at).toLocaleString('ar-SA', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Footer: Lifecycle Controls ── */}
        <div className="p-3 border-t border-slate-700/50 bg-slate-900/80">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-500 ml-1">إجراءات:</span>
            {LIFECYCLE_ACTIONS.map((cfg) => {
              const Icon = cfg.icon;
              const isCurrent = status === cfg.toStatus;
              return (
                <Button
                  key={cfg.toStatus}
                  variant="ghost"
                  size="sm"
                  disabled={isCurrent}
                  onClick={() => handleLifecycleAction(cfg)}
                  className={cn(
                    'h-7 text-[10px] px-2 gap-1',
                    cfg.colorClass,
                    'hover:bg-slate-800',
                    isCurrent && 'opacity-40 cursor-not-allowed'
                  )}
                >
                  <Icon className="w-3 h-3" />
                  {cfg.label}
                </Button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});