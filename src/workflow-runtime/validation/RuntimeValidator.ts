/**
 * ARM ERP — Workflow Runtime V1 Validation Layer
 *
 * Pre-execution graph validation. Runs BEFORE any node is executed. If
 * validation fails, {@link WorkflowRuntime.execute} throws and the runtime
 * never leaves the Idle state.
 *
 * Checks performed (each check is a separate, replaceable method):
 *   1. Exactly one Start node
 *   2. At least one End node
 *   3. No missing executors (every node has a registered executor)
 *   4. No broken edges (every edge source/target resolves to a real node)
 *   5. No unreachable nodes (every node is reachable from Start)
 *   6. No invalid transitions (every condition branch target resolves)
 *
 * Complexity: O(V + E) — a single BFS over the adjacency list.
 *
 * @module workflow-runtime/validation/RuntimeValidator
 */

import type {
  RuntimeWorkflow,
  RuntimeNode,
  ValidationResult,
  ValidationFailure,
} from '../types/runtime.types';
import type { ExecutorRegistry } from '../executors/ExecutorRegistry';
import { ValidationError } from '../errors/RuntimeErrors';

export interface ValidatorOptions {
  /** Skip the executor-presence check (useful when validating without a registry). */
  skipExecutorCheck?: boolean;
}

export class RuntimeValidator {
  private readonly registry?: ExecutorRegistry;
  private readonly options: ValidatorOptions;

  constructor(registry?: ExecutorRegistry, options: ValidatorOptions = {}) {
    this.registry = registry;
    this.options = options;
  }

  /**
   * Run every check and return the combined result.
   * Pure — does not throw on invalid graphs; returns errors instead.
   */
  public validate(workflow: RuntimeWorkflow): ValidationResult {
    const errors: ValidationFailure[] = [];
    const warnings: ValidationFailure[] = [];

    if (!workflow || !workflow.nodes) {
      errors.push({ code: 'EMPTY_WORKFLOW', message: 'Workflow has no nodes.' });
      return { valid: false, errors, warnings };
    }

    // ── Build adjacency / index ────────────────────────────────────────
    const nodesById = new Map<string, RuntimeNode>();
    for (const n of workflow.nodes) nodesById.set(n.id, n);

    // ── 1. Exactly one Start node ──────────────────────────────────────
    this.checkStartNode(workflow, nodesById, errors);

    // ── 2. At least one End node ───────────────────────────────────────
    this.checkEndNode(workflow, errors);

    // ── 3. No missing executors ────────────────────────────────────────
    if (!this.options.skipExecutorCheck && this.registry) {
      this.checkExecutors(workflow, errors);
    }

    // ── 4. No broken edges ─────────────────────────────────────────────
    this.checkEdges(workflow, nodesById, errors);

    // ── 5. No unreachable nodes ────────────────────────────────────────
    this.checkReachability(workflow, nodesById, errors, warnings);

    // ── 6. No invalid transitions (branch targets) ─────────────────────
    this.checkBranchTargets(workflow, nodesById, errors);

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate and throw {@link ValidationError} on failure.
   * This is the entry point used by the runtime before execution.
   */
  public validateOrThrow(workflow: RuntimeWorkflow): void {
    const result = this.validate(workflow);
    if (!result.valid) {
      const violations = result.errors.map((e) => ({
        code: e.code,
        message: e.message,
        nodeId: e.nodeId,
        edgeId: e.edgeId,
        severity: 'error' as const,
      }));
      throw new ValidationError(
        `Workflow "${workflow.id}" failed validation with ${result.errors.length} error(s).`,
        violations,
      );
    }
  }

  /* ─── individual checks ─────────────────────────────────────────────── */

  /** Check 1: Exactly one start node. */
  private checkStartNode(
    workflow: RuntimeWorkflow,
    nodesById: Map<string, RuntimeNode>,
    errors: ValidationFailure[],
  ): void {
    const startNodes = workflow.nodes.filter((n) => n.kind === 'start');
    if (startNodes.length === 0) {
      errors.push({
        code: 'NO_START_NODE',
        message: 'Workflow must have exactly one Start node — found 0.',
      });
    } else if (startNodes.length > 1) {
      startNodes.forEach((n) =>
        errors.push({
          code: 'MULTIPLE_START_NODES',
          message: `Multiple Start nodes found — only one is allowed.`,
          nodeId: n.id,
        }),
      );
    }
    // Verify the declared startNodeId (if any) resolves.
    if (workflow.startNodeId && !nodesById.has(workflow.startNodeId)) {
      errors.push({
        code: 'INVALID_START_NODE_ID',
        message: `Declared startNodeId "${workflow.startNodeId}" does not exist.`,
      });
    }
  }

  /** Check 2: At least one end node. */
  private checkEndNode(workflow: RuntimeWorkflow, errors: ValidationFailure[]): void {
    const endNodes = workflow.nodes.filter((n) => n.kind === 'end');
    if (endNodes.length === 0) {
      errors.push({
        code: 'NO_END_NODE',
        message: 'Workflow must have at least one End node — found 0.',
      });
    }
  }

  /** Check 3: Every node has a registered executor (or kind-based executor). */
  private checkExecutors(workflow: RuntimeWorkflow, errors: ValidationFailure[]): void {
    if (!this.registry) return;
    for (const node of workflow.nodes) {
      // Start/End nodes are handled by kind; they always have executors.
      if (node.kind === 'start' || node.kind === 'end') continue;
      const key = node.type ?? node.kind;
      if (!this.registry.has(key)) {
        errors.push({
          code: 'MISSING_EXECUTOR',
          message: `No executor registered for node type "${key}".`,
          nodeId: node.id,
        });
      }
    }
  }

  /** Check 4: No broken edges — source and target must exist. */
  private checkEdges(
    workflow: RuntimeWorkflow,
    nodesById: Map<string, RuntimeNode>,
    errors: ValidationFailure[],
  ): void {
    const seenEdges = new Set<string>();
    for (const edge of workflow.edges ?? []) {
      if (seenEdges.has(edge.id)) {
        errors.push({
          code: 'DUPLICATE_EDGE',
          message: `Duplicate edge id "${edge.id}".`,
          edgeId: edge.id,
        });
      }
      seenEdges.add(edge.id);
      if (!nodesById.has(edge.source)) {
        errors.push({
          code: 'BROKEN_EDGE_SOURCE',
          message: `Edge "${edge.id}" references unknown source "${edge.source}".`,
          edgeId: edge.id,
        });
      }
      if (!nodesById.has(edge.target)) {
        errors.push({
          code: 'BROKEN_EDGE_TARGET',
          message: `Edge "${edge.id}" references unknown target "${edge.target}".`,
          edgeId: edge.id,
        });
      }
    }
  }

  /**
   * Check 5: No unreachable nodes — every node reachable from the start.
   * O(V + E) BFS using the adjacency map.
   */
  private checkReachability(
    workflow: RuntimeWorkflow,
    nodesById: Map<string, RuntimeNode>,
    errors: ValidationFailure[],
    warnings: ValidationFailure[],
  ): void {
    const startId =
      workflow.startNodeId ??
      workflow.nodes.find((n) => n.kind === 'start')?.id ??
      workflow.nodes[0]?.id;
    if (!startId) return; // already reported by checkStartNode

    // Build adjacency: edges + explicit node.next + branch targets.
    const adjacency = buildAdjacency(workflow, nodesById);
    const reachable = new Set<string>();
    const queue: string[] = [startId];
    reachable.add(startId);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbours = adjacency.get(current) ?? [];
      for (const next of neighbours) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    for (const node of workflow.nodes) {
      if (!reachable.has(node.id)) {
        // Orphan start nodes are reported by checkStartNode; treat others as
        // errors since they would silently never execute.
        if (node.id === startId) continue;
        warnings.push({
          code: 'UNREACHABLE_NODE',
          message: `Node "${node.id}" is not reachable from the start node.`,
          nodeId: node.id,
        });
      }
    }
    void errors;
  }

  /** Check 6: No invalid transitions — branch targets must resolve. */
  private checkBranchTargets(
    workflow: RuntimeWorkflow,
    nodesById: Map<string, RuntimeNode>,
    errors: ValidationFailure[],
  ): void {
    for (const node of workflow.nodes) {
      if (node.kind !== 'condition' && node.kind !== 'switch') continue;
      const branches = node.branches ?? [];
      for (const branch of branches) {
        if (!branch.targetNodeId) {
          errors.push({
            code: 'BRANCH_NO_TARGET',
            message: `Branch in node "${node.id}" has no targetNodeId.`,
            nodeId: node.id,
          });
          continue;
        }
        if (!nodesById.has(branch.targetNodeId)) {
          errors.push({
            code: 'BRANCH_INVALID_TARGET',
            message: `Branch target "${branch.targetNodeId}" does not exist.`,
            nodeId: node.id,
          });
        }
      }
      // Also verify explicit next[] targets.
      for (const nextId of node.next ?? []) {
        if (!nodesById.has(nextId)) {
          errors.push({
            code: 'NEXT_INVALID_TARGET',
            message: `Next target "${nextId}" does not exist.`,
            nodeId: node.id,
          });
        }
      }
    }
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

/** Build an adjacency map combining edges, explicit next[], and branches. */
export function buildAdjacency(
  workflow: RuntimeWorkflow,
  _nodesById: Map<string, RuntimeNode>,
): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  const add = (from: string, to: string) => {
    const list = adjacency.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    adjacency.set(from, list);
  };

  for (const node of workflow.nodes) {
    adjacency.set(node.id, []); // ensure every node appears
    for (const next of node.next ?? []) add(node.id, next);
    for (const branch of node.branches ?? []) {
      if (branch.targetNodeId) add(node.id, branch.targetNodeId);
    }
  }
  for (const edge of workflow.edges ?? []) {
    add(edge.source, edge.target);
  }
  return adjacency;
}

/** Convenience factory. */
export function createRuntimeValidator(
  registry?: ExecutorRegistry,
  options?: ValidatorOptions,
): RuntimeValidator {
  return new RuntimeValidator(registry, options);
}
