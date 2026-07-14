/**
 * ARM ERP — Workflow Foundation
 * Single entry point. Import everything from here.
 *
 * Usage:
 *   import { WorkflowService, workflowRegistry, registerModuleWorkflow } from '@/workflow';
 */

// Types
export * from './types';

// Core
export { canTransition, transition, isTerminal, isActive, getAllowedTransitions } from './core/stateMachine';
export { assertWorkflowPermission, canPerformWorkflowAction, checkArmPermission } from './core/permissionGuard';

// Context
export { createWorkflowContext, setVariable, mergeVariables, resolveValue } from './context/contextFactory';

// Engine
export { workflowEngine, WorkflowEngine } from './engine/workflowEngine';
export { withRetry, shouldRetry, getBackoffDelay, buildWorkflowError, DEFAULT_RETRY_POLICY } from './engine/errorHandler';

// Registry
export { workflowRegistry, registerWorkflow } from './registry/workflowRegistry';

// Services
export { WorkflowService, registerVersion } from './services/workflowService';

// Conditions
export { conditionEvaluator, ConditionEvaluator } from './conditions/conditionEvaluator';

// Triggers
export { triggerEvaluator, TriggerEvaluator } from './triggers/triggerEvaluator';

// Actions
export { actionExecutor, ActionExecutor, registerActionHandler } from './actions/actionExecutor';

// History
export { workflowHistoryStore, buildHistoryEntry } from './history/historyEngine';

// Audit
export { ExecutionAuditLog, buildAuditEntry } from './audit/auditEngine';

// Events
export { eventPublisher, eventSubscriber, buildWorkflowEvent, WorkflowEventTypes } from './events/eventBus';

// Models
export { createDraftVersion, publishVersion, archiveVersion, rollbackToVersion, checkCompatibility } from './models/versionManager';
export { registerModuleWorkflow, OPEN_PERMISSIONS, ADMIN_ONLY_PERMISSIONS } from './models/moduleRegistration';

// Utils
export { generateExecutionId, generateCorrelationId, generateInstanceId, generateVersionId } from './utils/ids';
export { injectSystemVariables, coerceVariable, validateVariables, SYSTEM_VARIABLES } from './utils/variables';

// Hooks
export { useWorkflowStatus, useWorkflowExecution, useWorkflowRegistry, useWorkflowHistory, useWorkflowVariables } from './hooks/useWorkflow';
