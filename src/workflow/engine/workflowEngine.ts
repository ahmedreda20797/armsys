/**
 * Workflow Engine
 * The execution pipeline: validate → load context → evaluate trigger →
 * evaluate conditions → execute action → transition → repeat → finish.
 * Modular. Every stage is replaceable.
 */

import type {
  WorkflowInstance,
  WorkflowVersion,
  WorkflowContext,
  WorkflowStep,
  WorkflowStatus,
  StepExecution,
  IWorkflowEngine,
} from '../types';
import { createWorkflowContext, mergeVariables } from '../context/contextFactory';
import { conditionEvaluator } from '../conditions/conditionEvaluator';
import { triggerEvaluator } from '../triggers/triggerEvaluator';
import { actionExecutor } from '../actions/actionExecutor';
import { transition, isTerminal } from '../core/stateMachine';
import { ExecutionAuditLog } from '../audit/auditEngine';
import { buildHistoryEntry, workflowHistoryStore } from '../history/historyEngine';
import { workflowRegistry } from '../registry/workflowRegistry';
import { withRetry, DEFAULT_RETRY_POLICY } from './errorHandler';
import { generateInstanceId, generateExecutionId, generateCorrelationId } from '../utils/ids';

// In-memory instance store — replace with persistence adapter for production
const instanceStore = new Map<string, WorkflowInstance>();

export class WorkflowEngine implements IWorkflowEngine {

  // ── Start ──────────────────────────────────────────────────

  async start(
    workflowId: string,
    contextInput: Partial<WorkflowContext>,
    version: WorkflowVersion
  ): Promise<WorkflowInstance> {
    const registryEntry = workflowRegistry.get(workflowId);
    if (!registryEntry) throw new Error(`[WorkflowEngine] Workflow not registered: ${workflowId}`);

    const instanceId = generateInstanceId();
    const ctx = createWorkflowContext({
      ...contextInput,
      workflowId,
      versionId: version.id,
      instanceId,
      executionId: generateExecutionId(),
      correlationId: contextInput.correlationId ?? generateCorrelationId(),
    });

    // Evaluate triggers — at least one must fire
    const activeTrigger = version.triggers.find((t) => triggerEvaluator.canTrigger(t, ctx));
    if (!activeTrigger && version.triggers.length > 0) {
      throw new Error(`[WorkflowEngine] No trigger conditions met for workflow: ${workflowId}`);
    }

    const instance: WorkflowInstance = {
      id: instanceId,
      workflowId,
      versionId: version.id,
      correlationId: ctx.correlationId,
      executionId: ctx.executionId,
      status: 'running',
      currentStepId: registryEntry.entryPoint,
      context: ctx,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      duration: null,
      triggeredBy: ctx.triggeredBy,
      triggeredByUserId: ctx.userId,
      parentInstanceId: contextInput.metadata?.parentInstanceId as string ?? null,
      retryCount: 0,
      errorMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    instanceStore.set(instanceId, instance);

    const auditLog = new ExecutionAuditLog();
    auditLog.record({ instanceId, workflowId, correlationId: ctx.correlationId, event: 'workflow_started' });

    await this._runPipeline(instance, version, auditLog);

    return instanceStore.get(instanceId)!;
  }

  // ── Pipeline ───────────────────────────────────────────────

  private async _runPipeline(
    instance: WorkflowInstance,
    version: WorkflowVersion,
    auditLog: ExecutionAuditLog
  ): Promise<void> {
    const stepHistory: StepExecution[] = [];
    let currentStepId = instance.currentStepId;
    let ctx = instance.context;

    while (currentStepId) {
      const step = version.steps.find((s) => s.id === currentStepId);
      if (!step) break;
      if (step.type === 'end') {
        this._finalize(instance, 'completed', null, stepHistory, auditLog, version.workflowId);
        return;
      }

      const stepExec: StepExecution = {
        stepId: step.id,
        stepName: step.name,
        status: 'active',
        startedAt: new Date().toISOString(),
        finishedAt: null,
        duration: null,
        actorId: ctx.userId,
        decision: null,
        output: {},
        error: null,
        retryCount: 0,
      };

      auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: ctx.correlationId, event: 'step_started', stepId: step.id });

      try {
        // Evaluate step condition (if any)
        if (step.condition && !conditionEvaluator.evaluate(step.condition, ctx)) {
          stepExec.status = 'skipped';
          stepExec.decision = 'condition_false';
          auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: ctx.correlationId, event: 'step_skipped', stepId: step.id });
        } else if (step.action) {
          // Execute action with optional retry
          const policy = step.retryPolicy ?? DEFAULT_RETRY_POLICY;
          const output = await withRetry(
            () => actionExecutor.execute(step.action!, ctx),
            policy,
            (attempt) => {
              stepExec.retryCount = attempt;
              auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: ctx.correlationId, event: 'retry_attempted', stepId: step.id });
            }
          );

          stepExec.output = output;
          stepExec.status = 'completed';

          // Store action output in context variable if configured
          if (step.action.outputVariable) {
            ctx = mergeVariables(ctx, { [step.action.outputVariable]: output });
          }

          auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: ctx.correlationId, event: 'action_executed', stepId: step.id, after: output });
        } else {
          stepExec.status = 'completed';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        stepExec.status = 'failed';
        stepExec.error = message;
        auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: ctx.correlationId, event: 'step_failed', stepId: step.id, error: message });

        if (step.onError === 'abort') {
          this._finalize(instance, 'failed', message, stepHistory, auditLog, version.workflowId);
          return;
        }
        if (step.onError === 'skip') {
          stepExec.status = 'skipped';
        }
        // 'retry' already handled by withRetry above
      }

      stepExec.finishedAt = new Date().toISOString();
      stepExec.duration = new Date(stepExec.finishedAt).getTime() - new Date(stepExec.startedAt).getTime();
      stepHistory.push(stepExec);

      // Determine next step via transitions
      currentStepId = this._resolveNextStep(step.id, version, ctx);
      instance.currentStepId = currentStepId;
      instance.context = ctx;
      instance.updatedAt = new Date().toISOString();
      instanceStore.set(instance.id, instance);
    }

    this._finalize(instance, 'completed', null, stepHistory, auditLog, version.workflowId);
  }

  // ── Transition Resolution ──────────────────────────────────

  private _resolveNextStep(
    fromStepId: string,
    version: WorkflowVersion,
    ctx: WorkflowContext
  ): string | null {
    const candidates = version.transitions.filter((t) => t.fromStepId === fromStepId);
    if (candidates.length === 0) return null;

    // Evaluate conditional transitions first
    for (const t of candidates) {
      if (!t.isDefault && t.condition) {
        if (conditionEvaluator.evaluate(t.condition, ctx)) return t.toStepId;
      }
    }

    // Fall back to default transition
    const defaultTransition = candidates.find((t) => t.isDefault);
    return defaultTransition?.toStepId ?? null;
  }

  // ── Finalize ───────────────────────────────────────────────

  private _finalize(
    instance: WorkflowInstance,
    status: WorkflowStatus,
    errorMessage: string | null,
    stepHistory: StepExecution[],
    auditLog: ExecutionAuditLog,
    workflowName: string
  ): void {
    const finishedAt = new Date().toISOString();
    instance.status = status;
    instance.finishedAt = finishedAt;
    instance.duration = new Date(finishedAt).getTime() - new Date(instance.startedAt).getTime();
    instance.errorMessage = errorMessage;
    instance.updatedAt = finishedAt;
    instanceStore.set(instance.id, instance);

    const auditEvent = status === 'completed' ? 'workflow_completed' : 'workflow_failed';
    auditLog.record({ instanceId: instance.id, workflowId: instance.workflowId, correlationId: instance.correlationId, event: auditEvent, error: errorMessage });

    const historyEntry = buildHistoryEntry(instance, workflowName, stepHistory.length);
    workflowHistoryStore.add(historyEntry);
  }

  // ── Control ────────────────────────────────────────────────

  async pause(instanceId: string): Promise<void> {
    const inst = instanceStore.get(instanceId);
    if (!inst) throw new Error(`[WorkflowEngine] Instance not found: ${instanceId}`);
    inst.status = transition(inst.status, 'paused');
    inst.updatedAt = new Date().toISOString();
    instanceStore.set(instanceId, inst);
  }

  async resume(instanceId: string): Promise<void> {
    const inst = instanceStore.get(instanceId);
    if (!inst) throw new Error(`[WorkflowEngine] Instance not found: ${instanceId}`);
    inst.status = transition(inst.status, 'running');
    inst.updatedAt = new Date().toISOString();
    instanceStore.set(instanceId, inst);
  }

  async cancel(instanceId: string, reason: string): Promise<void> {
    const inst = instanceStore.get(instanceId);
    if (!inst) throw new Error(`[WorkflowEngine] Instance not found: ${instanceId}`);
    inst.status = transition(inst.status, 'cancelled');
    inst.errorMessage = reason;
    inst.finishedAt = new Date().toISOString();
    inst.updatedAt = new Date().toISOString();
    instanceStore.set(instanceId, inst);
  }

  async getStatus(instanceId: string): Promise<WorkflowStatus> {
    const inst = instanceStore.get(instanceId);
    if (!inst) throw new Error(`[WorkflowEngine] Instance not found: ${instanceId}`);
    return inst.status;
  }

  getInstance(instanceId: string): WorkflowInstance | undefined {
    return instanceStore.get(instanceId);
  }
}

export const workflowEngine = new WorkflowEngine();
