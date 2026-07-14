/**
 * Workflow ID utilities — deterministic, traceable IDs for every execution artifact.
 */

import { createId } from '@paralleldrive/cuid2';

export function generateExecutionId(): string {
  return `wf-exec-${createId()}`;
}

export function generateCorrelationId(): string {
  return `wf-corr-${createId()}`;
}

export function generateInstanceId(): string {
  return `wf-inst-${createId()}`;
}

export function generateVersionId(workflowId: string, version: number): string {
  return `${workflowId}-v${version}`;
}

export function generateAuditId(): string {
  return `wf-audit-${createId()}`;
}

export function generateHistoryId(): string {
  return `wf-hist-${createId()}`;
}

export function generateStepExecutionId(): string {
  return `wf-step-${createId()}`;
}
