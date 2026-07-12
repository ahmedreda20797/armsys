'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — DecisionInbox
//
//  The unified inbox for all decisions. Features:
//    - Search bar (filters by title, employee, department)
//    - Filter chips: priority, type, department, module, status
//    - Grouping by: priority, department, employee, manager, module, status
//    - Sorting by: score, priority, due date, created, confidence, impact
//    - Grouped/sorted decision list
//    - Bulk selection mode
//    - Empty state when no decisions match
//    - Count summary in header
//
//  No virtualization library needed — decisions are computed
//  client-side from existing data (typically 20-80 items). A
//  scrollable container with lazy rendering handles performance.
// ═══════════════════════════════════════════════════════════════

import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useDecisionStore } from '@/lib/aocc/decision-store';
import { getPriorityVisual } from '@/lib/aocc/priority-engine';
import type { Decision, DecisionGroup, DecisionGroupKey, DecisionSortKey } from '@/lib/aocc/decision-types';
import type { NextBestAction } from '@/lib/aocc/decision-types';
import type { PriorityLevel } from '@/lib/aocc/types';
import { DecisionCard } from './DecisionCard';
import { DecisionDetailDialog } from './DecisionDetailDialog';
import { BulkActionBar } from './BulkActionBar';
import {
  DecisionCountSummary,
  PriorityBadge,
  EmptyDecisionsState,
} from './shared';
import {
  Search,
  SlidersHorizontal,
  ChevronDown,
  Inbox,
  X,
  CheckSquare,
  Square,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface DecisionInboxProps {
  /** All decisions from the engine (before filtering). */
  decisions: Decision[];
  /** Loading state. */
  loading?: boolean;
  /** Error state. */
  error?: boolean;
  /** Retry callback. */
  onRetry?: () => void;
  /** Navigate to a page. */
  onNavigate?: (page: string, recordId?: string | null) => void;
  /** Execute a next-best-action. */
  onAction?: (action: NextBestAction, decision: Decision) => void;
}

// ═══════════════════════════════════════════════════════════════
//  Group key visual
// ═══════════════════════════════════════════════════════════════

interface GroupOption {
  key: DecisionGroupKey;
  label: string;
}

const GROUP_OPTIONS: GroupOption[] = [
  { key: 'priority', label: 'الأولوية' },
  { key: 'department', label: 'القسم' },
  { key: 'employee', label: 'الموظف' },
  { key: 'manager', label: 'المدير' },
  { key: 'module', label: 'الوحدة' },
  { key: 'status', label: 'الحالة' },
  { key: 'none', label: 'بدون تجميع' },
];

interface SortOption {
  key: DecisionSortKey;
  label: string;
}

const SORT_OPTIONS: SortOption[] = [
  { key: 'score', label: 'النتيجة' },
  { key: 'priority', label: 'الأولوية' },
  { key: 'dueDate', label: 'الموعد النهائي' },
  { key: 'created', label: 'وقت الإنشاء' },
  { key: 'confidence', label: 'الثقة' },
  { key: 'impact', label: 'التأثير' },
];

/** Priority filter options. */
const PRIORITY_FILTER_OPTIONS: { value: PriorityLevel; label: string }[] = [
  { value: 'critical', label: 'حرج' },
  { value: 'high', label: 'عالي' },
  { value: 'medium', label: 'متوسط' },
  { value: 'low', label: 'منخفض' },
];

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const DecisionInbox = memo(function DecisionInbox({
  decisions,
  loading = false,
  error = false,
  onRetry,
  onNavigate,
  onAction,
}: DecisionInboxProps) {
  // ── Store selectors ──
  const filters = useDecisionStore((s) => s.filters);
  const groupBy = useDecisionStore((s) => s.groupBy);
  const sortBy = useDecisionStore((s) => s.sortBy);
  const selectedIds = useDecisionStore((s) => s.selectedIds);
  const setFilter = useDecisionStore((s) => s.setFilter);
  const toggleArrayFilter = useDecisionStore((s) => s.toggleArrayFilter);
  const resetFilters = useDecisionStore((s) => s.resetFilters);
  const setGroupBy = useDecisionStore((s) => s.setGroupBy);
  const setSortBy = useDecisionStore((s) => s.setSortBy);
  const toggleSelect = useDecisionStore((s) => s.toggleSelect);
  const selectAll = useDecisionStore((s) => s.selectAll);
  const clearSelection = useDecisionStore((s) => s.clearSelection);
  const isSelected = useDecisionStore((s) => s.isSelected);
  const filterDecisions = useDecisionStore((s) => s.filterDecisions);
  const sortDecisions = useDecisionStore((s) => s.sortDecisions);
  const groupDecisions = useDecisionStore((s) => s.groupDecisions);
  const getStatus = useDecisionStore((s) => s.getStatus);

  // ── Local state ──
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailDecision, setDetailDecision] = useState<Decision | null>(null);

  // ── Derived data ──
  const filtered = useMemo(() => filterDecisions(decisions), [decisions, filterDecisions]);
  const sorted = useMemo(() => sortDecisions(filtered), [filtered, sortDecisions]);
  const grouped = useMemo(() => groupDecisions(sorted), [sorted, groupDecisions]);

  // ── Counts ──
  const counts = useMemo(() => {
    let critical = 0;
    let high = 0;
    for (const d of filtered) {
      if (d.priority === 'critical') critical++;
      else if (d.priority === 'high') high++;
    }
    return { total: filtered.length, critical, high };
  }, [filtered]);

  const hasSelection = selectedIds.size > 0;
  const allVisibleIds = useMemo(() => sorted.map((d) => d.id), [sorted]);

  // ── Handlers ──
  const handleToggleSelectAll = useCallback(() => {
    if (hasSelection) {
      clearSelection();
    } else {
      selectAll(allVisibleIds);
    }
  }, [hasSelection, clearSelection, selectAll, allVisibleIds]);

  const handleOpenDetail = useCallback((decision: Decision) => {
    setDetailDecision(decision);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFilter('search', e.target.value);
  }, [setFilter]);

  const handleGroupChange = useCallback((key: DecisionGroupKey) => {
    setGroupBy(key);
  }, [setGroupBy]);

  const handleSortChange = useCallback((key: DecisionSortKey) => {
    setSortBy(key);
  }, [setSortBy]);

  // ── Loading / Error states ──
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
          <X className="w-8 h-8 text-red-400/60" />
        </div>
        <div className="text-center">
          <p className="text-sm text-slate-400 font-medium">خطأ في تحميل القرارات</p>
          <p className="text-[11px] text-slate-500 mt-1">تعذر معالجة البيانات</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            إعادة المحاولة
          </Button>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-2 p-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg bg-slate-800/30 animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header: Search + Controls ── */}
      <div className="shrink-0 p-3 border-b border-slate-700/50 space-y-2">
        {/* Search row */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <Input
              placeholder="بحث في القرارات..."
              value={filters.search}
              onChange={handleSearchChange}
              className="h-8 text-[11px] pr-8 bg-slate-800/60 border-slate-700/50 text-slate-200 placeholder:text-slate-500"
            />
          </div>

          {/* Filter toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={cn(
              'h-8 text-[10px] gap-1.5',
              filtersOpen ? 'text-sky-400' : 'text-slate-400'
            )}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            فلاتر
          </Button>

          {/* Group selector */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span>تجميع:</span>
            <select
              value={groupBy}
              onChange={(e) => handleGroupChange(e.target.value as DecisionGroupKey)}
              className="bg-slate-800/60 border border-slate-700/50 rounded px-1.5 py-1 text-[10px] text-slate-300 outline-none focus:border-slate-600"
            >
              {GROUP_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <span>ترتيب:</span>
            <select
              value={sortBy}
              onChange={(e) => handleSortChange(e.target.value as DecisionSortKey)}
              className="bg-slate-800/60 border border-slate-700/50 rounded px-1.5 py-1 text-[10px] text-slate-300 outline-none focus:border-slate-600"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Expanded filter panel */}
        {filtersOpen && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {/* Priority filters */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-500">الأولوية:</span>
              {PRIORITY_FILTER_OPTIONS.map((opt) => {
                const active = filters.priorities.includes(opt.value);
                const pv = getPriorityVisual(opt.value);
                return (
                  <button
                    key={opt.value}
                    onClick={() => toggleArrayFilter('priorities', opt.value)}
                    className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                      active
                        ? pv.badge
                        : 'border-slate-700/50 text-slate-500 hover:text-slate-400'
                    )}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Time window */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-slate-500">الفترة:</span>
              {(['all', 'today', 'week'] as const).map((tw) => {
                const labels: Record<string, string> = { all: 'الكل', today: 'اليوم', week: 'هذا الأسبوع' };
                const active = filters.timeWindow === tw;
                return (
                  <button
                    key={tw}
                    onClick={() => setFilter('timeWindow', tw)}
                    className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded border transition-colors',
                      active
                        ? 'bg-sky-500/20 text-sky-400 border-sky-500/30'
                        : 'border-slate-700/50 text-slate-500 hover:text-slate-400'
                    )}
                  >
                    {labels[tw]}
                  </button>
                );
              })}
            </div>

            {/* Reset */}
            <button
              onClick={resetFilters}
              className="text-[9px] text-slate-600 hover:text-slate-400 transition-colors ml-auto"
            >
              إعادة تعيين
            </button>
          </div>
        )}

        {/* Active filter chips */}
        {(filters.priorities.length > 0 || filters.search) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {filters.priorities.map((p) => {
              const pv = getPriorityVisual(p);
              return (
                <Badge key={p} className={cn('text-[9px] px-1.5 py-0 gap-0.5', pv.badge)}>
                  {pv.label}
                  <button onClick={() => toggleArrayFilter('priorities', p)}>
                    <X className="w-2 h-2" />
                  </button>
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Summary + Select All ── */}
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-3 border-b border-slate-700/30">
        <DecisionCountSummary
          total={counts.total}
          critical={counts.critical}
          high={counts.high}
        />

        <div className="mr-auto flex items-center gap-2">
          {/* Select all checkbox */}
          <button
            onClick={handleToggleSelectAll}
            className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-300 transition-colors"
          >
            {hasSelection ? (
              <CheckSquare className="w-3.5 h-3.5 text-sky-400" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            <span>{hasSelection ? `${selectedIds.size} محدد` : 'تحديد الكل'}</span>
          </button>
        </div>
      </div>

      {/* ── Bulk action bar (visible when items selected) ── */}
      {hasSelection && (
        <BulkActionBar
          decisions={sorted}
          selectedCount={selectedIds.size}
          onNavigate={onNavigate}
          onAction={onAction}
        />
      )}

      {/* ── Decision List ── */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {grouped.length === 0 ? (
            <EmptyDecisionsState />
          ) : (
            grouped.map((group: DecisionGroup) => (
              <div key={group.key}>
                {/* Group header */}
                {groupBy !== 'none' && (
                  <div className="flex items-center gap-2 mb-2">
                    <PriorityBadge level={group.priority} />
                    <span className="text-xs text-slate-300 font-medium">{group.label}</span>
                    <Badge className="text-[9px] px-1.5 py-0 bg-slate-700/50 text-slate-400 border-slate-600/30">
                      {group.decisions.length}
                    </Badge>
                    <Separator className="flex-1 bg-slate-700/30" />
                  </div>
                )}

                {/* Decision cards */}
                <div className="space-y-2">
                  {group.decisions.map((decision: Decision) => (
                    <DecisionCard
                      key={decision.id}
                      decision={decision}
                      status={getStatus(decision.id)}
                      selected={isSelected(decision.id)}
                      onToggleSelect={toggleSelect}
                      onOpenDetail={handleOpenDetail}
                      onAction={onAction || (() => {})}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* ── Detail dialog ── */}
      <DecisionDetailDialog
        decision={detailDecision}
        open={!!detailDecision}
        onOpenChange={(open) => { if (!open) setDetailDecision(null); }}
        onAction={onAction}
      />
    </div>
  );
});