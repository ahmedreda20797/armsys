/**
 * Workflow Context Factory
 * Builds the immutable execution context that travels through every workflow step.
 */

import type { WorkflowContext, TriggerType } from '../types';
import { generateExecutionId, generateCorrelationId } from '../utils/ids';

export function createWorkflowContext(
  partial: Partial<WorkflowContext> & {
    workflowId: string;
    versionId: string;
    instanceId: string;
  }
): WorkflowContext {
  const now = new Date().toISOString();
  return {
    executionId: partial.executionId ?? generateExecutionId(),
    correlationId: partial.correlationId ?? generateCorrelationId(),
    workflowId: partial.workflowId,
    versionId: partial.versionId,
    instanceId: partial.instanceId,
    triggeredAt: partial.triggeredAt ?? now,
    triggeredBy: partial.triggeredBy ?? 'manual',
    userId: partial.userId ?? null,
    userRole: partial.userRole ?? null,
    userPermissions: partial.userPermissions ?? {},
    employeeId: partial.employeeId ?? null,
    employeeName: partial.employeeName ?? null,
    department: partial.department ?? null,
    requestId: partial.requestId ?? null,
    riskId: partial.riskId ?? null,
    capaId: partial.capaId ?? null,
    complaintId: partial.complaintId ?? null,
    attendanceId: partial.attendanceId ?? null,
    variables: { ...(partial.variables ?? {}) },
    metadata: Object.freeze({ ...(partial.metadata ?? {}) }),
  };
}

/** Produce a new context with updated mutable variables — metadata stays frozen */
export function setVariable(
  ctx: WorkflowContext,
  key: string,
  value: unknown
): WorkflowContext {
  return {
    ...ctx,
    variables: { ...ctx.variables, [key]: value },
  };
}

/** Merge multiple variable updates at once */
export function mergeVariables(
  ctx: WorkflowContext,
  updates: Record<string, unknown>
): WorkflowContext {
  return {
    ...ctx,
    variables: { ...ctx.variables, ...updates },
  };
}

/** Resolve a value that may be a variable reference (e.g. "{{employeeId}}") */
export function resolveValue(raw: unknown, ctx: WorkflowContext): unknown {
  if (typeof raw !== 'string') return raw;
  const match = raw.match(/^\{\{(.+?)\}\}$/);
  if (!match) return raw;
  const key = match[1].trim();
  if (key in ctx.variables) return ctx.variables[key];
  if (key in ctx) return (ctx as Record<string, unknown>)[key];
  return undefined;
}
