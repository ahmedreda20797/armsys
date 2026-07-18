/**
 * ARM ERP — Workflow Runtime Retry Policy
 *
 * Retry infrastructure: declarative policy + delay calculation.
 * No actual retry loops yet — the {@link WorkflowExecutor} and dispatcher
 * layers consume these primitives to decide whether/how to retry.
 *
 * @module workflow-runtime/errors/RetryPolicy
 */

/** Strategy for computing the delay between retry attempts. */
export type BackoffStrategy = 'fixed' | 'linear' | 'exponential';

/**
 * Declarative retry policy. Immutable once constructed; mutating during
 * a retry loop must create a new instance.
 */
export interface RetryPolicyConfig {
  /** Maximum number of retry attempts. 0 disables retries. */
  readonly maxRetries: number;
  /** Base interval in ms (the first attempt's delay). */
  readonly intervalMs: number;
  /** Backoff strategy for computing subsequent delays. */
  readonly strategy: BackoffStrategy;
  /** Multiplier applied each step (exponential/linear). Defaults to 2. */
  readonly multiplier?: number;
  /** Optional upper bound on a single delay, in ms. */
  readonly maxIntervalMs?: number;
  /** Optional jitter factor 0..1 to apply to the computed delay. */
  readonly jitter?: number;
}

/** A materialized retry decision returned to the caller. */
export interface RetryDecision {
  /** True if another attempt should be made. */
  readonly shouldRetry: boolean;
  /** Delay in ms before the next attempt (0 when not retrying). */
  readonly delayMs: number;
  /** The attempt number that would be next (1-based). */
  readonly nextAttempt: number;
  /** Reason for the decision. */
  readonly reason: string;
}

/** Sensible default policy used when none is supplied. */
export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = Object.freeze({
  maxRetries: 3,
  intervalMs: 500,
  strategy: 'exponential',
  multiplier: 2,
  maxIntervalMs: 30_000,
  jitter: 0.2,
});

/**
 * Pure helper class for computing retry delays. Stateless and side-effect
 * free — safe to share across executions.
 */
export class RetryPolicy {
  constructor(private readonly config: RetryPolicyConfig = DEFAULT_RETRY_POLICY) {}

  /** True if the policy allows any retries at all. */
  public get enabled(): boolean {
    return this.config.maxRetries > 0;
  }

  /** Maximum attempts (1 initial + maxRetries). */
  public get maxAttempts(): number {
    return this.config.maxRetries + 1;
  }

  /**
   * Compute the delay for a 1-based `attempt` number (i.e. the delay before
   * performing attempt N). Returns 0 for the first attempt.
   */
  public delayFor(attempt: number): number {
    if (attempt <= 1) return 0;
    const { strategy, intervalMs, multiplier = 2, maxIntervalMs } = this.config;
    let raw: number;
    switch (strategy) {
      case 'fixed':
        raw = intervalMs;
        break;
      case 'linear':
        raw = intervalMs * (attempt - 1);
        break;
      case 'exponential':
      default:
        raw = intervalMs * Math.pow(multiplier, attempt - 2);
        break;
    }
    if (maxIntervalMs !== undefined) raw = Math.min(raw, maxIntervalMs);
    return Math.max(0, Math.floor(raw));
  }

  /**
   * Decide whether to retry given the current attempt count and an optional
   * error signal (handlers may flag non-retryable failures).
   */
  public decide(
    attempt: number,
    opts: { retryable?: boolean; error?: unknown } = {},
  ): RetryDecision {
    const { maxRetries } = this.config;

    if (attempt >= this.maxAttempts) {
      return {
        shouldRetry: false,
        delayMs: 0,
        nextAttempt: attempt,
        reason: `Max attempts (${this.maxAttempts}) reached`,
      };
    }
    if (opts.retryable === false) {
      return {
        shouldRetry: false,
        delayMs: 0,
        nextAttempt: attempt,
        reason: 'Handler flagged failure as non-retryable',
      };
    }
    const next = attempt + 1;
    const delay = this.applyJitter(this.delayFor(next));
    return {
      shouldRetry: true,
      delayMs: delay,
      nextAttempt: next,
      reason: `Retrying (attempt ${next}/${this.maxAttempts})`,
    };
  }

  /** Apply optional jitter so concurrent executions don't synchronize. */
  private applyJitter(delay: number): number {
    const { jitter = 0 } = this.config;
    if (!jitter || delay <= 0) return delay;
    const magnitude = delay * jitter;
    const offset = (Math.random() * 2 - 1) * magnitude;
    return Math.max(0, Math.floor(delay + offset));
  }
}

/** Build a {@link RetryPolicy} from a partial config (merging defaults). */
export function createRetryPolicy(
  partial: Partial<RetryPolicyConfig> = {},
): RetryPolicy {
  const config: RetryPolicyConfig = { ...DEFAULT_RETRY_POLICY, ...partial };
  return new RetryPolicy(config);
}
