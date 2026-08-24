// src/lib/cron-auth.ts
// CRON_SECRET verification (M0.1) — replaces the x-internal-scheduler
// header bypass, which was indistinguishable from an attacker-set header.
// The secret lives server-side only; callers present it as a Bearer token
// (the same scheme Vercel Cron uses automatically).

import { timingSafeEqual } from 'crypto';

export function getCronSecret(): string | undefined {
  const secret = process.env.CRON_SECRET;
  return secret && secret.length > 0 ? secret : undefined;
}

/** Timing-safe comparison; a length mismatch fails closed. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * True when the request presents the expected CRON_SECRET as
 * `Authorization: Bearer <CRON_SECRET>`. Returns false whenever the
 * secret is not configured — fail closed, never fall back to a
 * hardcoded default.
 */
export function isCronRequest(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) return false;
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return false;
  return secretsMatch(header.slice(7).trim(), secret);
}
