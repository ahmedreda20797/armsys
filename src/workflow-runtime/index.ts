/**
 * ARM ERP — Workflow Runtime V1
 *
 * Public barrel. Single import point for the entire runtime:
 *
 *   import {
 *     createWorkflowRuntime,
 *     type RuntimeWorkflow,
 *     type ExecuteResult,
 *     ValidationError,
 *   } from '@/workflow-runtime';
 *
 * Pure TypeScript. No React, No ReactFlow, No Firebase, No Browser APIs.
 * Runs identically in Node.js, API Routes, Background Workers, and future
 * Queue Workers (Redis / Firebase).
 *
 * @module workflow-runtime
 */

/* ─── Types ───────────────────────────────────────────────────────────── */

export type {
  ExecutionState,
  VariableScope,
  VariableValue,
  RuntimeNode,
  RuntimeNodeKind,
  RuntimeBranch,
  RuntimeEdge,
  RuntimeWorkflow,
  ConditionOperator,
  Condition,
  RuntimeContext as RuntimeContextDTO,
  VariableSnapshotScoped,
  HistoryEntry,
  StepStatus,
  LogLevel,
  LogEntry,
  ExecutorOutcome,
  ExecutorResult,
  RuntimeEventType,
  RuntimeEvent,
  RuntimeEventSubscriber,
  QueueItem,
  QueuePriority,
  ValidationResult,
  ValidationFailure,
  RuntimeConfig,
} from './types/runtime.types';

export {
  DEFAULT_RUNTIME_CONFIG,
  TERMINAL_STATES,
  ACTIVE_STATES,
  SCOPE_PRECEDENCE,
  DEFAULT_NODE_TYPE_TO_KIND,
} from './types/runtime.types';

/* ─── Errors ──────────────────────────────────────────────────────────── */

export {
  WorkflowRuntimeError,
  ValidationError,
  ExecutionError,
  TransitionError,
  QueueError,
  SerializationError,
  VariableMissingError,
  NodeNotFoundError,
  InfiniteLoopError,
  ExecutorNotRegisteredError,
  WorkflowTimeoutError,
  RuntimeCancelledError,
  isWorkflowRuntimeError,
  type ValidationViolation,
} from './errors/RuntimeErrors';

/* ─── Execution State Machine ─────────────────────────────────────────── */

export {
  canTransition,
  transition,
  isTerminal,
  isActive,
  getAllowedTransitions,
  StateTracker,
} from './engine/ExecutionState';

/* ─── Runtime Context ────────────────────────────────────────────────── */

export {
  RuntimeContext,
  createRuntimeContext,
  type RuntimeContextOptions,
} from './engine/RuntimeContext';

/* ─── Event Bus ──────────────────────────────────────────────────────── */

export {
  EventBus,
  createEventBus,
  isRuntimeEventType,
} from './events/EventBus';

/* ─── Variable Engine ────────────────────────────────────────────────── */

export {
  VariableResolver,
  createVariableResolver,
  type VariableSnapshot,
  type VariableUpdater,
} from './variables/VariableResolver';

/* ─── Execution Logger ────────────────────────────────────────────────── */

export {
  ExecutionLogger,
  createExecutionLogger,
  type LogSink,
  type LogContext,
  type ExecutionLoggerOptions,
} from './logging/ExecutionLogger';

/* ─── Execution Queue ─────────────────────────────────────────────────── */

export {
  ExecutionQueue,
  createExecutionQueue,
  type EnqueueOptions,
} from './queue/ExecutionQueue';

/* ─── Executors ──────────────────────────────────────────────────────── */

export {
  BaseExecutor,
  type ExecutorContext,
} from './executors/BaseExecutor';

export {
  ExecutorRegistry,
  createExecutorRegistry,
  autoRegister,
} from './executors/ExecutorRegistry';

export {
  StartExecutor,
  EndExecutor,
  IfExecutor,
  SwitchExecutor,
  DelayExecutor,
  NotifyExecutor,
  SetVariableExecutor,
  CreateCAPAExecutor,
  AssignExecutor,
  PlaceholderExecutor,
  registerStandardExecutors,
} from './executors/Executors';

export {
  applyCondition,
} from './executors/ConditionOps';

/* ─── Validation ──────────────────────────────────────────────────────── */

export {
  RuntimeValidator,
  createRuntimeValidator,
  buildAdjacency,
  type ValidatorOptions,
} from './validation/RuntimeValidator';

/* ─── Serialization ──────────────────────────────────────────────────── */

export {
  RuntimeSerializer,
  createRuntimeSerializer,
  type SerializedRuntime,
} from './serialization/RuntimeSerializer';

/* ─── Workflow Executor ──────────────────────────────────────────────── */

export {
  WorkflowExecutor,
  createWorkflowExecutor,
  type WorkflowExecutorPorts,
  type ExecutionOutcome,
} from './engine/WorkflowExecutor';

/* ─── Workflow Runtime ───────────────────────────────────────────────── */

export {
  WorkflowRuntime,
  createWorkflowRuntime,
  type WorkflowRuntimeOptions,
  type ExecuteOptions,
  type ExecuteResult,
} from './engine/WorkflowRuntime';
