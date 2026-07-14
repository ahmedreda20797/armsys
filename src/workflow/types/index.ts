/**
 * ARM ERP — Workflow Foundation
 * Core type definitions. No Firebase schema changes. Infrastructure only.
 */

// ─────────────────────────────────────────────────────────────
// ENUMS & LITERALS
// ─────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | 'draft'
  | 'published'
  | 'running'
  | 'paused'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'archived';

export type StepStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'waiting';

export type TriggerType =
  | 'manual'
  | 'button'
  | 'api'
  | 'scheduled'
  | 'realtime'
  | 'rule_engine'
  | 'notification'
  | 'approval'
  | 'status_change'
  | 'database_change'
  | 'user_action'
  | 'timer'
  | 'webhook';

export type ActionType =
  | 'assign_user'
  | 'create_follow_up'
  | 'create_capa'
  | 'send_notification'
  | 'send_email'
  | 'update_status'
  | 'create_request'
  | 'create_hr_action'
  | 'escalate'
  | 'generate_report'
  | 'log_event'
  | 'run_rule'
  | 'execute_workflow'
  | 'call_integration';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'in_list'
  | 'not_in_list'
  | 'empty'
  | 'not_empty'
  | 'between';

export type ConditionLogic = 'and' | 'or' | 'not';

export type VariableType = 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
export type VariableScope = 'input' | 'output' | 'computed' | 'system' | 'temp';

export type ErrorStrategy = 'retry' | 'recover' | 'rollback' | 'skip' | 'abort' | 'escalate';

export type WorkflowModule =
  | 'attendance'
  | 'complaints'
  | 'capa'
  | 'employee360'
  | 'risk'
  | 'hr'
  | 'travel'
  | 'quality'
  | 'requests'
  | 'follow_up'
  | 'notifications'
  | 'aocc'
  | 'system';

export type WorkflowAuditEvent =
  | 'workflow_started'
  | 'workflow_completed'
  | 'workflow_failed'
  | 'workflow_cancelled'
  | 'workflow_paused'
  | 'workflow_resumed'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'step_skipped'
  | 'condition_evaluated'
  | 'action_executed'
  | 'transition_taken'
  | 'variable_set'
  | 'assignment_made'
  | 'error_handled'
  | 'retry_attempted';

export type WorkflowErrorCategory =
  | 'validation_error'
  | 'permission_error'
  | 'action_error'
  | 'condition_error'
  | 'timeout_error'
  | 'system_error'
  | 'integration_error';

// ─────────────────────────────────────────────────────────────
// DOMAIN MODELS
// ─────────────────────────────────────────────────────────────

export interface WorkflowPermissions {
  canView: string[];
  canExecute: string[];
  canEdit: string[];
  canPublish: string[];
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  module: WorkflowModule;
  category: string;
  ownerId: string;
  ownerName: string;
  status: WorkflowStatus;
  currentVersionId: string;
  publishedVersionId: string | null;
  permissions: WorkflowPermissions;
  entryPoint: string;
  supportedEvents: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowConditionNode {
  id: string;
  logic?: ConditionLogic;
  operator?: ConditionOperator;
  field?: string;
  value?: unknown;
  valueTo?: unknown;
  children?: WorkflowConditionNode[];
}

export interface WorkflowAction {
  id: string;
  type: ActionType;
  name: string;
  config: Record<string, unknown>;
  outputVariable?: string;
}

export interface WorkflowAssignment {
  type: 'user' | 'role' | 'department' | 'dynamic';
  value: string;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  backoffMultiplier: number;
  maxBackoffMs: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  type: 'action' | 'condition' | 'wait' | 'parallel' | 'sub_workflow' | 'end';
  action?: WorkflowAction;
  condition?: WorkflowConditionNode;
  assignedTo?: WorkflowAssignment;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  onError: ErrorStrategy;
  metadata: Record<string, unknown>;
}

export interface WorkflowTransition {
  id: string;
  fromStepId: string;
  toStepId: string;
  condition?: WorkflowConditionNode;
  label: string;
  isDefault: boolean;
}

export interface WorkflowTrigger {
  id: string;
  type: TriggerType;
  name: string;
  config: Record<string, unknown>;
  conditions?: WorkflowConditionNode;
  isActive: boolean;
}

export interface WorkflowVariable {
  id: string;
  name: string;
  type: VariableType;
  scope: VariableScope;
  defaultValue?: unknown;
  description: string;
  required: boolean;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  label: string;
  status: 'draft' | 'published' | 'archived';
  steps: WorkflowStep[];
  transitions: WorkflowTransition[];
  variables: WorkflowVariable[];
  triggers: WorkflowTrigger[];
  publishedAt: string | null;
  publishedBy: string | null;
  createdAt: string;
  createdBy: string;
  changelog: string;
}

// ─────────────────────────────────────────────────────────────
// CONTEXT
// ─────────────────────────────────────────────────────────────

export interface WorkflowContext {
  executionId: string;
  correlationId: string;
  workflowId: string;
  versionId: string;
  instanceId: string;
  triggeredAt: string;
  triggeredBy: TriggerType;
  userId: string | null;
  userRole: string | null;
  userPermissions: Record<string, unknown>;
  employeeId: string | null;
  employeeName: string | null;
  department: string | null;
  requestId: string | null;
  riskId: string | null;
  capaId: string | null;
  complaintId: string | null;
  attendanceId: string | null;
  variables: Record<string, unknown>;
  metadata: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────
// INSTANCE & EXECUTION
// ─────────────────────────────────────────────────────────────

export interface WorkflowInstance {
  id: string;
  workflowId: string;
  versionId: string;
  correlationId: string;
  executionId: string;
  status: WorkflowStatus;
  currentStepId: string | null;
  context: WorkflowContext;
  startedAt: string;
  finishedAt: string | null;
  duration: number | null;
  triggeredBy: TriggerType;
  triggeredByUserId: string | null;
  parentInstanceId: string | null;
  retryCount: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StepExecution {
  stepId: string;
  stepName: string;
  status: StepStatus;
  startedAt: string;
  finishedAt: string | null;
  duration: number | null;
  actorId: string | null;
  decision: string | null;
  output: Record<string, unknown>;
  error: string | null;
  retryCount: number;
}

export interface WorkflowExecution {
  instanceId: string;
  currentStep: WorkflowStep | null;
  previousStepId: string | null;
  status: WorkflowStatus;
  context: WorkflowContext;
  startedAt: string;
  stepHistory: StepExecution[];
}

// ─────────────────────────────────────────────────────────────
// HISTORY & AUDIT
// ─────────────────────────────────────────────────────────────

export interface WorkflowHistoryEntry {
  id: string;
  instanceId: string;
  workflowId: string;
  workflowName: string;
  correlationId: string;
  status: WorkflowStatus;
  startedAt: string;
  finishedAt: string | null;
  duration: number | null;
  triggeredBy: TriggerType;
  actorId: string | null;
  actorName: string | null;
  stepCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface WorkflowAuditEntry {
  id: string;
  instanceId: string;
  workflowId: string;
  correlationId: string;
  event: WorkflowAuditEvent;
  stepId: string | null;
  actorId: string | null;
  actorName: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  decision: string | null;
  error: string | null;
  timestamp: string;
  durationMs: number | null;
}

// ─────────────────────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────────────────────

export interface WorkflowRegistryEntry {
  id: string;
  name: string;
  version: number;
  latestVersionId: string;
  ownerId: string;
  module: WorkflowModule;
  category: string;
  description: string;
  status: WorkflowStatus;
  permissions: WorkflowPermissions;
  entryPoint: string;
  supportedEvents: string[];
  registeredAt: string;
  updatedAt: string;
}

// ─────────────────────────────────────────────────────────────
// ERROR
// ─────────────────────────────────────────────────────────────

export interface WorkflowError {
  code: string;
  message: string;
  category: WorkflowErrorCategory;
  stepId: string | null;
  instanceId: string;
  strategy: ErrorStrategy;
  retryCount: number;
  timestamp: string;
  originalError?: unknown;
}

// ─────────────────────────────────────────────────────────────
// EVENT BUS (interfaces only — no implementation)
// ─────────────────────────────────────────────────────────────

export interface WorkflowEvent {
  id: string;
  type: string;
  source: string;
  workflowId: string | null;
  instanceId: string | null;
  correlationId: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface IWorkflowEventPublisher {
  publish(event: WorkflowEvent): Promise<void>;
}

export interface IWorkflowEventSubscriber {
  subscribe(eventType: string, handler: (event: WorkflowEvent) => Promise<void>): void;
  unsubscribe(eventType: string): void;
}

// ─────────────────────────────────────────────────────────────
// ENGINE INTERFACES
// ─────────────────────────────────────────────────────────────

export interface IWorkflowEngine {
  start(workflowId: string, context: Partial<WorkflowContext>): Promise<WorkflowInstance>;
  pause(instanceId: string): Promise<void>;
  resume(instanceId: string): Promise<void>;
  cancel(instanceId: string, reason: string): Promise<void>;
  getStatus(instanceId: string): Promise<WorkflowStatus>;
}

export interface IWorkflowRegistry {
  register(entry: WorkflowRegistryEntry): void;
  unregister(workflowId: string): void;
  get(workflowId: string): WorkflowRegistryEntry | undefined;
  getAll(): WorkflowRegistryEntry[];
  getByModule(module: WorkflowModule): WorkflowRegistryEntry[];
}

export interface IConditionEvaluator {
  evaluate(node: WorkflowConditionNode, context: WorkflowContext): boolean;
}

export interface IActionExecutor {
  execute(action: WorkflowAction, context: WorkflowContext): Promise<Record<string, unknown>>;
}

export interface ITriggerEvaluator {
  canTrigger(trigger: WorkflowTrigger, context: WorkflowContext): boolean;
}
