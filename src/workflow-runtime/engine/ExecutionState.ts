/**
 * ARM ERP — Workflow Runtime V1 Execution State Machine
 *
 * Pure, side-effect-free transition table for {@link ExecutionState}.
 *
 * Legal transitions:
 *
 *   Idle         → Initializing
 *   Initializing → Running | Failed
 *   Running      → Waiting | Paused | Completed | Failed | Cancelled
 *   Waiting      → Running | Cancelled
 *   Paused       → Running | Cancelled
 *   Completed    → (terminal)
 *   Failed       → (terminal)
 *   Cancelled    → (terminal)
 *
 * Any unlisted transition throws {@link TransitionError}.
 *
 * @module workflow-runtime/engine/ExecutionState
 */

import { type ExecutionState, TERMINAL_STATES, ACTIVE_STATES } from '../types/runtime.types';
import { TransitionError } from '../errors/RuntimeErrors';

/** Adjacency map of legal transitions. Frozen and immutable. */
const TRANSITIONS: Readonly<Record<ExecutionState, ReadonlySet<ExecutionState>>> = Object.freeze({
  Idle: Object.freeze(new Set<ExecutionState>(['Initializing'])),
  Initializing: Object.freeze(new Set<ExecutionState>(['Running', 'Failed'])),
  Running: Object.freeze(
    new Set<ExecutionState>(['Waiting', 'Paused', 'Completed', 'Failed', 'Cancelled']),
  ),
  Waiting: Object.freeze(new Set<ExecutionState>(['Running', 'Cancelled'])),
  Paused: Object.freeze(new Set<ExecutionState>(['Running', 'Cancelled'])),
  Completed: Object.freeze(new Set<ExecutionState>([])),
  Failed: Object.freeze(new Set<ExecutionState>([])),
  Cancelled: Object.freeze(new Set<ExecutionState>([])),
});

/** True when transitioning from→to is allowed by the state machine. */
export function canTransition(from: ExecutionState, to: ExecutionState): boolean {
  return TRANSITIONS[from].has(to);
}

/**
 * Validate and return the new status, or throw {@link TransitionError}.
 * Pure — does not mutate any state. Callers apply the returned value.
 */
export function transition(from: ExecutionState, to: ExecutionState): ExecutionState {
  if (!canTransition(from, to)) {
    throw new TransitionError(from, to);
  }
  return to;
}

/** True when the status is terminal (no further transitions). */
export function isTerminal(status: ExecutionState): boolean {
  return TERMINAL_STATES.has(status);
}

/** True when the status indicates in-flight execution. */
export function isActive(status: ExecutionState): boolean {
  return ACTIVE_STATES.has(status);
}

/** Return every status reachable from `from` in a single step. */
export function getAllowedTransitions(from: ExecutionState): ExecutionState[] {
  return [...TRANSITIONS[from]];
}

/**
 * Mutable status tracker enforcing the transition rules on assignment.
 * Useful when an object wants to own its status field while still going
 * through the validator.
 */
export class StateTracker {
  private _status: ExecutionState;

  constructor(initial: ExecutionState = 'Idle') {
    this._status = initial;
  }

  public get status(): ExecutionState {
    return this._status;
  }

  /** Transition to a new status, throwing on illegal transitions. */
  public moveTo(to: ExecutionState): ExecutionState {
    this._status = transition(this._status, to);
    return this._status;
  }

  /** Attempt a transition; return false instead of throwing when illegal. */
  public tryMoveTo(to: ExecutionState): boolean {
    if (!canTransition(this._status, to)) return false;
    this._status = to;
    return true;
  }

  /** Force-set without validation (used for restart/reset only). */
  public reset(to: ExecutionState = 'Idle'): void {
    this._status = to;
  }

  public get isTerminal(): boolean {
    return isTerminal(this._status);
  }

  public get isActive(): boolean {
    return isActive(this._status);
  }
}
