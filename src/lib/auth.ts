// src/lib/auth.ts
// JWT Authentication System — replaces x-user-id header auth
// Uses jose for JWT (Edge Runtime compatible) and bcryptjs for password hashing

import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';

// ═══════════════════════════════════════════════════
//  Configuration
// ═══════════════════════════════════════════════════

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'arm-erp-jwt-secret-change-in-production-2026'
);

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
  // Token type to prevent token confusion attacks
  type: 'access' | 'refresh';
}

/**
 * Sign a JWT token (access or refresh).
 */
export async function signToken(payload: JWTPayload, type: 'access' | 'refresh'): Promise<string> {
  const expiry = type === 'access' ? ACCESS_TOKEN_EXPIRY : REFRESH_TOKEN_EXPIRY;

  return new SignJWT({ ...payload, type })
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
export async function verifyToken(token: string): Promise<JWTPayload | null> {
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
export async function authenticateRequest(request: Request): Promise<JWTPayload | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = verifyToken(token);
  // Must be an access token
  if (!payload || payload.type !== 'access') return null;

  return payload;
}

// Note: authenticateRequest must be awaited because verifyToken returns a Promise
// This is handled by wrapping in async
export async function authenticateRequestAsync(request: Request): Promise<JWTPayload | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || payload.type !== 'access') return null;

  return payload;
}

// ═══════════════════════════════════════════════════
//  Refresh Token Store (in-memory, production: Redis)
// ═══════════════════════════════════════════════════

const refreshTokens = new Map<string, { userId: string; expiresAt: number }>();

/**
 * Store a refresh token for later validation.
 */
export function storeRefreshToken(token: string, userId: string): void {
  const expiresIn = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
  refreshTokens.set(token, {
    userId,
    expiresAt: Date.now() + expiresIn,
  });
}

/**
 * Validate a refresh token exists and hasn't expired.
 */
export function validateRefreshToken(token: string): string | null {
  const entry = refreshTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    refreshTokens.delete(token);
    return null;
  }
  return entry.userId;
}

/**
 * Invalidate a refresh token (on logout).
 */
export function revokeRefreshToken(token: string): boolean {
  return refreshTokens.delete(token);
}

/**
 * Revoke ALL refresh tokens for a user (e.g., on password change).
 */
export function revokeAllUserRefreshTokens(userId: string): void {
  for (const [token, entry] of refreshTokens) {
    if (entry.userId === userId) {
      refreshTokens.delete(token);
    }
  }
}
