/**
 * ARM ERP — Workflow Runtime Foundation
 * Type Definitions (types/runtime.ts)
 *
 * Pure TypeScript. No React, No ReactFlow, No Firebase, No Browser APIs.
 * Designed to execute identically in: Node.js, API Routes, Background Workers,
 * and future Queue Workers.
 *
 * Architecture inspired by: Camunda, Temporal, Microsoft Power Automate, n8n.
 *
 * @module workflow-runtime/types
 */

/* ════════════════════════════════════════════════════════════════════════
   PART 1 — EXECUTION STATUS (State Machine values)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * High-level lifecycle status of an ExecutionSession.
 *
 * State machine transitions:
 *   Idle → Running → Waiting → Running → Completed
 *   Idle → Running → Failed
 *   Idle → Running → Cancelled
 *
 * Terminal states: Completed, Failed, Cancelled.
 * Once terminal, an execution cannot be resumed.
 */
export type ExecutionStatus =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** A status from which no further transition is possible. */
export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/** A status that indicates the execution is in-flight (not idle, not terminal). */
export const ACTIVE_STATUSES: ReadonlySet<ExecutionStatus> = new Set([
  'running',
  'waiting',
]);

/* ════════════════════════════════════════════════════════════════════════
   PART 2 — VARIABLE SCOPES
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Variable scope precedence (lowest → highest precedence):
 *   global < workflow < execution < temp
 *
 * Higher-precedence scopes shadow lower-precedence keys on resolution.
 */
export type VariableScope = 'global' | 'workflow' | 'execution' | 'temp';

/** Order of precedence — later entries win. */
export const SCOPE_PRECEDENCE: ReadonlyArray<VariableScope> = [
  'global',
  'workflow',
  'execution',
  'temp',
];

/** Serializable JSON value supported by the variable engine. */
export type VariableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | VariableValue[]
  | { [key: string]: VariableValue };

/** Metadata captured for each variable on read/write. */
export interface VariableEntry {
  scope: VariableScope;
  value: VariableValue;
  /** Epoch ms of the most recent write. */
  updatedAt: number;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 3 — GRAPH MODEL (minimal contract the runtime consumes)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Node "kind" recognized by the runtime's control-flow logic.
 * The runtime intentionally does NOT know business action types — it only
 * classifies nodes by control-flow behaviour.
 */
export type RuntimeNodeKind =
  | 'start'       // entry node — exactly one per workflow
  | 'end'         // terminal node — completes the execution
  | 'action'      // performs work via the ActionDispatcher
  | 'condition'   // branches the flow based on a predicate
  | 'wait'        // pauses execution until an external signal
  | 'parallel'    // fan-out / fan-in (architecture only)
  | 'subprocess'; // delegates to another workflow (architecture only)

/** A branch produced by a condition node. */
export interface RuntimeBranch {
  /** Target node id when this branch is taken. */
  targetNodeId: string;
  /** Operator used to evaluate {@link RuntimeBranch.expected} against actual. */
  operator: ConditionOperator;
  /** Field path resolved against the variable/context store. */
  field: string;
  /** Expected value the field is compared against. */
  expected: VariableValue;
  /** Optional human-readable label (e.g. "نعم", "Yes"). */
  label?: string;
}

/**
 * Minimal contract every graph node must satisfy for the runtime.
 *
 * The runtime is agnostic to the visual-builder's VBNode shape; adapters
 * translate between the two. Only these fields are required for execution.
 */
export interface RuntimeNode {
  id: string;
  kind: RuntimeNodeKind;
  /** Business action key (only meaningful when {@link kind} === 'action'). */
  actionType?: string;
  /** Branches (only meaningful when {@link kind} === 'condition'). */
  branches?: RuntimeBranch[];
  /** Ordered target ids for non-conditional flow (action → next). */
  next?: string[];
  /** Optional action configuration payload (passed to the dispatcher). */
  config?: Readonly<Record<string, VariableValue>>;
  /** Optional timeout in milliseconds for the node. */
  timeoutMs?: number;
}

/** Directed edge in the runtime graph (mostly informational). */
export interface RuntimeEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

/** The minimal workflow definition consumed by the runtime. */
export interface RuntimeWorkflow {
  id: string;
  version: number;
  nodes: RuntimeNode[];
  edges: RuntimeEdge[];
  /** Optional entry-point override (defaults to the first 'start' node). */
  startNodeId?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 4 — CONDITION MODEL
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Operators supported by the ConditionEvaluator.
 * String operators (contains/startsWith/endsWith/isEmpty/isNotEmpty/exists)
 * are null-safe.
 */
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

/** A single comparison predicate. */
export interface Condition {
  field: string;
  operator: ConditionOperator;
  value: VariableValue;
}

/** Boolean combinator for grouped conditions. */
export type ConditionLogic = 'and' | 'or' | 'not';

/** Recursive condition tree (AST). A leaf is a {@link Condition}. */
export type ConditionGroup = {
  logic: ConditionLogic;
  children: Array<Condition | ConditionGroup>;
};

/* ════════════════════════════════════════════════════════════════════════
   PART 5 — CONTEXT (generic business payload carrier)
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Generic execution context. The runtime NEVER imports business module
 * implementations — every module is an opaque keyed namespace here.
 *
 * Common namespaces: employee, request, capa, complaint, risk, travel,
 * user, department, environment. `payload` is a free-form escape hatch.
 */
export interface WorkflowContext {
  readonly executionId: string;
  readonly workflowId: string;
  readonly tenantId?: string;
  readonly triggeredBy?: string;
  readonly triggeredAt: Date;
  readonly environment: Readonly<Record<string, VariableValue>>;
  readonly employee?: Record<string, VariableValue>;
  readonly request?: Record<string, VariableValue>;
  readonly capa?: Record<string, VariableValue>;
  readonly complaint?: Record<string, VariableValue>;
  readonly risk?: Record<string, VariableValue>;
  readonly travel?: Record<string, VariableValue>;
  readonly user?: Record<string, VariableValue>;
  readonly department?: Record<string, VariableValue>;
  /** Free-form payload for anything not covered by a typed namespace. */
  readonly payload?: Record<string, VariableValue>;
}

/** Factory input used to build a {@link WorkflowContext}. */
export interface WorkflowContextInput {
  workflowId: string;
  executionId: string;
  tenantId?: string;
  triggeredBy?: string;
  environment?: Record<string, VariableValue>;
  employee?: Record<string, VariableValue>;
  request?: Record<string, VariableValue>;
  capa?: Record<string, VariableValue>;
  complaint?: Record<string, VariableValue>;
  risk?: Record<string, VariableValue>;
  travel?: Record<string, VariableValue>;
  user?: Record<string, VariableValue>;
  department?: Record<string, VariableValue>;
  payload?: Record<string, VariableValue>;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 6 — DISPATCHER CONTRACTS
   ════════════════════════════════════════════════════════════════════════ */

/** Outcome categories an action dispatch may produce. */
export type ActionOutcome = 'success' | 'failure' | 'waiting' | 'skipped';

/** Structured result of dispatching an action. */
export interface ActionResult {
  outcome: ActionOutcome;
  /** Optional output payload to merge into the execution variable store. */
  output?: Record<string, VariableValue>;
  /** Human-readable reason (especially for failure/skipped/waiting). */
  message?: string;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Optional retryable flag for failure outcomes. */
  retryable?: boolean;
}

/**
 * Handler contract for a single action type. Business modules register
 * handlers; the dispatcher routes by {@link actionType}.
 */
export type ActionHandler = (
  actionType: string,
  context: WorkflowContext,
  config: Readonly<Record<string, VariableValue>>,
  variables: VariableSnapshotRead,
) => Promise<ActionResult> | ActionResult;

/** Identifiers of every supported trigger origin. */
export type TriggerKind =
  | 'manual'
  | 'schedule'
  | 'event'
  | 'webhook'
  | 'api'
  | 'system';

/** Description of a trigger that may start a workflow. */
export interface TriggerDescriptor {
  kind: TriggerKind;
  workflowId: string;
  /** Optional cron expression (for 'schedule'). */
  cron?: string;
  /** Optional event topic filter (for 'event'/'webhook'). */
  topic?: string;
  /** Initial payload seed (for variables). */
  payload?: Record<string, VariableValue>;
}

/** Outcome of evaluating a trigger. */
export type TriggerOutcome = 'fire' | 'skip' | 'defer';

/** Result returned by the TriggerDispatcher. */
export interface TriggerResult {
  outcome: TriggerOutcome;
  workflowId: string;
  payload?: Record<string, VariableValue>;
  reason?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 7 — QUEUE MODEL
   ════════════════════════════════════════════════════════════════════════ */

/** When a queued item becomes eligible for processing. */
export type QueuePriority = 'immediate' | 'delayed' | 'waiting' | 'scheduled';

/** A single queue entry. */
export interface QueueItem<TPayload = VariableValue> {
  id: string;
  priority: QueuePriority;
  /** Epoch ms when the item becomes runnable. */
  runAt: number;
  enqueuedAt: number;
  payload: TPayload;
  /** Optional number of prior dequeue attempts. */
  attempts: number;
  /** Optional topic / channel for filtering. */
  topic?: string;
}

/** Filter options for {@link RuntimeQueue.dequeue}. */
export interface QueueDequeueOptions {
  topic?: string;
  /** Upper bound on items to return. */
  limit?: number;
  /** Only items whose runAt <= this value (defaults to Date.now()). */
  asOf?: number;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 8 — EVENT BUS
   ════════════════════════════════════════════════════════════════════════ */

/** All events emitted by the runtime. */
export type RuntimeEventType =
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'execution_cancelled'
  | 'node_started'
  | 'node_completed'
  | 'node_failed'
  | 'variable_changed';

/** Discriminated union of all runtime events. */
export interface RuntimeEvent {
  type: RuntimeEventType;
  executionId: string;
  workflowId: string;
  timestamp: number;
  nodeId?: string;
  payload?: Record<string, VariableValue>;
}

/** Subscriber callback. */
export type RuntimeEventSubscriber = (event: RuntimeEvent) => void;

/* ════════════════════════════════════════════════════════════════════════
   PART 9 — HISTORY & EXECUTION ARTIFACTS
   ════════════════════════════════════════════════════════════════════════ */

/** Status of a single executed node. */
export type StepStatus = 'pending' | 'active' | 'completed' | 'failed' | 'skipped' | 'waiting';

/** One entry in the execution history for a node. */
export interface ExecutionStep {
  readonly stepIndex: number;
  readonly nodeId: string;
  readonly nodeKind: RuntimeNodeKind;
  readonly actionType?: string;
  readonly status: StepStatus;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly durationMs?: number;
  readonly input?: Readonly<Record<string, VariableValue>>;
  readonly output?: Readonly<Record<string, VariableValue>>;
  readonly error?: { code: string; message: string };
  /** Branch label taken (for condition nodes). */
  readonly branchLabel?: string;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 10 — VARIABLE SNAPSHOT
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Read-only view of the variable store used by handlers and conditions.
 * Returned by {@link VariableStore.snapshot}.
 */
export type VariableSnapshotRead = Readonly<Record<string, VariableValue>>;

/** Per-scope breakdown of a snapshot. */
export interface VariableSnapshotScoped {
  global: Readonly<Record<string, VariableValue>>;
  workflow: Readonly<Record<string, VariableValue>>;
  execution: Readonly<Record<string, VariableValue>>;
  temp: Readonly<Record<string, VariableValue>>;
}

/* ════════════════════════════════════════════════════════════════════════
   PART 11 — RUNTIME CONFIG
   ════════════════════════════════════════════════════════════════════════ */

/** Tunable limits applied across the runtime. */
export interface RuntimeConfig {
  /** Hard ceiling on the number of nodes a single execution may visit. */
  maxNodeVisits: number;
  /** Hard ceiling on total execution wall-clock time, in ms. */
  maxExecutionMs: number;
  /** Whether to emit runtime events. */
  emitEvents: boolean;
}

export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  maxNodeVisits: 1_000,
  maxExecutionMs: 5 * 60 * 1_000, // 5 minutes
  emitEvents: true,
};
