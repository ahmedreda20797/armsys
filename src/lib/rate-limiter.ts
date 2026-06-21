// src/lib/rate-limiter.ts
// In-memory rate limiter for login brute-force protection
// Production: replace with Redis-backed implementation

interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lockedUntil: number | null;
}

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes lockout

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.lockedUntil && now > entry.lockedUntil) {
      // Lockout expired, reset
      rateLimitStore.delete(key);
    } else if (now - entry.firstAttemptAt > WINDOW_MS && !entry.lockedUntil) {
      // Window expired without lockout, reset
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitResult {
  allowed: boolean;
  remainingAttempts: number;
  lockedUntil: number | null;
  retryAfterSeconds: number | null;
}

/**
 * Check rate limit for a given identifier (email or IP).
 * Call this BEFORE processing a login attempt.
 */
export function checkRateLimit(identifier: string): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  if (!entry) {
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS,
      lockedUntil: null,
      retryAfterSeconds: null,
    };
  }

  // Check if currently locked out
  if (entry.lockedUntil && now < entry.lockedUntil) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: entry.lockedUntil,
      retryAfterSeconds,
    };
  }

  // Check if window has expired (no active lockout)
  if (now - entry.firstAttemptAt > WINDOW_MS) {
    rateLimitStore.delete(identifier);
    return {
      allowed: true,
      remainingAttempts: MAX_ATTEMPTS,
      lockedUntil: null,
      retryAfterSeconds: null,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - entry.attempts,
    lockedUntil: null,
    retryAfterSeconds: null,
  };
}

/**
 * Record a failed attempt for the given identifier.
 * Returns the updated rate limit status.
 */
export function recordFailedAttempt(identifier: string): RateLimitResult {
  const now = Date.now();
  let entry = rateLimitStore.get(identifier);

  if (!entry || (now - entry.firstAttemptAt > WINDOW_MS && !entry.lockedUntil)) {
    entry = {
      attempts: 0,
      firstAttemptAt: now,
      lockedUntil: null,
    };
    rateLimitStore.set(identifier, entry);
  }

  entry.attempts += 1;

  // Lock after exceeding max attempts
  if (entry.attempts >= MAX_ATTEMPTS) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    const retryAfterSeconds = Math.ceil(LOCKOUT_DURATION_MS / 1000);
    return {
      allowed: false,
      remainingAttempts: 0,
      lockedUntil: entry.lockedUntil,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - entry.attempts,
    lockedUntil: null,
    retryAfterSeconds: null,
  };
}

/**
 * Reset rate limit on successful login.
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}
