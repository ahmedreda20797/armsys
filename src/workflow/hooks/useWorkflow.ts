/**
 * Workflow React Hooks
 * Client-side hooks for consuming the workflow foundation.
 * No UI components — infrastructure only.
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import type {
  WorkflowInstance,
  WorkflowStatus,
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowModule,
  WorkflowContext,
} from '../types';

// ─────────────────────────────────────────────────────────────
// useWorkflowStatus
// ─────────────────────────────────────────────────────────────

export function useWorkflowStatus(initialStatus?: WorkflowStatus) {
  const [status, setStatus] = useState<WorkflowStatus>(initialStatus ?? 'draft');
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback((next: WorkflowStatus) => {
    setStatus(next);
    if (next !== 'failed') setError(null);
  }, []);

  const setFailed = useCallback((message: string) => {
    setStatus('failed');
    setError(message);
  }, []);

  return { status, error, updateStatus, setFailed };
}

// ─────────────────────────────────────────────────────────────
// useWorkflowExecution
// ─────────────────────────────────────────────────────────────

interface UseWorkflowExecutionOptions {
  onComplete?: (instance: WorkflowInstance) => void;
  onError?: (error: string) => void;
}

export function useWorkflowExecution(options?: UseWorkflowExecutionOptions) {
  const [instance, setInstance] = useState<WorkflowInstance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const start = useCallback(
    async (
      workflowId: string,
      ctx: Partial<WorkflowContext>,
      executor: (id: string, ctx: Partial<WorkflowContext>) => Promise<WorkflowInstance>
    ) => {
      abortRef.current = false;
      setLoading(true);
      setError(null);
      try {
        const result = await executor(workflowId, ctx);
        if (!abortRef.current) {
          setInstance(result);
          options?.onComplete?.(result);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!abortRef.current) {
          setError(msg);
          options?.onError?.(msg);
        }
      } finally {
        if (!abortRef.current) setLoading(false);
      }
    },
    [options]
  );

  const reset = useCallback(() => {
    abortRef.current = true;
    setInstance(null);
    setError(null);
    setLoading(false);
  }, []);

  return { instance, loading, error, start, reset };
}

// ─────────────────────────────────────────────────────────────
// useWorkflowRegistry
// ─────────────────────────────────────────────────────────────

export function useWorkflowRegistry(
  fetcher: (module?: WorkflowModule) => WorkflowRegistryEntry[],
  module?: WorkflowModule
) {
  const [entries] = useState<WorkflowRegistryEntry[]>(() => fetcher(module));
  return { entries };
}

// ─────────────────────────────────────────────────────────────
// useWorkflowHistory
// ─────────────────────────────────────────────────────────────

export function useWorkflowHistory(
  fetcher: (workflowId: string) => WorkflowHistoryEntry[],
  workflowId: string
) {
  const [history, setHistory] = useState<WorkflowHistoryEntry[]>(() =>
    fetcher(workflowId)
  );

  const refresh = useCallback(() => {
    setHistory(fetcher(workflowId));
  }, [fetcher, workflowId]);

  return { history, refresh };
}

// ─────────────────────────────────────────────────────────────
// useWorkflowVariables
// ─────────────────────────────────────────────────────────────

export function useWorkflowVariables(initial: Record<string, unknown> = {}) {
  const [variables, setVariables] = useState<Record<string, unknown>>(initial);

  const set = useCallback((key: string, value: unknown) => {
    setVariables((prev) => ({ ...prev, [key]: value }));
  }, []);

  const merge = useCallback((updates: Record<string, unknown>) => {
    setVariables((prev) => ({ ...prev, ...updates }));
  }, []);

  const reset = useCallback(() => setVariables(initial), [initial]);

  return { variables, set, merge, reset };
}
