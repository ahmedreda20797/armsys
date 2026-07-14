/**
 * Workflow Action Executor
 * Dispatches each action type to its handler.
 * Handlers are registered at startup — new action types require only a new handler.
 */

import type {
  WorkflowAction,
  WorkflowContext,
  IActionExecutor,
  ActionType,
} from '../types';
import { resolveValue } from '../context/contextFactory';

type ActionHandler = (
  action: WorkflowAction,
  ctx: WorkflowContext
) => Promise<Record<string, unknown>>;

const actionHandlers = new Map<ActionType, ActionHandler>();

/** Register a handler for an action type. Called by modules at startup. */
export function registerActionHandler(type: ActionType, handler: ActionHandler): void {
  actionHandlers.set(type, handler);
}

export class ActionExecutor implements IActionExecutor {
  async execute(
    action: WorkflowAction,
    ctx: WorkflowContext
  ): Promise<Record<string, unknown>> {
    const handler = actionHandlers.get(action.type);

    if (!handler) {
      // Architecture placeholder — log and return empty output
      console.warn(`[ActionExecutor] No handler registered for action type: ${action.type}`);
      return { skipped: true, reason: `no_handler:${action.type}` };
    }

    // Resolve any variable references in config before passing to handler
    const resolvedConfig = resolveConfig(action.config, ctx);
    const resolvedAction: WorkflowAction = { ...action, config: resolvedConfig };

    return handler(resolvedAction, ctx);
  }
}

function resolveConfig(
  config: Record<string, unknown>,
  ctx: WorkflowContext
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    resolved[key] = resolveValue(value, ctx);
  }
  return resolved;
}

export const actionExecutor = new ActionExecutor();
