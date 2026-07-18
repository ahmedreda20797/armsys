/**
 * ARM ERP — Workflow Runtime V1 Error System
 *
 * Enterprise-grade typed error hierarchy.
 * Never throw generic Error — always use a typed subclass.
 *
 * @module workflow-runtime/errors/RuntimeErrors
 */

/* ════════════════════════════════════════════════════════════════════════
   BASE ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Base class for every error raised by the Workflow Runtime V1.
 * Carries a stable `code` for programmatic handling and structured `details`.
 */
export abstract class WorkflowRuntimeError extends Error {
  public abstract readonly code: string;
  public readonly details: Record<string, unknown>;
  public readonly timestamp: number;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.timestamp = Date.now();
    Object.setPrototypeOf(this, new.target.prototype);
  }

  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
    };
  }
}

/* ════════════════════════════════════════════════════════════════════════
   VALIDATION ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Raised when workflow validation fails before execution.
 * Validation must pass before any execution can start.
 */
export class ValidationError extends WorkflowRuntimeError {
  public readonly code = 'VALIDATION_ERROR';

  constructor(
    message: string,
    public readonly violations: ReadonlyArray<ValidationViolation> = [],
  ) {
    super(message, { violations });
  }
}

export interface ValidationViolation {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  severity: 'error' | 'warning';
}

/* ════════════════════════════════════════════════════════════════════════
   EXECUTION ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Raised during workflow execution when a node fails or
 * an unexpected execution condition occurs.
 */
export class ExecutionError extends WorkflowRuntimeError {
  public readonly code = 'EXECUTION_ERROR';

  constructor(
    message: string,
    public readonly nodeId?: string,
    public readonly executionId?: string,
  ) {
    super(message, { nodeId, executionId });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   TRANSITION ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Raised when an illegal state machine transition is attempted.
 * The state machine enforces strict transitions.
 */
export class TransitionError extends WorkflowRuntimeError {
  public readonly code = 'TRANSITION_ERROR';

  constructor(
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`Illegal state transition: ${from} → ${to}`, { from, to });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   QUEUE ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Raised when a queue operation fails (dequeue from empty, etc.)
 */
export class QueueError extends WorkflowRuntimeError {
  public readonly code = 'QUEUE_ERROR';

  constructor(
    message: string,
    public readonly operation?: string,
  ) {
    super(message, { operation });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SERIALIZATION ERROR
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Raised when serialization/deserialization fails.
 */
export class SerializationError extends WorkflowRuntimeError {
  public readonly code = 'SERIALIZATION_ERROR';

  constructor(
    message: string,
    public readonly source?: string,
  ) {
    super(message, { source });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   VARIABLE ERROR
   ════════════════════════════════════════════════════════════════════════ */

/** Raised when a required variable cannot be resolved. */
export class VariableMissingError extends WorkflowRuntimeError {
  public readonly code = 'VARIABLE_MISSING';

  constructor(
    public readonly key: string,
    public readonly scope?: string,
  ) {
    super(`Required variable "${key}" is missing${scope ? ` in scope "${scope}"` : ''}.`, {
      key,
      scope,
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   NODE NOT FOUND ERROR
   ════════════════════════════════════════════════════════════════════════ */

/** Raised when a referenced node id cannot be located in the graph. */
export class NodeNotFoundError extends WorkflowRuntimeError {
  public readonly code = 'NODE_NOT_FOUND';

  constructor(
    public readonly nodeId: string,
    public readonly workflowId?: string,
  ) {
    super(
      `Node "${nodeId}" was not found${workflowId ? ` in workflow "${workflowId}"` : ''}.`,
      { nodeId, workflowId },
    );
  }
}

/* ════════════════════════════════════════════════════════════════════════
   INFINITE LOOP ERROR
   ════════════════════════════════════════════════════════════════════════ */

/** Raised when execution exceeds the per-node visit budget. */
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

/* ════════════════════════════════════════════════════════════════════════
   EXECUTOR ERROR
   ════════════════════════════════════════════════════════════════════════ */

/** Raised when no executor is registered for a node type. */
export class ExecutorNotRegisteredError extends WorkflowRuntimeError {
  public readonly code = 'EXECUTOR_NOT_REGISTERED';

  constructor(
    public readonly nodeType: string,
    public readonly nodeId?: string,
  ) {
    super(`No executor registered for node type "${nodeType}"${nodeId ? ` (node: ${nodeId})` : ''}.`, {
      nodeType,
      nodeId,
    });
  }
}

/** Raised when a workflow execution times out. */
export class WorkflowTimeoutError extends WorkflowRuntimeError {
  public readonly code = 'WORKFLOW_TIMEOUT';

  constructor(
    public readonly executionId: string,
    public readonly elapsedMs: number,
    public readonly limitMs: number,
  ) {
    super(`Execution "${executionId}" timed out after ${elapsedMs}ms (limit ${limitMs}ms).`, {
      executionId,
      elapsedMs,
      limitMs,
    });
  }
}

/** Raised when a cancelled execution is observed mid-loop. */
export class RuntimeCancelledError extends WorkflowRuntimeError {
  public readonly code = 'RUNTIME_CANCELLED';

  constructor(
    public readonly executionId: string,
    public readonly reason?: string,
  ) {
    super(`Execution "${executionId}" was cancelled${reason ? `: ${reason}` : ''}.`, {
      executionId,
      reason,
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   TYPE GUARD
   ════════════════════════════════════════════════════════════════════════ */

/** Type guard: any value is a WorkflowRuntimeError. */
export function isWorkflowRuntimeError(value: unknown): value is WorkflowRuntimeError {
  return value instanceof WorkflowRuntimeError;
}
