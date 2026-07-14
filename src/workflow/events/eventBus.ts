/**
 * Workflow Event Bus — Architecture Only
 * Interfaces and no-op stubs. Real implementation added when Event Bus is built.
 * Workflows subscribe to events and publish events through these interfaces.
 */

import type { WorkflowEvent, IWorkflowEventPublisher, IWorkflowEventSubscriber } from '../types';
import { createId } from '@paralleldrive/cuid2';

type EventHandler = (event: WorkflowEvent) => Promise<void>;

/** No-op publisher — replace with real bus (Redis, Firebase, etc.) */
class NoOpEventPublisher implements IWorkflowEventPublisher {
  async publish(event: WorkflowEvent): Promise<void> {
    // Future: publish to event bus
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[WorkflowEventBus] publish: ${event.type}`, event);
    }
  }
}

/** In-process subscriber — replace with real bus subscription */
class InProcessEventSubscriber implements IWorkflowEventSubscriber {
  private handlers = new Map<string, EventHandler[]>();

  subscribe(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, [...existing, handler]);
  }

  unsubscribe(eventType: string): void {
    this.handlers.delete(eventType);
  }

  async dispatch(event: WorkflowEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    await Promise.all(handlers.map((h) => h(event)));
  }
}

export const eventPublisher: IWorkflowEventPublisher = new NoOpEventPublisher();
export const eventSubscriber = new InProcessEventSubscriber();

export function buildWorkflowEvent(
  type: string,
  source: string,
  payload: Record<string, unknown>,
  workflowId?: string,
  instanceId?: string,
  correlationId?: string
): WorkflowEvent {
  return {
    id: `wf-evt-${createId()}`,
    type,
    source,
    workflowId: workflowId ?? null,
    instanceId: instanceId ?? null,
    correlationId: correlationId ?? createId(),
    payload,
    timestamp: new Date().toISOString(),
  };
}

// Well-known event type constants
export const WorkflowEventTypes = {
  WORKFLOW_STARTED:    'workflow.started',
  WORKFLOW_COMPLETED:  'workflow.completed',
  WORKFLOW_FAILED:     'workflow.failed',
  WORKFLOW_CANCELLED:  'workflow.cancelled',
  STEP_COMPLETED:      'workflow.step.completed',
  ACTION_EXECUTED:     'workflow.action.executed',
  APPROVAL_REQUESTED:  'workflow.approval.requested',
  APPROVAL_GRANTED:    'workflow.approval.granted',
  APPROVAL_REJECTED:   'workflow.approval.rejected',
} as const;
