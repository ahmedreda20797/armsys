/**
 * ARM ERP — Workflow Runtime V1 Base Executor
 *
 * Strategy Pattern foundation. Every concrete node executor extends this
 * base class and implements {@link execute}.
 *
 * The runtime NEVER uses switch(actionType). It only asks the
 * {@link ExecutorRegistry} for the executor matching a node's type.
 *
 * Each executor receives:
 *   - the node being executed
 *   - the runtime context (variables, history, etc.)
 *   - the executor context (helper services: resolver, evaluator, logger)
 *
 * And returns an {@link ExecutorResult} that tells the runtime what to do next.
 *
 * @module workflow-runtime/executors/BaseExecutor
 */

import type {
  RuntimeNode,
  ExecutorResult,
  VariableValue,
} from '../types/runtime.types';
import type { RuntimeContext } from '../engine/RuntimeContext';
import type { ExecutionLogger } from '../logging/ExecutionLogger';

/**
 * Shared services handed to every executor. Keeping these in a single object
 * lets us add capabilities without changing executor signatures (OCP).
 */
export interface ExecutorContext {
  /** Logger scoped to this execution. */
  logger: ExecutionLogger;
  /** All registered executors (for nested dispatch / subprocess). */
  registry: import('./ExecutorRegistry').ExecutorRegistry;
}

/**
 * Abstract base for all node executors.
 *
 * Subclasses MUST:
 *   1. Set a static `nodeType` property
 *   2. Implement {@link execute}
 *
 * Subclasses MAY override {@link canHandle} for advanced type matching.
 */
export abstract class BaseExecutor {
  /** Node type this executor handles. Subclasses must declare as static. */
  public static readonly nodeType: string;

  /** The node type this instance handles (mirrors the static property). */
  public abstract readonly type: string;

  /** Whether this executor can handle the given node. */
  public canHandle(node: RuntimeNode): boolean {
    return node.type === this.type || node.kind === (this as unknown as { kind?: string }).kind;
  }

  /**
   * Execute the node and return the result.
   * Implementations MUST be side-effect-free except through the context.
   */
  public abstract execute(
    node: RuntimeNode,
    context: RuntimeContext,
    exec: ExecutorContext,
  ): Promise<ExecutorResult> | ExecutorResult;

  /* ─── shared helpers (available to all subclasses) ────────────────── */

  /**
   * Resolve the next node id for non-conditional flow.
   * Priority: explicit node.next[0], then graph edges by source.
   */
  protected resolveNext(node: RuntimeNode, context: RuntimeContext): string | null {
    if (node.next && node.next.length > 0) return node.next[0];
    const edge = context.workflow.edges.find((e) => e.source === node.id);
    return edge ? edge.target : null;
  }

  /** Resolve a config value, dereferencing any variable expressions. */
  protected resolveConfig(
    node: RuntimeNode,
    key: string,
    fallback?: VariableValue,
  ): VariableValue {
    const raw = node.config?.[key];
    if (raw === undefined) return fallback;
    if (typeof raw === 'string' && raw.startsWith('${') && raw.endsWith('}')) {
      const expr = raw.slice(2, -1);
      const v = contextVar(node, expr);
      if (v !== undefined) return v;
    }
    return raw;
  }
}

/** Resolve a variable expression against the runtime context. */
function contextVar(_node: RuntimeNode, expr: string): VariableValue {
  // Late import avoided to keep base class dependency-free; the resolver is
  // accessible through the RuntimeContext passed to execute(). Subclasses
  // that need this should use context.variables.get(expr) directly.
  void expr;
  return undefined;
}
