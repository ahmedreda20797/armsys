/**
 * ARM ERP — Workflow Runtime Trigger Dispatcher
 *
 * Architecture for deciding whether and how a workflow should be started in
 * response to an external signal. Supports the {@link TriggerKind} family.
 *
 * No business triggers are implemented here — only the routing infrastructure.
 * Callers register trigger resolvers (one per kind) which decide whether the
 * trigger should `fire`, `skip`, or `defer`. A central dispatcher merges the
 * resolver decision with global guards (e.g. feature flags) and returns a
 * final {@link TriggerResult}.
 *
 * @module workflow-runtime/dispatcher/TriggerDispatcher
 */

import type {
  TriggerKind,
  TriggerDescriptor,
  TriggerResult,
  TriggerOutcome,
  VariableValue,
} from '../types/runtime';
import { TriggerError } from '../errors/WorkflowError';

export interface TriggerContext {
  kind: TriggerKind;
  topic?: string;
  payload?: Record<string, VariableValue>;
  /** Arbitrary metadata (headers, source IP, etc.). */
  meta?: Record<string, VariableValue>;
  /** Epoch ms when the trigger was raised. */
  raisedAt: number;
}

/** Resolver for a single trigger kind. Returns a decision + optional payload. */
export type TriggerResolver = (ctx: TriggerContext) => TriggerResolution | Promise<TriggerResolution>;

export interface TriggerResolution {
  outcome: TriggerOutcome;
  /** Optional payload to seed execution variables (overrides descriptor.payload). */
  payload?: Record<string, VariableValue>;
  reason?: string;
}

export class TriggerDispatcher {
  private readonly resolvers = new Map<TriggerKind, TriggerResolver>();
  private readonly guards: Array<(ctx: TriggerContext) => boolean> = [];

  /** Register (or replace) a resolver for a trigger kind. */
  public registerResolver(kind: TriggerKind, resolver: TriggerResolver): this {
    this.resolvers.set(kind, resolver);
    return this;
  }

  /** Unregister a resolver. */
  public unregisterResolver(kind: TriggerKind): boolean {
    return this.resolvers.delete(kind);
  }

  /** Add a global guard that must return true for a trigger to fire. */
  public addGuard(guard: (ctx: TriggerContext) => boolean): this {
    this.guards.push(guard);
    return this;
  }

  /** True when a resolver is registered for the kind. */
  public canResolve(kind: TriggerKind): boolean {
    return this.resolvers.has(kind);
  }

  /**
   * Evaluate a trigger against its descriptor. Returns a {@link TriggerResult}
   * that the caller feeds to {@link WorkflowRuntime.start}.
   */
  public async evaluate(
    descriptor: TriggerDescriptor,
    ctx: TriggerContext,
  ): Promise<TriggerResult> {
    if (descriptor.kind !== ctx.kind) {
      return {
        outcome: 'skip',
        workflowId: descriptor.workflowId,
        reason: `Trigger kind mismatch (descriptor: ${descriptor.kind}, ctx: ${ctx.kind})`,
      };
    }
    if (!this.guards.every((g) => g(ctx))) {
      return {
        outcome: 'skip',
        workflowId: descriptor.workflowId,
        reason: 'Global guard rejected the trigger',
      };
    }
    const resolver = this.resolvers.get(ctx.kind);
    if (!resolver) {
      return {
        outcome: 'defer',
        workflowId: descriptor.workflowId,
        reason: `No resolver registered for trigger kind "${ctx.kind}"`,
      };
    }
    try {
      const resolution = await resolver(ctx);
      return {
        outcome: resolution.outcome,
        workflowId: descriptor.workflowId,
        payload: resolution.payload ?? descriptor.payload ?? ctx.payload,
        reason: resolution.reason,
      };
    } catch (err) {
      throw new TriggerError(
        ctx.kind,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /** List registered trigger kinds. */
  public registeredKinds(): TriggerKind[] {
    return [...this.resolvers.keys()];
  }
}

/** Convenience factory. */
export function createTriggerDispatcher(): TriggerDispatcher {
  return new TriggerDispatcher();
}
