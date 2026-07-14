/**
 * Workflow Trigger Evaluator
 * Determines whether a trigger should fire for a given context.
 * Architecture only — each trigger type is a pluggable evaluator.
 */

import type {
  WorkflowTrigger,
  WorkflowContext,
  ITriggerEvaluator,
  TriggerType,
} from '../types';
import { conditionEvaluator } from '../conditions/conditionEvaluator';

type TriggerHandler = (trigger: WorkflowTrigger, ctx: WorkflowContext) => boolean;

const triggerHandlers: Partial<Record<TriggerType, TriggerHandler>> = {
  manual: () => true,
  button: () => true,
  api: () => true,

  status_change: (trigger, ctx) => {
    const { fromStatus, toStatus, field } = trigger.config as Record<string, unknown>;
    const current = field ? ctx.variables[field as string] : null;
    if (fromStatus && current !== fromStatus) return false;
    if (toStatus && current !== toStatus) return false;
    return true;
  },

  user_action: (trigger, ctx) => {
    const { requiredRole } = trigger.config as Record<string, unknown>;
    if (requiredRole && ctx.userRole !== requiredRole) return false;
    return true;
  },

  // Future: scheduled, realtime, webhook, timer — architecture placeholder
  scheduled:       () => false,
  realtime:        () => false,
  webhook:         () => false,
  timer:           () => false,
  rule_engine:     () => true,
  notification:    () => true,
  approval:        () => true,
  database_change: () => true,
};

export class TriggerEvaluator implements ITriggerEvaluator {
  canTrigger(trigger: WorkflowTrigger, ctx: WorkflowContext): boolean {
    if (!trigger.isActive) return false;

    const handler = triggerHandlers[trigger.type];
    if (!handler) return false;

    const typeResult = handler(trigger, ctx);
    if (!typeResult) return false;

    // Evaluate optional trigger-level conditions
    if (trigger.conditions) {
      return conditionEvaluator.evaluate(trigger.conditions, ctx);
    }

    return true;
  }
}

export const triggerEvaluator = new TriggerEvaluator();
