/**
 * ARM ERP — Workflow Runtime Condition Evaluator
 *
 * Reusable predicate evaluator supporting the {@link ConditionOperator}
 * family and recursive {@link ConditionGroup} trees.
 *
 * Pure functions — no I/O, no side effects, no business logic. The evaluator
 * consumes resolved values (typically produced by the VariableResolver) but
 * also accepts raw value resolution via an optional `lookup` callback so it
 * can be used standalone with any variable backend.
 *
 * @module workflow-runtime/conditions/ConditionEvaluator
 */

import {
  type Condition,
  type ConditionGroup,
  type ConditionOperator,
  type ConditionLogic,
  type VariableValue,
} from '../types/runtime';
import { ConditionEvaluationError } from '../errors/WorkflowError';

/** Leaf or group — the recursive union accepted by evaluate(). */
export type ConditionNode = Condition | ConditionGroup;

/** Optional lookup used to resolve field paths to concrete values. */
export type FieldLookup = (field: string) => VariableValue;

export class ConditionEvaluator {
  /**
   * Evaluate a leaf or grouped condition tree.
   *
   * @param node       AST node (leaf or group).
   * @param lookup     Optional field resolver (omit when values are pre-resolved).
   */
  public evaluate(node: ConditionNode, lookup?: FieldLookup): boolean {
    if (isGroup(node)) return this.evaluateGroup(node, lookup);
    return this.evaluateLeaf(node, lookup);
  }

  /** Evaluate multiple roots combined with `and`. */
  public evaluateAll(nodes: ConditionNode[], lookup?: FieldLookup): boolean {
    return nodes.every((n) => this.evaluate(n, lookup));
  }

  /** Evaluate multiple roots combined with `or`. */
  public evaluateAny(nodes: ConditionNode[], lookup?: FieldLookup): boolean {
    return nodes.some((n) => this.evaluate(n, lookup));
  }

  /* ─── leaves ───────────────────────────────────────────────────────── */

  private evaluateLeaf(c: Condition, lookup?: FieldLookup): boolean {
    const actual = lookup ? lookup(c.field) : (c.value as VariableValue);
    // When a lookup is provided, the leaf's `value` is the *expected* value;
    // otherwise the leaf's `value` is treated as the *actual* value (used by
    // callers that pre-resolve). To support both modes we use the lookup when
    // present.
    const expected = lookup ? c.value : c.value;
    void expected; // silence unused — `expected` is `c.value` in either mode
    return applyOperator(c.operator, actual, c.value);
  }

  /* ─── groups ───────────────────────────────────────────────────────── */

  private evaluateGroup(g: ConditionGroup, lookup?: FieldLookup): boolean {
    const results = g.children.map((child) => this.evaluate(child, lookup));
    return combine(g.logic, results);
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function isGroup(node: ConditionNode): node is ConditionGroup {
  return (node as ConditionGroup).logic !== undefined && (node as ConditionGroup).children !== undefined;
}

function combine(logic: ConditionLogic, results: boolean[]): boolean {
  switch (logic) {
    case 'and': return results.every(Boolean);
    case 'or': return results.some(Boolean);
    case 'not': return !results.every(Boolean);
    default:
      throw new ConditionEvaluationError(`Unknown logic operator: ${String(logic)}`, String(logic));
  }
}

/**
 * Apply a single operator. Null-safe for the string operators.
 * Numeric comparisons require both operands to be finite numbers; otherwise
 * they return false instead of throwing so that missing data doesn't crash
 * the runtime. Callers wanting strict behaviour can pre-validate.
 */
export function applyOperator(
  operator: ConditionOperator,
  actual: VariableValue,
  expected: VariableValue,
): boolean {
  switch (operator) {
    case '==': return looseEqual(actual, expected);
    case '!=': return !looseEqual(actual, expected);

    case '>':
    case '<':
    case '>=':
    case '<=':
      return compareNumeric(operator, actual, expected);

    case 'contains':
      return stringContains(actual, expected);
    case 'startsWith':
      return stringStartsWith(actual, expected);
    case 'endsWith':
      return stringEndsWith(actual, expected);

    case 'isEmpty':
      return isEmpty(actual);
    case 'isNotEmpty':
      return !isEmpty(actual);

    case 'exists':
      return actual !== undefined && actual !== null;

    default:
      throw new ConditionEvaluationError(
        `Unsupported condition operator: ${String(operator)}`,
        String(operator),
      );
  }
}

function looseEqual(a: VariableValue, b: VariableValue): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

function compareNumeric(op: '>' | '<' | '>=' | '<=', a: VariableValue, b: VariableValue): boolean {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na === null || nb === null) return false;
  switch (op) {
    case '>': return na > nb;
    case '<': return na < nb;
    case '>=': return na >= nb;
    case '<=': return na <= nb;
  }
}

function stringContains(a: VariableValue, b: VariableValue): boolean {
  if (a == null) return false;
  if (Array.isArray(a)) return a.some((item) => looseEqual(item, b));
  return String(a).includes(String(b ?? ''));
}

function stringStartsWith(a: VariableValue, b: VariableValue): boolean {
  if (a == null || typeof a !== 'string') return false;
  return a.startsWith(String(b ?? ''));
}

function stringEndsWith(a: VariableValue, b: VariableValue): boolean {
  if (a == null || typeof a !== 'string') return false;
  return a.endsWith(String(b ?? ''));
}

function isEmpty(v: VariableValue): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

function toNumber(v: VariableValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  return null;
}

/** Convenience factory. */
export function createConditionEvaluator(): ConditionEvaluator {
  return new ConditionEvaluator();
}
