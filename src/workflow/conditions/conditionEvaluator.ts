/**
 * Workflow Condition Engine
 * Evaluates nested condition trees (AND / OR / NOT + all operators).
 * Expression-tree ready. No side effects.
 */

import type {
  WorkflowConditionNode,
  WorkflowContext,
  IConditionEvaluator,
  ConditionOperator,
} from '../types';
import { resolveValue } from '../context/contextFactory';

function evalOperator(
  operator: ConditionOperator,
  fieldValue: unknown,
  targetValue: unknown,
  valueTo?: unknown
): boolean {
  switch (operator) {
    case 'equals':
      return fieldValue === targetValue;
    case 'not_equals':
      return fieldValue !== targetValue;
    case 'greater_than':
      return Number(fieldValue) > Number(targetValue);
    case 'less_than':
      return Number(fieldValue) < Number(targetValue);
    case 'between':
      return Number(fieldValue) >= Number(targetValue) && Number(fieldValue) <= Number(valueTo);
    case 'contains':
      return typeof fieldValue === 'string' && typeof targetValue === 'string'
        ? fieldValue.toLowerCase().includes(targetValue.toLowerCase())
        : false;
    case 'starts_with':
      return typeof fieldValue === 'string' && typeof targetValue === 'string'
        ? fieldValue.toLowerCase().startsWith(targetValue.toLowerCase())
        : false;
    case 'ends_with':
      return typeof fieldValue === 'string' && typeof targetValue === 'string'
        ? fieldValue.toLowerCase().endsWith(targetValue.toLowerCase())
        : false;
    case 'in_list': {
      const list = Array.isArray(targetValue) ? targetValue : [targetValue];
      return list.some((v) => String(v) === String(fieldValue));
    }
    case 'not_in_list': {
      const list = Array.isArray(targetValue) ? targetValue : [targetValue];
      return !list.some((v) => String(v) === String(fieldValue));
    }
    case 'empty':
      return fieldValue === null || fieldValue === undefined || fieldValue === '' ||
        (Array.isArray(fieldValue) && fieldValue.length === 0);
    case 'not_empty':
      return fieldValue !== null && fieldValue !== undefined && fieldValue !== '' &&
        !(Array.isArray(fieldValue) && fieldValue.length === 0);
    default:
      return false;
  }
}

function getFieldValue(field: string, ctx: WorkflowContext): unknown {
  if (field in ctx.variables) return ctx.variables[field];
  if (field in ctx) return (ctx as Record<string, unknown>)[field];
  return undefined;
}

export class ConditionEvaluator implements IConditionEvaluator {
  evaluate(node: WorkflowConditionNode, ctx: WorkflowContext): boolean {
    // Leaf node — has an operator
    if (node.operator && node.field !== undefined) {
      const fieldValue = getFieldValue(node.field, ctx);
      const targetValue = resolveValue(node.value, ctx);
      const valueTo = node.valueTo !== undefined ? resolveValue(node.valueTo, ctx) : undefined;
      return evalOperator(node.operator, fieldValue, targetValue, valueTo);
    }

    // Group node — has logic + children
    if (node.logic && node.children && node.children.length > 0) {
      const results = node.children.map((child) => this.evaluate(child, ctx));
      switch (node.logic) {
        case 'and': return results.every(Boolean);
        case 'or':  return results.some(Boolean);
        case 'not': return !results[0];
      }
    }

    // Empty node defaults to true (no condition = always pass)
    return true;
  }
}

// Singleton for use across the engine
export const conditionEvaluator = new ConditionEvaluator();
