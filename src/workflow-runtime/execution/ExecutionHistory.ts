/**
 * ARM ERP — Workflow Runtime Execution History
 *
 * Append-only in-memory store of {@link ExecutionStep} records for a single
 * execution. Provides filtered views (by node, by status) and aggregate
 * metrics (total duration, failure count).
 *
 * @module workflow-runtime/execution/ExecutionHistory
 */

import type { ExecutionStep, StepStatus } from '../types/runtime';

export interface HistoryMetrics {
  readonly totalSteps: number;
  readonly totalDurationMs: number;
  readonly byStatus: Readonly<Record<StepStatus, number>>;
  readonly failureCount: number;
  readonly skippedCount: number;
}

export class ExecutionHistory {
  private readonly steps: ExecutionStep[] = [];
  private readonly byNode = new Map<string, ExecutionStep[]>();

  /** Append an immutable step. Returns the step for chaining. */
  public append(step: ExecutionStep): ExecutionStep {
    this.steps.push(step);
    const bucket = this.byNode.get(step.nodeId) ?? [];
    bucket.push(step);
    this.byNode.set(step.nodeId, bucket);
    return step;
  }

  /** All steps in insertion order. */
  public all(): readonly ExecutionStep[] {
    return this.steps;
  }

  /** Step count. */
  public get length(): number {
    return this.steps.length;
  }

  /** Latest step, or undefined when empty. */
  public last(): ExecutionStep | undefined {
    return this.steps[this.steps.length - 1];
  }

  /** All steps for a given node id. */
  public forNode(nodeId: string): readonly ExecutionStep[] {
    return this.byNode.get(nodeId) ?? [];
  }

  /** Filter steps by status. */
  public withStatus(status: StepStatus): readonly ExecutionStep[] {
    return this.steps.filter((s) => s.status === status);
  }

  /** Aggregate metrics over the recorded steps. */
  public metrics(): HistoryMetrics {
    const byStatus: Record<StepStatus, number> = {
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      waiting: 0,
    };
    let totalDurationMs = 0;
    for (const s of this.steps) {
      byStatus[s.status] += 1;
      if (s.durationMs !== undefined) totalDurationMs += s.durationMs;
    }
    return Object.freeze({
      totalSteps: this.steps.length,
      totalDurationMs,
      byStatus: Object.freeze(byStatus),
      failureCount: byStatus.failed,
      skippedCount: byStatus.skipped,
    });
  }

  /** Reset the history (used when restarting an execution). */
  public clear(): void {
    this.steps.length = 0;
    this.byNode.clear();
  }

  /** Serialize to a plain array (deep copy of frozen records). */
  public toJSON(): ExecutionStep[] {
    return this.steps.map((s) => ({ ...s }));
  }
}

/** Convenience factory. */
export function createExecutionHistory(): ExecutionHistory {
  return new ExecutionHistory();
}
