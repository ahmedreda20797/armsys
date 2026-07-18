/**
 * ARM ERP — Workflow Runtime V1 Execution Logger
 *
 * Structured logging for every execution. Each log entry carries:
 *
 *   timestamp | workflowId | executionId | nodeId | level | message | metadata
 *
 * Levels: Debug | Info | Warning | Error
 *
 * Pure TypeScript, in-memory ring buffer. A future database-backed logger
 * can replace the storage layer behind the same interface (sink injection).
 *
 * @module workflow-runtime/logging/ExecutionLogger
 */

import {
  type LogEntry,
  type LogLevel,
  type VariableValue,
} from '../types/runtime.types';

/** Optional external sink (e.g. console, Firestore, Datadog). */
export type LogSink = (entry: LogEntry) => void;

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  Debug: 10,
  Info: 20,
  Warning: 30,
  Error: 40,
};

export interface ExecutionLoggerOptions {
  /** Minimum level to emit (default: 'Debug'). */
  minLevel?: LogLevel;
  /** Max entries to retain in memory (default: 1000; oldest evicted). */
  capacity?: number;
  /** Optional external sink. */
  sink?: LogSink;
  /** Whether logging is enabled. */
  enabled?: boolean;
}

export class ExecutionLogger {
  private readonly entries: LogEntry[] = [];
  private readonly minLevel: LogLevel;
  private readonly capacity: number;
  private readonly sink?: LogSink;
  private enabled: boolean;

  constructor(options: ExecutionLoggerOptions = {}) {
    this.minLevel = options.minLevel ?? 'Debug';
    this.capacity = options.capacity ?? 1_000;
    this.sink = options.sink;
    this.enabled = options.enabled ?? true;
  }

  /** Enable logging. */
  public enable(): void {
    this.enabled = true;
  }

  /** Disable logging (subsequent calls are no-ops). */
  public disable(): void {
    this.enabled = false;
  }

  /** Log a Debug message. */
  public debug(
    ctx: LogContext,
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    this.log('Debug', ctx, message, metadata);
  }

  /** Log an Info message. */
  public info(
    ctx: LogContext,
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    this.log('Info', ctx, message, metadata);
  }

  /** Log a Warning message. */
  public warn(
    ctx: LogContext,
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    this.log('Warning', ctx, message, metadata);
  }

  /** Log an Error message. */
  public error(
    ctx: LogContext,
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    this.log('Error', ctx, message, metadata);
  }

  /** Generic entry point that filters by level. */
  public log(
    level: LogLevel,
    ctx: LogContext,
    message: string,
    metadata?: Record<string, VariableValue>,
  ): void {
    if (!this.enabled) return;
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minLevel]) return;

    const entry: LogEntry = {
      timestamp: Date.now(),
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      nodeId: ctx.nodeId,
      level,
      message,
      metadata,
    };
    this.entries.push(entry);
    // Evict oldest once capacity is exceeded (ring-buffer behaviour).
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    if (this.sink) {
      try {
        this.sink(entry);
      } catch {
        /* swallow sink errors — never let logging crash execution */
      }
    }
  }

  /** All entries in insertion order (optionally filtered by level). */
  public all(level?: LogLevel): readonly LogEntry[] {
    return level ? this.entries.filter((e) => e.level === level) : this.entries;
  }

  /** Entries filtered by execution id. */
  public forExecution(executionId: string): readonly LogEntry[] {
    return this.entries.filter((e) => e.executionId === executionId);
  }

  /** Latest entry, or undefined when empty. */
  public last(): LogEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** Total entry count. */
  public get length(): number {
    return this.entries.length;
  }

  /** Clear all entries. */
  public clear(): void {
    this.entries.length = 0;
  }

  /** Serialize to a plain array. */
  public toJSON(): LogEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }
}

/** Minimal context required to log an entry. */
export interface LogContext {
  workflowId: string;
  executionId: string;
  nodeId?: string;
}

/** Convenience factory. */
export function createExecutionLogger(options: ExecutionLoggerOptions = {}): ExecutionLogger {
  return new ExecutionLogger(options);
}
