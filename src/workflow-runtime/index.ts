/**
 * ARM ERP — Workflow Runtime Foundation
 *
 * Public barrel. Single import point for the entire runtime:
 *
 *   import {
 *     createWorkflowRuntime,
 *     type RuntimeWorkflow,
 *     type WorkflowContextInput,
 *     NodeNotFoundError,
 *   } from '@/workflow-runtime';
 *
 * Pure TypeScript. No React, No ReactFlow, No Firebase, No Browser APIs.
 * Runs identically in Node.js, API Routes, Background Workers, and future
 * Queue Workers.
 *
 * @module workflow-runtime
 */

/* ─── Types ───────────────────────────────────────────────────────────── */
export * from './types/runtime';

/* ─── Errors ──────────────────────────────────────────────────────────── */
export {
  WorkflowRuntimeError,
  NodeNotFoundError,
  InfiniteLoopError,
  VariableMissingError,
  DispatcherError,
  InvalidTransitionError,
  WorkflowTimeoutError,
  RuntimeCancelledError,
  ConditionEvaluationError,
  TriggerError,
  isWorkflowRuntimeError,
  type WorkflowErrorDetails,
} from './errors/WorkflowError';

export {
  RetryPolicy,
  createRetryPolicy,
  DEFAULT_RETRY_POLICY,
  type RetryPolicyConfig,
  type RetryDecision,
  type BackoffStrategy,
} from './errors/RetryPolicy';

/* ─── Variables ───────────────────────────────────────────────────────── */
export {
  VariableStore,
  createVariableStore,
} from './variables/VariableStore';

export {
  VariableResolver,
  createVariableResolver,
  type ResolverSources,
  type ResolveOptions,
} from './variables/VariableResolver';

/* ─── Conditions ──────────────────────────────────────────────────────── */
export {
  ConditionEvaluator,
  createConditionEvaluator,
  applyOperator,
  type ConditionNode,
  type FieldLookup,
} from './conditions/ConditionEvaluator';

/* ─── Events ──────────────────────────────────────────────────────────── */
export {
  RuntimeEventBus,
  createRuntimeEventBus,
  isRuntimeEventType,
} from './events/RuntimeEvents';

/* ─── Queue ───────────────────────────────────────────────────────────── */
export {
  RuntimeQueue,
  createRuntimeQueue,
} from './queue/RuntimeQueue';

/* ─── Engine ──────────────────────────────────────────────────────────── */
export {
  createWorkflowContext,
  mergeWorkflowContext,
  getContextNamespace,
} from './engine/WorkflowContext';

export {
  canTransition,
  transition,
  isTerminal,
  isActive,
  getAllowedTransitions,
  StateTracker,
} from './engine/WorkflowState';

export {
  ExecutionCursor,
  createExecutionCursor,
  type CursorSnapshot,
  type ExecutionCursorOptions,
} from './engine/ExecutionCursor';

export {
  WorkflowExecutor,
  createWorkflowExecutor,
  type WorkflowExecutorPorts,
} from './engine/WorkflowExecutor';

export {
  WorkflowRuntime,
  createWorkflowRuntime,
  type WorkflowRuntimeOptions,
  type StartOptions,
} from './engine/WorkflowRuntime';

/* ─── Execution ───────────────────────────────────────────────────────── */
export {
  ExecutionSession,
  type ExecutionSessionOptions,
} from './execution/ExecutionSession';

export {
  ExecutionResult,
  buildExecutionResult,
  type ExecutionResultInput,
} from './execution/ExecutionResult';

export {
  ExecutionHistory,
  createExecutionHistory,
  type HistoryMetrics,
} from './execution/ExecutionHistory';

export {
  buildExecutionStep,
  startedStep,
  completeStep,
  failStep,
  type StepBuildInput,
} from './execution/ExecutionStep';

/* ─── Dispatchers ─────────────────────────────────────────────────────── */
export {
  ActionDispatcher,
  createActionDispatcher,
  type DispatchInput,
} from './dispatcher/ActionDispatcher';

export {
  TriggerDispatcher,
  createTriggerDispatcher,
  type TriggerContext,
  type TriggerResolver,
  type TriggerResolution,
} from './dispatcher/TriggerDispatcher';
