/**
 * ARM ERP — Workflow Runtime Action Dispatcher
 *
 * Routes a node's action to a registered handler keyed by actionType.
 *
 * No business actions are implemented here — only the routing infrastructure.
 * Business modules register handlers via {@link registerHandler}; the
 * dispatcher performs lookup, lifecycle instrumentation (timing), and
 * result normalization.
 *
 * Outcome contract ({@link ActionOutcome}):
 *   success  → action completed; its output (if any) is merged into variables
 *   failure  → action threw or signalled failure (optionally retryable)
 *   waiting  → action requires an external signal before continuing
 *   skipped  → action deliberately did nothing (e.g. a guard fired)
 *
 * @module workflow-runtime/dispatcher/ActionDispatcher
 */

import type {
  ActionHandler,
  ActionResult,
  WorkflowContext,
  VariableSnapshotRead,
  VariableValue,
} from '../types/runtime';
import { DispatcherError } from '../errors/WorkflowError';

export interface DispatchInput {
  actionType: string;
  context: WorkflowContext;
  config: Readonly<Record<string, VariableValue>>;
  variables: VariableSnapshotRead;
}

export class ActionDispatcher {
  /** actionType → handler. */
  private readonly handlers = new Map<string, ActionHandler>();
  /** Optional fallback invoked when no handler matches. */
  private fallback?: ActionHandler;

  /** Register (or replace) a handler for an action type. */
  public registerHandler(actionType: string, handler: ActionHandler): this {
    this.handlers.set(actionType, handler);
    return this;
  }

  /** Remove a handler. */
  public unregisterHandler(actionType: string): boolean {
    return this.handlers.delete(actionType);
  }

  /** Register a fallback invoked when no specific handler matches. */
  public setFallback(handler: ActionHandler | undefined): this {
    this.fallback = handler;
    return this;
  }

  /** True when a handler (or fallback) exists for the action type. */
  public canDispatch(actionType: string): boolean {
    return this.handlers.has(actionType) || this.fallback !== undefined;
  }

  /** List all registered action types (excluding fallback). */
  public registeredActionTypes(): string[] {
    return [...this.handlers.keys()];
  }

  /**
   * Dispatch an action. Always returns an {@link ActionResult}; never throws
   * — handler exceptions are caught and converted to failure results.
   */
  public async dispatch(input: DispatchInput): Promise<ActionResult> {
    const startedAt = Date.now();
    const handler = this.resolveHandler(input.actionType);
    if (!handler) {
      return this.failure(
        input.actionType,
        `No handler registered for action "${input.actionType}"`,
        startedAt,
        false,
      );
    }
    try {
      const result = await handler(
        input.actionType,
        input.context,
        input.config,
        input.variables,
      );
      return this.normalize(input.actionType, result, startedAt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = isRetryableError(err);
      return this.failure(input.actionType, message, startedAt, retryable);
    }
  }

  /* ─── internals ────────────────────────────────────────────────────── */

  private resolveHandler(actionType: string): ActionHandler | undefined {
    return this.handlers.get(actionType) ?? this.fallback;
  }

  private normalize(
    actionType: string,
    result: ActionResult,
    startedAt: number,
  ): ActionResult {
    const durationMs = Date.now() - startedAt;
    if (!isValidOutcome(result.outcome)) {
      throw new DispatcherError(actionType, `Invalid outcome: ${String(result.outcome)}`);
    }
    return {
      outcome: result.outcome,
      output: result.output,
      message: result.message,
      retryable: result.retryable,
      durationMs: result.durationMs || durationMs,
    };
  }

  private failure(
    actionType: string,
    message: string,
    startedAt: number,
    retryable: boolean,
  ): ActionResult {
    return {
      outcome: 'failure',
      message,
      retryable,
      durationMs: Date.now() - startedAt,
    };
  }
}

function isValidOutcome(o: string): o is ActionResult['outcome'] {
  return o === 'success' || o === 'failure' || o === 'waiting' || o === 'skipped';
}

function isRetryableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'retryable' in err) {
    return Boolean((err as { retryable: unknown }).retryable);
  }
  return false;
}

/** Convenience factory. */
export function createActionDispatcher(): ActionDispatcher {
  return new ActionDispatcher();
}
