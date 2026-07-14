/**
 * Workflow Service
 * Public API surface for the workflow foundation.
 * All modules interact with workflows through this service only.
 */

import type {
  WorkflowContext,
  WorkflowInstance,
  WorkflowStatus,
  WorkflowModule,
  WorkflowRegistryEntry,
  WorkflowHistoryEntry,
} from '../types';
import { workflowEngine } from '../engine/workflowEngine';
import { workflowRegistry } from '../registry/workflowRegistry';
import { workflowHistoryStore } from '../history/historyEngine';
import { assertWorkflowPermission } from '../core/permissionGuard';
import { isTerminal } from '../core/stateMachine';

// Version store — in production, replace with Firebase-backed adapter
const versionStore = new Map<string, import('../types').WorkflowVersion>();

export function registerVersion(version: import('../types').WorkflowVersion): void {
  versionStore.set(version.id, version);
}

export const WorkflowService = {

  /** Start a workflow by ID. Validates permissions before execution. */
  async start(
    workflowId: string,
    ctx: Partial<WorkflowContext>
  ): Promise<WorkflowInstance> {
    const entry = workflowRegistry.get(workflowId);
    if (!entry) throw new Error(`Workflow not found: ${workflowId}`);

    const versionId = entry.latestVersionId;
    const version = versionStore.get(versionId);
    if (!version) throw new Error(`Version not found: ${versionId}`);

    // Permission check
    const mockCtx = { userRole: ctx.userRole ?? null, userId: ctx.userId ?? null } as WorkflowContext;
    assertWorkflowPermission(mockCtx, entry.permissions, 'execute');

    return workflowEngine.start(workflowId, ctx, version);
  },

  async pause(instanceId: string): Promise<void> {
    return workflowEngine.pause(instanceId);
  },

  async resume(instanceId: string): Promise<void> {
    return workflowEngine.resume(instanceId);
  },

  async cancel(instanceId: string, reason: string): Promise<void> {
    return workflowEngine.cancel(instanceId, reason);
  },

  async getStatus(instanceId: string): Promise<WorkflowStatus> {
    return workflowEngine.getStatus(instanceId);
  },

  getInstance(instanceId: string): WorkflowInstance | undefined {
    return workflowEngine.getInstance(instanceId);
  },

  /** Get all registered workflows, optionally filtered by module */
  getRegistered(module?: WorkflowModule): WorkflowRegistryEntry[] {
    return module
      ? workflowRegistry.getByModule(module)
      : workflowRegistry.getAll();
  },

  /** Get execution history for a workflow */
  getHistory(workflowId: string): WorkflowHistoryEntry[] {
    return workflowHistoryStore.getByWorkflow(workflowId);
  },

  getRecentHistory(limit = 50): WorkflowHistoryEntry[] {
    return workflowHistoryStore.getRecent(limit);
  },
};
