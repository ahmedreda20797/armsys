// ══════════════════════════════════════════════════════════════
//  GET /api/ai/health — live provider health check (Phase 6.4, §24)
//
//  Admin-only. Performs the SERVER-SIDE health check: configuration
//  booleans + a MINIMAL SAFE provider round-trip (no ARM data, tiny
//  token budget). Response contains SAFE fields only (§3/§24):
//  providerReachable / modelAccepted / operational / errorCategory.
//  Secrets, headers and raw provider bodies are never returned.
// ══════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/verify-permission';
import { forbiddenError, internalError, logServerFailure, unauthorizedError } from '@/lib/api-error';
import { runProviderHealthCheck } from '@/lib/ai/provider/health';
import { isAdminRole } from '@/lib/ai/gateway/provider-settings';
import { checkAIRateLimit } from '@/lib/ai/gateway/rate-limit';

// Phase 6.5-A §14: health performs a REAL bounded provider round-trip.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth) return unauthorizedError();
    if (!isAdminRole(auth.role)) return forbiddenError('هذه الصلاحية للمدير النظامي فقط');

    // Health probes hit the real provider — rate-limit them too (§23).
    if (!checkAIRateLimit(auth.userId, 'health')) {
      return Response.json(
        { status: 'RATE_LIMITED', message: 'طلبات فحص كثيرة — انتظر لحظة ثم أعد المحاولة.' },
        { status: 429 },
      );
    }

    const health = await runProviderHealthCheck();
    return Response.json({ status: 'OK', health });
  } catch (error) {
    logServerFailure('ai-health', 'GET', error);
    return internalError();
  }
}
