'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — CoachingEngine
//
//  Manager coaching opportunities widget. Surfaces employees or
//  departments that would benefit from coaching intervention:
//    - Attendance issues
//    - Quality decline
//    - Complaint increase
//    - Performance drop
//    - Training recommendation
//
//  Each opportunity shows:
//    - Category badge (color-coded)
//    - Employee/department name
//    - Supporting evidence
//    - Suggested coaching action (clickable → follow-ups / employee360)
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { DashboardCard } from '@/components/dashboard/DashboardCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type { CoachingOpportunity } from '@/lib/aocc/decision-types';
import {
  COACHING_CATEGORY_VISUAL,
  PriorityBadge,
} from './shared';
import {
  GraduationCap,
  CheckCircle2,
  User,
  Building,
  ArrowLeft,
  Lightbulb,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface CoachingEngineProps {
  opportunities: CoachingOpportunity[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const CoachingEngine = memo(function CoachingEngine({
  opportunities,
  loading = false,
  error = false,
  onRetry,
}: CoachingEngineProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);

  const handleOpportunityClick = useCallback((opp: CoachingOpportunity) => {
    if (opp.affectedEmployeeId) {
      openEmployee360(opp.affectedEmployeeId);
    } else if (opp.affectedDepartment) {
      navigateTo('attendance');
    }
  }, [navigateTo, openEmployee360]);

  // ── Summary stats ──
  const highPriority = opportunities.filter((o) => o.priority === 'high' || o.priority === 'critical').length;

  return (
    <DashboardCard
      title="محرك التوجيه"
      icon={<GraduationCap className="w-4 h-4" />}
      iconBg="bg-cyan-500/15"
      iconColor="text-cyan-400"
      borderClr="border-slate-700/50"
      size="medium"
      loading={loading}
      error={error}
      onRetry={onRetry}
      badge={opportunities.length}
      empty={opportunities.length === 0}
      emptyIcon={<CheckCircle2 className="w-10 text-emerald-400/40" />}
      emptyMessage="لا توجد فرص توجيه"
      emptyDescription="جميع الموظفين ضمن المسار الصحيح"
      actions={
        highPriority > 0 ? (
          <Badge className="text-[9px] px-1.5 py-0 bg-amber-500/20 text-amber-400 border-amber-500/30">
            {highPriority} عالي
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {opportunities.map((opp) => (
          <CoachingOpportunityRow
            key={opp.id}
            opportunity={opp}
            onClick={() => handleOpportunityClick(opp)}
          />
        ))}
      </div>
    </DashboardCard>
  );
});

// ═══════════════════════════════════════════════════════════════
//  Single coaching opportunity row
// ═══════════════════════════════════════════════════════════════

const CoachingOpportunityRow = memo(function CoachingOpportunityRow({
  opportunity,
  onClick,
}: {
  opportunity: CoachingOpportunity;
  onClick: () => void;
}) {
  const catVisual = COACHING_CATEGORY_VISUAL[opportunity.category];
  const priorityVisual = getPriorityVisual(opportunity.priority);
  const hasEmployee = !!opportunity.affectedEmployeeId;

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
      {/* ── Row 1: Category + Priority ── */}
      <div className="flex items-center gap-2 mb-1.5">
        <Badge className={cn('text-[9px] px-1.5 py-0 border', 'bg-slate-700/40', catVisual.colorClass, 'border-slate-600/30')}>
          <Lightbulb className="w-2.5 h-2.5 ml-0.5" />
          {catVisual.label}
        </Badge>
        <div className="mr-auto" />
        <PriorityBadge level={opportunity.priority} />
      </div>

      {/* ── Row 2: Title + Entity ── */}
      <div className="flex items-center gap-1.5 mb-1">
        {hasEmployee ? (
          <User className="w-3 h-3 text-slate-400 shrink-0" />
        ) : (
          <Building className="w-3 h-3 text-slate-400 shrink-0" />
        )}
        <span className="text-xs font-medium text-slate-200 truncate">
          {opportunity.affectedEmployeeName}
        </span>
        {opportunity.affectedDepartment && (
          <span className="text-[9px] text-slate-500">
            • {opportunity.affectedDepartment}
          </span>
        )}
      </div>

      {/* ── Row 3: Evidence ── */}
      <div className="text-[10px] text-slate-400 leading-relaxed mb-1.5">
        {opportunity.evidence}
      </div>

      {/* ── Row 4: Suggested action ── */}
      <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-700/40">
        <div className={cn('flex items-center gap-1 text-[10px] font-medium', catVisual.colorClass)}>
          <GraduationCap className="w-3 h-3" />
          {opportunity.suggestedAction}
        </div>
        <ArrowLeft className="w-3 h-3 text-slate-600 group-hover:text-slate-400 transition-colors mr-auto" />
      </div>
    </div>
  );
});