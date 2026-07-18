/**
 * ARM ERP — Workflow Runtime Execution Cursor
 *
 * Tracks the runtime's position within a workflow graph:
 *   - current node
 *   - previous node
 *   - next node (resolved after a move)
 *   - visited nodes (with per-node visit count)
 *   - ordered execution path
 *
 * The cursor enforces an infinite-loop guard: any node that is visited more
 * than `maxVisitsPerNode` times in a single execution triggers an
 * {@link InfiniteLoopError}. This guards against both runaway cycles and
 * intentionally-loopy workflows whose loop budget was exceeded.
 *
 * @module workflow-runtime/engine/ExecutionCursor
 */

import { InfiniteLoopError } from '../errors/WorkflowError';

export interface CursorSnapshot {
  readonly currentNodeId: string | null;
  readonly previousNodeId: string | null;
  readonly nextNodeId: string | null;
  readonly path: readonly string[];
  readonly visitCounts: Readonly<Record<string, number>>;
  readonly steps: number;
}

export interface ExecutionCursorOptions {
  /** Max visits to any single node before {@link InfiniteLoopError}. */
  readonly maxVisitsPerNode: number;
  /** Absolute step ceiling — total moves across all nodes. */
  readonly maxSteps: number;
  /** Optional starting node id. */
  readonly startNodeId?: string;
}

const DEFAULT_OPTIONS: ExecutionCursorOptions = {
  maxVisitsPerNode: 200,
  maxSteps: 1_000,
};

export class ExecutionCursor {
  private _current: string | null;
  private _previous: string | null = null;
  private _next: string | null = null;
  private readonly path: string[] = [];
  private readonly visitCounts = new Map<string, number>();
  private _steps = 0;
  private readonly options: ExecutionCursorOptions;

  constructor(options: Partial<ExecutionCursorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this._current = this.options.startNodeId ?? null;
    if (this._current) {
      this.recordVisit(this._current);
      this.path.push(this._current);
    }
  }

  /** Current node id, or null when the cursor hasn't started / has finished. */
  public get current(): string | null {
    return this._current;
  }

  public get previous(): string | null {
    return this._previous;
  }

  /** The node id the cursor is expected to move to next (if pre-resolved). */
  public get next(): string | null {
    return this._next;
  }

  /** Total number of move operations performed. */
  public get steps(): number {
    return this._steps;
  }

  /** Ordered list of node ids the cursor has occupied. */
  public get executionPath(): readonly string[] {
    return this.path;
  }

  /** Total visits for a given node id (0 if never visited). */
  public visitCount(nodeId: string): number {
    return this.visitCounts.get(nodeId) ?? 0;
  }

  /** True when `nodeId` has been visited at least once. */
  public hasVisited(nodeId: string): boolean {
    return this.visitCounts.has(nodeId);
  }

  /** Pre-resolve the next hop (useful for branching executors). */
  public setNext(nodeId: string | null): void {
    this._next = nodeId;
  }

  /**
   * Advance the cursor to `nodeId`. Enforces loop guards and step ceiling.
   * @throws InfiniteLoopError when the per-node visit budget is exhausted.
   */
  public moveTo(nodeId: string): void {
    if (this._steps >= this.options.maxSteps) {
      throw new InfiniteLoopError(nodeId, this._steps + 1, this.options.maxSteps);
    }
    const newCount = (this.visitCounts.get(nodeId) ?? 0) + 1;
    if (newCount > this.options.maxVisitsPerNode) {
      throw new InfiniteLoopError(nodeId, newCount, this.options.maxVisitsPerNode);
    }
    this._previous = this._current;
    this._current = nodeId;
    this._next = null;
    this._steps += 1;
    this.recordVisit(nodeId);
    this.path.push(nodeId);
  }

  /** Mark the cursor as finished (no current node). */
  public finish(): void {
    this._previous = this._current;
    this._current = null;
    this._next = null;
  }

  /** Immutable snapshot of cursor state. */
  public snapshot(): CursorSnapshot {
    return Object.freeze({
      currentNodeId: this._current,
      previousNodeId: this._previous,
      nextNodeId: this._next,
      path: Object.freeze([...this.path]),
      visitCounts: Object.freeze(Object.fromEntries(this.visitCounts)),
      steps: this._steps,
    });
  }

  /* ─── internals ────────────────────────────────────────────────────── */

  private recordVisit(nodeId: string): void {
    this.visitCounts.set(nodeId, (this.visitCounts.get(nodeId) ?? 0) + 1);
  }
}

/** Convenience factory. */
export function createExecutionCursor(
  options: Partial<ExecutionCursorOptions> = {},
): ExecutionCursor {
  return new ExecutionCursor(options);
}
