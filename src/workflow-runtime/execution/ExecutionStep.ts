/**
 * ARM ERP — Workflow Runtime Execution Step
 *
 * Builders for the {@link ExecutionStep} record produced at each node
 * visit. Steps are immutable value objects; the executor produces them
 * and appends them to {@link ExecutionHistory}.
 *
 * @module workflow-runtime/execution/ExecutionStep
 */

import type {
  ExecutionStep,
  RuntimeNodeKind,
  StepStatus,
  VariableValue,
} from '../types/runtime';

export interface StepBuildInput {
  stepIndex: number;
  nodeId: string;
  nodeKind: RuntimeNodeKind;
  actionType?: string;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  input?: Record<string, VariableValue>;
  output?: Record<string, VariableValue>;
  error?: { code: string; message: string };
  branchLabel?: string;
}

/** Build an immutable ExecutionStep. */
export function buildExecutionStep(input: StepBuildInput): ExecutionStep {
  const durationMs =
    input.endedAt !== undefined && input.startedAt !== undefined
      ? Math.max(0, input.endedAt - input.startedAt)
      : undefined;
  return Object.freeze({
    stepIndex: input.stepIndex,
    nodeId: input.nodeId,
    nodeKind: input.nodeKind,
    actionType: input.actionType,
    status: input.status,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    durationMs,
    input: input.input ? Object.freeze({ ...input.input }) : undefined,
    output: input.output ? Object.freeze({ ...input.output }) : undefined,
    error: input.error ? Object.freeze({ ...input.error }) : undefined,
    branchLabel: input.branchLabel,
  });
}

/** Convenience: build an in-progress step (no end time yet). */
export function startedStep(input: Omit<StepBuildInput, 'status' | 'endedAt'> & { status?: StepStatus }): ExecutionStep {
  return buildExecutionStep({ ...input, status: input.status ?? 'active' });
}

/** Convenience: build a completed step from an in-progress one. */
export function completeStep(
  step: ExecutionStep,
  opts: { endedAt?: number; output?: Record<string, VariableValue>; branchLabel?: string } = {},
): ExecutionStep {
  const endedAt = opts.endedAt ?? Date.now();
  return buildExecutionStep({
    stepIndex: step.stepIndex,
    nodeId: step.nodeId,
    nodeKind: step.nodeKind,
    actionType: step.actionType,
    status: 'completed',
    startedAt: step.startedAt,
    endedAt,
    input: step.input as Record<string, VariableValue> | undefined,
    output: opts.output,
    branchLabel: opts.branchLabel ?? step.branchLabel,
  });
}

/** Convenience: build a failed step from an in-progress one. */
export function failStep(step: ExecutionStep, error: { code: string; message: string }, endedAt?: number): ExecutionStep {
  return buildExecutionStep({
    stepIndex: step.stepIndex,
    nodeId: step.nodeId,
    nodeKind: step.nodeKind,
    actionType: step.actionType,
    status: 'failed',
    startedAt: step.startedAt,
    endedAt: endedAt ?? Date.now(),
    input: step.input as Record<string, VariableValue> | undefined,
    error,
  });
}
