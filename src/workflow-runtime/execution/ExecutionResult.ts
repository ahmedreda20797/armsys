/**
 * ARM ERP — Workflow Runtime Execution Result
 *
 * The terminal artifact of a workflow execution. Immutable snapshot of the
 * final status, history, variables, and any terminal error.
 *
 * @module workflow-runtime/execution/ExecutionResult
 */

import type {
  ExecutionStatus,
  VariableSnapshotRead,
  VariableSnapshotScoped,
} from '../types/runtime';
import type { ExecutionStep } from '../types/runtime';
import type { WorkflowRuntimeError } from '../errors/WorkflowError';

export interface ExecutionResultInput {
  executionId: string;
  workflowId: string;
  workflowVersion: number;
  status: ExecutionStatus;
  startedAt: number;
  endedAt: number;
  steps: readonly ExecutionStep[];
  variables: VariableSnapshotRead;
  variablesScoped?: VariableSnapshotScoped;
  error?: WorkflowRuntimeError;
  /** Final cursor path (node ids in execution order). */
  path?: readonly string[];
}

/** Final outcome of an execution. Frozen at construction. */
export class ExecutionResult {
  public readonly executionId: string;
  public readonly workflowId: string;
  public readonly workflowVersion: number;
  public readonly status: ExecutionStatus;
  public readonly startedAt: number;
  public readonly endedAt: number;
  public readonly durationMs: number;
  public readonly steps: readonly ExecutionStep[];
  public readonly variables: VariableSnapshotRead;
  public readonly variablesScoped?: VariableSnapshotScoped;
  public readonly error?: WorkflowRuntimeError;
  public readonly path: readonly string[];

  constructor(input: ExecutionResultInput) {
    this.executionId = input.executionId;
    this.workflowId = input.workflowId;
    this.workflowVersion = input.workflowVersion;
    this.status = input.status;
    this.startedAt = input.startedAt;
    this.endedAt = input.endedAt;
    this.durationMs = Math.max(0, input.endedAt - input.startedAt);
    this.steps = Object.freeze([...input.steps]);
    this.variables = input.variables;
    this.variablesScoped = input.variablesScoped;
    this.error = input.error;
    this.path = Object.freeze([...(input.path ?? [])]);
    Object.freeze(this);
  }

  public get succeeded(): boolean {
    return this.status === 'completed';
  }

  public get failed(): boolean {
    return this.status === 'failed';
  }

  public get cancelled(): boolean {
    return this.status === 'cancelled';
  }

  /** Step count. */
  public get stepCount(): number {
    return this.steps.length;
  }

  /** Plain serializable object (errors are stringified). */
  public toJSON(): Record<string, unknown> {
    return {
      executionId: this.executionId,
      workflowId: this.workflowId,
      workflowVersion: this.workflowVersion,
      status: this.status,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      durationMs: this.durationMs,
      stepCount: this.stepCount,
      path: [...this.path],
      variables: this.variables,
      error: this.error ? this.error.toJSON() : undefined,
    };
  }
}

/** Convenience: build a result from session state. */
export function buildExecutionResult(input: ExecutionResultInput): ExecutionResult {
  return new ExecutionResult(input);
}
