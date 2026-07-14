/**
 * Workflow History Engine
 * Records execution summaries. Separate from audit (audit = every event, history = summary).
 */

import type {
  WorkflowHistoryEntry,
  WorkflowInstance,
  WorkflowStatus,
} from '../types';
import { generateHistoryId } from '../utils/ids';

export function buildHistoryEntry(
  instance: WorkflowInstance,
  workflowName: string,
  stepCount: number
): WorkflowHistoryEntry {
  const finishedAt = instance.finishedAt ?? new Date().toISOString();
  const duration = instance.startedAt
    ? new Date(finishedAt).getTime() - new Date(instance.startedAt).getTime()
    : null;

  return {
    id: generateHistoryId(),
    instanceId: instance.id,
    workflowId: instance.workflowId,
    workflowName,
    correlationId: instance.correlationId,
    status: instance.status,
    startedAt: instance.startedAt,
    finishedAt,
    duration,
    triggeredBy: instance.triggeredBy,
    actorId: instance.triggeredByUserId,
    actorName: instance.context.userId ?? null,
    stepCount,
    errorMessage: instance.errorMessage,
    createdAt: new Date().toISOString(),
  };
}

/** In-memory history store — replace with persistence adapter for production */
export class WorkflowHistoryStore {
  private entries: WorkflowHistoryEntry[] = [];

  add(entry: WorkflowHistoryEntry): void {
    this.entries.push(entry);
  }

  getByWorkflow(workflowId: string): WorkflowHistoryEntry[] {
    return this.entries.filter((e) => e.workflowId === workflowId);
  }

  getByStatus(status: WorkflowStatus): WorkflowHistoryEntry[] {
    return this.entries.filter((e) => e.status === status);
  }

  getByCorrelation(correlationId: string): WorkflowHistoryEntry[] {
    return this.entries.filter((e) => e.correlationId === correlationId);
  }

  getRecent(limit = 50): WorkflowHistoryEntry[] {
    return [...this.entries]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  getAll(): WorkflowHistoryEntry[] {
    return [...this.entries];
  }
}

export const workflowHistoryStore = new WorkflowHistoryStore();
