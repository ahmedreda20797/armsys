// src/lib/auth.ts
// JWT Authentication System — replaces x-user-id header auth
// Uses jose for JWT (Edge Runtime compatible) and bcryptjs for password hashing

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
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<void> {
  const snapshot = await getAdminDb().ref('arm_erp/sessions').orderByChild('userId').equalTo(userId).get();
  if (snapshot.exists()) {
    const updates: Record<string, null> = {};
    snapshot.forEach((child: any) => {
      updates[child.key] = null;
    });
    if (Object.keys(updates).length > 0) {
      await getAdminDb().ref('arm_erp/sessions').update(updates);
    }
  }
}
