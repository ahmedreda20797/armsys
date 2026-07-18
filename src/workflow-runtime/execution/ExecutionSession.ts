/**
 * ARM ERP — Workflow Runtime Execution Session
 *
 * Aggregate root that ties together the per-execution state: identity,
 * status, cursor position, variables, context, history, and errors.
 *
 * A Session is the in-flight counterpart of an {@link ExecutionResult}; when
 * the session terminates the executor materialises a result from it.
 *
 * Status mutations route through {@link StateTracker} so illegal transitions
 * throw before any field is mutated.
 *
 * @module workflow-runtime/execution/ExecutionSession
 */

import type {
  ExecutionStatus,
  RuntimeWorkflow,
  WorkflowContext,
} from '../types/runtime';
import type { WorkflowRuntimeError } from '../errors/WorkflowError';
import { StateTracker } from '../engine/WorkflowState';
import { VariableStore } from '../variables/VariableStore';
import { ExecutionHistory } from './ExecutionHistory';

export interface ExecutionSessionOptions {
  executionId: string;
  workflow: RuntimeWorkflow;
  context: WorkflowContext;
  variables?: VariableStore;
  history?: ExecutionHistory;
  startedAt?: number;
}

export class ExecutionSession {
  public readonly executionId: string;
  public readonly workflowId: string;
  public readonly workflowVersion: number;
  public readonly startedAt: number;

  public readonly workflow: RuntimeWorkflow;
  public readonly context: WorkflowContext;
  public readonly variables: VariableStore;
  public readonly history: ExecutionHistory;

  private readonly tracker: StateTracker;
  private _currentNodeId: string | null;
  private _endedAt: number | null = null;
  private readonly errors: WorkflowRuntimeError[] = [];
  private _cancelled = false;
  private _cancelReason?: string;

  constructor(opts: ExecutionSessionOptions) {
    this.executionId = opts.executionId;
    this.workflow = opts.workflow;
    this.workflowId = opts.workflow.id;
    this.workflowVersion = opts.workflow.version;
    this.context = opts.context;
    this.variables = opts.variables ?? new VariableStore();
    this.history = opts.history ?? new ExecutionHistory();
    this.startedAt = opts.startedAt ?? Date.now();
    this.tracker = new StateTracker('idle');
    this._currentNodeId = opts.workflow.startNodeId ?? findStartNodeId(opts.workflow) ?? null;
  }

  /* ─── status ───────────────────────────────────────────────────────── */

  public get status(): ExecutionStatus {
    return this.tracker.status;
  }

  public get currentNodeId(): string | null {
    return this._currentNodeId;
  }

  public get endedAt(): number | null {
    return this._endedAt;
  }

  public get cancelled(): boolean {
    return this._cancelled;
  }

  public get cancelReason(): string | undefined {
    return this._cancelReason;
  }

  /** Transition to a new status, throwing on illegal transitions. */
  public setStatus(next: ExecutionStatus): void {
    this.tracker.moveTo(next);
    if (next === 'completed' || next === 'failed' || next === 'cancelled') {
      if (this._endedAt === null) this._endedAt = Date.now();
    }
    if (next === 'cancelled') {
      this._cancelled = true;
    }
  }

  /** Move the cursor to a new node id. */
  public setCurrentNode(nodeId: string | null): void {
    this._currentNodeId = nodeId;
  }

  /* ─── errors ───────────────────────────────────────────────────────── */

  public get hasErrors(): boolean {
    return this.errors.length > 0;
  }

  public get errorCount(): number {
    return this.errors.length;
  }

  public getErrors(): readonly WorkflowRuntimeError[] {
    return this.errors;
  }

  public get lastError(): WorkflowRuntimeError | undefined {
    return this.errors[this.errors.length - 1];
  }

  public recordError(error: WorkflowRuntimeError): void {
    this.errors.push(error);
  }

  /* ─── predicates ───────────────────────────────────────────────────── */

  public get isTerminal(): boolean {
    return this.tracker.isTerminal;
  }

  public get isActive(): boolean {
    return this.tracker.isActive;
  }

  /* ─── snapshot ─────────────────────────────────────────────────────── */

  /** Plain serializable snapshot (for logging / debugging). */
  public toJSON(): Record<string, unknown> {
    return {
      executionId: this.executionId,
      workflowId: this.workflowId,
      workflowVersion: this.workflowVersion,
      status: this.status,
      currentNodeId: this._currentNodeId,
      startedAt: this.startedAt,
      endedAt: this._endedAt,
      cancelled: this._cancelled,
      cancelReason: this._cancelReason,
      errorCount: this.errors.length,
      history: this.history.toJSON(),
    };
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function findStartNodeId(workflow: RuntimeWorkflow): string | undefined {
  return workflow.nodes.find((n) => n.kind === 'start')?.id ?? workflow.nodes[0]?.id;
}
