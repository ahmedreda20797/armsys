// ══════════════════════════════════════════════════════════════
//  Automation — REAL stats + master switch (Qnlys milestone §15)
//
//  ONE module so the automation page, the settings page, and any
//  future dashboard read the SAME numbers:
//    • counts computed over the full authorized rule set
//      (never a paginated page),
//    • success rate ONLY from actual execution counters maintained
//      by the rules engine (null when nothing ever ran),
//    • last execution = the newest real lastRunAt (null otherwise).
//  No fabricated "94%" — when there are no executions the UI must
//  show "—" / "لم يتم التنفيذ بعد".
// ══════════════════════════════════════════════════════════════

import { getById, updateRecord } from '@/lib/db';
import type { AutomationRule } from '@/types';

export const AUTOMATION_SETTINGS_TABLE = 'systemSettings';
export const AUTOMATION_SETTINGS_ID = 'automation';

export interface AutomationStats {
  total: number;
  active: number;
  inactive: number;
  draft: number;
  /** Sum of real execution counters written by the engine. */
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  /** Percent 0..100 — NULL when no execution ever happened. */
  successRate: number | null;
  /** ISO timestamp of the newest real execution — NULL when never run. */
  lastExecutedAt: string | null;
  /** Rules whose last real execution happened "today". */
  triggeredToday: number;
}

/** Pure aggregation over automation rules — unit-testable. */
export function computeAutomationStats(rules: ReadonlyArray<AutomationRule>, now: Date = new Date()): AutomationStats {
  const total = rules.length;
  const active = rules.filter((r) => r.status === 'active').length;
  const draft = rules.filter((r) => r.status === 'draft').length;
  const inactive = total - active - draft;

  const totalExecutions = rules.reduce((sum, r) => sum + (Number(r.totalExecutions) || 0), 0);
  const successCount = rules.reduce((sum, r) => sum + (Number(r.successCount) || 0), 0);
  const failureCount = rules.reduce((sum, r) => sum + (Number(r.failCount) || 0), 0);

  const lastExecutedAt = rules.reduce<string | null>((latest, r) => {
    const t = typeof r.lastRunAt === 'string' && r.lastRunAt ? r.lastRunAt : null;
    if (!t) return latest;
    return !latest || t > latest ? t : latest;
  }, null);

  const todayKey = now.toISOString().split('T')[0];
  const triggeredToday = rules.filter(
    (r) => typeof r.lastRunAt === 'string' && r.lastRunAt && r.lastRunAt.split('T')[0] === todayKey,
  ).length;

  const successRate =
    totalExecutions > 0
      ? Math.round((successCount / totalExecutions) * 100)
      : null;

  return {
    total,
    active,
    inactive,
    draft,
    totalExecutions,
    successCount,
    failureCount,
    successRate,
    lastExecutedAt,
    triggeredToday,
  };
}

/** Master switch — read from the systemSettings record (default ON). */
export async function isAutomationEnabled(): Promise<boolean> {
  const rec = await getById<{ enabled?: boolean }>(AUTOMATION_SETTINGS_TABLE, AUTOMATION_SETTINGS_ID);
  return rec ? rec.enabled !== false : true;
}

/** Persist the master switch (admin-only; route enforces permission). */
export async function setAutomationEnabled(enabled: boolean): Promise<void> {
  await updateRecord(AUTOMATION_SETTINGS_TABLE, AUTOMATION_SETTINGS_ID, { enabled });
}
