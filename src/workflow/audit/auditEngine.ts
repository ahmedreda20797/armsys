/**
 * Workflow Audit Engine
 * Produces an immutable audit trail for every execution event.
 * Stored in-memory during execution; persisted via auditStore.
 */

import type {
  WorkflowAuditEntry,
  WorkflowAuditEvent,
  WorkflowContext,
} from '../types';
import { generateAuditId } from '../utils/ids';

export interface AuditEntryInput {
  instanceId: string;
  workflowId: string;
  correlationId: string;
  event: WorkflowAuditEvent;
  stepId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  decision?: string | null;
  error?: string | null;
  durationMs?: number | null;
}

export function buildAuditEntry(input: AuditEntryInput): WorkflowAuditEntry {
  return {
    id: generateAuditId(),
    instanceId: input.instanceId,
    workflowId: input.workflowId,
    correlationId: input.correlationId,
    event: input.event,
    stepId: input.stepId ?? null,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    before: input.before ?? null,
    after: input.after ?? null,
    decision: input.decision ?? null,
    error: input.error ?? null,
    timestamp: new Date().toISOString(),
    durationMs: input.durationMs ?? null,
  };
}

/** In-memory audit log per execution — flushed to persistence layer after completion */
export class ExecutionAuditLog {
  private entries: WorkflowAuditEntry[] = [];

  record(input: AuditEntryInput): WorkflowAuditEntry {
    const entry = buildAuditEntry(input);
    this.entries.push(entry);
    return entry;
  }

  getAll(): WorkflowAuditEntry[] {
    return [...this.entries];
  }

  getByEvent(event: WorkflowAuditEvent): WorkflowAuditEntry[] {
    return this.entries.filter((e) => e.event === event);
  }

  getErrors(): WorkflowAuditEntry[] {
    return this.entries.filter((e) => e.error !== null);
  }

  clear(): void {
    this.entries = [];
  }
}
