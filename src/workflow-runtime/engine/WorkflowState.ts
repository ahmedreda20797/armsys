/**
 * ARM ERP — Workflow Runtime State Machine
 *
 * Pure, side-effect-free transition table for {@link ExecutionStatus}.
 *
 * Permitted transitions:
 *
 *   idle      → running
 *   running   → waiting
 *   waiting   → running
 *   running   → completed
 *   running   → failed
 *   running   → cancelled
 *   waiting   → cancelled
 *
 * Terminal states (completed / failed / cancelled) have no outgoing edges.
 * Any unlisted transition throws {@link InvalidTransitionError}.
 *
 * @module workflow-runtime/engine/WorkflowState
 */

import {
  type ExecutionStatus,
  TERMINAL_STATUSES,
  ACTIVE_STATUSES,
} from '../types/runtime';
import { InvalidTransitionError } from '../errors/WorkflowError';

/** Adjacency map of legal transitions. */
const TRANSITIONS: Readonly<Record<ExecutionStatus, ReadonlySet<ExecutionStatus>>> = Object.freeze({
  idle: Object.freeze(new Set<ExecutionStatus>(['running'])),
  running: Object.freeze(new Set<ExecutionStatus>(['waiting', 'completed', 'failed', 'cancelled'])),
  waiting: Object.freeze(new Set<ExecutionStatus>(['running', 'cancelled'])),
  completed: Object.freeze(new Set<ExecutionStatus>([])),
  failed: Object.freeze(new Set<ExecutionStatus>([])),
  cancelled: Object.freeze(new Set<ExecutionStatus>([])),
});

/** True when transitioning from→to is allowed by the state machine. */
export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from].has(to);
}

/**
 * Validate and return the new status, or throw {@link InvalidTransitionError}.
 * Does not mutate any state — callers apply the returned value themselves.
 */
export function transition(from: ExecutionStatus, to: ExecutionStatus): ExecutionStatus {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
  return to;
}

/** True when the status is terminal (no further transitions possible). */
export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** True when the status indicates in-flight execution. */
export function isActive(status: ExecutionStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

/** Return every status reachable from `from` in a single step. */
export function getAllowedTransitions(from: ExecutionStatus): ExecutionStatus[] {
  return [...TRANSITIONS[from]];
}

/**
 * Mutable status tracker. Thin wrapper that enforces the transition rules
 * on assignment. Useful when an object wants to own its status field while
 * still going through the validator.
 */
export class StateTracker {
  private _status: ExecutionStatus;

  constructor(initial: ExecutionStatus = 'idle') {
    this._status = initial;
  }

  public get status(): ExecutionStatus {
    return this._status;
  }

  /** Transition to a new status, throwing on illegal transitions. */
  public moveTo(to: ExecutionStatus): ExecutionStatus {
    this._status = transition(this._status, to);
    return this._status;
  }

  /** Attempt a transition; return false instead of throwing when illegal. */
  public tryMoveTo(to: ExecutionStatus): boolean {
    if (!canTransition(this._status, to)) return false;
    this._status = to;
    return true;
  }

  public get isTerminal(): boolean {
    return isTerminal(this._status);
  }

  public get isActive(): boolean {
    return isActive(this._status);
  }
}
