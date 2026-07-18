/**
 * ARM ERP — Workflow Runtime V1 Execution Queue
 *
 * In-memory, priority-aware execution queue.
 *
 * Public API:
 *   enqueue() | dequeue() | peek() | clear() | cancel() | size()
 *
 * The queue is intentionally storage-agnostic — it stores opaque payloads
 * and is designed so it can later be backed by Redis or Firebase without
 * changing any runtime code that depends on this interface.
 *
 * Priority semantics:
 *   immediate → runAt = enqueuedAt
 *   delayed   → runAt = enqueuedAt + supplied delay
 *   scheduled → runAt = caller-supplied timestamp
 *
 * @module workflow-runtime/queue/ExecutionQueue
 */

import {
  type QueueItem,
  type QueuePriority,
  type VariableValue,
} from '../types/runtime.types';
import { QueueError } from '../errors/RuntimeErrors';

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `q_${Date.now().toString(36)}_${sequence.toString(36)}`;
}

export interface EnqueueOptions {
  delayMs?: number;
  runAt?: number;
  topic?: string;
}

export class ExecutionQueue<TPayload = VariableValue> {
  private readonly items: QueueItem<TPayload>[] = [];

  /**
   * Enqueue an item with the given priority and optional delay/schedule.
   * Returns the created item.
   */
  public enqueue(
    payload: TPayload,
    priority: QueuePriority = 'immediate',
    opts: EnqueueOptions = {},
  ): QueueItem<TPayload> {
    const now = Date.now();
    const item: QueueItem<TPayload> = {
      id: nextId(),
      priority,
      enqueuedAt: now,
      runAt: this.computeRunAt(priority, now, opts),
      payload,
      attempts: 0,
      topic: opts.topic,
      cancelled: false,
    };
    this.items.push(item);
    return item;
  }

  /**
   * Dequeue eligible items (runAt <= now, topic filter, not cancelled).
   * Items remain in the queue — the caller removes them via {@link ack} on
   * success or {@link requeue} for retry.
   *
   * @throws QueueError when the queue is empty.
   */
  public dequeue(opts: { topic?: string; limit?: number; asOf?: number } = {}): QueueItem<TPayload>[] {
    if (this.items.length === 0) {
      throw new QueueError('Cannot dequeue from an empty queue', 'dequeue');
    }
    const asOf = opts.asOf ?? Date.now();
    const eligible = this.items.filter((item) => {
      if (item.cancelled) return false;
      if (item.runAt > asOf) return false;
      if (opts.topic && item.topic !== opts.topic) return false;
      return true;
    });
    // Stable sort by runAt then enqueue order for FIFO fairness.
    eligible.sort((a, b) => a.runAt - b.runAt || a.enqueuedAt - b.enqueuedAt);
    const limited = opts.limit ? eligible.slice(0, opts.limit) : eligible;
    limited.forEach((i) => (i.attempts += 1));
    return limited;
  }

  /** Peek without affecting attempt counters. */
  public peek(opts: { topic?: string; limit?: number; asOf?: number } = {}): QueueItem<TPayload>[] {
    const asOf = opts.asOf ?? Date.now();
    const matches = this.items.filter(
      (item) =>
        !item.cancelled &&
        item.runAt <= asOf &&
        (!opts.topic || item.topic === opts.topic),
    );
    matches.sort((a, b) => a.runAt - b.runAt || a.enqueuedAt - b.enqueuedAt);
    return opts.limit ? matches.slice(0, opts.limit) : matches;
  }

  /** Mark an item as processed and remove it from the queue. */
  public ack(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  /** Re-enqueue an item for retry (resets runAt using the supplied delay). */
  public requeue(id: string, opts: { delayMs?: number } = {}): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.runAt = Date.now() + Math.max(0, opts.delayMs ?? 0);
    return true;
  }

  /**
   * Cancel a queued item by id. Cancelled items are skipped during dequeue
   * but remain in the queue until {@link ack} / {@link clear} removes them.
   */
  public cancel(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.cancelled = true;
    return true;
  }

  /** Total items in the queue (cancelled + active). */
  public size(): number {
    return this.items.length;
  }

  /** Count of active (non-cancelled) items eligible as of now. */
  public pending(topic?: string): number {
    const now = Date.now();
    return this.items.filter(
      (i) => !i.cancelled && i.runAt <= now && (!topic || i.topic === topic),
    ).length;
  }

  /** Remove all items. */
  public clear(): void {
    this.items.length = 0;
  }

  /** All items (snapshot, including cancelled). */
  public snapshot(): readonly QueueItem<TPayload>[] {
    return [...this.items];
  }

  /* ─── internals ────────────────────────────────────────────────────── */

  private computeRunAt(
    priority: QueuePriority,
    now: number,
    opts: EnqueueOptions,
  ): number {
    switch (priority) {
      case 'immediate':
        return now;
      case 'delayed':
        return now + Math.max(0, opts.delayMs ?? 0);
      case 'scheduled':
        return opts.runAt ?? now;
      default:
        return now;
    }
  }
}

/** Convenience factory. */
export function createExecutionQueue<T = VariableValue>(): ExecutionQueue<T> {
  return new ExecutionQueue<T>();
}
