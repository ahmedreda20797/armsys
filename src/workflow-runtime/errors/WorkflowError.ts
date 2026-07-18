/**
 * ARM ERP — Workflow Runtime Error System
 * Strongly typed enterprise error classes.
 *
 * Each error carries a stable `code` for programmatic handling and a
 * machine-readable `details` bag. Errors are differentiated by class so
 * callers may use `instanceof` for branching in catch blocks.
 *
 * @module workflow-runtime/errors/WorkflowError
 */

import type { ExecutionStatus } from '../types/runtime';

/** Common shape every workflow runtime error satisfies. */
export interface WorkflowErrorDetails {
  readonly [key: string]: unknown;
}

/**
 * Base class for every error raised by the workflow runtime.
 *
 * `code` is a stable, versioned identifier safe to log and branch on.
 */
export abstract class WorkflowRuntimeError extends Error {
  /** Stable, machine-readable error code. */
  public abstract readonly code: string;
  public readonly details: WorkflowErrorDetails;
  public readonly timestamp: number;

  constructor(message: string, details: WorkflowErrorDetails = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = Date.now();
    // Restore prototype chain across TS class transpilation.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** Structured representation suitable for logging / serialization. */
  public toJSON(): {
    name: string;
    code: string;
    message: string;
    details: WorkflowErrorDetails;
    timestamp: number;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/* ─────────────────────────────────────────────────────────────────────── */

/** Raised when a referenced node id cannot be located in the workflow graph. */
export class NodeNotFoundError extends WorkflowRuntimeError {
  public readonly code = 'NODE_NOT_FOUND';
  constructor(
    public readonly nodeId: string,
    workflowId?: string,
  ) {
    super(
      `Node "${nodeId}" was not found${workflowId ? ` in workflow "${workflowId}"` : ''}.`,
      { nodeId, workflowId },
    );
  }
}

/** Raised when execution visits the same node more times than the guard allows. */
export class InfiniteLoopError extends WorkflowRuntimeError {
  public readonly code = 'INFINITE_LOOP';
  constructor(
    public readonly nodeId: string,
    public readonly visits: number,
    public readonly limit: number,
  ) {
    super(
      `Infinite loop detected at node "${nodeId}": ${visits} visits exceed limit of ${limit}.`,
      { nodeId, visits, limit },
    );
  }
}

/** Raised when a variable resolution fails for a required key. */
export class VariableMissingError extends WorkflowRuntimeError {
  public readonly code = 'VARIABLE_MISSING';
  constructor(
    public readonly key: string,
    scope?: string,
  ) {
    super(
      `Required variable "${key}" is missing${scope ? ` in scope "${scope}"` : ''}.`,
      { key, scope },
    );
  }
}

/** Raised when an action dispatcher handler fails or is unregistered. */
export class DispatcherError extends WorkflowRuntimeError {
  public readonly code = 'DISPATCHER_ERROR';
  constructor(
    public readonly actionType: string,
    reason: string,
    public readonly retryable: boolean = false,
  ) {
    super(`Dispatcher error for action "${actionType}": ${reason}`, {
      actionType,
      reason,
      retryable,
    });
  }
}

/** Raised when an illegal status transition is attempted. */
export class InvalidTransitionError extends WorkflowRuntimeError {
  public readonly code = 'INVALID_TRANSITION';
  constructor(
    public readonly from: ExecutionStatus,
    public readonly to: ExecutionStatus,
  ) {
    super(`Illegal state transition: ${from} → ${to}.`, { from, to });
  }
}

/** Raised when execution exceeds the configured wall-clock timeout. */
export class WorkflowTimeoutError extends WorkflowRuntimeError {
  public readonly code = 'WORKFLOW_TIMEOUT';
  constructor(
    public readonly executionId: string,
    public readonly elapsedMs: number,
    public readonly limitMs: number,
  ) {
    super(
      `Execution "${executionId}" timed out after ${elapsedMs}ms (limit ${limitMs}ms).`,
      { executionId, elapsedMs, limitMs },
    );
  }
}

/** Raised when an in-flight execution is cancelled by an external caller. */
export class RuntimeCancelledError extends WorkflowRuntimeError {
  public readonly code = 'RUNTIME_CANCELLED';
  constructor(public readonly executionId: string, reason?: string) {
    super(`Execution "${executionId}" was cancelled${reason ? `: ${reason}` : ''}.`, {
      executionId,
      reason,
    });
  }
}

/** Raised when a condition cannot be evaluated (bad operator / operand types). */
export class ConditionEvaluationError extends WorkflowRuntimeError {
  public readonly code = 'CONDITION_EVALUATION_ERROR';
  constructor(
    message: string,
    public readonly operator?: string,
    public readonly field?: string,
  ) {
    super(message, { operator, field });
  }
}

/** Raised when a trigger dispatcher cannot process a trigger. */
export class TriggerError extends WorkflowRuntimeError {
  public readonly code = 'TRIGGER_ERROR';
  constructor(
    public readonly triggerKind: string,
    reason: string,
  ) {
    super(`Trigger error (${triggerKind}): ${reason}`, { triggerKind, reason });
  }
}

/** Type guard: any value is a workflow runtime error. */
export function isWorkflowRuntimeError(value: unknown): value is WorkflowRuntimeError {
  return value instanceof WorkflowRuntimeError;
}
