// src/lib/auth.ts
// JWT Authentication System — replaces x-user-id header auth
// Uses jose for JWT (Edge Runtime compatible) and bcryptjs for password hashing

// §SERVER-ONLY BOUNDARY — password hashing/verification and the
// refresh-token store reach the Firebase ADMIN SDK (./firebase-server).
// Never import from client code (AuthContext uses /api/auth routes).
import 'server-only';

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

// ═══════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════

// ─── STARTUP VALIDATION: Fail securely if JWT_SECRET is missing ───
if (!process.env.JWT_SECRET) {
  console.error(
    '[CRITICAL SECURITY] JWT_SECRET environment variable is not set. ' +
    'The application cannot start securely. ' +
    'Set JWT_SECRET to a strong random value (min 32 characters) in your environment.'
  );
  throw new Error(
    'JWT_SECRET environment variable is required. ' +
    'Refusing to start with insecure configuration. ' +
    'Set JWT_SECRET to a strong random string (min 32 chars).'
  );
}

const _rawSecret = process.env.JWT_SECRET as string;
if (_rawSecret.length < 32) {
  console.error(
    `[CRITICAL SECURITY] JWT_SECRET is too short (${_rawSecret.length} chars). Minimum 32 characters required.`
  );
  throw new Error(
    `JWT_SECRET must be at least 32 characters long. Current length: ${_rawSecret.length}.`
  );
}

const JWT_SECRET = new TextEncoder().encode(_rawSecret);

const ACCESS_TOKEN_EXPIRY = '15m';    // Short-lived access token
const REFRESH_TOKEN_EXPIRY = '7d';   // Long-lived refresh token

// ═══════════════════════════════════════════════════
//  Password Hashing (bcrypt with 12 rounds minimum)
// ═══════════════════════════════════════════════════

/**
 * Hash a password using bcrypt with 12 salt rounds (minimum).
 * This is the ONLY way passwords should be stored.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, 12);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * Handles both legacy plaintext passwords and bcrypt hashes for migration.
 * Returns an object indicating whether:
 *  - valid: the password is correct
 *  - needsRehash: the password was stored as plaintext and needs migration
 */
export async function verifyPassword(
  plainPassword: string,
  storedPassword: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // Check if the stored password looks like a bcrypt hash
  if (storedPassword.startsWith('$2a$') || storedPassword.startsWith('$2b$')) {
    const isValid = await bcrypt.compare(plainPassword, storedPassword);
    return { valid: isValid, needsRehash: false };
  }

  // Legacy plaintext comparison — for migration
  const isValid = plainPassword === storedPassword;
  return { valid: isValid, needsRehash: isValid }; // Only rehash if the password is actually correct
}

// ═══════════════════════════════════════════════════
//  JWT Token Creation & Verification
// ═══════════════════════════════════════════════════

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

// Decoded token payload includes the type field set during signing
export interface DecodedToken extends JWTPayload {
  type: 'access' | 'refresh';
}

/**
 * Sign a JWT token (access or refresh).
 */
export async function signToken(payload: JWTPayload, type: 'access' | 'refresh'): Promise<string> {
  const expiry = type === 'access' ? ACCESS_TOKEN_EXPIRY : REFRESH_TOKEN_EXPIRY;

  return new SignJWT({ ...payload, type: type })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('arm-erp')
    .setExpirationTime(expiry)
    .sign(JWT_SECRET);
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null otherwise.
 */
export async function verifyToken(token: string): Promise<DecodedToken | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      issuer: 'arm-erp',
    });

    // Ensure token type is present (prevents token confusion)
    if (!payload.type || (payload.type !== 'access' && payload.type !== 'refresh')) {
      return null;
    }

    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
      type: payload.type as 'access' | 'refresh',
    };
  } catch {
    return null; // Token expired, invalid, or malformed
  }
}

/**
 * Extract JWT from Authorization header.
 * Supports "Bearer <token>" format.
 */
export function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7).trim();
}

/**
 * Authenticate a request by verifying the Bearer token.
 * Returns the JWT payload if valid, or null.
 */
export async function authenticateRequest(request: Request): Promise<DecodedToken | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = await verifyToken(token);
  // Must be an access token
  if (!payload || payload.type !== 'access') return null;

  return payload;
}

// Note: authenticateRequest must be awaited because verifyToken returns a Promise
// This is handled by wrapping in async
export async function authenticateRequestAsync(request: Request): Promise<DecodedToken | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || payload.type !== 'access') return null;

  return payload;
}

// ═══════════════════════════════════════════════════
//  Refresh Token Store — persisted in Firebase RTDB
//  Path: arm_erp/sessions/{tokenHash}
// ═══════════════════════════════════════════════════

import { getAdminDb } from './firebase-server';

function getSessionRef(tokenHash: string) {
  return getAdminDb().ref(`arm_erp/sessions/${tokenHash}`);
}

/** Create a short hash of the refresh token for use as RTDB key */
function hashToken(token: string): string {
  let h = 0;
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) - h + token.charCodeAt(i)) | 0;
  }
  return 'ses_' + Math.abs(h).toString(36);
}

/**
 * Store a refresh token for later validation.
 */
export async function storeRefreshToken(token: string, userId: string): Promise<void> {
  const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
  const tokenHash = hashToken(token);
  await getSessionRef(tokenHash).set({
    userId,
    tokenPrefix: token.slice(0, 20),
    expiresAt: Date.now() + expiresIn,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Validate a refresh token exists and hasn't expired.
 */
export async function validateRefreshToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);
  const snapshot = await getSessionRef(tokenHash).get();

  if (!snapshot.exists()) return null;

  const entry = snapshot.val();
  if (!entry || Date.now() > (entry.expiresAt || 0)) {
    // Expired — clean up
    await getSessionRef(tokenHash).remove();
    return null;
  }

  return entry.userId;
}

/**
 * Invalidate a refresh token (on logout).
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);
  await getSessionRef(tokenHash).remove();
  return true;
}

/**
 * Revoke ALL refresh tokens for a user (e.g., on password change).
 *
 * §SESSION-REVOKE-GUARD (Phase 2): the lookup of the user's sessions
 * is an indexed `orderByChild('userId')` query — the query shape
 * observed to hang indefinitely on this network when the index is
 * absent (same signature as the login lookup; see lib/db
 * §INDEXED-QUERY / findUserByEmail). An UNGUARDED hang here would
 * wedge the password-change flow forever, and — worse — a timeout
 * must NEVER be interpreted as a successful revocation while valid
 * refresh tokens remain active. The guard below therefore:
 *
 *   1. Hard-caps the indexed attempt (SESSION_QUERY_TIMEOUT_MS);
 *   2. Falls back to the proven full-node scan of `arm_erp/sessions`
 *      on ANY indexed failure (missing index, timeout, network
 *      error) — the same in-memory `userId` equality the indexed
 *      query computes, so both paths select exactly the same records;
 *   3. Opens a circuit breaker after repeated TIMEOUTS (the hang
 *      signature) so subsequent revocations skip the hung query —
 *      a fast error does not open it, and the first indexed success
 *      resets the streak;
 *   4. Drains the orphaned query after a timeout (the Admin SDK
 *      cannot cancel a pending query): its late resolution is
 *      ignored and its late rejection swallowed — the fallback's
 *      scan is the only result that ever drives the revocation;
 *   5. Deduplicates concurrent revocations for the SAME user through
 *      an in-flight registry — two simultaneous password changes
 *      share one lookup+revoke instead of issuing duplicate queries
 *      and duplicate null-updates;
 *   6. Fails EXPLICITLY: only when the revocation set was fully
 *      determined AND the null-update completed does this resolve.
 *      A failure of BOTH the indexed query and the fallback scan
 *      REJECTS — the caller (password change) must surface the
 *      failure, never report tokens revoked while sessions survive.
 */
const SESSION_QUERY_TIMEOUT_MS = 10_000;
const SESSION_BREAKER_THRESHOLD = 2;
const SESSION_BREAKER_COOLDOWN_MS = 5 * 60_000;

let sessionQueryTimeoutStreak = 0;
let sessionBreakerOpenUntil = 0;
const inflightRevocations = new Map<string, Promise<void>>();

/** Test hook — resets the session-lookup breaker and in-flight registry. */
export function resetSessionRevokeStateForTests(): void {
  sessionQueryTimeoutStreak = 0;
  sessionBreakerOpenUntil = 0;
  inflightRevocations.clear();
}

/** Drain an orphaned RTDB query (see §SESSION-REVOKE-GUARD #4). */
function drainOrphanedQuery<T>(promise: Promise<T>): void {
  promise.then(
    () => undefined, // late resolution — the fallback already served the caller
    () => undefined, // late rejection — never an unhandled rejection
  );
}

/**
 * Resolve the ids of ALL session records for `userId` — indexed
 * query first (hard-capped), full-node scan fallback (the path the
 * revocation relied on before Phase 2). Both failure modes of the
 * indexed attempt leave the revocation correctness to the scan.
 */
async function loadUserSessionIds(userId: string, queryTimeoutMs: number): Promise<string[]> {
  const sessionsRef = getAdminDb().ref('arm_erp/sessions');

  // Breaker open → the indexed query proved it hangs recently; go
  // straight to the scan without re-paying the timeout budget.
  if (Date.now() < sessionBreakerOpenUntil) {
    return scanUserSessionIds(sessionsRef, userId);
  }

  try {
    const indexedPromise = sessionsRef.orderByChild('userId').equalTo(userId).get();
    const snapshot = await Promise.race([
      indexedPromise,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          drainOrphanedQuery(indexedPromise);
          const err = new Error(`[auth] sessions indexed query exceeded ${queryTimeoutMs}ms (hung connection)`);
          (err as any).kind = 'timeout';
          reject(err);
        }, queryTimeoutMs);
        // Free the timer when the indexed query wins the race.
        indexedPromise.then(() => clearTimeout(timer), () => clearTimeout(timer));
      }),
    ]);
    sessionQueryTimeoutStreak = 0;
    const ids: string[] = [];
    snapshot.forEach((child: any) => {
      ids.push(child.key);
    });
    return ids;
  } catch (err: any) {
    const isTimeout = err?.kind === 'timeout';
    if (isTimeout) {
      sessionQueryTimeoutStreak += 1;
      if (sessionQueryTimeoutStreak >= SESSION_BREAKER_THRESHOLD) {
        sessionBreakerOpenUntil = Date.now() + SESSION_BREAKER_COOLDOWN_MS;
      }
    }
    console.warn(
      `[auth] revokeAllUserRefreshTokens: indexed sessions lookup failed ` +
      `(${isTimeout ? 'timeout' : 'error'}: ${String(err?.message ?? err).slice(0, 140)}) — ` +
      'falling back to the full sessions scan. Revocation is unaffected.' +
      (isTimeout && sessionBreakerOpenUntil > Date.now()
        ? ' Indexed path temporarily disabled (breaker open).'
        : '')
    );
    return scanUserSessionIds(sessionsRef, userId);
  }
}

/** The legacy revocation-set computation: full-node scan + strict in-memory userId equality. */
async function scanUserSessionIds(sessionsRef: any, userId: string): Promise<string[]> {
  const snapshot = await sessionsRef.get();
  const ids: string[] = [];
  snapshot.forEach((child: any) => {
    const val = child.val();
    if (val && val.userId === userId) ids.push(child.key);
  });
  return ids;
}export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  // §SESSION-REVOKE-GUARD #5 — concurrent revocations for the same
  // user share one operation; the registry entry is removed on both
  // outcomes so a FAILED revocation is retried fresh by the next
  // caller instead of being joined.
  const pending = inflightRevocations.get(userId);
  if (pending) return pending;

  const operation = (async () => {
    // The revocation set is fully determined only when this resolves —
    // an indexed timeout falls back to the scan INSIDE this call, and
    // a scan failure REJECTS (never an empty set masquerading as
    // "nothing to revoke").
    const sessionIds = await loadUserSessionIds(userId, SESSION_QUERY_TIMEOUT_MS);
    if (sessionIds.length === 0) return;

    const updates: Record<string, null> = {};
    for (const id of sessionIds) {
      updates[id] = null;
    }
    await getAdminDb().ref('arm_erp/sessions').update(updates);
  })();

  const tracked = operation.finally(() => {
    inflightRevocations.delete(userId);
  });
  inflightRevocations.set(userId, tracked);
  return tracked;
}
