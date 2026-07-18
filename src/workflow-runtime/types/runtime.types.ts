/**
 * ARM ERP — Workflow Runtime V1 Type Definitions
 *
 * Pure TypeScript. No React, No UI, No Firebase, No Browser APIs.
 * Designed to execute identically in: Node.js, API Routes, Background Workers,
 * and future Queue Workers (Redis / Firebase).
 *
 * @module workflow-runtime/types/runtime.types
 */

/* ════════════════════════════════════════════════════════════════════════
   PART 1 — EXECUTION STATE MACHINE
   ════════════════════════════════════════════════════════════════════════ */

/**
 * State machine values for the runtime lifecycle.
 *
 * Legal transitions:
 *   Idle         → Initializing
 *   Initializing → Running | Failed
 *   Running      → Waiting | Paused | Completed | Failed | Cancelled
 *   Waiting      → Running | Cancelled
 *   Paused       → Running | Cancelled
 *   Completed    → (terminal)
 *   Failed       → (terminal)
 *   Cancelled    → (terminal)
 */
export type ExecutionState =
  | 'Idle'
  | 'Initializing'
  | 'Running'
  | 'Waiting'
  | 'Paused'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

/** Terminal states — no further transitions possible. */
export const TERMINAL_STATES: ReadonlySet<ExecutionState> = new Set([
  'Completed',
  'Failed',
  'Cancelled',
]);

/** States considered "in flight" (not idle, not terminal). */
export const ACTIVE_STATES: ReadonlySet<ExecutionState> = new Set([
  'Initializing',
  'Running',
  'Waiting',
  'Paused',
]);

/* ════════════════════════════════════════════════════════════════════════
   PART 2 — VARIABLE SCOPES
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Variable scope precedence (lowest → highest precedence):
 *   global < workflow < execution < temp < nodeOutput
 */
export type VariableScope = 'global' | 'workflow' | 'execution' | 'temp' | 'nodeOutput';

export const SCOPE_PRECEDENCE: ReadonlyArray<VariableScope> = [
  'global',
  'workflow',
  'execution',
  'temp',
  'nodeOutput',
];

/** JSON-serializable value supported by the variable engine. */
export type VariableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | VariableValue[]
  | { [key: string]: VariableValue };

/* ════════════════════════════════════════════════════════════════════════
   PART 3 — GRAPH MODEL (minimal runtime contract)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Node kind recognized by the runtime's control-flow logic.
 * The runtime classifies nodes only by control-flow behaviour — it does not
 * know business-specific action types. Those live in the ExecutorRegistry.
 */
export type RuntimeNodeKind =
  | 'start'
  | 'end'
  | 'action'
  | 'condition'
  | 'switch'
  | 'delay'
  | 'wait'
  | 'parallel'
  | 'subprocess';

/** A node in the runtime graph. */
export interface RuntimeNode {
  id: string;
  kind: RuntimeNodeKind;
  /** Business action type — used to look up the executor. */
  type?: string;
  /** Branches for condition/switch nodes. */
  branches?: RuntimeBranch[];
  /** Ordered next targets for non-conditional flow. */
  next?: string[];
  /** Optional configuration payload handed to the executor. */
  config?: Record<string, VariableValue>;
  /** Optional timeout in ms. */
  timeoutMs?: number;
  /** Optional human-readable label. */
  label?: string;
}

/** A branch produced by a condition/switch node. */
export interface RuntimeBranch {
  /** Target node id when this branch is taken. */
  targetNodeId: string;
  /** Operator for comparison. */
  operator: ConditionOperator;
  /** Field path resolved against the variable store. */
  field: string;
  /** Expected value. */
  expected: VariableValue;
  /** Optional label. */
  label?: string;
}

/** Directed edge. */
export interface RuntimeEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
}

/** Minimal workflow definition. */
export interface RuntimeWorkflow {
  id: string;
  version: number;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  startNodeId?: string;
  /** Optional metadata. */
  metadata?: Record<string, VariableValue>;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 4 — CONDITION MODEL
   ════════════════════════════════════════════════════════════════════════ */

export type ConditionOperator =
  | '=='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'exists';

export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: VariableValue;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 5 — RUNTIME CONTEXT
   ════════════════════════════════════════════════════════════════════════ */

/**
 * The RuntimeContext travels through the entire execution lifecycle.
 * It carries identity, status, position, history, logs, variables, metadata.
 */
export interface RuntimeContext {
  workflowId: string;
  workflowVersion: number;
  executionId: string;
  status: ExecutionState;
  currentNodeId: string | null;
  visitedNodes: string[];
  pendingNodes: string[];
  variables: VariableSnapshotScoped;
  executionHistory: HistoryEntry[];
  logs: LogEntry[];
  metadata: Record<string, VariableValue>;
  startedAt: number | null;
  endedAt: number | null;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 6 — VARIABLE SNAPSHOT
   ════════════════════════════════════════════════════════════════════════ */

/** Per-scope variable breakdown. */
export interface VariableSnapshotScoped {
  global: Record<string, VariableValue>;
  workflow: Record<string, VariableValue>;
  execution: Record<string, VariableValue>;
  temp: Record<string, VariableValue>;
  nodeOutput: Record<string, VariableValue>;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 7 — HISTORY & LOGS
   ════════════════════════════════════════════════════════════════════════ */

export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'waiting';

export interface HistoryEntry {
  stepIndex: number;
  nodeId: string;
  nodeKind: RuntimeNodeKind;
  nodeType?: string;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  input?: Record<string, VariableValue>;
  output?: Record<string, VariableValue>;
  error?: { code: string; message: string };
  branchLabel?: string;
}

/** Log levels supported by the ExecutionLogger. */
export type LogLevel = 'Debug' | 'Info' | 'Warning' | 'Error';

/** Structured log entry. */
export interface LogEntry {
  timestamp: number;
  workflowId: string;
  executionId: string;
  nodeId?: string;
  level: LogLevel;
  message: string;
  metadata?: Record<string, VariableValue>;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 8 — EXECUTOR CONTRACT
   ════════════════════════════════════════════════════════════════════════ */

/** Outcome of executing a single node. */
export type ExecutorOutcome = 'continue' | 'wait' | 'complete' | 'fail';

/** Result returned by an executor. */
export interface ExecutorResult {
  outcome: ExecutorOutcome;
  /** Next node id (when outcome is 'continue'); null otherwise. */
  nextNodeId?: string | null;
  /** Output to merge into nodeOutput scope. */
  output?: Record<string, VariableValue>;
  /** Branch label taken (for condition/switch nodes). */
  branchLabel?: string;
  /** Optional message. */
  message?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 9 — EVENT BUS
   ════════════════════════════════════════════════════════════════════════ */

/**
 * All events emitted by the runtime.
 * Event names use dot-notation as required by the spec.
 */
export type RuntimeEventType =
  | 'workflow.started'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.cancelled'
  | 'node.started'
  | 'node.completed'
  | 'node.failed'
  | 'variable.changed';

export interface RuntimeEvent {
  type: RuntimeEventType;
  executionId: string;
  workflowId: string;
  timestamp: number;
  nodeId?: string;
  payload?: Record<string, VariableValue>;
}

export type RuntimeEventSubscriber = (event: RuntimeEvent) => void;

/* ════════════════════════════════════════════════════════════════════════
   PART 10 — QUEUE MODEL
   ════════════════════════════════════════════════════════════════════════ */

export type QueuePriority = 'immediate' | 'delayed' | 'scheduled';

/** A single queued item. */
export interface QueueItem<TPayload = VariableValue> {
  id: string;
  priority: QueuePriority;
  runAt: number;
  enqueuedAt: number;
  payload: TPayload;
  attempts: number;
  topic?: string;
  cancelled?: boolean;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 11 — VALIDATION
   ════════════════════════════════════════════════════════════════════════ */

export interface ValidationResult {
  valid: boolean;
  errors: ValidationFailure[];
  warnings: ValidationFailure[];
}

export interface ValidationFailure {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 12 — RUNTIME CONFIG
   ════════════════════════════════════════════════════════════════════════ */

export interface RuntimeConfig {
  /** Max visits to any single node before raising an error. */
  maxNodeVisits: number;
  /** Hard ceiling on total steps in a single execution. */
  maxSteps: number;
  /** Hard ceiling on total wall-clock time, in ms. */
  maxExecutionMs: number;
  /** Whether to emit runtime events. */
  emitEvents: boolean;
  /** Whether to emit structured logs. */
  emitLogs: boolean;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  maxNodeVisits: 1_000,
  maxSteps: 5_000,
  maxExecutionMs: 10 * 60 * 1_000, // 10 minutes
  emitEvents: true,
  emitLogs: true,
};

/** Default node "type" to kind mapping for the standard executors. */
export const DEFAULT_NODE_TYPE_TO_KIND: Readonly<Record<string, RuntimeNodeKind>> = Object.freeze({
  start: 'start',
  end: 'end',
  if: 'condition',
  switch: 'switch',
  delay: 'delay',
  notify: 'action',
  setVariable: 'action',
  createCAPA: 'action',
  assign: 'action',
  placeholder: 'action',
  action: 'action',
  wait: 'wait',
  parallel: 'parallel',
  subprocess: 'subprocess',
});
