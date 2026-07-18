/**
 * ARM ERP — Workflow Runtime Queue
 *
 * In-memory, priority-aware queue. No persistence, no workers — this is
 * pure scheduling infrastructure. Items become eligible for dequeue when
 * `runAt <= Date.now()` and (optionally) match the requested topic.
 *
 * Priority semantics:
 *   immediate → runAt = enqueuedAt
 *   delayed   → runAt = enqueuedAt + supplied delay
 *   waiting   → runAt = Number.POSITIVE_INFINITY until released via release()
 *   scheduled → runAt = caller-supplied timestamp
 *
 * @module workflow-runtime/queue/RuntimeQueue
 */

import {
  type QueueItem,
  type QueuePriority,
  type QueueDequeueOptions,
  type VariableValue,
} from '../types/runtime';

let sequence = 0;
function nextId(): string {
  sequence += 1;
  return `q_${Date.now().toString(36)}_${sequence.toString(36)}`;
}

export class RuntimeQueue<TPayload = VariableValue> {
  private readonly items: QueueItem<TPayload>[] = [];

  /** Enqueue an item with the given priority and optional delay/schedule. */
  public enqueue(
    payload: TPayload,
    priority: QueuePriority = 'immediate',
    opts: {
      delayMs?: number;
      runAt?: number;
      topic?: string;
    } = {},
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
    };
    this.items.push(item);
    return item;
  }

  /**
   * Dequeue eligible items. Items remain in the queue; the caller is
   * responsible for removing them via {@link ack} on success or {@link nack}
   * for retry.
   */
  public dequeue(opts: QueueDequeueOptions = {}): QueueItem<TPayload>[] {
    const asOf = opts.asOf ?? Date.now();
    const eligible = this.items.filter((item) => {
      if (item.runAt > asOf) return false;
      if (opts.topic && item.topic !== opts.topic) return false;
      return true;
    });
    // Stable sort by runAt then enqueue order.
    eligible.sort((a, b) => a.runAt - b.runAt || a.enqueuedAt - b.enqueuedAt);
    const limited = opts.limit ? eligible.slice(0, opts.limit) : eligible;
    limited.forEach((i) => (i.attempts += 1));
    return limited;
  }

  /** Mark an item as processed and remove it from the queue. */
  public ack(id: string): boolean {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    this.items.splice(idx, 1);
    return true;
  }

  /** Re-enqueue an item for retry (resets runAt using the supplied delay). */
  public nack(id: string, opts: { delayMs?: number } = {}): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.runAt = Date.now() + (opts.delayMs ?? 0);
    return true;
  }

  /** Release a `waiting` item so it becomes immediately eligible. */
  public release(id: string): boolean {
    const item = this.items.find((i) => i.id === id);
    if (!item) return false;
    item.runAt = Date.now();
    return true;
  }

  /** Peek without affecting attempt counters. */
  public peek(opts: QueueDequeueOptions = {}): QueueItem<TPayload>[] {
    const asOf = opts.asOf ?? Date.now();
    return this.items
      .filter((item) => item.runAt <= asOf && (!opts.topic || item.topic === opts.topic))
      .sort((a, b) => a.runAt - b.runAt || a.enqueuedAt - b.enqueuedAt);
  }

  /** Total items in the queue (regardless of eligibility). */
  public size(): number {
    return this.items.length;
  }

  /** Count of items eligible as of now (optionally filtered by topic). */
  public pending(topic?: string): number {
    const now = Date.now();
    return this.items.filter((i) => i.runAt <= now && (!topic || i.topic === topic)).length;
  }

  /** Remove all items. */
  public clear(): void {
    this.items.length = 0;
  }

  /* ─── internals ────────────────────────────────────────────────────── */

  private computeRunAt(
    priority: QueuePriority,
    now: number,
    opts: { delayMs?: number; runAt?: number },
  ): number {
    switch (priority) {
      case 'immediate': return now;
      case 'delayed': return now + Math.max(0, opts.delayMs ?? 0);
      case 'waiting': return Number.POSITIVE_INFINITY;
      case 'scheduled': return opts.runAt ?? now;
      default: return now;
    }
  }
}

/** Convenience factory. */
export function createRuntimeQueue<T = VariableValue>(): RuntimeQueue<T> {
  return new RuntimeQueue<T>();
}
