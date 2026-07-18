/**
 * ARM ERP — Workflow Runtime V1 Workflow Executor
 *
 * Core execution loop. Drives a {@link RuntimeContext} through the workflow
 * graph one node at a time:
 *
 *   Idle → Initializing → (for each node):
 *     resolve node → emit node.started → log → executor.execute →
 *     collect result → merge outputs → emit variable.changed →
 *     emit node.completed → resolve next → repeat
 *   → Completed | Failed | Cancelled | Paused | Waiting
 *
 * The executor is the single place that orchestrates the pipeline. It is
 * agnostic to persistence, transport, UI, and business modules — every side
 * effect crosses the injected ports (registry, event bus, logger).
 *
 * The pipeline stages (load, validate, create-context, create-queue,
 * execute-node, collect-result, resolve-next) are isolated as methods so any
 * one can be replaced without changing the others.
 *
 * @module workflow-runtime/engine/WorkflowExecutor
 */

import type {
  RuntimeConfig,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeNode,
  RuntimeWorkflow,
  StepStatus,
  VariableValue,
  ExecutorResult,
  HistoryEntry,
} from '../types/runtime.types';
import { DEFAULT_RUNTIME_CONFIG } from '../types/runtime.types';
import type { RuntimeContext } from './RuntimeContext';
import type { ExecutorRegistry } from '../executors/ExecutorRegistry';
import type { ExecutorContext } from '../executors/BaseExecutor';
import type { EventBus } from '../events/EventBus';
import type { ExecutionLogger, LogContext } from '../logging/ExecutionLogger';
import type { ExecutionQueue } from '../queue/ExecutionQueue';
import {
  NodeNotFoundError,
  InfiniteLoopError,
  WorkflowTimeoutError,
  RuntimeCancelledError,
  ExecutionError,
  isWorkflowRuntimeError,
  type WorkflowRuntimeError,
} from '../errors/RuntimeErrors';

export interface WorkflowExecutorPorts {
  registry: ExecutorRegistry;
  eventBus: EventBus;
  logger: ExecutionLogger;
  queue?: ExecutionQueue;
  config?: RuntimeConfig;
}

/** Final outcome returned by the executor. */
export interface ExecutionOutcome {
  status: RuntimeContext['status'];
  executionId: string;
  workflowId: string;
  currentNodeId: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  error?: WorkflowRuntimeError;
  path: readonly string[];
}

export class WorkflowExecutor {
  private readonly ports: WorkflowExecutorPorts;
  private readonly config: RuntimeConfig;

  constructor(ports: WorkflowExecutorPorts) {
    this.ports = ports;
    this.config = ports.config ?? DEFAULT_RUNTIME_CONFIG;
  }

  /**
   * Drive a context through the graph to completion (or termination).
   * Resolves with the final status. Cancellation surfaces as a Cancelled
   * status (not a throw); other failures surface as Failed.
   */
  public async execute(context: RuntimeContext): Promise<ExecutionOutcome> {
    const { eventBus, logger } = this.ports;

    // ── Stage: Idle → Initializing ─────────────────────────────────────
    context.setStatus('Initializing');
    context.setStartedAt(context.startedAt ?? Date.now());
    this.log(context, 'Info', `Initializing execution for workflow "${context.workflowId}"`);
    this.emit(context, eventBus, 'workflow.started');

    // ── Stage: create queue (optional — set pending nodes) ─────────────
    this.seedPendingNodes(context);

    // ── Stage: Initializing → Running ──────────────────────────────────
    context.setStatus('Running');

    const visitCounts = new Map<string, number>();
    let steps = 0;

    try {
      await this.runLoop(context, visitCounts, () => steps++);

      // Loop exited normally — complete unless paused / waiting / cancelled.
      if (
        context.status === 'Running' &&
        !context.cancelRequested &&
        !context.pauseRequested
      ) {
        context.setStatus('Completed');
        this.emit(context, eventBus, 'workflow.completed');
        this.log(context, 'Info', 'Execution completed');
      } else if (context.status === 'Running' && context.pauseRequested) {
        context.setStatus('Paused');
        this.emit(context, eventBus, 'workflow.paused');
        this.log(context, 'Info', 'Execution paused');
      }
    } catch (err) {
      if (err instanceof RuntimeCancelledError || context.cancelRequested) {
        if (context.status !== 'Cancelled') context.setStatus('Cancelled');
        this.emit(context, eventBus, 'workflow.cancelled', { reason: context.cancelReason });
        this.log(context, 'Warning', `Execution cancelled: ${context.cancelReason ?? 'no reason'}`);
      } else {
        const wrapped = wrapError(err, context);
        if (context.status !== 'Failed') context.setStatus('Failed');
        context.recordError(wrapped);
        this.emit(context, eventBus, 'workflow.failed', { error: wrapped.message });
        this.log(context, 'Error', `Execution failed: ${wrapped.message}`);
      }
    }

    return this.finalize(context);
  }

  /* ─── main loop ────────────────────────────────────────────────────── */

  private async runLoop(
    context: RuntimeContext,
    visitCounts: Map<string, number>,
    incrementSteps: () => void,
  ): Promise<void> {
    const { registry, eventBus } = this.ports;
    const nodesById = this.indexNodes(context.workflow);

    let currentNodeId = context.currentNodeId;

    while (currentNodeId !== null) {
      // ── Cancellation checkpoint ──────────────────────────────────────
      if (context.cancelRequested) {
        throw new RuntimeCancelledError(context.executionId, context.cancelReason);
      }
      // ── Pause checkpoint ─────────────────────────────────────────────
      if (context.pauseRequested) {
        context.setCurrentNode(currentNodeId);
        return;
      }
      // ── Timeout checkpoint ───────────────────────────────────────────
      this.assertWithinTimeout(context);
      // ── Step ceiling ─────────────────────────────────────────────────
      incrementSteps();
      if (this.exceedsMaxSteps(visitCounts.size === 0 ? 0 : totalVisits(visitCounts))) {
        throw new InfiniteLoopError(
          currentNodeId,
          totalVisits(visitCounts),
          this.config.maxSteps,
        );
      }

      const node = nodesById.get(currentNodeId);
      if (!node) {
        throw new NodeNotFoundError(currentNodeId, context.workflowId);
      }

      // ── Per-node visit guard ─────────────────────────────────────────
      const visits = (visitCounts.get(node.id) ?? 0) + 1;
      visitCounts.set(node.id, visits);
      if (visits > this.config.maxNodeVisits) {
        throw new InfiniteLoopError(node.id, visits, this.config.maxNodeVisits);
      }

      // ── node.started ─────────────────────────────────────────────────
      context.markVisited(node.id);
      context.setCurrentNode(node.id);
      this.emit(context, eventBus, 'node.started', { nodeId: node.id });
      this.log(context, 'Debug', `Executing node "${node.id}" (${node.type ?? node.kind})`, {
        nodeId: node.id,
      });

      const startedAt = Date.now();
      const inputSnapshot = cloneRecord(context.variables.snapshot());
      const stepInProgress = buildHistoryEntry({
        stepIndex: context.executionHistory.length,
        nodeId: node.id,
        nodeKind: node.kind,
        nodeType: node.type,
        status: 'active',
        startedAt,
        input: inputSnapshot,
      });

      // ── Resolve executor via the Registry ────────────────────────────
      let result: ExecutorResult;
      try {
        const executor = registry.resolve(node);
        const execCtx: ExecutorContext = {
          logger: this.ports.logger,
          registry,
        };
        result = await executor.execute(node, context, execCtx);
      } catch (err) {
        const wrapped = wrapError(err, context, node.id);
        const failedEntry = completeHistoryEntry(stepInProgress, {
          status: 'failed',
          endedAt: Date.now(),
          error: { code: wrapped.code, message: wrapped.message },
        });
        context.appendHistory(failedEntry);
        this.emit(context, eventBus, 'node.failed', {
          nodeId: node.id,
          error: wrapped.message,
        });
        this.log(context, 'Error', `Node "${node.id}" failed: ${wrapped.message}`, {
          nodeId: node.id,
        });
        throw wrapped;
      }

      // ── Apply result ─────────────────────────────────────────────────
      const endedAt = Date.now();
      if (result.output) {
        context.variables.setMany(result.output, 'nodeOutput');
        this.emit(context, eventBus, 'variable.changed', { nodeId: node.id });
      }
      const completedEntry = completeHistoryEntry(stepInProgress, {
        status: 'completed',
        endedAt,
        output: result.output,
        branchLabel: result.branchLabel,
      });
      context.appendHistory(completedEntry);
      this.emit(context, eventBus, 'node.completed', { nodeId: node.id });

      // ── Resolve next node ────────────────────────────────────────────
      const nextNodeId = this.resolveNextNodeId(node, result, context, nodesById);

      // ── outcome handling ─────────────────────────────────────────────
      if (result.outcome === 'complete' || nextNodeId === null) {
        context.setCurrentNode(null);
        context.clearPending();
        return; // loop exits → Completed branch
      }
      if (result.outcome === 'wait') {
        context.setStatus('Waiting');
        context.setCurrentNode(nextNodeId);
        return; // external resume required
      }

      context.setCurrentNode(nextNodeId);
      context.setPending([nextNodeId]);
      currentNodeId = nextNodeId;
    }
  }

  /* ─── stages (each replaceable) ─────────────────────────────────────── */

  /** Index nodes by id for O(1) lookup during the loop. */
  protected indexNodes(workflow: RuntimeWorkflow): Map<string, RuntimeNode> {
    const map = new Map<string, RuntimeNode>();
    for (const n of workflow.nodes) map.set(n.id, n);
    return map;
  }

  /** Seed the pendingNodes list with the start node. */
  protected seedPendingNodes(context: RuntimeContext): void {
    if (context.currentNodeId) context.setPending([context.currentNodeId]);
  }

  /**
   * Resolve the next node id from the executor result, falling back to
   * graph edges if the executor did not specify one.
   */
  protected resolveNextNodeId(
    node: RuntimeNode,
    result: ExecutorResult,
    context: RuntimeContext,
    nodesById: Map<string, RuntimeNode>,
  ): string | null {
    const candidate = result.nextNodeId ?? null;
    if (candidate !== null) {
      if (!nodesById.has(candidate)) {
        throw new NodeNotFoundError(candidate, context.workflowId);
      }
      return candidate;
    }
    // Fall back to edges.
    const edge = context.workflow.edges.find((e) => e.source === node.id);
    return edge ? edge.target : null;
  }

  /* ─── guards ────────────────────────────────────────────────────────── */

  private assertWithinTimeout(context: RuntimeContext): void {
    if (context.startedAt === null) return;
    const elapsed = Date.now() - context.startedAt;
    if (elapsed > this.config.maxExecutionMs) {
      throw new WorkflowTimeoutError(
        context.executionId,
        elapsed,
        this.config.maxExecutionMs,
      );
    }
  }

  private exceedsMaxSteps(totalVisits: number): boolean {
    return totalVisits > this.config.maxSteps;
  }

  /* ─── emit / log helpers ───────────────────────────────────────────── */

  private emit(
    context: RuntimeContext,
    bus: EventBus,
    type: RuntimeEventType,
    extra?: Record<string, VariableValue>,
  ): void {
    if (!this.config.emitEvents) return;
    const event: RuntimeEvent = {
      type,
      executionId: context.executionId,
      workflowId: context.workflowId,
      timestamp: Date.now(),
      nodeId: context.currentNodeId ?? undefined,
      payload: extra,
    };
    bus.publish(event);
  }

  private log(
    context: RuntimeContext,
    level: 'Debug' | 'Info' | 'Warning' | 'Error',
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    if (!this.config.emitLogs) return;
    const ctx: LogContext = {
      workflowId: context.workflowId,
      executionId: context.executionId,
      nodeId: context.currentNodeId ?? undefined,
    };
    this.ports.logger.log(level, ctx, message, metadata);
  }

  /* ─── finalize ─────────────────────────────────────────────────────── */

  private finalize(context: RuntimeContext): ExecutionOutcome {
    const startedAt = context.startedAt;
    const endedAt = context.endedAt ?? Date.now();
    return {
      status: context.status,
      executionId: context.executionId,
      workflowId: context.workflowId,
      currentNodeId: context.currentNodeId,
      startedAt,
      endedAt,
      durationMs: startedAt ? Math.max(0, endedAt - startedAt) : 0,
      error: context.lastError,
      path: context.visitedNodes,
    };
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function totalVisits(map: Map<string, number>): number {
  let total = 0;
  map.forEach((v) => (total += v));
  return total;
}

function wrapError(err: unknown, context: RuntimeContext, nodeId?: string): WorkflowRuntimeError {
  if (isWorkflowRuntimeError(err)) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ExecutionError(message, nodeId, context.executionId);
}

function cloneRecord<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ─── history entry builders ──────────────────────────────────────────── */

interface HistoryBuildInput {
  stepIndex: number;
  nodeId: string;
  nodeKind: RuntimeNode['kind'];
  nodeType?: string;
  status: StepStatus;
  startedAt: number;
  input?: Record<string, VariableValue>;
}

function buildHistoryEntry(input: HistoryBuildInput): HistoryEntry {
  return {
    stepIndex: input.stepIndex,
    nodeId: input.nodeId,
    nodeKind: input.nodeKind,
    nodeType: input.nodeType,
    status: input.status,
    startedAt: input.startedAt,
    input: input.input,
  };
}

interface HistoryCompleteInput {
  status: StepStatus;
  endedAt: number;
  output?: Record<string, VariableValue>;
  error?: { code: string; message: string };
  branchLabel?: string;
}

function completeHistoryEntry(base: HistoryEntry, opts: HistoryCompleteInput): HistoryEntry {
  return {
    ...base,
    status: opts.status,
    endedAt: opts.endedAt,
    durationMs: Math.max(0, opts.endedAt - base.startedAt),
    output: opts.output,
    error: opts.error,
    branchLabel: opts.branchLabel,
  };
}

/** Convenience factory. */
export function createWorkflowExecutor(ports: WorkflowExecutorPorts): WorkflowExecutor {
  return new WorkflowExecutor(ports);
}
