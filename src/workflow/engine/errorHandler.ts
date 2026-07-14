/**
 * Workflow Error Handler
 * Applies error strategies: retry, recover, rollback, skip, abort, escalate.
 */

import type {
  WorkflowError,
  ErrorStrategy,
  WorkflowErrorCategory,
  RetryPolicy,
} from '../types';

export function buildWorkflowError(
  message: string,
  instanceId: string,
  strategy: ErrorStrategy,
  category: WorkflowErrorCategory,
  stepId: string | null,
  retryCount: number,
  originalError?: unknown
): WorkflowError {
  return {
    code: `${category.toUpperCase()}_${Date.now()}`,
    message,
    category,
    stepId,
    instanceId,
    strategy,
    retryCount,
    timestamp: new Date().toISOString(),
    originalError,
  };
}

export function shouldRetry(policy: RetryPolicy, currentAttempt: number): boolean {
  return currentAttempt < policy.maxAttempts;
}

export function getBackoffDelay(policy: RetryPolicy, attempt: number): number {
  const delay = policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt);
  return Math.min(delay, policy.maxBackoffMs);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  onRetry?: (attempt: number, error: unknown) => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < policy.maxAttempts) {
        onRetry?.(attempt + 1, err);
        const delay = getBackoffDelay(policy, attempt);
        await new Promise((res) => setTimeout(res, delay));
      }
    }
  }
  throw lastError;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoffMs: 500,
  backoffMultiplier: 2,
  maxBackoffMs: 10_000,
};
