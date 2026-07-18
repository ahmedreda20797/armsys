/**
 * ARM ERP — Workflow Runtime Context
 *
 * Factory + helpers for the generic {@link WorkflowContext}.
 *
 * The runtime never imports business module implementations. Every module
 * (Employee, Request, CAPA, Complaint, Risk, Travel, User, Department,
 * Environment, Current Date/Time, Custom Payload) is an opaque, keyed
 * namespace inside the context.
 *
 * @module workflow-runtime/engine/WorkflowContext
 */

import type { WorkflowContext, WorkflowContextInput, VariableValue } from '../types/runtime';

/**
 * Build an immutable {@link WorkflowContext}. Inputs are shallow-frozen so
 * handlers cannot mutate the caller's data structures.
 */
export function createWorkflowContext(input: WorkflowContextInput): WorkflowContext {
  return Object.freeze({
    executionId: input.executionId,
    workflowId: input.workflowId,
    tenantId: input.tenantId,
    triggeredBy: input.triggeredBy,
    triggeredAt: new Date(),
    environment: Object.freeze({ ...(input.environment ?? defaultEnvironment()) }),
    employee: freeze(input.employee),
    request: freeze(input.request),
    capa: freeze(input.capa),
    complaint: freeze(input.complaint),
    risk: freeze(input.risk),
    travel: freeze(input.travel),
    user: freeze(input.user),
    department: freeze(input.department),
    payload: freeze(input.payload),
  });
}

/** Merge two contexts into a new immutable instance (right wins). */
export function mergeWorkflowContext(
  base: WorkflowContext,
  patch: Partial<WorkflowContextInput>,
): WorkflowContext {
  return createWorkflowContext({
    executionId: patch.executionId ?? base.executionId,
    workflowId: patch.workflowId ?? base.workflowId,
    tenantId: patch.tenantId ?? base.tenantId,
    triggeredBy: patch.triggeredBy ?? base.triggeredBy,
    environment: { ...base.environment, ...(patch.environment ?? {}) },
    employee: { ...(base.employee ?? {}), ...(patch.employee ?? {}) },
    request: { ...(base.request ?? {}), ...(patch.request ?? {}) },
    capa: { ...(base.capa ?? {}), ...(patch.capa ?? {}) },
    complaint: { ...(base.complaint ?? {}), ...(patch.complaint ?? {}) },
    risk: { ...(base.risk ?? {}), ...(patch.risk ?? {}) },
    travel: { ...(base.travel ?? {}), ...(patch.travel ?? {}) },
    user: { ...(base.user ?? {}), ...(patch.user ?? {}) },
    department: { ...(base.department ?? {}), ...(patch.department ?? {}) },
    payload: { ...(base.payload ?? {}), ...(patch.payload ?? {}) },
  });
}

/** Read a namespace by name (useful for adapters). */
export function getContextNamespace(
  ctx: WorkflowContext,
  name: string,
): Readonly<Record<string, VariableValue>> | undefined {
  switch (name) {
    case 'employee': return ctx.employee;
    case 'request': return ctx.request;
    case 'capa': return ctx.capa;
    case 'complaint': return ctx.complaint;
    case 'risk': return ctx.risk;
    case 'travel': return ctx.travel;
    case 'user': return ctx.user;
    case 'department': return ctx.department;
    case 'environment': return ctx.environment;
    case 'payload': return ctx.payload;
    default: return undefined;
  }
}

/* ─── internals ───────────────────────────────────────────────────────── */

function freeze<T extends Record<string, VariableValue> | undefined>(
  v: T,
): Readonly<Record<string, VariableValue>> | undefined {
  return v ? Object.freeze({ ...v }) : undefined;
}

function defaultEnvironment(): Record<string, VariableValue> {
  return {
    runtime: 'workflow-runtime',
    version: '1.0.0',
    timezone: 'UTC',
  };
}
