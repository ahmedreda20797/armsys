'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — PredictiveAlerts
//
//  Widget showing trajectory-based predictions (no AI — pure math):
//    - Likely SLA breach
//    - Likely complaint escalation
//    - Likely CAPA overdue
//    - Likely attendance issue / burnout
//    - Likely department decline
//
//  Each alert shows:
//    - Probability percentage (0-100)
//    - Signal indicator (1-3 bars)
//    - Title + affected entity
//    - Reasoning (the trend/data used)
//    - ETA label
//    - Suggested mitigation action (clickable)
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type { PredictiveAlert } from '@/lib/aocc/decision-types';
import {
  PREDICTIVE_TYPE_VISUAL,
  SignalIndicator,
  PriorityBadge,
} from './shared';
import {
  TrendingUp,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface PredictiveAlertsProps {
  alerts: PredictiveAlert[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const PredictiveAlerts = memo(function PredictiveAlerts({
  alerts,
  loading = false,
  error = false,
  onRetry,
}: PredictiveAlertsProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);

  const handleAlertClick = useCallback((alert: PredictiveAlert) => {
    navigateTo(alert.targetPage, alert.sourceRecordId || undefined);
  }, [navigateTo]);

  // ── Summary stats ──
  const highProbability = alerts.filter((a) => a.probability >= 75).length;

  return (
    <DashboardCard
      title="تنبيهات تنبؤية"
      icon={<TrendingUp className="w-4 h-4" />}
      iconBg="bg-cyan-500/15"
      iconColor="text-cyan-400"
      borderClr="border-slate-700/50"
      size="medium"
      loading={loading}
      error={error}
      onRetry={onRetry}
      badge={alerts.length}
      empty={alerts.length === 0}
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
      emptyMessage="لا توجد تنبيهات تنبؤية"
      emptyDescription="جميع المسارات ضمن الحدود الآمنة"
      actions={
        highProbability > 0 ? (
          <Badge className="text-[9px] px-1.5 py-0 bg-red-500/20 text-red-400 border-red-500/30">
            {highProbability} عالي
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <PredictiveAlertRow
            key={alert.id}
            alert={alert}
            onClick={() => handleAlertClick(alert)}
          />
        ))}
      </div>
    </DashboardCard>
  );
});

// ═══════════════════════════════════════════════════════════════
//  Single alert row
// ═══════════════════════════════════════════════════════════════

const PredictiveAlertRow = memo(function PredictiveAlertRow({
  alert,
  onClick,
}: {
  alert: PredictiveAlert;
  onClick: () => void;
}) {
  const typeVisual = PREDICTIVE_TYPE_VISUAL[alert.type];
  const priorityVisual = getPriorityVisual(alert.severity);

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      className={cn(
        'group rounded-lg border p-2.5 cursor-pointer transition-all duration-150',
        'hover:border-slate-600 hover:bg-slate-800/60',
        priorityVisual.bgTint,
        priorityVisual.border
      )}
    >
      {/* ── Row 1: Type + Probability + Severity ── */}
      <div className="flex items-center gap-2 mb-1.5">
        <SignalIndicator probability={alert.probability} />
        <span className={cn('text-[10px] font-medium', typeVisual.colorClass)}>
          {typeVisual.label}
        </span>
        <div className="mr-auto flex items-center gap-1">
          <span className={cn(
            'text-sm font-bold',
            alert.probability >= 75 ? 'text-red-400' :
            alert.probability >= 50 ? 'text-amber-400' :
            'text-slate-400'
          )}>
            {alert.probability}%
          </span>
        </div>
        <PriorityBadge level={alert.severity} />
      </div>

      {/* ── Row 2: Title + Affected ── */}
      <div className="text-xs font-medium text-slate-200 leading-snug mb-1">
        {alert.title}
      </div>
      {alert.affectedName && (
        <div className="text-[10px] text-slate-400 mb-1">
          {alert.affectedName}
        </div>
      )}

      {/* ── Row 3: Reasoning ── */}
      <div className="text-[10px] text-slate-500 leading-relaxed mb-1.5">
        {alert.reasoning}
      </div>

      {/* ── Row 4: ETA + Action ── */}
      <div className="flex items-center gap-2 pt-1.5 border-t border-slate-700/40">
        <Badge className="text-[9px] px-1.5 py-0 bg-slate-700/50 text-slate-400 border-slate-600/30">
          {alert.etaLabel}
        </Badge>
        <span className="text-[10px] text-slate-500 mr-auto">
          {alert.suggestedAction}
        </span>
        <ExternalLink className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-colors" />
      </div>
    </div>
  );
});