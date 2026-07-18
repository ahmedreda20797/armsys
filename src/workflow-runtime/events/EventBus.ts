/**
 * ARM ERP — Workflow Runtime V1 Event Bus
 *
 * Lightweight in-memory publish/subscribe. No external dependencies.
 * Uses the dot-notation event names from the spec:
 *
 *   workflow.started | workflow.completed | workflow.failed
 *   workflow.paused  | workflow.resumed   | workflow.cancelled
 *   node.started     | node.completed     | node.failed
 *   variable.changed
 *
 * Subscribers may listen to a specific type or '*' (wildcard) for all.
 * Publish calls are synchronous; handlers must be non-blocking (hand any
 * async work off to the queue).
 *
 * @module workflow-runtime/events/EventBus
 */

import type { RuntimeEvent, RuntimeEventType, RuntimeEventSubscriber } from '../types/runtime.types';

type SubscriberHandle = number;

export class EventBus {
  /** eventType → subscribers (or '*' for wildcard). */
  private readonly subscribers = new Map<
    RuntimeEventType | '*',
    Map<SubscriberHandle, RuntimeEventSubscriber>
  >();
  private nextHandle = 1;
  private muted = false;

  /**
   * Subscribe to a specific event type (or '*' for all).
   * Returns a disposer function for ergonomic cleanup.
   */
  public subscribe(
    eventType: RuntimeEventType | '*',
    fn: RuntimeEventSubscriber,
  ): () => void {
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

  /** Convenience: subscribe to many event types with one disposer. */
  public subscribeMany(
    eventTypes: RuntimeEventType[],
    fn: RuntimeEventSubscriber,
  ): () => void {
    const disposers = eventTypes.map((t) => this.subscribe(t, fn));
    return () => disposers.forEach((d) => d());
  }

  /**
   * Publish an event to all matching subscribers.
   * Errors in one handler do not stop other handlers — they are collected
   * and re-thrown after dispatch completes.
   */
  public publish(event: RuntimeEvent): void {
    if (this.muted) return;
    const errors: unknown[] = [];
    const dispatch = (
      bucket: Map<SubscriberHandle, RuntimeEventSubscriber> | undefined,
    ) => {
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
      throw new Error(
        `EventBus: ${errors.length} subscribers threw. First error: ${String(errors[0])}`,
      );
    }
  }

  /** Active subscriber count (optionally filtered by type). */
  public subscriberCount(eventType?: RuntimeEventType | '*'): number {
    if (eventType) return this.subscribers.get(eventType)?.size ?? 0;
    let total = 0;
    this.subscribers.forEach((bucket) => (total += bucket.size));
    return total;
  }

  /** Temporarily mute the bus (useful in tests). Returns a restore fn. */
  public mute(): () => void {
    this.muted = true;
    return () => {
      this.muted = false;
    };
  }

  /** Remove every subscriber. */
  public clear(): void {
    this.subscribers.clear();
  }
}

/** Convenience factory. */
export function createEventBus(): EventBus {
  return new EventBus();
}

/** Type guard for runtime event types. */
export function isRuntimeEventType(value: string): value is RuntimeEventType {
  return (
    value === 'workflow.started' ||
    value === 'workflow.completed' ||
    value === 'workflow.failed' ||
    value === 'workflow.paused' ||
    value === 'workflow.resumed' ||
    value === 'workflow.cancelled' ||
    value === 'node.started' ||
    value === 'node.completed' ||
    value === 'node.failed' ||
    value === 'variable.changed'
  );
}
