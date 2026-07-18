/**
 * ARM ERP — Workflow Runtime V1 Runtime Context
 *
 * The RuntimeContext is the aggregate state object that travels through the
 * entire execution lifecycle. It carries:
 *
 *   workflowId | workflowVersion | executionId | status | currentNodeId
 *   visitedNodes | pendingNodes | variables | executionHistory
 *   logs | metadata | startedAt | endedAt
 *
 * The context is a mutable value object owned by the WorkflowExecutor during
 * a single execution. It is NOT shared across executions — each `execute()`
 * call creates a fresh context.
 *
 * All status mutations route through {@link StateTracker} so illegal
 * transitions throw {@link TransitionError} before any field changes.
 *
 * @module workflow-runtime/engine/RuntimeContext
 */

import type {
  ExecutionState,
  HistoryEntry,
  LogEntry,
  RuntimeWorkflow,
  VariableValue,
  VariableSnapshotScoped,
} from '../types/runtime.types';
import type { WorkflowRuntimeError } from '../errors/RuntimeErrors';
import { StateTracker } from './ExecutionState';
import { VariableResolver } from '../variables/VariableResolver';

export interface RuntimeContextOptions {
  workflow: RuntimeWorkflow;
  executionId?: string;
  /** Caller-supplied execution scope variables seed. */
  variables?: Record<string, VariableValue>;
  /** Global scope seed (lowest precedence). */
  globalVariables?: Record<string, VariableValue>;
  /** Free-form metadata. */
  metadata?: Record<string, VariableValue>;
}

let executionCounter = 0;
function generateExecutionId(workflowId: string): string {
  executionCounter += 1;
  return `exec_${workflowId}_${Date.now().toString(36)}_${executionCounter.toString(36)}`;
}

export class RuntimeContext {
  public readonly workflowId: string;
  public readonly workflowVersion: number;
  public readonly executionId: string;

  private readonly tracker: StateTracker;
  private _currentNodeId: string | null;
  private readonly _visitedNodes: string[] = [];
  private readonly _pendingNodes: string[] = [];
  private readonly _variables: VariableResolver;
  private readonly _history: HistoryEntry[] = [];
  private readonly _logs: LogEntry[] = [];
  private readonly _metadata: Record<string, VariableValue>;
  private _startedAt: number | null = null;
  private _endedAt: number | null = null;
  private readonly _errors: WorkflowRuntimeError[] = [];
  private _cancelRequested = false;
  private _cancelReason?: string;
  private _pauseRequested = false;

  public readonly workflow: RuntimeWorkflow;

  constructor(opts: RuntimeContextOptions) {
    this.workflow = opts.workflow;
    this.workflowId = opts.workflow.id;
    this.workflowVersion = opts.workflow.version;
    this.executionId = opts.executionId ?? generateExecutionId(opts.workflow.id);
    this.tracker = new StateTracker('Idle');
    this._currentNodeId =
      opts.workflow.startNodeId ?? this.findStartNodeId(opts.workflow) ?? null;
    this._variables = new VariableResolver();
    if (opts.globalVariables) this._variables.setMany(opts.globalVariables, 'global');
    if (opts.workflow.metadata) {
      this._variables.setMany(opts.workflow.metadata, 'workflow');
    }
    if (opts.variables) this._variables.setMany(opts.variables, 'execution');
    this._metadata = { ...(opts.metadata ?? {}) };
  }

  /* ─── status (state machine) ──────────────────────────────────────── */

  public get status(): ExecutionState {
    return this.tracker.status;
  }

  /** Transition to a new status, throwing on illegal transitions. */
  public setStatus(next: ExecutionState): void {
    this.tracker.moveTo(next);
    if (next === 'Completed' || next === 'Failed' || next === 'Cancelled') {
      if (this._endedAt === null) this._endedAt = Date.now();
    }
    if (next === 'Initializing' && this._startedAt === null) {
      this._startedAt = Date.now();
    }
  }

  /** Attempt a transition without throwing. Returns true on success. */
  public trySetStatus(next: ExecutionState): boolean {
    if (!this.tracker.tryMoveTo(next)) return false;
    if (next === 'Completed' || next === 'Failed' || next === 'Cancelled') {
      if (this._endedAt === null) this._endedAt = Date.now();
    }
    if (next === 'Initializing' && this._startedAt === null) {
      this._startedAt = Date.now();
    }
    return true;
  }

  /** Force-reset the status (used for restart()). */
  public resetStatus(to: ExecutionState = 'Idle'): void {
    this.tracker.reset(to);
  }

  /* ─── position ────────────────────────────────────────────────────── */

  public get currentNodeId(): string | null {
    return this._currentNodeId;
  }

  public setCurrentNode(nodeId: string | null): void {
    this._currentNodeId = nodeId;
  }

  public get visitedNodes(): readonly string[] {
    return this._visitedNodes;
  }

  public get pendingNodes(): readonly string[] {
    return this._pendingNodes;
  }

  public markVisited(nodeId: string): void {
    if (!this._visitedNodes.includes(nodeId)) this._visitedNodes.push(nodeId);
  }

  public setPending(nodes: string[]): void {
    this._pendingNodes.length = 0;
    this._pendingNodes.push(...nodes);
  }

  public clearPending(): void {
    this._pendingNodes.length = 0;
  }

  /* ─── variables ───────────────────────────────────────────────────── */

  public get variables(): VariableResolver {
    return this._variables;
  }

  public get variableSnapshot(): VariableSnapshotScoped {
    return this._variables.snapshotScoped();
  }

  /* ─── history ─────────────────────────────────────────────────────── */

  public get executionHistory(): readonly HistoryEntry[] {
    return this._history;
  }

  public appendHistory(entry: HistoryEntry): void {
    this._history.push(entry);
  }

  public get lastHistoryEntry(): HistoryEntry | undefined {
    return this._history[this._history.length - 1];
  }

  /* ─── logs ────────────────────────────────────────────────────────── */

  public get logs(): readonly LogEntry[] {
    return this._logs;
  }

  public appendLog(entry: LogEntry): void {
    this._logs.push(entry);
  }

  /* ─── metadata ────────────────────────────────────────────────────── */

  public get metadata(): Record<string, VariableValue> {
    return this._metadata;
  }

  public setMetadata(key: string, value: VariableValue): void {
    this._metadata[key] = value;
  }

  /* ─── timing ──────────────────────────────────────────────────────── */

  public get startedAt(): number | null {
    return this._startedAt;
  }

  public get endedAt(): number | null {
    return this._endedAt;
  }

  public setStartedAt(ts: number | null): void {
    this._startedAt = ts;
  }

  public setEndedAt(ts: number | null): void {
    this._endedAt = ts;
  }

  /* ─── errors ──────────────────────────────────────────────────────── */

  public get errors(): readonly WorkflowRuntimeError[] {
    return this._errors;
  }

  public get lastError(): WorkflowRuntimeError | undefined {
    return this._errors[this._errors.length - 1];
  }

  public recordError(error: WorkflowRuntimeError): void {
    this._errors.push(error);
  }

  public get hasErrors(): boolean {
    return this._errors.length > 0;
  }

  /* ─── control signals ─────────────────────────────────────────────── */

  public get cancelRequested(): boolean {
    return this._cancelRequested;
  }

  public get cancelReason(): string | undefined {
    return this._cancelReason;
  }

  public requestCancel(reason?: string): void {
    this._cancelRequested = true;
    this._cancelReason = reason;
  }

  public get pauseRequested(): boolean {
    return this._pauseRequested;
  }

  public requestPause(): void {
    this._pauseRequested = true;
  }

  public clearPauseRequest(): void {
    this._pauseRequested = false;
  }

  /* ─── predicates ──────────────────────────────────────────────────── */

  public get isTerminal(): boolean {
    return this.tracker.isTerminal;
  }

  public get isActive(): boolean {
    return this.tracker.isActive;
  }

  /* ─── snapshot ────────────────────────────────────────────────────── */

  /** Plain serializable snapshot of the entire context (for serialization). */
  public toJSON(): Record<string, unknown> {
    return {
      workflowId: this.workflowId,
      workflowVersion: this.workflowVersion,
      executionId: this.executionId,
      status: this.status,
      currentNodeId: this._currentNodeId,
      visitedNodes: [...this._visitedNodes],
      pendingNodes: [...this._pendingNodes],
      variables: this._variables.snapshotScoped(),
      executionHistory: this._history.map((h) => ({ ...h })),
      logs: this._logs.map((l) => ({ ...l })),
      metadata: { ...this._metadata },
      startedAt: this._startedAt,
      endedAt: this._endedAt,
      errors: this._errors.map((e) => e.toJSON()),
    };
  }

  /* ─── internals ───────────────────────────────────────────────────── */

  private findStartNodeId(workflow: RuntimeWorkflow): string | undefined {
    return (
      workflow.nodes.find((n) => n.kind === 'start')?.id ?? workflow.nodes[0]?.id
    );
  }
}

/** Convenience factory. */
export function createRuntimeContext(opts: RuntimeContextOptions): RuntimeContext {
  return new RuntimeContext(opts);
}
