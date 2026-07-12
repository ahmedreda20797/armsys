'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — DecisionCard
//
//  The hero card for each decision in the inbox. Displays:
//    - Decision type badge + title
//    - Priority + urgency ring + score
//    - Confidence meter
//    - Business impact
//    - Affected employee / department
//    - Suggested owner + resolution estimate
//    - Due date (color-coded)
//    - Source modules
//    - Top 2 next-best-actions (compact)
//    - Expandable evidence section
//    - Lifecycle status badge
//    - Selection checkbox (for bulk actions)
//
//  This card is the primary visual artifact of the Decision
//  Intelligence Layer. Every visible card answers:
//    What requires action? Why? How urgent? Who should handle it?
// ═══════════════════════════════════════════════════════════════

import { memo, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { Decision, DecisionStatus } from '@/lib/aocc/decision-types';
import type { NextBestAction } from '@/lib/aocc/decision-types';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import {
  PriorityBadge,
  UrgencyBadge,
  StatusBadge,
  DecisionTypeBadge,
  ModuleBadgeList,
  UrgencyRing,
  ConfidenceMeter,
  ImpactMeter,
  ScoreBadge,
  EvidenceItem,
  ActionButton,
  DueDateLabel,
  OwnerLabel,
  ResolutionEstimate,
} from './shared';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  User,
  Building,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface DecisionCardProps {
  /** The decision to render. */
  decision: Decision;
  /** Current lifecycle status (from store). */
  status: DecisionStatus;
  /** Whether this card is selected for bulk actions. */
  selected: boolean;
  /** Toggle selection for bulk actions. */
  onToggleSelect: (id: string) => void;
  /** Open the full detail dialog. */
  onOpenDetail: (decision: Decision) => void;
  /** Execute a next-best-action. */
  onAction: (action: NextBestAction, decision: Decision) => void;
  /** Navigate to a page. */
  onNavigate?: (page: string, recordId?: string | null) => void;
  /** Compact mode — hides evidence, reduces spacing. */
  compact?: boolean;
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const DecisionCard = memo(function DecisionCard({
  decision,
  status,
  selected,
  onToggleSelect,
  onOpenDetail,
  onAction,
  onNavigate,
  compact = false,
}: DecisionCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const d = decision;

  // Priority visual from the existing engine
  const priorityVisual = getPriorityVisual(d.priority);

  // ── Handlers ──
  const handleCardClick = useCallback((e: React.MouseEvent) => {
    // Don't trigger detail open if clicking on checkbox or action button
    const target = e.target as HTMLElement;
    if (target.closest('[data-action]') || target.closest('[data-checkbox]')) return;
    onOpenDetail(d);
  }, [d, onOpenDetail]);

  const handleActionClick = useCallback((action: NextBestAction) => {
    onAction(action, d);
    if (action.kind === 'navigate' && action.targetPage && onNavigate) {
      onNavigate(action.targetPage, action.targetRecordId);
    }
  }, [d, onAction, onNavigate]);

  // ── Determine if evidence is expandable ──
  const hasEvidence = d.explanation.evidence.length > 0;

  return (
    <div
      className={cn(
        'group relative rounded-lg border transition-all duration-200',
        'bg-slate-800/40 hover:bg-slate-800/70',
        selected ? 'ring-1 ring-sky-500/50 border-sky-500/30' : priorityVisual.border,
        priorityVisual.bgTint,
        compact ? 'p-2.5' : 'p-3',
        priorityVisual.glow && d.priority === 'critical' ? priorityVisual.glow : ''
      )}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={d.title}
    >
      {/* ── Row 1: Selection + Type + Priority + Score + Status ── */}
      <div className="flex items-center gap-2 mb-2">
        {/* Checkbox */}
        <div
          data-checkbox
          className={cn(
            'shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors',
            selected
              ? 'bg-sky-500 border-sky-500'
              : 'border-slate-600 hover:border-slate-400'
          )}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(d.id); }}
        >
          {selected && (
            <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Decision type badge */}
        <DecisionTypeBadge type={d.type} size="sm" />

        {/* Priority badge */}
        <PriorityBadge level={d.priority} />

        {/* Score */}
        <div className="mr-auto">
          <ScoreBadge score={d.score.overall} size="sm" />
        </div>

        {/* Status badge (non-new only) */}
        {status !== 'new' && (
          <StatusBadge status={status} />
        )}
      </div>

      {/* ── Row 2: Title + Affected Entity ── */}
      <div className="mb-2">
        <h3 className={cn(
          'font-medium leading-snug mb-0.5',
          compact ? 'text-[13px]' : 'text-sm'
        )}>
          {d.title}
        </h3>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Affected employee */}
          {d.affectedEmployeeName && (
            <div className="flex items-center gap-1 text-slate-400">
              <User className="w-3 h-3 shrink-0" />
              <span className="text-[11px] truncate max-w-[150px]">{d.affectedEmployeeName}</span>
            </div>
          )}

          {/* Affected department */}
          {d.affectedDepartment && (
            <div className="flex items-center gap-1 text-slate-400">
              <Building className="w-3 h-3 shrink-0" />
              <span className="text-[11px] truncate max-w-[120px]">{d.affectedDepartment}</span>
            </div>
          )}

          {/* Resolution estimate */}
          <ResolutionEstimate estimate={d.estimatedResolutionTime} />

          {/* Due date */}
          <DueDateLabel dueDate={d.dueDate} />
        </div>
      </div>

      {/* ── Row 3: Metrics Row ── */}
      <div className={cn('flex items-center gap-3 mb-2', compact ? 'mb-1.5' : 'mb-2')}>
        {/* Urgency ring */}
        <UrgencyRing level={d.urgency} size="sm" showLabel />

        {/* Confidence meter */}
        <div className="flex-1 min-w-0">
          <ConfidenceMeter score={d.score.confidence} showLabel />
        </div>

        {/* Impact meter (compact: badge only) */}
        {compact ? (
          <UrgencyBadge level={d.urgency} />
        ) : (
          <div className="w-32 shrink-0">
            <ImpactMeter impact={d.businessImpact} />
          </div>
        )}

        {/* Owner */}
        <OwnerLabel owner={d.suggestedOwner} ownerType={d.suggestedOwnerType} />
      </div>

      {/* ── Row 4: Source Modules ── */}
      {!compact && d.affectedModules.length > 0 && (
        <div className="mb-2">
          <ModuleBadgeList modules={d.affectedModules} />
        </div>
      )}

      {/* ── Row 5: Quick Actions (top 2) ── */}
      {d.actions.length > 0 && !compact && (
        <div className="flex flex-col gap-1 mb-2">
          {d.actions.slice(0, 2).map((action) => (
            <ActionButton
              key={action.id}
              action={action}
              compact
              onClick={() => handleActionClick(action)}
            />
          ))}
          {d.actions.length > 2 && (
            <button
              className="text-[9px] text-slate-500 hover:text-slate-300 transition-colors text-left"
              onClick={(e) => { e.stopPropagation(); onOpenDetail(d); }}
            >
              +{d.actions.length - 2} إجراءات أخرى
            </button>
          )}
        </div>
      )}

      {/* ── Row 6: Expandable Evidence ── */}
      {hasEvidence && !compact && (
        <div>
          <button
            data-action
            className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
            onClick={(e) => { e.stopPropagation(); setEvidenceOpen(!evidenceOpen); }}
          >
            {evidenceOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>{evidenceOpen ? 'إخفاء الأدلة' : `عرض ${d.explanation.evidence.length} دليل`}</span>
          </button>

          {evidenceOpen && (
            <div className="mt-1.5 pr-1 border-r-2 border-slate-700/50 space-y-0.5">
              {d.explanation.evidence.map((ev, i) => (
                <EvidenceItem key={i} evidence={ev} />
              ))}
              {/* Consequence */}
              <div className="flex items-start gap-2 py-1 mt-1">
                <div className="mt-0.5 shrink-0 text-amber-400">
                  <Eye className="w-3 h-3" />
                </div>
                <span className="text-[10px] text-amber-300/70 leading-relaxed">
                  {d.explanation.consequence}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Compact: Inline consequence ── */}
      {compact && (
        <div className="text-[9px] text-slate-500 leading-relaxed line-clamp-1">
          {d.explanation.consequence}
        </div>
      )}
    </div>
  );
});