'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — DecisionCenterLayout
//
//  The orchestrator for the Decision Intelligence Layer. Composes
//  all decision widgets into a cohesive layout:
//
//    ┌─────────────────────────────────────────────────────┐
//    │  Decision Center Header (counts + command bar btn)  │
//    ├──────────────────────────┬──────────────────────────┤
//    │                          │                          │
//    │   Decision Inbox         │   Executive Priorities   │
//    │   (unified, filterable)  │   (top priorities, risks)│
//    │                          │                          │
//    ├──────────────────────────┼──────────────────────────┤
//    │   Predictive Alerts      │   Coaching Engine        │
//    │   (trajectory warnings)  │   (manager opportunities)│
//    └──────────────────────────┴──────────────────────────┘
//
//  All widgets consume the `useDecisions` hook output, passed in
//  from AoccLayout. No data fetching happens here — pure composition.
// ═══════════════════════════════════════════════════════════════

import { memo, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { DashboardGrid } from '@/components/dashboard/DashboardCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useDecisionStore } from '@/lib/aocc/decision-store';
import { useAppStore } from '@/lib/store';
import type { Decision, NextBestAction } from '@/lib/aocc/decision-types';
import type {
  PredictiveAlert,
  CoachingOpportunity,
  ExecutivePriorities as ExecutivePrioritiesData,
} from '@/lib/aocc/decision-types';
import { DecisionInbox } from './DecisionInbox';
import { DecisionDetailDialog } from './DecisionDetailDialog';
import { CommandBar } from './CommandBar';
import { PredictiveAlerts } from './PredictiveAlerts';
import { ExecutivePriorities } from './ExecutivePriorities';
import { CoachingEngine } from './CoachingEngine';
import {
  BrainCircuit,
  Command,
  Flame,
  TrendingUp,
  CheckCircle2,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════

export interface DecisionCenterLayoutProps {
  /** All decisions from the engine. */
  decisions: Decision[];
  /** Predictive alerts. */
  alerts: PredictiveAlert[];
  /** Coaching opportunities. */
  coaching: CoachingOpportunity[];
  /** Executive priorities bundle. */
  execPriorities: ExecutivePrioritiesData;
  /** Counts summary. */
  counts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    newCount: number;
    resolved: number;
  };
  /** Loading state. */
  loading?: boolean;
  /** Error state. */
  error?: boolean;
  /** Retry callback. */
  onRetry?: () => void;
}

// ═══════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════

export const DecisionCenterLayout = memo(function DecisionCenterLayout({
  decisions,
  alerts,
  coaching,
  execPriorities,
  counts,
  loading = false,
  error = false,
  onRetry,
}: DecisionCenterLayoutProps) {
  const navigateTo = useAppStore((s) => s.navigateTo);
  const openEmployee360 = useAppStore((s) => s.openEmployee360);
  const setCommandBarOpen = useDecisionStore((s) => s.setCommandBarOpen);

  // ── Detail dialog state ──
  const [detailDecision, setDetailDecision] = useState<Decision | null>(null);

  // ── Handlers ──
  const handleNavigate = useCallback((page: string, recordId?: string | null) => {
    navigateTo(page, recordId || undefined);
  }, [navigateTo]);

  const handleAction = useCallback((action: NextBestAction, decision: Decision) => {
    // Navigation-type actions are handled by the dialog itself.
    // This handler covers create_capa, create_fu, notify, dialog kinds.
    switch (action.kind) {
      case 'create_capa':
        navigateTo('capa');
        break;
      case 'create_fu':
        navigateTo('followUps');
        break;
      case 'notify':
        // Notification handled by toast in a real implementation
        break;
      case 'dialog':
        // Custom dialog (e.g. coaching scheduler) — open detail
        setDetailDecision(decision);
        break;
    }
  }, [navigateTo]);

  const handleOpenCommandBar = useCallback(() => {
    setCommandBarOpen(true);
  }, [setCommandBarOpen]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ═══════════════════════════════════════════════════════════
          Section 1: Decision Center Header
          ═══════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-700/50 bg-gradient-to-l from-indigo-500/10 via-slate-800/40 to-slate-800/40 p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">
                مركز القرارات
              </h2>
              <p className="text-[11px] text-slate-400">
                ذكاء القرارات — ما يتطلب إجراءً ولماذا وكيف
              </p>
            </div>
          </div>

          {/* Counts summary */}
          <div className="flex items-center gap-3">
            <CountPill
              label="الكل"
              value={counts.total}
              colorClass="text-slate-300"
              bgClass="bg-slate-700/40"
            />
            <CountPill
              label="حرج"
              value={counts.critical}
              colorClass="text-red-400"
              bgClass="bg-red-500/15"
              icon={<Flame className="w-3 h-3" />}
            />
            <CountPill
              label="عالي"
              value={counts.high}
              colorClass="text-amber-400"
              bgClass="bg-amber-500/15"
            />
            <CountPill
              label="جديد"
              value={counts.newCount}
              colorClass="text-sky-400"
              bgClass="bg-sky-500/15"
            />
            <CountPill
              label="محلول"
              value={counts.resolved}
              colorClass="text-emerald-400"
              bgClass="bg-emerald-500/15"
              icon={<CheckCircle2 className="w-3 h-3" />}
            />
          </div>

          {/* Command bar trigger */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenCommandBar}
            className="gap-1.5 text-[11px] border-slate-600/50 hover:border-slate-500"
          >
            <Command className="w-3.5 h-3.5" />
            لوحة الأوامر
            <kbd className="text-[9px] px-1 py-0 rounded bg-slate-800 text-slate-400 border border-slate-600/40">
              Ctrl+K
            </kbd>
          </Button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════
          Section 2: Decision Inbox (full width — primary surface)
          ═══════════════════════════════════════════════════════════ */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/30 overflow-hidden h-[600px]">
        <DecisionInbox
          decisions={decisions}
          loading={loading}
          error={error}
          onRetry={onRetry}
          onNavigate={handleNavigate}
          onAction={handleAction}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════
          Section 3: Executive Priorities + Predictive Alerts
          ═══════════════════════════════════════════════════════════ */}
      <DashboardGrid columns={2} gap="gap-4">
        <ExecutivePriorities
          data={execPriorities}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
        <PredictiveAlerts
          alerts={alerts}
          loading={loading}
          error={error}
          onRetry={onRetry}
        />
      </DashboardGrid>

      {/* ═══════════════════════════════════════════════════════════
          Section 4: Coaching Engine (full width)
          ═══════════════════════════════════════════════════════════ */}
      <CoachingEngine
        opportunities={coaching}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />

      {/* ═══════════════════════════════════════════════════════════
          Command Bar (global, keyboard-activated)
          ═══════════════════════════════════════════════════════════ */}
      <CommandBar
        decisions={decisions}
        onOpenDecision={setDetailDecision}
        onNavigate={handleNavigate}
      />

      {/* ═══════════════════════════════════════════════════════════
          Detail dialog (for command bar navigation)
          ═══════════════════════════════════════════════════════════ */}
      <DecisionDetailDialog
        decision={detailDecision}
        open={!!detailDecision}
        onOpenChange={(open) => { if (!open) setDetailDecision(null); }}
        onAction={handleAction}
      />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════
//  CountPill — small count badge for the header
// ═══════════════════════════════════════════════════════════════

const CountPill = memo(function CountPill({
  label,
  value,
  colorClass,
  bgClass,
  icon,
}: {
  label: string;
  value: number;
  colorClass: string;
  bgClass: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-lg', bgClass)}>
      {icon}
      <span className={cn('text-sm font-bold', colorClass)}>{value}</span>
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
});