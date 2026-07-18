/**
 * ARM ERP — Workflow Runtime V1 Serialization
 *
 * JSON-only serialization of the RuntimeContext. Future database persistence
 * (Firestore, Redis, Postgres) MUST use these methods — they define the
 * canonical wire format.
 *
 * Public API:
 *   serialize(context)   → JSON-safe plain object
 *   deserialize(payload) → validated plain object (typed)
 *   exportExecution()    → JSON string ready for transport / storage
 *   importExecution()    → parse a JSON string back into a payload
 *
 * Notes:
 *   - `serialize` does NOT rehydrate class instances (RuntimeContext carries
 *     live state and a state machine). Instead it produces a plain snapshot
 *     that can be fed back into a new RuntimeContext for resume / replay.
 *   - All dates are stored as epoch ms (numbers).
 *
 * @module workflow-runtime/serialization/RuntimeSerializer
 */

import type {
  RuntimeContext as RuntimeContextDTO,
  VariableSnapshotScoped,
  HistoryEntry,
  LogEntry,
} from '../types/runtime.types';
import type { RuntimeContext } from '../engine/RuntimeContext';
import { SerializationError } from '../errors/RuntimeErrors';

/** Serialized payload shape — JSON-safe. */
export interface SerializedRuntime {
  schemaVersion: 1;
  workflowId: string;
  workflowVersion: number;
  executionId: string;
  status: string;
  currentNodeId: string | null;
  visitedNodes: string[];
  pendingNodes: string[];
  variables: VariableSnapshotScoped;
  executionHistory: HistoryEntry[];
  logs: LogEntry[];
  metadata: Record<string, unknown>;
  startedAt: number | null;
  endedAt: number | null;
  errors: Array<Record<string, unknown>>;
}

const SCHEMA_VERSION = 1 as const;

export class RuntimeSerializer {
  /** Serialize a live RuntimeContext into a JSON-safe plain object. */
  public serialize(context: RuntimeContext): SerializedRuntime {
    try {
      return {
        schemaVersion: SCHEMA_VERSION,
        workflowId: context.workflowId,
        workflowVersion: context.workflowVersion,
        executionId: context.executionId,
        status: context.status,
        currentNodeId: context.currentNodeId,
        visitedNodes: [...context.visitedNodes],
        pendingNodes: [...context.pendingNodes],
        variables: deepClone(context.variableSnapshot),
        executionHistory: context.executionHistory.map((h) => deepClone(h) as HistoryEntry),
        logs: context.logs.map((l) => deepClone(l) as LogEntry),
        metadata: deepClone(context.metadata),
        startedAt: context.startedAt,
        endedAt: context.endedAt,
        errors: context.errors.map((e) => e.toJSON()),
      };
    } catch (err) {
      throw new SerializationError(
        `Failed to serialize runtime context: ${err instanceof Error ? err.message : String(err)}`,
        'serialize',
      );
    }
  }

  /**
   * Validate and return a deserialized payload. Does NOT reconstruct a live
   * RuntimeContext — callers feed this payload into a new context when
   * resuming / replaying.
   */
  public deserialize(payload: unknown): SerializedRuntime {
    if (!isObject(payload)) {
      throw new SerializationError('Deserialization payload is not an object.', 'deserialize');
    }
    if (payload.schemaVersion !== SCHEMA_VERSION) {
      throw new SerializationError(
        `Unsupported schema version: expected ${SCHEMA_VERSION}, got ${String(
          payload.schemaVersion,
        )}.`,
        'deserialize',
      );
    }
    const required = [
      'workflowId',
      'workflowVersion',
      'executionId',
      'status',
      'variables',
      'executionHistory',
      'logs',
    ];
    for (const key of required) {
      if (!(key in payload)) {
        throw new SerializationError(`Missing required field "${key}".`, 'deserialize');
      }
    }
    return payload as unknown as SerializedRuntime;
  }

  /** Export an execution as a JSON string (transport/storage ready). */
  public exportExecution(context: RuntimeContext): string {
    const payload = this.serialize(context);
    try {
      return JSON.stringify(payload);
    } catch (err) {
      throw new SerializationError(
        `Failed to stringify execution: ${err instanceof Error ? err.message : String(err)}`,
        'exportExecution',
      );
    }
  }

  /** Import a JSON string and return a validated payload. */
  public importExecution(json: string): SerializedRuntime {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      throw new SerializationError(
        `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`,
        'importExecution',
      );
    }
    return this.deserialize(parsed);
  }

  /** Convenience: round-trip a context through JSON (deep clone). */
  public clone(context: RuntimeContext): SerializedRuntime {
    return this.deserialize(this.exportExecution(context));
  }
}

/** Convenience factory. */
export function createRuntimeSerializer(): RuntimeSerializer {
  return new RuntimeSerializer();
}

/** Also expose the DTO type under its spec name for callers that want it. */
export type { RuntimeContextDTO };

/* ─── helpers ─────────────────────────────────────────────────────────── */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Structured deep clone (JSON is the canonical format per spec). */
function deepClone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
