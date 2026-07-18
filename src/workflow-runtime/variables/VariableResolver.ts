/**
 * ARM ERP — Workflow Runtime V1 Variable Engine
 *
 * Multi-scope variable storage with strict precedence:
 *
 *   global < workflow < execution < temp < nodeOutput
 *
 * Higher-precedence scopes shadow lower-precedence keys on read.
 *
 * Supports: get / set / update / remove / exists / snapshot / restore.
 *
 * Pure TypeScript, in-memory. Designed so a future Redis/Firebase backend
 * can replace the in-memory maps without changing the public API.
 *
 * @module workflow-runtime/variables/VariableResolver
 */

import {
  type VariableScope,
  type VariableValue,
  type VariableSnapshotScoped,
  SCOPE_PRECEDENCE,
} from '../types/runtime.types';
import { VariableMissingError } from '../errors/RuntimeErrors';

/** Snapshot shape — useful for restore(). */
export type VariableSnapshot = VariableSnapshotScoped;

interface ScopedEntry {
  value: VariableValue;
  updatedAt: number;
}

/** Update callback signature for update(). */
export type VariableUpdater = (current: VariableValue | undefined) => VariableValue;

/**
 * Variable resolver/store hybrid. Stores variables in layered scopes and
 * resolves them with precedence. All mutations return `this` for chaining.
 */
export class VariableResolver {
  /** scope → (key → entry). */
  private readonly scopes: Record<VariableScope, Map<string, ScopedEntry>> = {
    global: new Map(),
    workflow: new Map(),
    execution: new Map(),
    temp: new Map(),
    nodeOutput: new Map(),
  };

  /** Monotonic revision counter — bumped on every mutation. */
  private revision = 0;

  /* ─── reads ────────────────────────────────────────────────────────── */

  /**
   * Resolve a key by precedence. Returns `undefined` when absent.
   * Supports dot-path descent into nested objects (e.g. "employee.name").
   */
  public get(key: string): VariableValue {
    const path = key.split('.');
    const head = path[0];
    for (let i = SCOPE_PRECEDENCE.length - 1; i >= 0; i--) {
      const scope = this.scopes[SCOPE_PRECEDENCE[i]];
      const entry = scope.get(head);
      if (entry !== undefined) {
        return descend(entry.value, path.slice(1), key);
      }
    }
    return undefined;
  }

  /** Get a value or throw {@link VariableMissingError} when absent. */
  public require(key: string): VariableValue {
    const v = this.get(key);
    if (v === undefined) throw new VariableMissingError(key);
    return v;
  }

  /** True when the key is present in any scope. */
  public exists(key: string): boolean {
    const head = key.split('.')[0];
    return SCOPE_PRECEDENCE.some((scope) => this.scopes[scope].has(head));
  }

  /* ─── writes ───────────────────────────────────────────────────────── */

  /** Write a value to a scope (default: execution). Returns `this`. */
  public set(key: string, value: VariableValue, scope: VariableScope = 'execution'): this {
    const head = key.split('.')[0];
    this.scopes[scope].set(head, { value, updatedAt: Date.now() });
    this.revision += 1;
    return this;
  }

  /** Bulk-merge values into a scope. */
  public setMany(values: Record<string, VariableValue>, scope: VariableScope = 'execution'): this {
    for (const [k, v] of Object.entries(values)) this.set(k, v, scope);
    return this;
  }

  /**
   * Functional update. Reads the current value (by precedence) and writes
   * the returned value back to the given scope.
   */
  public update(key: string, updater: VariableUpdater, scope: VariableScope = 'execution'): this {
    const current = this.get(key);
    const next = updater(current);
    return this.set(key, next, scope);
  }

  /** Remove a key. Optionally restrict to a single scope. */
  public remove(key: string, scope?: VariableScope): this {
    const head = key.split('.')[0];
    if (scope) {
      this.scopes[scope].delete(head);
    } else {
      SCOPE_PRECEDENCE.forEach((s) => this.scopes[s].delete(head));
    }
    this.revision += 1;
    return this;
  }

  /** Remove all keys in a scope. */
  public clearScope(scope: VariableScope): this {
    this.scopes[scope].clear();
    this.revision += 1;
    return this;
  }

  /** Remove all keys in every scope. */
  public clear(): this {
    SCOPE_PRECEDENCE.forEach((s) => this.scopes[s].clear());
    this.revision += 1;
    return this;
  }

  /* ─── snapshots ────────────────────────────────────────────────────── */

  /** Flat merged view with precedence applied. */
  public snapshot(): Record<string, VariableValue> {
    const merged: Record<string, VariableValue> = {};
    for (const scope of SCOPE_PRECEDENCE) {
      this.scopes[scope].forEach((entry, key) => {
        merged[key] = entry.value;
      });
    }
    return merged;
  }

  /** Per-scope breakdown — matches the {@link VariableSnapshotScoped} shape. */
  public snapshotScoped(): VariableSnapshotScoped {
    const toObject = (m: Map<string, ScopedEntry>): Record<string, VariableValue> => {
      const o: Record<string, VariableValue> = {};
      m.forEach((e, k) => (o[k] = e.value));
      return o;
    };
    return {
      global: toObject(this.scopes.global),
      workflow: toObject(this.scopes.workflow),
      execution: toObject(this.scopes.execution),
      temp: toObject(this.scopes.temp),
      nodeOutput: toObject(this.scopes.nodeOutput),
    };
  }

  /** Monotonic revision counter. */
  public getRevision(): number {
    return this.revision;
  }

  /* ─── restore ──────────────────────────────────────────────────────── */

  /**
   * Restore a previously captured snapshot (e.g. from serialize/deserialize).
   * Replaces every scope's contents.
   */
  public restore(snapshot: Partial<VariableSnapshot>): this {
    this.clear();
    if (snapshot.global) this.setMany(snapshot.global, 'global');
    if (snapshot.workflow) this.setMany(snapshot.workflow, 'workflow');
    if (snapshot.execution) this.setMany(snapshot.execution, 'execution');
    if (snapshot.temp) this.setMany(snapshot.temp, 'temp');
    if (snapshot.nodeOutput) this.setMany(snapshot.nodeOutput, 'nodeOutput');
    return this;
  }
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

function descend(root: VariableValue, segments: string[], fullPath: string): VariableValue {
  let current: VariableValue = root;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, VariableValue>)[seg];
  }
  void fullPath;
  return current;
}

/** Convenience factory. */
export function createVariableResolver(): VariableResolver {
  return new VariableResolver();
}
