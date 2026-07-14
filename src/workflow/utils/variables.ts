/**
 * Workflow Variable Utilities
 * Type-safe variable resolution, system variables, and computed variable support.
 */

import type { WorkflowVariable, WorkflowContext, VariableType } from '../types';

// ── System Variables (injected automatically into every context) ──

export const SYSTEM_VARIABLES: WorkflowVariable[] = [
  { id: 'sys_now',          name: 'now',          type: 'date',    scope: 'system', description: 'Current timestamp', required: false },
  { id: 'sys_today',        name: 'today',        type: 'string',  scope: 'system', description: 'Current date YYYY-MM-DD', required: false },
  { id: 'sys_userId',       name: 'userId',       type: 'string',  scope: 'system', description: 'Current user ID', required: false },
  { id: 'sys_userRole',     name: 'userRole',     type: 'string',  scope: 'system', description: 'Current user role', required: false },
  { id: 'sys_instanceId',   name: 'instanceId',   type: 'string',  scope: 'system', description: 'Workflow instance ID', required: false },
  { id: 'sys_correlationId',name: 'correlationId',type: 'string',  scope: 'system', description: 'Correlation ID', required: false },
  { id: 'sys_workflowId',   name: 'workflowId',   type: 'string',  scope: 'system', description: 'Workflow definition ID', required: false },
];

export function injectSystemVariables(ctx: WorkflowContext): WorkflowContext {
  const now = new Date();
  return {
    ...ctx,
    variables: {
      ...ctx.variables,
      now: now.toISOString(),
      today: now.toISOString().split('T')[0],
      userId: ctx.userId,
      userRole: ctx.userRole,
      instanceId: ctx.instanceId,
      correlationId: ctx.correlationId,
      workflowId: ctx.workflowId,
    },
  };
}

// ── Type coercion ──

export function coerceVariable(value: unknown, type: VariableType): unknown {
  if (value === null || value === undefined) return value;
  switch (type) {
    case 'string':  return String(value);
    case 'number':  return Number(value);
    case 'boolean': return Boolean(value);
    case 'date':    return new Date(String(value)).toISOString();
    case 'array':   return Array.isArray(value) ? value : [value];
    case 'object':  return typeof value === 'object' ? value : {};
    default:        return value;
  }
}

// ── Validation ──

export function validateVariables(
  definitions: WorkflowVariable[],
  values: Record<string, unknown>
): string[] {
  const errors: string[] = [];
  for (const def of definitions) {
    if (def.required && def.scope === 'input') {
      if (values[def.name] === undefined || values[def.name] === null) {
        errors.push(`Required variable missing: ${def.name}`);
      }
    }
  }
  return errors;
}
