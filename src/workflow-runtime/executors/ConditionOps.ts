/**
 * ARM ERP — Workflow Runtime V1 Condition Operators
 *
 * Pure functions for evaluating {@link ConditionOperator} predicates.
 * Shared by IfExecutor and SwitchExecutor (and any future branching node).
 *
 * String operators are null-safe; numeric comparisons return false instead
 * of throwing when operands aren't comparable.
 *
 * @module workflow-runtime/executors/ConditionOps
 */

import {
  type ConditionOperator,
  type VariableValue,
} from '../types/runtime.types';

/**
 * Apply a single operator to actual vs expected values.
 * Pure, side-effect-free.
 */
export function applyCondition(
  operator: ConditionOperator,
  actual: VariableValue,
  expected: VariableValue,
): boolean {
  switch (operator) {
    case '==':
      return looseEqual(actual, expected);
    case '!=':
      return !looseEqual(actual, expected);

    case '>':
      return compareNumeric(actual, expected) > 0;
    case '<':
      return compareNumeric(actual, expected) < 0;
    case '>=':
      return compareNumeric(actual, expected) >= 0;
    case '<=':
      return compareNumeric(actual, expected) <= 0;

    case 'contains':
      return contains(actual, expected);
    case 'startsWith':
      return typeof actual === 'string' && actual.startsWith(String(expected ?? ''));
    case 'endsWith':
      return typeof actual === 'string' && actual.endsWith(String(expected ?? ''));

    case 'isEmpty':
      return isEmpty(actual);
    case 'isNotEmpty':
      return !isEmpty(actual);

    case 'exists':
      return actual !== undefined && actual !== null;

    default:
      return false;
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function looseEqual(a: VariableValue, b: VariableValue): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

/** Returns NaN-safe numeric comparison, or 0 if either side isn't a number. */
function compareNumeric(a: VariableValue, b: VariableValue): number {
  const na = toNumber(a);
  const nb = toNumber(b);
  if (na === null || nb === null) return 0;
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

function contains(a: VariableValue, b: VariableValue): boolean {
  if (a == null) return false;
  if (Array.isArray(a)) return a.some((item) => looseEqual(item, b));
  return String(a).includes(String(b ?? ''));
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
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== '' ? n : null;
  }
  return null;
}
