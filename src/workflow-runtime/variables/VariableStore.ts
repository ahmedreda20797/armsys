/**
 * ARM ERP — Workflow Runtime Variable Store
 *
 * In-memory, multi-scope variable storage. No persistence. Scopes follow a
 * strict precedence (global < workflow < execution < temp); higher-precedence
 * scopes shadow lower-precedence keys on read.
 *
 * Mutation methods return the store for chaining and emit no events directly;
 * the executor is responsible for raising `variable_changed` events when it
 * observes writes through the public API.
 *
 * @module workflow-runtime/variables/VariableStore
 */

import {
  type VariableValue,
  type VariableScope,
  type VariableEntry,
  type VariableSnapshotRead,
  type VariableSnapshotScoped,
  SCOPE_PRECEDENCE,
} from '../types/runtime';

/**
 * Layered, mutable variable store. Internally a Map per scope for O(1)
 * access; a merged view is computed lazily on {@link snapshot}.
 */
export class VariableStore {
  /** Scope → (key → entry). Entries are recreated on write (immutable values). */
  private readonly scopes: Record<VariableScope, Map<string, VariableEntry>> = {
    global: new Map(),
    workflow: new Map(),
    execution: new Map(),
    temp: new Map(),
  };

  /** Revision counter — bumped on every write so consumers can detect change. */
  private revision = 0;

  /**
   * Read a value, respecting scope precedence. Returns `undefined` when the
   * key is absent from every scope.
   */
  public get(key: string): VariableValue | undefined {
    for (let i = SCOPE_PRECEDENCE.length - 1; i >= 0; i--) {
      const entry = this.scopes[SCOPE_PRECEDENCE[i]].get(key);
      if (entry !== undefined) return entry.value;
    }
    return undefined;
  }

  /** True when `key` is present in any scope. */
  public has(key: string): boolean {
    return SCOPE_PRECEDENCE.some((scope) => this.scopes[scope].has(key));
  }

  /** Write a value to the given scope, returning the store for chaining. */
  public set(key: string, value: VariableValue, scope: VariableScope = 'execution'): this {
    if (!isValidScope(scope)) {
      throw new Error(`Invalid variable scope: ${scope}`);
    }
    this.scopes[scope].set(key, { scope, value, updatedAt: Date.now() });
    this.revision += 1;
    return this;
  }

  /** Bulk-merge values into a scope. */
  public setMany(
    values: Record<string, VariableValue>,
    scope: VariableScope = 'execution',
  ): this {
    for (const [k, v] of Object.entries(values)) this.set(k, v, scope);
    return this;
  }

  /** Remove a key from a specific scope. No-op if absent. */
  public remove(key: string, scope?: VariableScope): this {
    if (scope) {
      this.scopes[scope].delete(key);
    } else {
      (Object.keys(this.scopes) as VariableScope[]).forEach((s) => this.scopes[s].delete(key));
    }
    this.revision += 1;
    return this;
  }

  /** Remove every key in every scope. */
  public clear(): this {
    (Object.keys(this.scopes) as VariableScope[]).forEach((s) => this.scopes[s].clear());
    this.revision += 1;
    return this;
  }

  /** Remove every key in a single scope. */
  public clearScope(scope: VariableScope): this {
    this.scopes[scope].clear();
    this.revision += 1;
    return this;
  }

  /** Flat merged view (precedence applied). Frozen for caller safety. */
  public snapshot(): VariableSnapshotRead {
    const merged: Record<string, VariableValue> = {};
    for (const scope of SCOPE_PRECEDENCE) {
      this.scopes[scope].forEach((entry, key) => {
        merged[key] = entry.value;
      });
    }
    return Object.freeze(merged);
  }

  /** Per-scope breakdown — useful for debugging and history snapshots. */
  public snapshotScoped(): VariableSnapshotScoped {
    const toObject = (m: Map<string, VariableEntry>): Record<string, VariableValue> => {
      const o: Record<string, VariableValue> = {};
      m.forEach((e, k) => (o[k] = e.value));
      return o;
    };
    return Object.freeze({
      global: Object.freeze(toObject(this.scopes.global)),
      workflow: Object.freeze(toObject(this.scopes.workflow)),
      execution: Object.freeze(toObject(this.scopes.execution)),
      temp: Object.freeze(toObject(this.scopes.temp)),
    });
  }

  /** Monotonic revision counter. Useful for change detection. */
  public getRevision(): number {
    return this.revision;
  }
}

function isValidScope(s: string): s is VariableScope {
  return s === 'global' || s === 'workflow' || s === 'execution' || s === 'temp';
}

/** Convenience factory. */
export function createVariableStore(): VariableStore {
  return new VariableStore();
}
