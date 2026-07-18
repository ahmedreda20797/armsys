/**
 * ARM ERP — Workflow Runtime V1 Executor Registry
 *
 * Registry Pattern implementation. The WorkflowRuntime asks the registry for
 * the executor that handles a given node type — never a switch statement.
 *
 * Registration is automatic: each concrete executor class registers itself
 * at module load (see {@link autoRegister}). New executors are added by
 * simply creating a class and registering it — the runtime never needs
 * modification (Open/Closed Principle).
 *
 * @module workflow-runtime/executors/ExecutorRegistry
 */

import type { RuntimeNode } from '../types/runtime.types';
import type { BaseExecutor } from './BaseExecutor';
import { ExecutorNotRegisteredError } from '../errors/RuntimeErrors';

/**
 * Registry of node executors keyed by node type.
 *
 * The registry stores executor INSTANCES (not classes) because executors
 * are stateless services and a single instance can serve every execution.
 */
export class ExecutorRegistry {
  /** nodeType → executor instance. */
  private readonly executors = new Map<string, BaseExecutor>();
  /** Optional fallback invoked when no executor matches. */
  private fallback?: BaseExecutor;

  /**
   * Register an executor instance. The executor's `type` becomes its key.
   * Returns the registry for chaining.
   */
  public register(executor: BaseExecutor): this {
    if (!executor.type) {
      throw new Error('Cannot register an executor without a `type`.');
    }
    this.executors.set(executor.type, executor);
    return this;
  }

  /** Register many executors at once. */
  public registerAll(executors: BaseExecutor[]): this {
    executors.forEach((e) => this.register(e));
    return this;
  }

  /** Remove an executor by node type. */
  public unregister(nodeType: string): boolean {
    return this.executors.delete(nodeType);
  }

  /** Install a fallback executor for unknown node types. */
  public setFallback(executor: BaseExecutor | undefined): this {
    this.fallback = executor;
    return this;
  }

  /** True when an executor (or fallback) is available for the node type. */
  public has(nodeType: string | undefined): boolean {
    if (!nodeType) return this.fallback !== undefined;
    return this.executors.has(nodeType) || this.fallback !== undefined;
  }

  /** List every registered node type. */
  public registeredTypes(): string[] {
    return [...this.executors.keys()];
  }

  /**
   * Resolve the executor for a node. Falls back to the placeholder/fallback
   * executor when no specific match exists.
   *
   * @throws ExecutorNotRegisteredError when no executor and no fallback.
   */
  public resolve(node: RuntimeNode): BaseExecutor {
    const nodeType = node.type ?? node.kind;
    const executor = this.executors.get(nodeType);
    if (executor) return executor;
    // Try kind-based lookup as a secondary resolution.
    const kindExecutor = this.executors.get(node.kind);
    if (kindExecutor) return kindExecutor;
    if (this.fallback) return this.fallback;
    throw new ExecutorNotRegisteredError(nodeType ?? node.kind, node.id);
  }

  /** Get an executor by exact node type (no fallback). */
  public get(nodeType: string): BaseExecutor | undefined {
    return this.executors.get(nodeType);
  }

  /** Remove every executor. */
  public clear(): void {
    this.executors.clear();
    this.fallback = undefined;
  }
}

/** Convenience factory. */
export function createExecutorRegistry(): ExecutorRegistry {
  return new ExecutorRegistry();
}

/**
 * Auto-register an executor instance with a registry.
 * Used by concrete executors to self-register on import.
 */
export function autoRegister(
  registry: ExecutorRegistry,
  executor: BaseExecutor,
): void {
  registry.register(executor);
}
