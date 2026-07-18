/**
 * ARM ERP — Workflow Runtime V1
 *
 * Top-level orchestrator. Composes the executor, registry, event bus,
 * logger, queue, validator, and serializer into a single facade.
 *
 * Public API (ONLY these methods):
 *
 *   execute()   — run a workflow to completion (or pause/wait/cancel)
 *   pause()     — request a running execution to pause
 *   resume()    — resume a paused / waiting execution
 *   cancel()    — request cancellation of a running execution
 *   restart()   — reset a context and re-run from the start
 *   validate()  — validate a workflow without executing it
 *
 * Internal implementation details (executor, registry, etc.) are private.
 *
 * The runtime holds the live {@link RuntimeContext} for an in-flight
 * execution keyed by executionId. This allows pause/resume/cancel to target
 * a specific execution. A future multi-worker deployment can move the
 * context map behind a distributed store (Redis) without changing the API.
 *
 * @module workflow-runtime/engine/WorkflowRuntime
 */

import type {
  RuntimeConfig,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeWorkflow,
  ValidationResult,
  VariableValue,
} from '../types/runtime.types';
import { DEFAULT_RUNTIME_CONFIG } from '../types/runtime.types';
import { RuntimeContext } from './RuntimeContext';
import { WorkflowExecutor, type ExecutionOutcome } from './WorkflowExecutor';
import { ExecutorRegistry } from '../executors/ExecutorRegistry';
import { registerStandardExecutors } from '../executors/Executors';
import type { BaseExecutor } from '../executors/BaseExecutor';
import { EventBus } from '../events/EventBus';
import { ExecutionLogger, type LogSink } from '../logging/ExecutionLogger';
import { ExecutionQueue } from '../queue/ExecutionQueue';
import { RuntimeValidator } from '../validation/RuntimeValidator';
import { RuntimeSerializer, type SerializedRuntime } from '../serialization/RuntimeSerializer';
import { TransitionError, ValidationError } from '../errors/RuntimeErrors';

export interface WorkflowRuntimeOptions {
  config?: Partial<RuntimeConfig>;
  /** Global scope variables (lowest precedence; applies to all executions). */
  globalVariables?: Record<string, VariableValue>;
  /** Optional external log sink. */
  logSink?: LogSink;
}

export interface ExecuteOptions {
  workflow: RuntimeWorkflow;
  /** Per-execution variable seed (execution scope). */
  variables?: Record<string, VariableValue>;
  /** Optional explicit execution id. */
  executionId?: string;
  /** Optional metadata to attach to the context. */
  metadata?: Record<string, VariableValue>;
  /** Skip pre-execution validation (default: false). */
  skipValidation?: boolean;
}

/** Result of an execute() call. */
export interface ExecuteResult extends ExecutionOutcome {
  context: RuntimeContext;
}

export class WorkflowRuntime {
  public readonly config: RuntimeConfig;
  public readonly registry: ExecutorRegistry;
  public readonly eventBus: EventBus;
  public readonly logger: ExecutionLogger;
  public readonly queue: ExecutionQueue;
  public readonly validator: RuntimeValidator;
  public readonly serializer: RuntimeSerializer;

  private readonly executor: WorkflowExecutor;
  private readonly globalVariables: Record<string, VariableValue>;
  /** executionId → live context for pause/resume/cancel. */
  private readonly liveContexts = new Map<string, RuntimeContext>();

  constructor(options: WorkflowRuntimeOptions = {}) {
    this.config = { ...DEFAULT_RUNTIME_CONFIG, ...options.config };
    this.registry = new ExecutorRegistry();
    // Auto-register the standard executor family.
    registerStandardExecutors(this.registry);
    this.eventBus = new EventBus();
    this.logger = new ExecutionLogger({
      enabled: this.config.emitLogs,
      sink: options.logSink,
    });
    this.queue = new ExecutionQueue();
    this.validator = new RuntimeValidator(this.registry);
    this.serializer = new RuntimeSerializer();
    this.globalVariables = { ...(options.globalVariables ?? {}) };
    this.executor = new WorkflowExecutor({
      registry: this.registry,
      eventBus: this.eventBus,
      logger: this.logger,
      queue: this.queue,
      config: this.config,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════
     PUBLIC API
     ═══════════════════════════════════════════════════════════════════ */

  /**
   * Validate a workflow without executing it. Returns the structured result.
   */
  public validate(workflow: RuntimeWorkflow): ValidationResult {
    return this.validator.validate(workflow);
  }

  /**
   * Execute a workflow. Validates first (unless `skipValidation`), then
   * creates a fresh context and drives it through the graph.
   *
   * The returned {@link ExecuteResult} includes the live context so callers
   * can pause/resume/cancel by executionId afterwards.
   */
  public async execute(opts: ExecuteOptions): Promise<ExecuteResult> {
    // ── Validate ───────────────────────────────────────────────────────
    if (!opts.skipValidation) {
      this.validator.validateOrThrow(opts.workflow);
    }

    // ── Create RuntimeContext ──────────────────────────────────────────
    const context = new RuntimeContext({
      workflow: opts.workflow,
      executionId: opts.executionId,
      variables: opts.variables,
      globalVariables: this.globalVariables,
      metadata: opts.metadata,
    });

    this.liveContexts.set(context.executionId, context);

    // ── Execute ────────────────────────────────────────────────────────
    const outcome = await this.executor.execute(context);

    // ── Cleanup live map if terminal ───────────────────────────────────
    if (context.isTerminal) {
      this.liveContexts.delete(context.executionId);
    }

    return { ...outcome, context };
  }

  /**
   * Request a running execution to pause at the next node boundary.
   * Returns true if the request was accepted (the execution must be Running).
   */
  public pause(executionId: string): boolean {
    const context = this.liveContexts.get(executionId);
    if (!context) return false;
    if (context.status !== 'Running') {
      throw new TransitionError(context.status, 'Paused');
    }
    context.requestPause();
    return true;
  }

  /**
   * Resume a paused or waiting execution. Re-enters the executor loop at the
   * recorded current node.
   */
  public async resume(executionId: string): Promise<ExecuteResult> {
    const context = this.liveContexts.get(executionId);
    if (!context) {
      throw new TransitionError('<none>', 'Running');
    }
    if (context.status !== 'Paused' && context.status !== 'Waiting') {
      throw new TransitionError(context.status, 'Running');
    }
    context.clearPauseRequest();
    context.setStatus('Running');
    this.eventBus.publish({
      type: 'workflow.resumed',
      executionId: context.executionId,
      workflowId: context.workflowId,
      timestamp: Date.now(),
      nodeId: context.currentNodeId ?? undefined,
    });

    const outcome = await this.executor.execute(context);
    if (context.isTerminal) {
      this.liveContexts.delete(context.executionId);
    }
    return { ...outcome, context };
  }

  /**
   * Request cancellation of a running execution. The executor observes the
   * request at the next node boundary and transitions to Cancelled.
   */
  public cancel(executionId: string, reason?: string): boolean {
    const context = this.liveContexts.get(executionId);
    if (!context) return false;
    if (context.isTerminal) return false;
    context.requestCancel(reason);
    return true;
  }

  /**
   * Restart an execution: reset the context's state machine, clear history
   * and logs, and re-run from the start node. Returns a fresh outcome.
   */
  public async restart(executionId: string): Promise<ExecuteResult> {
    const context = this.liveContexts.get(executionId);
    if (!context) {
      throw new TransitionError('<none>', 'Initializing');
    }
    // Reset the state machine forcibly (bypass transition rules).
    context.resetStatus('Idle');
    // Rewind cursor to the start node; variables are preserved.
    const startId =
      context.workflow.startNodeId ??
      context.workflow.nodes.find((n) => n.kind === 'start')?.id ??
      context.workflow.nodes[0]?.id ??
      null;
    context.setCurrentNode(startId);
    // Clear startedAt so the executor re-stamps it on the next run.
    context.setStartedAt(null);
    context.setEndedAt(null);
    // Re-execute from scratch.
    const outcome = await this.executor.execute(context);
    if (context.isTerminal) {
      this.liveContexts.delete(context.executionId);
    }
    return { ...outcome, context };
  }

  /* ═══════════════════════════════════════════════════════════════════
     EXTENSION POINTS
     ═══════════════════════════════════════════════════════════════════ */

  /** Register a custom executor (e.g. a real Notify transport). */
  public registerExecutor(executor: BaseExecutor): this {
    this.registry.register(executor);
    return this;
  }

  /** Subscribe to runtime events (specific type or '*' for all). */
  public subscribe(
    eventType: RuntimeEventType | '*',
    fn: (event: RuntimeEvent) => void,
  ): () => void {
    return this.eventBus.subscribe(eventType, fn);
  }

  /** Set a global variable (lowest precedence). */
  public setGlobalVariable(key: string, value: VariableValue): this {
    this.globalVariables[key] = value;
    return this;
  }

  /* ═══════════════════════════════════════════════════════════════════
     ACCESSORS
     ═══════════════════════════════════════════════════════════════════ */

  /** Get a live context by executionId (if still in flight). */
  public getContext(executionId: string): RuntimeContext | undefined {
    return this.liveContexts.get(executionId);
  }

  /** All in-flight execution ids. */
  public activeExecutions(): string[] {
    return [...this.liveContexts.keys()];
  }

  /** Serialize a live execution (for persistence). */
  public serialize(executionId: string): SerializedRuntime | undefined {
    const ctx = this.liveContexts.get(executionId);
    return ctx ? this.serializer.serialize(ctx) : undefined;
  }

  /**
   * Import a previously serialized execution and rehydrate a paused context
   * so it can be resumed. Returns the new executionId.
   */
  public async importAndResume(payload: SerializedRuntime): Promise<ExecuteResult> {
    const deserialized = this.serializer.deserialize(payload);
    const workflow: RuntimeWorkflow = {
      id: deserialized.workflowId,
      version: deserialized.workflowVersion,
      // Edges/nodes are not in the serialized form (we only persist runtime
      // state, not the graph). The caller is expected to provide them via the
      // graph cache; here we restore just enough to resume.
      nodes: [],
      edges: [],
      startNodeId: deserialized.currentNodeId ?? undefined,
    };
    // Because we lack the original graph after a pure runtime import, this
    // helper is mainly used in tests / replay. Production resume should use
    // restart() with the original workflow.
    void workflow;
    throw new ValidationError(
      'importAndResume requires the original workflow graph; use WorkflowRuntime.importContext().',
    );
  }

  /**
   * Rehydrate a context from a serialized payload PLUS the original workflow.
   * The rehydrated context is registered as a live execution and can be
   * resumed via {@link resume}.
   */
  public importContext(
    workflow: RuntimeWorkflow,
    payload: SerializedRuntime,
  ): string {
    const deserialized = this.serializer.deserialize(payload);
    const context = new RuntimeContext({
      workflow,
      executionId: deserialized.executionId,
      globalVariables: this.globalVariables,
    });
    // Restore variables / cursor position.
    context.variables.restore(deserialized.variables);
    context.setCurrentNode(deserialized.currentNodeId);
    context.setStatus('Paused');
    if (deserialized.startedAt) context.setStartedAt(deserialized.startedAt);
    this.liveContexts.set(context.executionId, context);
    return context.executionId;
  }
}

/** Convenience factory. */
export function createWorkflowRuntime(options: WorkflowRuntimeOptions = {}): WorkflowRuntime {
  return new WorkflowRuntime(options);
}
