/**
 * ARM ERP — Workflow Runtime Event Bus
 *
 * Lightweight in-memory publish/subscribe system. No external dependencies.
 * Subscribers are invoked synchronously on publish — handlers must be
 * non-blocking (hand off async work via the queue).
 *
 * The bus is keyed by event type. Wildcard subscribers (`*`) receive every
 * event regardless of type. Unsubscribe returns a disposer for ergonomic
 * cleanup in `useEffect`-style lifecycles.
 *
 * @module workflow-runtime/events/RuntimeEvents
 */

import type { RuntimeEvent, RuntimeEventType, RuntimeEventSubscriber } from '../types/runtime';

type SubscriberHandle = number;

export class RuntimeEventBus {
  /** eventType → subscribers (or '*' for wildcard). */
  private readonly subscribers = new Map<RuntimeEventType | '*', Map<SubscriberHandle, RuntimeEventSubscriber>>();
  private nextHandle = 1;
  private muted = false;

  /** Subscribe to a specific event type (or '*' for all). Returns a disposer. */
  public subscribe(eventType: RuntimeEventType | '*', fn: RuntimeEventSubscriber): () => void {
    const handle = this.nextHandle++;
    let bucket = this.subscribers.get(eventType);
    if (!bucket) {
      bucket = new Map();
      this.subscribers.set(eventType, bucket);
    }
    bucket.set(handle, fn);
    return () => this.unsubscribe(eventType, handle);
  }

  /** Remove a subscriber by its handle. */
  public unsubscribe(eventType: RuntimeEventType | '*', handle: SubscriberHandle): void {
    this.subscribers.get(eventType)?.delete(handle);
  }

  /** Publish an event to all matching subscribers. Errors in one handler do
   *  not stop other handlers — they are collected and re-thrown after. */
  public publish(event: RuntimeEvent): void {
    if (this.muted) return;
    const errors: unknown[] = [];
    const dispatch = (bucket: Map<SubscriberHandle, RuntimeEventSubscriber> | undefined) => {
      if (!bucket) return;
      bucket.forEach((fn) => {
        try {
          fn(event);
        } catch (err) {
          errors.push(err);
        }
      });
    };
    dispatch(this.subscribers.get(event.type));
    dispatch(this.subscribers.get('*'));
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      // Aggregate; re-throw the first with a count note.
      throw new Error(
        `RuntimeEventBus: ${errors.length} subscribers threw. First error: ${String(errors[0])}`,
      );
    }
  }

  /** Count of active subscribers (optionally filtered by type). */
  public subscriberCount(eventType?: RuntimeEventType | '*'): number {
    if (eventType) return this.subscribers.get(eventType)?.size ?? 0;
    let total = 0;
    this.subscribers.forEach((bucket) => (total += bucket.size));
    return total;
  }

  /** Temporarily mute the bus — useful in tests. Returns a restore fn. */
  public mute(): () => void {
    this.muted = true;
    return () => { this.muted = false; };
  }

  /** Remove every subscriber. */
  public clear(): void {
    this.subscribers.clear();
  }
}

/** Convenience factory. */
export function createRuntimeEventBus(): RuntimeEventBus {
  return new RuntimeEventBus();
}

/** Type guard for runtime event types. */
export function isRuntimeEventType(value: string): value is RuntimeEventType {
  return [
    'workflow_started',
    'workflow_completed',
    'workflow_failed',
    'execution_cancelled',
    'node_started',
    'node_completed',
    'node_failed',
    'variable_changed',
  ].includes(value as RuntimeEventType);
}
