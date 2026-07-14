/**
 * Workflow State Machine
 * Defines valid lifecycle transitions. Future states can be added by extending TRANSITIONS.
 */

import type { WorkflowStatus } from '../types';

type TransitionMap = Partial<Record<WorkflowStatus, WorkflowStatus[]>>;

const TRANSITIONS: TransitionMap = {
  draft:      ['published', 'archived'],
  published:  ['running', 'archived', 'draft'],
  running:    ['paused', 'waiting', 'completed', 'failed', 'cancelled'],
  paused:     ['running', 'cancelled'],
  waiting:    ['running', 'cancelled', 'failed'],
  completed:  ['archived'],
  failed:     ['running', 'archived'],
  cancelled:  ['archived'],
  archived:   [],
};

export function canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transition(current: WorkflowStatus, next: WorkflowStatus): WorkflowStatus {
  if (!canTransition(current, next)) {
    throw new Error(`[WorkflowStateMachine] Invalid transition: ${current} → ${next}`);
  }
  return next;
}

export function isTerminal(status: WorkflowStatus): boolean {
  return ['completed', 'failed', 'cancelled', 'archived'].includes(status);
}

export function isActive(status: WorkflowStatus): boolean {
  return ['running', 'paused', 'waiting'].includes(status);
}

export function getAllowedTransitions(status: WorkflowStatus): WorkflowStatus[] {
  return TRANSITIONS[status] ?? [];
}
