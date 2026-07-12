'use client';

// ═══════════════════════════════════════════════════════════════
//  AOCC V3 — useDecisions
//
//  The single composition hook for the Decision Intelligence Layer.
//  It wires together:
//    1. The existing AOCC data pipeline (reused — no new fetches)
//    2. The decision engine (pure functions)
//    3. The decision store (lifecycle + selection + filters)
//
//  Widgets import THIS hook, never the raw engine or store directly.
//  This keeps the data flow unidirectional and the API surface small.
// ═══════════════════════════════════════════════════════════════

import { useMemo, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDecisionStore } from '@/lib/aocc/decision-store';
import {
  generateDecisions,
  predictiveAlerts,
  generateCoachingOpportunities,
  generateExecutivePriorities,
} from '@/lib/aocc/decision-engine';
import type { Decision } from '@/lib/aocc/decision-types';
import type {
  ActionItem,
  EmployeeCorrelation,
  DepartmentHealth,
  RawDataBundle,
} from '@/lib/aocc/types';

// ═══════════════════════════════════════════════════════════════
//  Input contract — the caller passes the already-computed pipeline
//  outputs from AoccLayout. This avoids re-fetching anything.
// ═══════════════════════════════════════════════════════════════

export interface UseDecisionsInput {
  actions: ActionItem[];
  correlations: EmployeeCorrelation[];
  departments: DepartmentHealth[];
  data: RawDataBundle;
}

export interface UseDecisionsResult {
  // ── Derived intelligence ──
  decisions: Decision[];
  alerts: ReturnType<typeof predictiveAlerts>;
  coaching: ReturnType<typeof generateCoachingOpportunities>;
  execPriorities: ReturnType<typeof generateExecutivePriorities>;

  // ── Counts ──
  counts: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    newCount: number;
    resolved: number;
  };
}

/**
 * Compose the decision intelligence from the existing operational pipeline.
 * All heavy computation is memoized — it only re-runs when the input
 * pipeline outputs change (i.e. when the underlying React Query data
 * changes, which happens every 30s or on manual refresh).
 */
export function useDecisions(input: UseDecisionsInput): UseDecisionsResult {
  const { actions, correlations, departments, data } = input;
  const user = useAuth().user;
  const initStore = useDecisionStore((s) => s.init);

  // ── Initialize the store for this user (loads localStorage) ──
  useEffect(() => {
    initStore(user?.id || null);
  }, [user?.id, initStore]);

  // ── Generate decisions (memoized on pipeline outputs) ──
  const decisions = useMemo(
    () => generateDecisions({ actions, correlations, departments, data }),
    [actions, correlations, departments, data]
  );

  // ── Predictive alerts ──
  const alerts = useMemo(
    () => predictiveAlerts({ actions, correlations, departments, data }),
    [actions, correlations, departments, data]
  );

  // ── Coaching opportunities ──
  const coaching = useMemo(
    () => generateCoachingOpportunities(correlations, departments),
    [correlations, departments]
  );

  // ── Executive priorities ──
  const execPriorities = useMemo(
    () => generateExecutivePriorities(decisions, correlations, departments),
    [decisions, correlations, departments]
  );

  // ── Counts (using the store for status lookup) ──
  const states = useDecisionStore((s) => s.states);

  const counts = useMemo(() => {
    const result = {
      total: decisions.length,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      newCount: 0,
      resolved: 0,
    };
    for (const d of decisions) {
      result[d.priority]++;
      const status = states[d.id]?.status ?? 'new';
      if (status === 'new') result.newCount++;
      if (status === 'resolved' || status === 'dismissed' || status === 'archived') result.resolved++;
    }
    return result;
  }, [decisions, states]);

  return { decisions, alerts, coaching, execPriorities, counts };
}
