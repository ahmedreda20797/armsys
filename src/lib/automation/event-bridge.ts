// ══════════════════════════════════════════════════════════════
//  Automation Event Bridge (§13)
//
//  ROOT CAUSE FIXED: the rules engine (evaluation, actions,
//  execution logs, throttling, enable/disable) was REAL but nothing
//  ever invoked it — trigger types were stored metadata with no
//  listeners wired into the record-writing routes, so rules could
//  only run manually.
//
//  This bridge is the missing wiring: after a record is created /
//  updated / status-changed, the owning route calls
//  `dispatchAutomationEvent(triggerType, module, payload)` —
//  fire-and-forget by design:
//    • NEVER blocks or fails the business write that already
//      succeeded (errors are swallowed into console + logs).
//    • Loads ONLY active rules whose triggerType matches.
//    • Conditions receive the payload fields (employeeId,
//      employeeName, department, status, severity, category, and any
//      extra fields the route supplies) — the existing condition
//      builder evaluates them unchanged.
//    • runRule handles throttle/persist/logs exactly as manual runs.
// ══════════════════════════════════════════════════════════════

import { getAll, TTL } from '@/lib/db';
import { runRule } from '@/lib/rules-engine';
import type { AutomationRule } from '@/types';

/** The record lifecycle events routes can emit (rule triggerTypes). */
export type AutomationTriggerType =
  | 'record_created'
  | 'record_updated'
  | 'record_deleted'
  | 'status_changed';

/** What a route tells the engine about the record it just wrote. */
export interface AutomationEventPayload {
  employeeId?: string | null;
  employeeName?: string | null;
  department?: string | null;
  status?: string | null;
  severity?: string | null;
  category?: string | null;
  priority?: string | null;
  sourceRecordId?: string | null;
  /** Any additional fields rule conditions may reference. */
  extra?: Record<string, string | number | boolean | null>;
}

/**
 * Fire the matching active rules for one lifecycle event. SAFE to
 * call without await — returns a promise that never rejects.
 */
export async function dispatchAutomationEvent(
  triggerType: AutomationTriggerType,
  module: string,
  payload: AutomationEventPayload,
): Promise<void> {
  try {
    const rules = await getAll<AutomationRule>('automationRules', TTL.LONG);
    const matching = rules.filter(
      (r) => r && r.status === 'active' && r.triggerType === triggerType && r.module === module,
    );
    if (matching.length === 0) return;

    const context: Record<string, unknown> = {
      triggeredBy: `event:${triggerType}`,
      sourceModule: module,
      employeeId: payload.employeeId ?? null,
      employeeName: payload.employeeName ?? null,
      department: payload.department ?? null,
      status: payload.status ?? null,
      severity: payload.severity ?? null,
      category: payload.category ?? null,
      priority: payload.priority ?? null,
      sourceRecordId: payload.sourceRecordId ?? null,
      ...(payload.extra ?? {}),
    };

    for (const rule of matching) {
      try {
        await runRule(rule, context);
      } catch (err) {
        // One crashing rule must never affect the others or the caller.
        console.error(`[automation-bridge] rule "${rule.name}" (${rule.id}) failed:`, err);
      }
    }
  } catch (err) {
    console.error(`[automation-bridge] dispatch(${triggerType}, ${module}) failed:`, err);
  }
}
